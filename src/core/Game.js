import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { GameState, STATE } from './GameState.js';
import { GameLoop } from './GameLoop.js';
import { createScene, applyQuality, QUALITY } from '../scene/createScene.js';
import { Lighting } from '../scene/Lighting.js';
import { Environment } from '../scene/Environment.js';
import { TerrainData } from '../scene/TerrainData.js';
import { TrackGeometry } from '../track/TrackGeometry.js';
import { Hungaroring } from '../track/Hungaroring.js';
import { computeBarrierLines, createTrackColliders } from '../track/TrackColliders.js';
import { buildCheckpoints } from '../track/Checkpoints.js';
import { FormulaCar, LIVERIES } from '../vehicle/FormulaCar.js';
import { VehiclePhysics, CAR_SPEC } from '../vehicle/VehiclePhysics.js';
import { CarController } from '../vehicle/CarController.js';
import { CarAudio } from '../vehicle/CarAudio.js';
import { AIOpponentManager } from '../ai/AIOpponentManager.js';
import { RaceManager } from '../race/RaceManager.js';
import { formatTime } from '../race/LapSystem.js';
import { CameraManager, RACE_CAMERAS, CAMERA_LABELS } from '../camera/CameraManager.js';
import { Particles } from '../effects/Particles.js';
import { InputManager } from '../systems/InputManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Storage } from '../systems/LocalStorage.js';
import { MainMenu } from '../ui/MainMenu.js';
import { SettingsMenu } from '../ui/SettingsMenu.js';
import { ControlsPanel } from '../ui/ControlsPanel.js';
import { HUD } from '../ui/HUD.js';
import { Countdown } from '../ui/Countdown.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { ResultsScreen } from '../ui/ResultsScreen.js';
import { el } from '../ui/dom.js';

