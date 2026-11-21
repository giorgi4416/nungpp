import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { GameState, STATE } from './GameState.js';
import { GameLoop } from './GameLoop.js';
import { createScene, applyQuality, setSky, QUALITY } from '../scene/createScene.js';
import { Lighting } from '../scene/Lighting.js';
import { Environment } from '../scene/Environment.js';
import { TerrainData } from '../scene/TerrainData.js';
import { TrackGeometry } from '../track/TrackGeometry.js';
import { Hungaroring as CircuitBuilder } from '../track/Hungaroring.js';
import { CIRCUITS } from '../track/circuits/index.js';
import { computeBarrierLines, createTrackColliders } from '../track/TrackColliders.js';
import { buildCheckpoints } from '../track/Checkpoints.js';
import { FormulaCar } from '../vehicle/FormulaCar.js';
import { hex } from '../vehicle/Teams.js';
import { CAR_BY_ID, SUBERA_BY_ID, defaultCarId } from '../vehicle/CarCatalog.js';
import { VehiclePhysics, CAR_SPEC } from '../vehicle/VehiclePhysics.js';
import { DamageModel } from '../vehicle/DamageModel.js';
import { Debris } from '../effects/Debris.js';
import { CameraInput } from '../systems/CameraInput.js';
import { CarController } from '../vehicle/CarController.js';
import { CarAudio } from '../vehicle/CarAudio.js';
import { AIOpponentManager } from '../ai/AIOpponentManager.js';
import { RaceManager } from '../race/RaceManager.js';
import { formatTime } from '../race/LapSystem.js';
import { CameraManager, RACE_CAMERAS, CAMERA_LABELS } from '../camera/CameraManager.js';
import { Particles } from '../effects/Particles.js';
import { SkidMarks } from '../effects/SkidMarks.js';
import { InputManager } from '../systems/InputManager.js';
import { AudioManager } from '../systems/AudioManager.js';
import { Storage } from '../systems/LocalStorage.js';
import { MainMenu } from '../ui/MainMenu.js';
import { SettingsMenu } from '../ui/SettingsMenu.js';
import { ControlsPanel } from '../ui/ControlsPanel.js';
import { CarSelect, TrackSelect } from '../ui/SelectionScreens.js';
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

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  obj.removeFromParent();
}

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
    if (this.settings.camera === 'tcam') this.settings.camera = 'cockpit';
    if (!CAR_BY_ID[this.settings.car]) this.settings.car = defaultCarId(this.settings.team);

    progress(0.08, 'Creating renderer');
    await nextFrame();
    const { renderer, scene, camera, quality } = createScene(this.canvas, this.settings.quality);
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.lighting = new Lighting(scene, quality);
    // tunnel lamps: one warm light that travels with the car inside Monaco's tunnel
    this.tunnelLight = new THREE.PointLight(0xffc27a, 0, 34, 1.4);
    scene.add(this.tunnelLight);
    this.particles = new Particles(scene, 700);
    this.sparks = new Particles(scene, 260, { additive: true, gravity: 9.8, drag: 0.6, grow: -0.5 });
    this.particles.setViewportHeight(window.innerHeight);
    this.sparks.setViewportHeight(window.innerHeight);
    this.skids = new SkidMarks(scene);
    this.debris = new Debris(scene, (x, z) => this._groundAt(x, z));
    // rear-view mirror camera + render target (cockpit view only)
    this.mirrorRT = new THREE.WebGLRenderTarget(384, 150, { samples: 0 });
    this.mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.mirrorCam = new THREE.PerspectiveCamera(46, 384 / 150, 0.3, 900);

    this.input = new InputManager(this.settings.bindings);
    this.audio = new AudioManager(this.settings);
    this.carAudio = new CarAudio(this.audio);
    this.cams = new CameraManager(camera);
    this.cams.shakeEnabled = this.settings.cameraShake;
    this.cams.cockpitFov = this.settings.cockpitFov;
    this.cams.setSmoothing(this.settings.cameraSmoothing);
    this.cameraInput = new CameraInput(this.canvas, this.cams, () => this.settings.cameraSensitivity);
    this._buildUI();
    this._bindInput();

    this._makePlayerCar(this.settings.car);
    await this.loadCircuit(this.settings.track, (p, t) => progress(0.12 + p * 0.8, t));

    progress(0.94, 'Warming up tyres');
    await nextFrame();
    this._frame(0, 0);
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

  _makePlayerCar(carId) {
    this.debris && this.debris.clear();
    if (this.playerCar) this.playerCar.dispose();
    this.carDef = this.team = CAR_BY_ID[carId] || CAR_BY_ID[defaultCarId()];
    this.subEra = SUBERA_BY_ID[this.carDef.sub];
    this.playerCar = new FormulaCar(this.carDef, { cockpit: true, detachable: true });
    this.scene.add(this.playerCar.root);
    this.playerCar.setMirrorTexture(null);
    if (this.physics) {
      this.physics.setEra(this.subEra.perf);
      this.damage.setCar(this.playerCar);
    }
  }

  /** Ground height for debris: the road surface where there is road, terrain elsewhere. */
  _groundAt(x, z) {
    const t = this.terrain ? this.terrain.heightAt(x, z) + 0.06 : 0;
    if (!this.track) return t;
    this._gProj = this._gProj || { index: undefined };
    this.track.project(x, z, this._gProj.index, this._gProj);
    return this._gProj.dist < this.track.halfWidth + 3 ? Math.max(t, this._gProj.height) : t;
  }

  /** Build (or rebuild) everything that depends on the circuit. */
  async loadCircuit(id, progress = () => {}) {
    const def = CIRCUITS[id] || CIRCUITS.hungaroring;
    this._busy = true; // the loop must not touch the world while it is rebuilt
    try {
      await this._loadCircuit(def, progress);
    } finally {
      this._busy = false;
    }
  }

  async _loadCircuit(def, progress) {
    // ---- tear down the previous circuit
    if (this.track) {
      disposeTree(this.circuit.group);
      disposeTree(this.environment.group);
      this.ai.dispose(this.world);
      this.physics.dispose();
      this.world.free();
      this.skids.clear();
      this.debris.clear();
      this.particles.clear();
      this.sparks.clear();
    }
    progress(0.05, `Surveying ${def.name}`);
    await nextFrame();
    this.trackId = def.id;
    this.track = new TrackGeometry(def);
    this.checkpoints = buildCheckpoints(this.track);
    setSky(this.renderer, this.scene, def.sky);

    progress(0.2, 'Shaping the landscape');
    await nextFrame();
    this.terrain = new TerrainData(this.track);
    this.barriers = computeBarrierLines(this.track);

    progress(0.45, 'Laying asphalt, kerbs and barriers');
    await nextFrame();
    this.circuit = new CircuitBuilder(this.scene, this.track, this.barriers, this.quality, this.terrain);
    this.circuit.addSectorBoards(this.checkpoints.sectorStarts);

    progress(0.6, def.theme === 'monaco' ? 'Mooring the yachts' : 'Building grandstands and planting forests');
    await nextFrame();
    this.environment = new Environment(this.scene, this.track, this.terrain, this.barriers, QUALITY.high);
    this.environment.applyQuality(this.quality);

    progress(0.8, 'Preparing the cars');
    await nextFrame();
    const R = this.RAPIER;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
    this.colliders = createTrackColliders(R, this.world, this.track, this.terrain, this.barriers);
    this.groundHandles = new Set([this.colliders.road.handle, this.colliders.terrain.handle]);
    this.eventQueue = new R.EventQueue(true);
    const start = this.trackTransform(this.track.length - 30, 0);
    this.physics = new VehiclePhysics(R, this.world, { position: start.pos, quaternion: start.quat });
    this._proj = { index: 0 };
    this._sfcProj = { index: 0 };
    this._camProj = { index: undefined };
    this.physics.setSurfaceSampler((x, z) => {
      this.track.project(x, z, this._sfcProj.index, this._sfcProj);
      return this.track.surfaceAt(this._sfcProj.index, this._sfcProj.lateral);
    });
    this.physics.onGearChange = (g, up) => this.audio && this.audio.gearShift(up);
    this.physics.onShiftRejected = () => this.audio.tone(220, 0.08, { type: 'square', gain: 0.05 });
    this.physics.setEra(this.subEra.perf);
    this.damage = new DamageModel(this.playerCar, this.physics, this.debris, {
      sparks: (pos, vel, n) => this._sparkBurst(pos, vel, n),
      notify: (label, value, style) => this.state.is(STATE.RACING, STATE.FINISHED) && this.hud.notify(label, value, style, 2.4),
      sound: (strength, level) => this.audio.crash(strength, level),
      shake: (a) => this.cams.addShake(a),
    });
    this._applyDriverSettings();
    this.controller = new CarController(this.input, this.physics, this.track);
    this.ai = new AIOpponentManager(R, this.world, this.scene, this.track, this.carDef.id);
    this.ai.setDifficulty(this.settings.difficulty);
    this.race = new RaceManager(this.track, this.checkpoints, (type, data) => this._onRaceEvent(type, data));
    this.hud.setTrack(this.track, this.checkpoints);
    this._enterMenuScene();
    progress(1, 'Ready');
  }

  _applyDriverSettings() {
    const ph = this.physics;
    ph.transmission = this.settings.transmission;
    ph.steerSensitivity = this.settings.steering;
  }

  /** World transform for a car on the track at distance s and lateral offset. */
  trackTransform(s, lateral, drop = 0.12) {
    const p = new THREE.Vector3(), t = new THREE.Vector3();
    this.track.sampleAt(s, lateral, p, t);
    p.y += CAR_SPEC.wheelRadiusR + drop;
    const flat = new THREE.Vector3(t.x, 0, t.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), flat);
    const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.asin(THREE.MathUtils.clamp(t.y, -0.3, 0.3)));
    quat.multiply(pitch);
    return { pos: p, quat };
  }

  // ------------------------------------------------------------------ UI
  _buildUI() {
    const root = this.uiRoot;
    this.hud = new HUD(root);
    this.countdown = new Countdown(root, this.audio);
    this.menu = new MainMenu(root, this.audio, this.settings, {
      onRace: () => this.startSession('race'),
      onTrial: () => this.startSession('trial'),
      onSettings: () => this.settingsMenu.show(),
      onControls: () => this.controlsPanel.show(),
      onTeam: () => this._openCarSelect(),
      onTrack: () => this.trackSelect.show(),
      onOptions: () => this.ai && this.ai.setDifficulty(this.settings.difficulty),
    });
    this.settingsMenu = new SettingsMenu(root, this.audio, this.settings, this.input, (k, v) => this._applySetting(k, v));
    this.controlsPanel = new ControlsPanel(root, this.audio, this.input);
    this.teamSelect = new CarSelect(root, this.audio, () => this.settings.car, (id) => this.selectCar(id));
    this.teamSelect.onClose = () => this.state.is(STATE.MENU) && this.menu.show(true);
    this.trackSelect = new TrackSelect(root, this.audio, () => this.settings.track, (id) => this.selectTrack(id));
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
    this.loadingOverlay = document.getElementById('loading-screen');
  }

  _openCarSelect() {
    this.menu.show(false);
    this.teamSelect.show();
  }

  /** Pick a car (era + team livery); the menu showcase updates immediately as a 3D preview. */
  selectCar(id) {
    if (!CAR_BY_ID[id] || id === this.settings.car) return;
    this.settings.car = id;
    this.settings.team = CAR_BY_ID[id].teamId;
    Storage.saveSettings(this.settings);
    this._makePlayerCar(id);
    this.ai.setPlayerCar(id);
    if (this.state.is(STATE.MENU)) this._enterMenuScene();
    this.menu.refresh();
  }

  async selectTrack(id) {
    if (!CIRCUITS[id] || id === this.trackId || this._loadingTrack) return;
    this._loadingTrack = true;
    this.settings.track = id;
    Storage.saveSettings(this.settings);
    const fill = document.getElementById('loading-fill');
    const status = document.getElementById('loading-status');
    this.loadingOverlay.classList.add('visible');
    this.menu.show(false);
    await nextFrame();
    try {
      await this.loadCircuit(id, (p, t) => { fill.style.width = `${Math.round(p * 100)}%`; if (t) status.textContent = t; });
      try { if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera); } catch { /* optional */ }
    } finally {
      this.loadingOverlay.classList.remove('visible');
      this.menu.show(true);
      this._loadingTrack = false;
    }
  }

  _applySetting(key, value) {
    switch (key) {
      case 'quality': {
        const q = applyQuality(this.renderer, this.scene, value);
        this.quality = q;
        this.lighting.applyQuality(q);
        this.environment.applyQuality(q);
        this.particles.setViewportHeight(window.innerHeight);
        this.sparks.setViewportHeight(window.innerHeight);
        break;
      }
      case 'volume': this.audio.setVolume(value / 100); break;
      case 'muted': this.audio.setMuted(value); break;
      case 'music': this.audio.setMusicEnabled(value); break;
      case 'cameraShake': this.cams.shakeEnabled = value; break;
      case 'difficulty': this.ai.setDifficulty(value); break;
      case 'transmission':
      case 'steering': this._applyDriverSettings(); break;
      case 'cockpitFov': this.cams.cockpitFov = value; break;
      case 'cameraSmoothing': this.cams.setSmoothing(value); break;
      case 'cameraSensitivity': this.cams.sensitivity = value; break;
      case 'bindings': this.input.setBindings(value); break;
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
      if (this.teamSelect.visible) return this.teamSelect.hide();
      if (this.trackSelect.visible) return this.trackSelect.hide();
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
    inp.on('cameraReset', () => this.cams.resetLook());
    inp.on('shiftUp', () => { if (this.state.is(STATE.RACING)) this.physics.shiftUp(); });
    inp.on('shiftDown', () => { if (this.state.is(STATE.RACING)) this.physics.shiftDown(); });
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
    for (const ui of [this.results, this.pauseMenu, this.settingsMenu, this.controlsPanel, this.teamSelect, this.trackSelect]) ui.hide();
    this.menu.show(false);
    this.countdown.cancel();
    this.hud.clearToasts();
    this.input.clear();
    this.particles.clear();
    this.sparks.clear();
    this.skids.clear();
    this.debris.clear();
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
    const ph = this.physics;
    ph.body.setEnabled(true);
    ph.reset(spawn.pos, spawn.quat);
    ph.resetThermals(T.def.ambient);
    this.damage.reset();
    this.damage.enabled = true;
    ph.locked = true;
    ph.throttle = ph.brake = ph.steer = 0;
    this._applyDriverSettings();
    this.controller.reset();
    this.controller.autopilot = false;
    this._proj = { index: undefined };
    T.project(spawn.pos.x, spawn.pos.z, undefined, this._proj);
    this._sfcProj.index = this._proj.index;
    this.playerCar.setVisible(true);

    const racers = [{
      id: 'player', name: 'YOU', short: 'YOU', team: this.team.name, color: hex(this.team.primary), isPlayer: true,
      getS: () => this._proj.s, getSpeed: () => this.physics.speed,
    }];
    if (mode === 'race') {
      for (const d of this.ai.drivers) {
        racers.push({
          id: d.profile.short, name: d.profile.name, short: d.profile.short, team: d.livery.name, color: hex(d.livery.primary), isPlayer: false,
          getS: () => d.wrappedS, getSpeed: () => d.speed, driver: d,
        });
      }
    }
    this.race.setup(mode, this.settings.laps, racers);
    this.playerRacer = this.race.player;
    this.sectorCls = [null, null, null];
    this._offTimer = 0; this._offCooldown = 0; this._wrongTimer = 0; this._wrongCooldown = 0; this._resetCooldown = 0;
    this._limitTimer = 0; this._impactCooldown = 0; this._finishTimer = -1; this._airTime = 0;
    this._prevVel = null;

    this.cams.resetRig(spawn.pos, spawn.quat);
    const front = new THREE.Vector3(), back = new THREE.Vector3();
    if (mode === 'race') {
      T.sampleAt(22, -T.def.pit.side * (T.halfWidth + 3.5), front);
      front.y += 5.5;
      T.sampleAt(-28, 0, back);
      back.y += 0.6;
    } else {
      T.sampleAt(T.length - 140, -T.def.pit.side * (T.halfWidth + 2.5), front);
      front.y += 3.5;
      back.copy(spawn.pos);
    }
    _fwd.set(0, 0, 1).applyQuaternion(spawn.quat);
    const to = spawn.pos.clone().addScaledVector(_fwd, -6.6);
    to.y += 1.95;
    this._gridShot = { from: front, to, focus: back };
    this.cams.setMode('grid', { instant: true });
    this.cams.gridT = mode === 'race' ? 0 : 2.2;

    this.hud.setMode(mode, mode === 'race' ? this.settings.laps : 0, this.settings.transmission);
    this.hud.show(true);
    this.carAudio.setActive(true);
    this.environment.setExcitement(1);
    this.state.set(STATE.COUNTDOWN);
    this.countdown.start({
      preDelay: mode === 'race' ? 3.4 : 1.4,
      interval: mode === 'race' ? 1.0 : 0.55,
      holdMin: mode === 'race' ? 0.5 : 0.2,
      holdMax: mode === 'race' ? 2.2 : 0.6,
      caption: mode === 'race' ? `${T.def.name.toUpperCase()} · ${this.settings.laps} LAPS · 5 CARS` : 'TIME TRIAL · FLYING LAP STARTS AT THE LINE',
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
    const p = env.straightPoint(28, this.circuit.pitLaneOffset);
    p.y = this.track.heightAtS(28) + CAR_SPEC.wheelRadiusR - 0.008;
    const yaw = Math.atan2(env.t0.x, env.t0.z) + 0.42 * this.track.def.pit.side;
    this.showcase = { pos: p, quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) };
    this.physics.body.setEnabled(false);
    this.physics.locked = true;
    this.controller.autopilot = false;
    this.playerCar.setVisible(true);
    this.playerCar.root.position.copy(p);
    this.playerCar.root.quaternion.copy(this.showcase.quat);
    this.playerCar.update(0, { speed: 0, steer: 0.22, accelLong: 0, accelLat: 0, brake: 0 });
    this.playerCar.setMirrorTexture(null);
    this.ai.setEnabled(true);
    this.ai.setDifficulty(this.settings.difficulty);
    this.ai.placeDemo();
    this.particles.clear();
    this.sparks.clear();
    this.circuit.setStartLights(0, false);
    this.cams.setMode('orbit', { instant: true });
    this.environment.setExcitement(0.25);
  }

  resetPlayerCar() {
    if (!this.state.is(STATE.RACING) || this._resetCooldown > 0) return;
    const wasDamaged = this.damage.level > 0;
    this._recoverToTrack();
    this.damage.reset();
    this.hud.notify(wasDamaged ? 'CAR RESPAWNED' : 'CAR RESET', wasDamaged ? 'REPAIRED' : '', 'yellow', 1.5);
  }

  /** Put the player car back on the racing surface just ahead of where it is. */
  _recoverToTrack() {
    const T = this.track;
    const s = this._proj.s + 6;
    let lat = THREE.MathUtils.clamp(this._proj.lateral, -3.5, 3.5);
    if (Math.abs(this._proj.lateral) > T.halfWidth) lat = T.interp(T.lineOffset, s);
    lat = THREE.MathUtils.clamp(lat, -(T.halfWidth - 1.5), T.halfWidth - 1.5);
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
    this.skids.endAll();
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
        if (d.s3cls) this.sectorCls[2] = d.s3cls;
        this._lastLapSectors = { times: d.sectors.slice(), cls: this.sectorCls.slice() };
        if (!d.valid) {
          hud.notify(`LAP ${d.lap}`, formatTime(d.lapTime) + ' · INVALID', 'red', 2.6);
        } else if (d.best) {
          const stored = Storage.loadBestLap(this.mode, this.trackId);
          const record = stored == null || d.lapTime < stored;
          if (record) Storage.saveBestLap(this.mode, d.lapTime, this.trackId);
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
    this.physics.transmission = 'auto'; // the cool-down autopilot shifts for itself
    this.controller.autopilot = true;
    this.environment.setExcitement(1);
    this.hud.notify('RACE FINISHED', `P${pos}`, pos === 1 ? 'purple' : 'green', 3.5);
    this.audio.lapChime(true);
    const total = d.time - this.race.startTime;
    const tr = p.tracker;
    const prevBest = Storage.loadAllTimeBest(this.trackId);
    Storage.saveLastResult({ position: pos, total: this.race.racers.length, time: total, laps: this.race.totalLaps, bestLap: tr.bestLap, date: new Date().toISOString(), track: this.trackId });
    this._resultSummary = {
      position: pos,
      total: this.race.racers.length,
      totalTime: total,
      bestLap: tr.bestLap,
      lapTimes: tr.lapTimes.slice(),
      newRecord: tr.bestLap != null && (prevBest == null || tr.bestLap <= prevBest),
      track: this.track.def.name,
    };
    this._finishTimer = 3.2;
    setTimeout(() => this.state.is(STATE.FINISHED) && this.cams.setMode('finish', { duration: 1.5 }), 1200);
  }

  // ------------------------------------------------------------------ simulation
  _fixed(dt) {
    if (this._busy) return;
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
    const dv = Math.hypot(lv1.x - v0x, lv1.y - v0y, lv1.z - v0z);
    this.eventQueue.drainContactForceEvents((e) => {
      const f = e.totalForceMagnitude();
      const ground = this.groundHandles.has(e.collider1()) || this.groundHandles.has(e.collider2());
      if (ground) {
        // the floor touching the road: sparks, not a crash
        if (f > 6000) this._scrape = Math.min(1, (this._scrape || 0) + f / 40000);
        return;
      }
      // barrier / other car: the velocity change of this step drives crash damage
      if (st === STATE.RACING || st === STATE.FINISHED) {
        const part = this.physics.partOf(e.collider1()) || this.physics.partOf(e.collider2()) || 'tub';
        this._dvVec = (this._dvVec || new THREE.Vector3()).set(lv1.x - v0x, lv1.y - v0y, lv1.z - v0z);
        this.damage.onContact(part, this._dvVec);
      }
      if (f > 14000 && dv > 0.55 && dv < 5 && this._impactCooldown <= 0) {
        // light knock (no damage): small thump & shake; bigger hits are handled by the damage model
        const strength = Math.min(1, (f - 14000) / 60000);
        this._impactCooldown = 0.35;
        this.cams.addShake(0.12 + strength * 0.3);
        this.audio.impact(strength * 0.6);
      }
    });
    this.physics.postStep(dt);
    this.damage.update(dt);
    this._impactCooldown -= dt;
    this._resetCooldown -= dt;
    this.raceTime += dt;
    const b = this.physics.currPos;
    T.project(b.x, b.z, this._proj.index, this._proj, b.y);
    this.race.fixedUpdate(this.raceTime, dt);
    if (st === STATE.RACING) this._driverAids(dt);
    if (st === STATE.FINISHED && Math.abs(this.physics.speed) < 1) {
      this._stuckTimer = (this._stuckTimer || 0) + dt;
      if (this._stuckTimer > 3) { this._stuckTimer = 0; this._recoverToTrack(); }
    } else this._stuckTimer = 0;
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
    if (this._busy) return;
    this.time += dt;
    const st = this.state.current;
    const paused = st === STATE.PAUSED;
    const inSession = st === STATE.COUNTDOWN || st === STATE.RACING || st === STATE.FINISHED || (paused && this._pausedFrom);
    const fdt = paused ? 0 : dt;
    this.input.pollGamepad();
    // camera look-around: right stick + hold-to-look keys (cockpit)
    const pad = this.input.pad;
    if (pad.lookX || pad.lookY) { this.cams.sensitivity = this.settings.cameraSensitivity; this.cams.lookInput(pad.lookX * 520 * dt, pad.lookY * 380 * dt); }
    this.cams.setLookHold(this.cams.mode === 'cockpit' ? this.input.lookHold : 0);

    if (!paused && this.countdown.active) this.countdown.update(dt);

    const car = this.playerCar;
    const ph = this.physics;
    let carPos = this.showcase ? this.showcase.pos : _v2;
    let carQuat = this.showcase ? this.showcase.quat : _q;
    let accelLong = 0;
    const cockpit = this.cams.mode === 'cockpit';
    if (inSession) {
      ph.getInterpolated(paused ? 1 : alpha, car.root.position, car.root.quaternion);
      carPos = car.root.position;
      carQuat = car.root.quaternion;
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
      const cs = this._carState || (this._carState = { susp: [0, 0, 0, 0] });
      for (let i = 0; i < 4; i++) cs.susp[i] = CAR_SPEC.suspConnY - ph.wheelSuspension(i);
      cs.speed = ph.speed;
      cs.steer = ph.steerAngle;
      cs.accelLong = accelLong;
      cs.accelLat = -(this._aLat || 0);
      cs.brake = ph.brake;
      cs.compression = ph.compression;
      cs.brakeTemp = ph.brakeTemp;
      cs.maxRpm = ph.spec.maxRpm;
      cs.damage = this.damage.total;
      cs.rpm = ph.rpm;
      cs.gearLabel = this._gearLabel();
      cs.manual = ph.transmission === 'manual';
      cs.dashVisible = cockpit;
      cs.vibration = Math.min(1, Math.abs(ph.speed) / 90) * 0.4 + ph.onKerb * 1.2;
      car.update(fdt, cs);
      if (!paused) this._emitPlayerEffects(fdt);
    }

    let nearestAI = null, nearestD = Infinity;
    for (const d of this.ai.drivers) {
      if (d.enabled === false) continue;
      d.getInterpolated(paused ? 1 : alpha, d.car.root.position, d.car.root.quaternion);
      d.car.update(fdt, { speed: d.speed, steer: d.steerVis, accelLong: d.accelLong, accelLat: d.accelLat, brake: d.brakeVis });
      d.car.setLOD(d.car.root.position.distanceToSquared(this.camera.position) > 70 * 70);
      if (inSession) {
        const dist = d.car.root.position.distanceTo(carPos);
        if (dist < nearestD) { nearestD = dist; nearestAI = d; }
      }
    }

    if (!paused) {
      this.particles.update(dt);
      this.sparks.update(dt);
      this.debris.update(dt);
    }
    this.skids.update();

    // ---- camera
    const camCtx = this._camCtx || (this._camCtx = {
      groundAt: (x, z) => this.terrain.heightAt(x, z),
      rayClip: (o, dir, len) => this._rayClip(o, dir, len),
    });
    camCtx.carPos = carPos;
    camCtx.carQuat = carQuat;
    camCtx.speed = inSession ? ph.speed : 0;
    camCtx.accel = accelLong;
    camCtx.accelLat = inSession ? -(this._aLat || 0) : 0;
    camCtx.showcase = this.showcase;
    camCtx.grid = this._gridShot;
    camCtx.eye = this.playerCar.eye;
    if (!paused || this.cams.mode === 'orbit') this.cams.update(dt, camCtx);
    if (st === STATE.COUNTDOWN && this.cams.mode === 'grid' && this.cams.gridT > 3.3) {
      this.cams.setMode(this.settings.camera, { duration: 1.1 });
    }

    // ---- world
    this.lighting.update(inSession ? carPos : this.showcase.pos);
    this._updateTunnelLighting(dt, carPos);
    if (!paused) this.environment.update(dt, this.time);

    // ---- HUD + audio
    if (inSession) {
      this.hud.update(dt, this._hudData());
      if (!paused) {
        this.carAudio.update({
          rpm: ph.rpm,
          throttle: ph.locked ? ph.throttle * 0.8 : ph.throttle,
          speed: ph.speed,
          slip: Math.min(1, Math.max(...ph.wheelSlip) / 6),
          offTrack: ph.offTrack,
          kerb: ph.onKerb,
          maxRpm: ph.spec.maxRpm,
          cylinders: this.subEra.cylinders,
          limiter: ph.limiter,
          ai: nearestAI ? { distance: nearestD, rpm: nearestAI.rpm * (ph.spec.maxRpm / CAR_SPEC.maxRpm), closingSpeed: this._closing(nearestAI) } : null,
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
    // rear-view mirrors: low-res render every other frame, only in the cockpit
    if (inSession && cockpit && this.quality.shadowMap >= 2048 && !paused) {
      this._mirrorFrame = ((this._mirrorFrame || 0) + 1) % 2;
      if (this._mirrorFrame === 0) this._renderMirrors(carPos, carQuat);
      car.setMirrorTexture(this.mirrorRT.texture);
    } else if (car.mirrorMat && car.mirrorMat.map) car.setMirrorTexture(null);
  }

  _renderMirrors(carPos, carQuat) {
    const cam = this.mirrorCam;
    _v.set(0, 0.62, -0.1).applyQuaternion(carQuat);
    cam.position.copy(carPos).add(_v);
    cam.quaternion.copy(carQuat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.05));
    const r = this.renderer;
    const autoShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.mirrorRT);
    r.render(this.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = autoShadow;
  }

  /** Monaco tunnel: darken sun/sky light and add passing lamp light when the camera is inside. */
  _updateTunnelLighting(dt, carPos) {
    let target = 0;
    if (this.circuit.tunnelRange) {
      const cp = this.camera.position;
      this.track.project(cp.x, cp.z, this._camProj.index, this._camProj, cp.y);
      if (this.circuit.inTunnel(this._camProj.s) && this._camProj.dist < this.track.halfWidth + 4 && cp.y < this._camProj.height + 6) target = 1;
    }
    this._tunnel = (this._tunnel || 0) + (target - (this._tunnel || 0)) * Math.min(1, dt * 3.5);
    const f = this._tunnel;
    this.lighting.setDimming(f);
    this.scene.environmentIntensity = 0.9 * (1 - f * 0.82);
    const L = this.tunnelLight;
    if (f > 0.01) {
      // lamps every 6 m overhead: the light pulses as the car passes under them
      const s = this._proj ? this._proj.s : 0;
      const pulse = 0.65 + 0.35 * Math.cos((s / 6) * Math.PI * 2);
      L.intensity = f * 60 * pulse;
      L.position.set(carPos.x, carPos.y + 5.2, carPos.z);
    } else L.intensity = 0;
  }

  _gearLabel() {
    const ph = this.physics;
    if (ph.speed < -0.5) return 'R';
    if (ph.transmission !== 'manual' && Math.abs(ph.speed) < 0.4 && ph.throttle === 0) return 'N';
    return String(ph.gear);
  }

  _closing(ai) {
    const lv = this.physics.body.linvel();
    _v.subVectors(ai.car.root.position, this.playerCar.root.position).normalize();
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

  /** Tyre smoke, dust, rubber marks and floor sparks. */
  _emitPlayerEffects(dt) {
    const ph = this.physics;
    const root = this.playerCar.root;
    const spd = Math.abs(ph.speed);
    const lv = ph.body.linvel();
    const vc = ph.vc;
    // rubber marks from every sliding / locked / spinning tyre
    const right = (this._right || (this._right = new THREE.Vector3())).set(-1, 0, 0).applyQuaternion(root.quaternion);
    right.y = 0;
    right.normalize();
    for (let i = 0; i < 4; i++) {
      const intensity = vc.wheelIsInContact(i) && ph.surface[i] <= 2 ? Math.min(1, Math.max(0, (ph.wheelSlip[i] - 1.6) / 5)) : 0;
      if (intensity > 0) {
        const cp = vc.wheelContactPoint(i);
        if (cp) { _v.set(cp.x, cp.y, cp.z); this.skids.add(i, _v, right.x, right.z, intensity, i < 2 ? 0.3 : 0.38); continue; }
      }
      this.skids.add(i, _v, 0, 0, 0);
    }
    const P = this.particles;
    const wheelLocal = this._wheelLocal || (this._wheelLocal = [
      new THREE.Vector3(CAR_SPEC.trackHalf, -0.3, CAR_SPEC.frontZ), new THREE.Vector3(-CAR_SPEC.trackHalf, -0.3, CAR_SPEC.frontZ),
      new THREE.Vector3(CAR_SPEC.trackHalf, -0.3, CAR_SPEC.rearZ), new THREE.Vector3(-CAR_SPEC.trackHalf, -0.3, CAR_SPEC.rearZ),
    ]);
    this._emitAcc = (this._emitAcc || 0) + dt * 60;
    if (this._emitAcc < 1) return;
    this._emitAcc = 0;
    const j = () => (Math.random() - 0.5) * 1.2;
    for (let i = 0; i < 4; i++) {
      const sfc = ph.surface[i];
      const slip = ph.wheelSlip[i];
      const smoke = slip > 2.4 && spd > 5 && sfc <= 2;
      const dust = sfc >= 3 && spd > 7;
      if (!smoke && !dust) continue;
      _v.copy(wheelLocal[i]).applyMatrix4(root.matrixWorld);
      if (smoke) {
        const k = Math.min(1, (slip - 2.4) / 6);
        P.emit(_v.x, _v.y + 0.1, _v.z, lv.x * 0.22 + j(), 0.4 + Math.random() * 0.6, lv.z * 0.22 + j(), { life: 1.3 + Math.random() * 1.4, size: 0.9 + k * 1.6, r: 0.88, g: 0.88, b: 0.9, alpha: 0.14 + k * 0.42 });
      } else {
        const gravel = sfc === 4;
        P.emit(_v.x, _v.y + 0.15, _v.z, lv.x * 0.15 + j(), 0.8 + Math.random(), lv.z * 0.15 + j(), { life: 1.0 + Math.random() * 0.6, size: 0.9 + spd * 0.015, r: gravel ? 0.72 : 0.5, g: gravel ? 0.64 : 0.47, b: gravel ? 0.5 : 0.32, alpha: 0.45 });
      }
    }
    // landing after a kerb hop: dust puff, sparks if it bottoms out, a small camera bump
    if (!ph.grounded) this._airTime = (this._airTime || 0) + dt;
    else {
      if (this._airTime > 0.08 && spd > 15) {
        const hard = Math.min(1, this._airTime * 3 + ph.bottoming);
        _v.set(0, -0.3, -0.3).applyMatrix4(root.matrixWorld);
        for (let k = 0; k < 4 + hard * 6; k++) P.emit(_v.x + j(), _v.y, _v.z + j(), lv.x * 0.2 + j(), 0.6 + Math.random(), lv.z * 0.2 + j(), { life: 0.8 + Math.random() * 0.5, size: 0.8, r: 0.6, g: 0.58, b: 0.52, alpha: 0.35 });
        if (hard > 0.4) this._scrape = Math.max(this._scrape || 0, hard);
        this.cams.addShake(0.05 + hard * 0.12);
      }
      this._airTime = 0;
    }
    // exhaust pops: lift-off at high revs and upshifts flick a short flame from the tailpipes
    const thr = ph.throttle;
    if (((this._prevThr || 0) > 0.6 && thr < 0.2 && ph.rpm > ph.spec.maxRpm * 0.7) || (ph.shiftTimer > 0.04 && !this._wasShifting)) {
      for (const ex of this.playerCar.exhausts) {
        _v.copy(ex).applyMatrix4(root.matrixWorld);
        for (let k = 0; k < 5; k++) this.sparks.emit(_v.x, _v.y, _v.z, lv.x - _fwd.x * 6 + j(), j() * 0.6, lv.z - _fwd.z * 6 + j(), { life: 0.06 + Math.random() * 0.08, size: 0.32, r: 1, g: 0.55 + Math.random() * 0.3, b: 0.2, alpha: 0.9 });
      }
    }
    this._prevThr = thr;
    this._wasShifting = ph.shiftTimer > 0.04;
    // floor sparks when the plank touches the road (compression, crests, kerbs at speed)
    const scrape = Math.max(ph.bottoming, this._scrape || 0, spd > 50 && ph.onKerb > 0 ? 0.25 * Math.random() : 0);
    this._scrape = Math.max(0, (this._scrape || 0) - dt * 4);
    if (scrape > 0.05 && spd > 25) {
      const n = 1 + Math.floor(scrape * 5);
      for (let k = 0; k < n; k++) {
        _v.set((Math.random() - 0.5) * 1.0, -0.33, -0.9 - Math.random() * 1.1).applyMatrix4(root.matrixWorld);
        this.sparks.emit(_v.x, _v.y, _v.z, lv.x * 0.55 + j() * 3, 1 + Math.random() * 2.5, lv.z * 0.55 + j() * 3, { life: 0.18 + Math.random() * 0.3, size: 0.09 + Math.random() * 0.08, r: 1, g: 0.62 + Math.random() * 0.3, b: 0.25, alpha: 1 });
      }
    }
  }

  _sparkBurst(pos, vel, n) {
    for (let k = 0; k < n; k++) {
      this.sparks.emit(pos.x + (Math.random() - 0.5) * 0.8, pos.y + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * 0.8,
        vel.x * 0.5 + (Math.random() - 0.5) * 9, 1 + Math.random() * 5, vel.z * 0.5 + (Math.random() - 0.5) * 9,
        { life: 0.25 + Math.random() * 0.45, size: 0.1 + Math.random() * 0.08, r: 1, g: 0.6 + Math.random() * 0.3, b: 0.25, alpha: 1 });
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
    if (tr.sectorTimes[0] == null && this._lastLapSectors && tr.currentLapTime(this.raceTime) < 4) {
      for (let i = 0; i < 3; i++) { d.sectors[i].time = this._lastLapSectors.times[i]; d.sectors[i].cls = this._lastLapSectors.cls[i]; }
    }
    d.speedKmh = Math.abs(ph.speed) * 3.6;
    d.gear = this._gearLabel();
    d.rpm = ph.rpm;

    d.manual = ph.transmission === 'manual';
    d.limiter = ph.limiter;
    d.damage = this.damage.status();
    d.topGear = ph.spec.gears.length - 1;
    d.rpmMax = ph.spec.maxRpm;
    d.brakeTemp = ph.brakeTemp;
    d.markers.length = 0;
    for (const rc of race.racers) {
      if (rc.isPlayer) d.markers.push({ x: this.playerCar.root.position.x, z: this.playerCar.root.position.z, color: rc.color, isPlayer: true });
      else d.markers.push({ x: rc.driver.car.root.position.x, z: rc.driver.car.root.position.z, color: rc.color, isPlayer: false });
    }
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
    this.sparks.setViewportHeight(h);
    this.hud.map && this.hud.map.resize();
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