const FIXED_DT = 1 / 120;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3();

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.state = new GameState();
    this.time = 0;
    this.raceTime = 0;
    this.mode = 'race';
    this._transitioning = false;
  }

  // ------------------------------------------------------------------ boot
  async init(progress = () => {}) {
    progress(0.04, 'Starting physics engine');
    await RAPIER.init();
    this.RAPIER = RAPIER;
    this.settings = Storage.loadSettings();

    progress(0.1, 'Creating renderer');
    await nextFrame();
    const { renderer, scene, camera, quality } = createScene(this.canvas, this.settings.quality);
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;

    progress(0.18, 'Surveying the Hungaroring');
    await nextFrame();
    this.track = new TrackGeometry();
    this.checkpoints = buildCheckpoints(this.track);

    progress(0.3, 'Shaping the valley');
    await nextFrame();
    this.terrain = new TerrainData(this.track);
    this.barriers = computeBarrierLines(this.track);

    progress(0.45, 'Laying asphalt and kerbs');
    await nextFrame();
    this.lighting = new Lighting(scene, quality);
    this.circuit = new Hungaroring(scene, this.track, this.barriers, quality);
    this.circuit.addSectorBoards(this.checkpoints.sectorStarts);

    progress(0.58, 'Building grandstands and planting forests');
    await nextFrame();
    this.environment = new Environment(scene, this.track, this.terrain, this.barriers, QUALITY.high);
    this.environment.applyQuality(quality);

    progress(0.72, 'Preparing the cars');
    await nextFrame();
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.colliders = createTrackColliders(RAPIER, this.world, this.track, this.terrain, this.barriers);
    this.eventQueue = new RAPIER.EventQueue(true);

    const start = this.trackTransform(this.track.length - 30, 0);
    this.physics = new VehiclePhysics(RAPIER, this.world, { position: start.pos, quaternion: start.quat });
    this._proj = { index: 0 };
    this._sfcProj = { index: 0 };
    this.physics.setSurfaceSampler((x, z) => {
      this.track.project(x, z, this._sfcProj.index, this._sfcProj);
      return this.track.surfaceAt(this._sfcProj.index, this._sfcProj.lateral);
    });
    this.physics.onGearChange = (g, up) => this.audio && this.audio.gearShift(up);
    this.playerLivery = LIVERIES[0];
    this.playerCar = new FormulaCar(this.playerLivery);
    scene.add(this.playerCar.root);
    this.ai = new AIOpponentManager(RAPIER, this.world, scene, this.track);
    this.ai.setDifficulty(this.settings.difficulty);
    this.particles = new Particles(scene, 700);
    this.particles.setViewportHeight(window.innerHeight);

    progress(0.82, 'Wiring up the pit wall');
    await nextFrame();
    this.input = new InputManager();
    this.audio = new AudioManager(this.settings);
    this.carAudio = new CarAudio(this.audio);
    this.controller = new CarController(this.input, this.physics, this.track);
    this.cams = new CameraManager(camera);
    this.cams.shakeEnabled = this.settings.cameraShake;
    this.race = new RaceManager(this.track, this.checkpoints, (type, data) => this._onRaceEvent(type, data));
    this._buildUI();
    this._bindInput();

    progress(0.9, 'Warming up tyres');
    await nextFrame();
    this._enterMenuScene();
    this._frame(0, 0); // position everything once
    try {
      if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    } catch { /* optional */ }

    this.loop = new GameLoop(renderer, { fixedDt: FIXED_DT, fixed: (dt) => this._fixed(dt), frame: (dt, a) => this._frame(dt, a) });
    this.loop.start();
    progress(1, 'Ready');
    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this._onVisibility());
    this.state.set(STATE.MENU);
    this.menu.show(true);
    this.audio.playMusic(true);
  }

  /** World transform for a car on the track at distance s and lateral offset. */
  trackTransform(s, lateral, drop = 0.12) {
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    this.track.sampleAt(s, lateral, p, t);
    p.y += CAR_SPEC.wheelRadiusR + drop;
    const flat = new THREE.Vector3(t.x, 0, t.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), flat);
    // pitch to the slope
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.asin(THREE.MathUtils.clamp(t.y, -0.3, 0.3)));
    quat.multiply(pitch);
    return { pos: p, quat };
  }

  // ------------------------------------------------------------------ UI
  _buildUI() {
    const root = this.uiRoot;
    this.hud = new HUD(root, this.track, this.checkpoints);
    this.countdown = new Countdown(root, this.audio);
    this.menu = new MainMenu(root, this.audio, this.settings, {
      onRace: () => this.startSession('race'),
      onTrial: () => this.startSession('trial'),
      onSettings: () => this.settingsMenu.show(),
      onControls: () => this.controlsPanel.show(),
      onOptions: () => this.ai.setDifficulty(this.settings.difficulty),
    });
    this.settingsMenu = new SettingsMenu(root, this.audio, this.settings, (k, v) => this._applySetting(k, v));
    this.controlsPanel = new ControlsPanel(root, this.audio);
    this.pauseMenu = new PauseMenu(root, this.audio, {
      resume: () => this.resume(),
      restart: () => this.startSession(this.mode),
      controls: () => this.controlsPanel.show(),
      settings: () => this.settingsMenu.show(),
      menu: () => this.toMenu(),
    });
    this.results = new ResultsScreen(root, this.audio, {
      restart: () => this.startSession('race'),
      menu: () => this.toMenu(),
    });
    this.fade = el('div', 'fade');
    root.appendChild(this.fade);
  }

  _applySetting(key, value) {
    switch (key) {
      case 'quality': {
        const q = applyQuality(this.renderer, this.scene, value);
        this.quality = q;
        this.lighting.applyQuality(q);
        this.environment.applyQuality(q);
        this.particles.setViewportHeight(window.innerHeight);
        break;
      }
      case 'volume': this.audio.setVolume(value / 100); break;
      case 'muted': this.audio.setMuted(value); break;
      case 'music': this.audio.setMusicEnabled(value); break;
      case 'cameraShake': this.cams.shakeEnabled = value; break;
      case 'difficulty': this.ai.setDifficulty(value); break;
      case 'camera':
        if (this.state.is(STATE.RACING, STATE.COUNTDOWN) || this.state.previous === STATE.RACING) this.cams.setMode(value, { instant: false });
        break;
    }
    this.menu.refresh();
  }

  _bindInput() {
    const inp = this.input;
    inp.on('pause', () => {
      if (this.settingsMenu.visible) return this.settingsMenu.hide();
      if (this.controlsPanel.visible) return this.controlsPanel.hide();
      if (this.state.is(STATE.PAUSED)) return this.resume();
      if (this.state.is(STATE.COUNTDOWN, STATE.RACING) || (this.state.is(STATE.FINISHED) && !this.results.visible)) this.pause();
    });
    inp.on('camera', () => {
      if (!this.state.is(STATE.RACING, STATE.COUNTDOWN)) return;
      if (this.cams.mode === 'grid') return;
      const i = RACE_CAMERAS.indexOf(this.cams.mode);
      const next = RACE_CAMERAS[(i + 1) % RACE_CAMERAS.length];
      this.cams.setMode(next, { duration: 0.55 });
      this.hud.hint(CAMERA_LABELS[next], 1.6);
    });
    inp.on('reset', () => this.resetPlayerCar());
    inp.on('mute', () => {
      const m = this.audio.toggleMute();
      this.settings.muted = m;
      Storage.saveSettings(this.settings);
      this.settingsMenu.refresh();
      if (this.state.is(STATE.RACING, STATE.COUNTDOWN, STATE.FINISHED)) this.hud.hint(m ? 'SOUND OFF' : 'SOUND ON', 1.4);
    });
  }

  // ------------------------------------------------------------------ flow
  _withFade(fn) {
    if (this._transitioning) return;
    this._transitioning = true;
    this.fade.classList.add('on');
    setTimeout(() => {
      try {
        fn();
      } finally {
        // render one frame in the new state before revealing it
        requestAnimationFrame(() => {
          this.fade.classList.remove('on');
          this._transitioning = false;
        });
      }
    }, 420);
  }

  startSession(mode) {
    this._withFade(() => this._setupSession(mode));
  }

  _setupSession(mode) {
    this.mode = mode;
    this.state.mode = mode;
    this.menu.show(false);
    this.results.hide();
    this.pauseMenu.hide();
    this.settingsMenu.hide();
    this.controlsPanel.hide();
    this.countdown.cancel();
    this.hud.clearToasts();
    this.input.clear();
    this.particles.clear();
    this.audio.playMusic(false);

    const T = this.track;
    const slots = this.circuit.gridSlots;
    let spawn;
    if (mode === 'race') {
      const ps = slots[4];
      spawn = this.trackTransform(ps.s, ps.lateral);
      this.ai.setEnabled(true);
      this.ai.setDifficulty(this.settings.difficulty);
      this.ai.placeOnGrid(slots);
    } else {
      spawn = this.trackTransform(T.length - 160, -1.5);
      this.ai.setEnabled(false);
    }
    this.physics.body.setEnabled(true);
    this.physics.reset(spawn.pos, spawn.quat);
    this.physics.locked = true;
    this.physics.throttle = this.physics.brake = this.physics.steer = 0;
    this.controller.reset();
    this.controller.autopilot = false;
    this._proj = { index: undefined };
    T.project(spawn.pos.x, spawn.pos.z, undefined, this._proj);
    this._sfcProj.index = this._proj.index;
    this.playerCar.setVisible(true);

    // racers
    const racers = [{
      id: 'player', name: 'YOU', short: 'YOU', team: this.playerLivery.team, color: '#' + new THREE.Color(this.playerLivery.primary).getHexString(), isPlayer: true,
      getS: () => this._proj.s, getSpeed: () => this.physics.speed,
    }];
    if (mode === 'race') {
      for (const d of this.ai.drivers) {
        racers.push({
          id: d.profile.short, name: d.profile.name, short: d.profile.short, team: d.livery.team, color: '#' + new THREE.Color(d.livery.primary).getHexString(), isPlayer: false,
          getS: () => d.wrappedS, getSpeed: () => d.speed, driver: d,
        });
      }
    }
    this.race.setup(mode, this.settings.laps, racers);
    this.playerRacer = this.race.player;
    this.sectorCls = [null, null, null];
    this._offTimer = 0; this._offCooldown = 0; this._wrongTimer = 0; this._wrongCooldown = 0; this._resetCooldown = 0;
    this._limitTimer = 0; this._impactCooldown = 0; this._finishTimer = -1;
    this._prevVel = null;

    // camera: sweeping grid shot then settle into the race camera
    this.cams.resetRig(spawn.pos, spawn.quat);
    const front = new THREE.Vector3(), back = new THREE.Vector3();
    if (mode === 'race') {
      T.sampleAt(22, -10, front);
      front.y += 5.5;
      T.sampleAt(-28, 0, back);
      back.y += 0.6;
    } else {
      T.sampleAt(T.length - 140, -9, front);
      front.y += 3.5;
      back.copy(spawn.pos);
    }
    _fwd.set(0, 0, 1).applyQuaternion(spawn.quat);
    const to = spawn.pos.clone().addScaledVector(_fwd, -6.6);
    to.y += 1.95;
    this._gridShot = { from: front, to, focus: back };
    this.cams.setMode('grid', { instant: true });
    this.cams.gridT = mode === 'race' ? 0 : 2.2;

    this.hud.setMode(mode, mode === 'race' ? this.settings.laps : 0);
    this.hud.show(true);
    this.carAudio.setActive(true);
    this.environment.setExcitement(1);
    this.state.set(STATE.COUNTDOWN);
    this.countdown.start({
      preDelay: mode === 'race' ? 3.4 : 1.4,
      interval: mode === 'race' ? 1.0 : 0.55,
      holdMin: mode === 'race' ? 0.5 : 0.2,
      holdMax: mode === 'race' ? 2.2 : 0.6,
      caption: mode === 'race' ? `HUNGARORING · ${this.settings.laps} LAPS · 5 CARS` : 'TIME TRIAL · FLYING LAP STARTS AT THE LINE',
      onLights: (n, green) => this.circuit.setStartLights(n, green),
      onGo: () => this._go(),
    });
  }

  _go() {
    if (!this.state.is(STATE.COUNTDOWN)) return;
    this.state.set(STATE.RACING);
    this.physics.locked = false;
    this.race.start(this.raceTime);
    if (this.mode === 'race') this.ai.release();
    this.environment.setExcitement(0.45);
    if (this.cams.mode === 'grid') this.cams.setMode(this.settings.camera, { duration: 0.9 });
  }

  pause() {
    if (this.state.is(STATE.PAUSED)) return;
    this._pausedFrom = this.state.current;
    if (!this.state.set(STATE.PAUSED)) return;
    this.carAudio.setActive(false);
    this.input.clear();
    this.pauseMenu.show(this.mode);
  }

  resume() {
    if (!this.state.is(STATE.PAUSED)) return;
    this.settingsMenu.hide();
    this.controlsPanel.hide();
    this.pauseMenu.hide();
    this.state.set(this._pausedFrom || STATE.RACING);
    this.carAudio.setActive(true);
    this.input.clear();
  }

  toMenu() {
    this._withFade(() => {
      this.pauseMenu.hide();
      this.results.hide();
      this.countdown.cancel();
      this.hud.show(false);
      this.carAudio.setActive(false);
      this.state.set(STATE.MENU);
      this._enterMenuScene();
      this.menu.show(true);
      this.audio.playMusic(true);
    });
  }

  _enterMenuScene() {
    // showcase car parked in the pit lane in front of the garages
    const env = this.environment;
    const p = env.straightPoint(28, 21.5);
    p.y = this.track.heightAtS(28) + CAR_SPEC.wheelRadiusR - 0.008;
    const yaw = Math.atan2(env.t0.x, env.t0.z) + 0.42;
    this.showcase = { pos: p, quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) };
    this.physics.body.setEnabled(false);
    this.physics.locked = true;
    this.controller.autopilot = false;
    this.playerCar.root.position.copy(p);
    this.playerCar.root.quaternion.copy(this.showcase.quat);
    this.playerCar.update(0, { speed: 0, steer: 0.22, accelLong: 0, accelLat: 0, brake: 0 });
    this.ai.setEnabled(true);
    this.ai.setDifficulty(this.settings.difficulty);
    this.ai.placeDemo();
    this.particles.clear();
    this.circuit.setStartLights(0, false);
    this.cams.setMode('orbit', { instant: true });
    this.environment.setExcitement(0.25);
  }

  resetPlayerCar() {
    if (!this.state.is(STATE.RACING) || this._resetCooldown > 0) return;
    this._recoverToTrack();
    this.hud.notify('CAR RESET', '', 'yellow', 1.5);
  }

  /** Put the player car back on the racing surface just ahead of where it is. */
  _recoverToTrack() {
    const T = this.track;
    const s = this._proj.s + 6;
    let lat = THREE.MathUtils.clamp(this._proj.lateral, -3.5, 3.5);
    if (Math.abs(this._proj.lateral) > T.halfWidth) lat = T.interp(T.lineOffset, s);
    // avoid dropping onto an AI car
    for (const d of this.ai.drivers) {
      if (!d.enabled) continue;
      let ds = d.wrappedS - T.wrapS(s);
      if (ds > T.length / 2) ds -= T.length;
      if (ds < -T.length / 2) ds += T.length;
      if (Math.abs(ds) < 14 && Math.abs(d.lateral - lat) < 3) lat = d.lateral > 0 ? d.lateral - 3.6 : d.lateral + 3.6;
    }
    const tf = this.trackTransform(s, lat, 0.25);
    this.physics.reset(tf.pos, tf.quat);
    this.controller.reset();
    this.cams.resetRig(tf.pos, tf.quat);
    this._resetCooldown = 2;
  }

  // ------------------------------------------------------------------ race events
  _onRaceEvent(type, d) {
    const hud = this.hud;
    const audio = this.audio;
    switch (type) {
      case 'lap-start':
        if (this.mode === 'trial') { hud.notify('LAP STARTED', '', 'green', 1.5); this.sectorCls = [null, null, null]; }
        break;
      case 'sector':
        this.sectorCls[d.sector] = d.cls;
        hud.notify(`SECTOR ${d.sector + 1}`, d.sectorTime.toFixed(3), d.cls, 1.8);
        break;
      case 'lap': {
        const tr = d.racer.tracker;
        // sector 3 is classified by the race manager on lap completion
        if (d.s3cls) this.sectorCls[2] = d.s3cls;
        this._lastLapSectors = { times: d.sectors.slice(), cls: this.sectorCls.slice() };
        if (!d.valid) {
          hud.notify(`LAP ${d.lap}`, formatTime(d.lapTime) + ' · INVALID', 'red', 2.6);
        } else if (d.best) {
          const stored = Storage.loadBestLap(this.mode);
          const record = stored == null || d.lapTime < stored;
          if (record) Storage.saveBestLap(this.mode, d.lapTime);
          hud.notify(record ? 'NEW PERSONAL BEST' : 'BEST LAP', formatTime(d.lapTime), 'purple', 3);
          audio.lapChime(true);
        } else {
          hud.notify(`LAP ${d.lap}`, formatTime(d.lapTime), '', 2.4);
          audio.lapChime(false);
        }
        if (this.mode === 'race' && !tr.finished) {
          const remaining = this.race.totalLaps - tr.lapsCompleted;
          if (remaining === 1) setTimeout(() => hud.notify('FINAL LAP', '', 'red', 2.4), 900);
        }
        this.sectorCls = [null, null, null];
        break;
      }
      case 'position-gained':
        hud.notify('POSITION GAINED', 'P' + d.position, 'green', 1.8);
        break;
      case 'position-lost':
        hud.notify('POSITION LOST', 'P' + d.position, 'yellow', 1.6);
        break;
      case 'ai-finish':
        if (d.winner) hud.notify('CHEQUERED FLAG', d.racer.name + ' WINS', 'yellow', 3);
        d.racer.driver && (d.racer.driver.cooldown = true);
        break;
      case 'finish':
        this._onPlayerFinish(d);
        break;
    }
  }

  _onPlayerFinish(d) {
    const p = this.race.player;
    const pos = p.position;
    this.state.set(STATE.FINISHED);
    this.controller.autopilot = true;
    this.environment.setExcitement(1);
    this.hud.notify('RACE FINISHED', `P${pos}`, pos === 1 ? 'purple' : 'green', 3.5);
    this.audio.lapChime(true);
    const total = d.time - this.race.startTime;
    const tr = p.tracker;
    const prevBest = Storage.loadAllTimeBest();
    Storage.saveLastResult({ position: pos, total: this.race.racers.length, time: total, laps: this.race.totalLaps, bestLap: tr.bestLap, date: new Date().toISOString() });
    this._resultSummary = {
      position: pos,
      total: this.race.racers.length,
      totalTime: total,
      bestLap: tr.bestLap,
      lapTimes: tr.lapTimes.slice(),
      newRecord: tr.bestLap != null && (prevBest == null || tr.bestLap <= prevBest),
    };
    this._finishTimer = 3.2;
    setTimeout(() => this.state.is(STATE.FINISHED) && this.cams.setMode('finish', { duration: 1.5 }), 1200);
  }

  // ------------------------------------------------------------------ simulation
  _fixed(dt) {
    const st = this.state.current;
    if (st === STATE.MENU) {
      this.ai.fixedUpdate(dt, null);
      return;
    }
    if (st !== STATE.COUNTDOWN && st !== STATE.RACING && st !== STATE.FINISHED) return;
    const T = this.track;
    this.controller.update(dt, st === STATE.RACING);
    this.physics.preStep(dt);
    if (this.mode === 'race') {
      this._playerInfo = this._playerInfo || { ref: null, isPlayer: true };
      this._playerInfo.s = this._proj.s;
      this._playerInfo.lateral = this._proj.lateral;
      this._playerInfo.speed = this.physics.speed;
      this.ai.fixedUpdate(dt, this._playerInfo);
    }
    const lv0 = this.physics.body.linvel();
    const v0x = lv0.x, v0y = lv0.y, v0z = lv0.z;
    this.world.step(this.eventQueue);
    const lv1 = this.physics.body.linvel();
    // a real hit changes velocity abruptly; grinding along a wall does not
    const dv = Math.hypot(lv1.x - v0x, lv1.y - v0y, lv1.z - v0z);
    this.eventQueue.drainContactForceEvents((e) => {
      const f = e.totalForceMagnitude();
      if (f > 14000 && dv > 0.55 && this._impactCooldown <= 0) {
        const strength = Math.min(1, (f - 14000) / 60000);
        this._impactCooldown = 0.35;
        this.cams.addShake(0.18 + strength * 0.5);
        this.audio.impact(strength);
      }
    });
    this.physics.postStep(dt);
    this._impactCooldown -= dt;
    this._resetCooldown -= dt;
    this.raceTime += dt;
    const b = this.physics.currPos;
    T.project(b.x, b.z, this._proj.index, this._proj);
    this.race.fixedUpdate(this.raceTime, dt);
    if (st === STATE.RACING) this._driverAids(dt);
    // cool-down lap autopilot: recover if wedged against a barrier
    if (st === STATE.FINISHED && Math.abs(this.physics.speed) < 1) {
      this._stuckTimer = (this._stuckTimer || 0) + dt;
      if (this._stuckTimer > 3) { this._stuckTimer = 0; this._recoverToTrack(); }
    } else this._stuckTimer = 0;
    // auto-recover if flipped or stuck upside down
    if (this.physics.upright < 0.2) {
      this._flipTimer = (this._flipTimer || 0) + dt;
      if (this._flipTimer > 2.0) { this._flipTimer = 0; this._recoverToTrack(); }
    } else this._flipTimer = 0;
  }

  /** Off-track / wrong-way warnings and time-trial track limits. */
  _driverAids(dt) {
    const ph = this.physics;
    const hud = this.hud;
    this._offCooldown -= dt;
    this._wrongCooldown -= dt;
    if (ph.offTrack >= 0.75 && Math.abs(ph.speed) > 6) {
      this._offTimer += dt;
      if (this._offTimer > 0.35 && this._offCooldown <= 0) {
        hud.notify('OFF TRACK', '', 'warn', 1.6);
        this.audio.warning();
        this._offCooldown = 5;
      }
    } else this._offTimer = 0;
    // track limits invalidate time-trial laps (all four wheels off)
    const tr = this.playerRacer.tracker;
    if (this.mode === 'trial' && tr.started && !tr.invalid) {
      if (ph.offTrack >= 1) {
        this._limitTimer += dt;
        if (this._limitTimer > 0.25) {
          tr.invalid = true;
          hud.notify('TRACK LIMITS', 'LAP DELETED', 'red', 2.2);
        }
      } else this._limitTimer = 0;
    }
    // wrong way
    const T = this.track;
    T.sampleAt(this._proj.s, 0, null, _v);
    const lv = ph.body.linvel();
    const along = lv.x * _v.x + lv.z * _v.z;
    if (along < -3) {
      this._wrongTimer += dt;
      if (this._wrongTimer > 1.2 && this._wrongCooldown <= 0) {
        hud.notify('WRONG WAY', '', 'warn', 2);
        this.audio.warning();
        this._wrongCooldown = 3.5;
      }
    } else this._wrongTimer = 0;
  }

  // ------------------------------------------------------------------ frame
  _frame(dt, alpha) {
    this.time += dt;
    const st = this.state.current;
    const paused = st === STATE.PAUSED;
    const inSession = st === STATE.COUNTDOWN || st === STATE.RACING || st === STATE.FINISHED || (paused && this._pausedFrom);
    const fdt = paused ? 0 : dt;

    if (!paused && this.countdown.active) this.countdown.update(dt);

    // ---- player car visual
    const car = this.playerCar;
    const ph = this.physics;
    let carPos = this.showcase ? this.showcase.pos : _v2;
    let carQuat = this.showcase ? this.showcase.quat : _q;
    let accelLong = 0;
    if (inSession) {
      ph.getInterpolated(paused ? 1 : alpha, car.root.position, car.root.quaternion);
      carPos = car.root.position;
      carQuat = car.root.quaternion;
      // smoothed acceleration in the car frame (for body pitch/roll + camera)
      const lv = ph.body.linvel();
      _v.set(lv.x, lv.y, lv.z);
      if (!this._prevVel) this._prevVel = _v.clone();
      if (fdt > 0) {
        _v2.subVectors(_v, this._prevVel).divideScalar(Math.max(fdt, 1e-3));
        this._prevVel.copy(_v);
        _fwd.set(0, 0, 1).applyQuaternion(carQuat);
        const aLong = _v2.dot(_fwd);
        const left = (this._left || (this._left = new THREE.Vector3())).set(1, 0, 0).applyQuaternion(carQuat);
        const aLat = _v2.dot(left);
        this._aLong = (this._aLong || 0) + (THREE.MathUtils.clamp(aLong, -60, 30) - (this._aLong || 0)) * Math.min(1, fdt * 6);
        this._aLat = (this._aLat || 0) + (THREE.MathUtils.clamp(aLat, -60, 60) - (this._aLat || 0)) * Math.min(1, fdt * 6);
      }
      accelLong = this._aLong || 0;
      const susp = this._susp || (this._susp = [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) susp[i] = CAR_SPEC.suspConnY - ph.wheelSuspension(i);
      car.update(fdt, { speed: ph.speed, steer: ph.steerAngle, accelLong, accelLat: -(this._aLat || 0), brake: ph.brake, susp });
      if (!paused) this._emitPlayerParticles(fdt);
    }

    // ---- AI visuals
    let nearestAI = null, nearestD = Infinity;
    for (const d of this.ai.drivers) {
      if (d.enabled === false) continue;
      d.getInterpolated(paused ? 1 : alpha, d.car.root.position, d.car.root.quaternion);
      d.car.update(fdt, { speed: d.speed, steer: d.steerVis, accelLong: d.accelLong, accelLat: d.accelLat, brake: d.brakeVis });
      if (inSession) {
        const dist = d.car.root.position.distanceTo(carPos);
        if (dist < nearestD) { nearestD = dist; nearestAI = d; }
      }
    }

    if (!paused) this.particles.update(dt);

    // ---- camera
    const camCtx = this._camCtx || (this._camCtx = {
      groundAt: (x, z) => this.terrain.heightAt(x, z),
      rayClip: (o, dir, len) => this._rayClip(o, dir, len),
    });
    camCtx.carPos = carPos;
    camCtx.carQuat = carQuat;
    camCtx.speed = inSession ? ph.speed : 0;
    camCtx.accel = accelLong;
    camCtx.showcase = this.showcase;
    camCtx.grid = this._gridShot;
    if (!paused || this.cams.mode === 'orbit') this.cams.update(dt, camCtx);
    if (st === STATE.COUNTDOWN && this.cams.mode === 'grid' && this.cams.gridT > 3.3) {
      this.cams.setMode(this.settings.camera, { duration: 1.1 });
    }

    // ---- world
    this.lighting.update(inSession ? carPos : this.showcase.pos);
    if (!paused) this.environment.update(dt, this.time);

    // ---- HUD + audio
    if (inSession) {
      this.hud.update(dt, this._hudData());
      if (!paused) {
        this.carAudio.update({
          rpm: ph.rpm,
          throttle: ph.locked ? ph.throttle * 0.8 : ph.throttle,
          speed: ph.speed,
          slip: ph.slip,
          offTrack: ph.offTrack,
          ai: nearestAI ? { distance: nearestD, rpm: nearestAI.rpm, closingSpeed: this._closing(nearestAI) } : null,
        });
      }
      if (st === STATE.FINISHED && this._finishTimer > 0) {
        this._finishTimer -= dt;
        if (this._finishTimer <= 0) this.results.show(this._resultSummary, this.race.classification(this.raceTime));
      }
      if (this.results.visible) {
        this._resRefresh = (this._resRefresh || 0) - dt;
        if (this._resRefresh <= 0) { this._resRefresh = 0.5; this.results.updateRows(this.race.classification(this.raceTime)); }
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  _closing(ai) {
    const lv = this.physics.body.linvel();
    _v.subVectors(ai.car.root.position, this.playerCar.root.position).normalize();
    // relative velocity toward each other (positive = approaching)
    const aiVel = _fwd.set(0, 0, 1).applyQuaternion(ai.car.root.quaternion).multiplyScalar(ai.speed);
    return (lv.x - aiVel.x) * _v.x + (lv.y - aiVel.y) * _v.y + (lv.z - aiVel.z) * _v.z;
  }

  _rayClip(origin, dir, len) {
    if (!this._rapierRay) this._rapierRay = new this.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const r = this._rapierRay;
    r.origin.x = origin.x; r.origin.y = origin.y; r.origin.z = origin.z;
    r.dir.x = dir.x; r.dir.y = dir.y; r.dir.z = dir.z;
    const hit = this.world.castRay(r, len, true, this.RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | this.RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit ? hit.timeOfImpact : Infinity;
  }

  _emitPlayerParticles(dt) {
    const ph = this.physics;
    const root = this.playerCar.root;
    const spd = Math.abs(ph.speed);
    const P = this.particles;
    const wheelLocal = this._wheelLocal || (this._wheelLocal = [
      new THREE.Vector3(CAR_SPEC.trackHalf, -0.3, CAR_SPEC.frontZ), new THREE.Vector3(-CAR_SPEC.trackHalf, -0.3, CAR_SPEC.frontZ),
      new THREE.Vector3(CAR_SPEC.trackHalf, -0.3, CAR_SPEC.rearZ), new THREE.Vector3(-CAR_SPEC.trackHalf, -0.3, CAR_SPEC.rearZ),
    ]);
    this._emitAcc = (this._emitAcc || 0) + dt * 60;
    if (this._emitAcc < 1) return;
    this._emitAcc = 0;
    const lv = ph.body.linvel();
    for (let i = 0; i < 4; i++) {
      const sfc = ph.surface[i];
      const smoke = ph.slip > 0.35 && spd > 6 && sfc <= 2 && (i >= 2 || ph.brake > 0.7);
      const dust = sfc >= 3 && spd > 7;
      if (!smoke && !dust) continue;
      _v.copy(wheelLocal[i]).applyMatrix4(root.matrixWorld);
      const j = () => (Math.random() - 0.5) * 1.2;
      if (smoke) {
        P.emit(_v.x, _v.y + 0.1, _v.z, lv.x * 0.25 + j(), 0.4 + Math.random() * 0.6, lv.z * 0.25 + j(), { life: 1.4 + Math.random(), size: 1.0 + ph.slip, r: 0.86, g: 0.86, b: 0.88, alpha: 0.35 * ph.slip + 0.1 });
      } else {
        const gravel = sfc === 4;
        P.emit(_v.x, _v.y + 0.15, _v.z, lv.x * 0.15 + j(), 0.8 + Math.random(), lv.z * 0.15 + j(), { life: 1.0 + Math.random() * 0.6, size: 0.9 + spd * 0.015, r: gravel ? 0.72 : 0.5, g: gravel ? 0.64 : 0.47, b: gravel ? 0.5 : 0.32, alpha: 0.45 });
      }
    }
  }

  _hudData() {
    const d = this._hd || (this._hd = { sectors: [{}, {}, {}], markers: [], tower: [] });
    const ph = this.physics;
    const r = this.playerRacer;
    const tr = r.tracker;
    const race = this.race;
    const started = this.state.is(STATE.RACING, STATE.FINISHED) || (this.state.is(STATE.PAUSED) && this._pausedFrom !== STATE.COUNTDOWN);
    d.position = r.position || race.racers.length;
    d.total = race.racers.length;
    d.totalLaps = race.totalLaps;
    d.lap = tr.lapsCompleted + 1;
    d.waiting = this.mode === 'trial' && !tr.started;
    d.lapTime = !started ? 0 : tr.finished ? tr.lastLap : tr.currentLapTime(this.raceTime);
    d.invalid = tr.invalid;
    d.best = tr.bestLap;
    d.bestIsOverall = tr.bestLap != null && tr.bestLap === race.bestLapAll;
    d.last = tr.lastLap;
    d.raceTime = !started ? 0 : tr.finished ? tr.finishTime - race.startTime : this.raceTime - race.startTime;
    d.currentSector = tr.sector;
    for (let i = 0; i < 3; i++) {
      d.sectors[i].time = tr.sectorTimes[i];
      d.sectors[i].cls = tr.sectorTimes[i] != null ? this.sectorCls[i] : null;
    }
    // show the previous lap's sectors in the first moments of a new lap
    if (tr.sectorTimes[0] == null && this._lastLapSectors && tr.currentLapTime(this.raceTime) < 4) {
      for (let i = 0; i < 3; i++) { d.sectors[i].time = this._lastLapSectors.times[i]; d.sectors[i].cls = this._lastLapSectors.cls[i]; }
    }
    d.speedKmh = Math.abs(ph.speed) * 3.6;
    d.gear = ph.speed < -0.5 ? 'R' : Math.abs(ph.speed) < 0.4 && ph.throttle === 0 ? 'N' : String(ph.gear);
    d.rpm = ph.rpm;
    d.rpmMax = CAR_SPEC.maxRpm;
    // minimap markers
    d.markers.length = 0;
    for (const rc of race.racers) {
      if (rc.isPlayer) d.markers.push({ x: this.playerCar.root.position.x, z: this.playerCar.root.position.z, color: rc.color, isPlayer: true });
      else d.markers.push({ x: rc.driver.car.root.position.x, z: rc.driver.car.root.position.z, color: rc.color, isPlayer: false });
    }
    // timing tower
    d.tower.length = 0;
    if (this.mode === 'race') {
      const order = race.positions.order;
      order.forEach((rc, i) => {
        let gap;
        if (rc.tracker.finished) gap = i === 0 ? 'FLAG' : rc.gap > 0 ? '+' + rc.gap.toFixed(1) : 'FLAG';
        else if (!started) gap = '';
        else if (i === 0) gap = 'LEADER';
        else gap = rc.tracker.lastCpIndex > 0 || rc.tracker.lapsCompleted > 0 ? '+' + Math.max(0, rc.gap).toFixed(1) : '';
        d.tower.push({ position: i + 1, name: rc.isPlayer ? 'YOU' : rc.short, color: rc.color, isPlayer: rc.isPlayer, gap });
      });
    }
    return d;
  }

  // ------------------------------------------------------------------ platform
  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewportHeight(h);
    this.hud.map.resize();
  }

  _onVisibility() {
    if (document.hidden) {
      if (this.state.is(STATE.COUNTDOWN, STATE.RACING)) this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
    }
  }
}
