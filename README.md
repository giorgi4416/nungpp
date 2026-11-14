# HUNGARORING GP — Racing Challenge

*Master the circuit. Own the race.*

A single-player 3D Formula racing game built with **Three.js** and **Rapier** physics. It runs entirely in the
browser, with no backend and no accounts. Every model, texture and sound is generated procedurally in code,
so the game needs no downloads and works offline.

![Three.js](https://img.shields.io/badge/Three.js-r187-black) ![Rapier](https://img.shields.io/badge/Rapier-0.21-orange) ![Vite](https://img.shields.io/badge/Vite-8-646cff)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Requires a WebGL 2 browser (recent Chrome, Edge or Firefox). On first load the circuit, terrain and forests are
generated, which takes a few seconds.

## Controls

| Key | Action |
| --- | --- |
| **W / ↑** | Accelerate |
| **S / ↓** | Brake (hold at a standstill to reverse) |
| **A / ←**, **D / →** | Steer |
| **Space** | Strong brake |
| **C** | Cycle camera: Chase → Far chase → Cockpit |
| **R** | Reset the car onto the track |
| **Esc** | Pause (resume, restart, controls, settings, main menu) |
| **M** | Mute all sound |

## Game modes

- **Start Race**: you against 4 AI rivals, over 3 or 5 laps, starting from the back of the grid. The race starts
  with the five-red-lights sequence and a randomised hold, and you cannot move before the lights go out.
- **Time Trial**: a solo session with unlimited flying laps, sector times, a best lap saved to `localStorage`,
  and track limits (a lap is deleted when all four wheels leave the track).

## What's inside

**Circuit.** The Hungaroring is described the way an engineer would describe it: 14 corners, each with a
direction, angle and radius, joined by straights. That sequence is integrated into a closed centreline, scaled
to the real **4.381 km** lap, and used as control points for a closed `CatmullRomCurve3`. The road, kerbs,
verges, gravel traps, barriers, colliders, AI racing line, minimap and timing all come from this one spline.
That is why they always line up and the road has no gaps. Elevation follows the valley's character: downhill
into T1 and T2, a crest at T4, and a climb back to the line.

**Environment.** Terrain with mowing stripes, with hills rising around the valley. There are about 8,500
instanced trees with wind sway, ten grandstands holding about 13,600 animated spectators, a pit building with
garages, the control tower, paddock, start/finish gantry with working start lights, grid boxes, pit lane,
sponsor barriers, tyre walls, catch fencing, marshal posts, billboards, waving flags, a sponsor bridge, turn
numbers, braking boards and sector boards.

**Car.** A procedurally modelled modern single-seater. It is built from lofted monocoque, nose, engine cover
and sidepod sections, aerofoil front and rear wings, a halo, sculpted tyres with compound stripes, wheel
covers, brake discs that glow under braking, wishbones, mirrors, a helmet and livery decals. Wheels spin and
steer, the suspension follows the physics, and the body pitches and rolls with load transfer. There are five
fictional liveries, and the player's car is #7 Danubio Racing in red and black.

**Physics.** The car uses Rapier's `DynamicRayCastVehicleController`, the same approach as the official
three.js example. It has front steering, rear-wheel drive, four-wheel brakes, and suspension stepped at a
fixed 120 Hz with interpolated rendering. On top of that sits an arcade layer:

- aero downforce and drag, giving about 300 km/h on the main straight
- an 8-speed automatic gearbox with a power curve
- speed-sensitive steering
- grip and drag penalties on grass and gravel
- a yaw-stability assist and a tilt limiter, so the car stays predictable and never rolls over

**AI.** Four rivals with different pace, launch reactions and aggression. They follow a minimum-curvature
racing line with a speed profile computed from curvature, braking and acceleration limits. They look ahead
far enough to stop for slower or stopped cars, pick a side to overtake, keep a car's width when alongside,
and sidestep on contact. The AI cars are kinematic Rapier bodies, so you can really collide with them.
Rival pace can be set to Easy, Medium or Hard.

**Race system.** Ordered checkpoints mean shortcuts and reversing over the line never count. Lap and sector
times are interpolated between physics steps. Positions come from validated race distance, and gaps are
measured at the last common timing point, the way broadcast timing does it. A chequered-flag rule applies
(after the leader finishes, everyone finishes on their next crossing). The results screen shows the full
classification, lap list and personal-best badge.

**Presentation.**
- A cinematic main menu: an orbiting showcase car in the pit lane while the rivals lap the circuit live
  behind it.
- A broadcast-style HUD: position, lap, timing tower, sector bars (purple/green/yellow), speedometer with rev
  arc and shift lights, a live minimap generated from the centreline, and animated notifications for lap,
  best lap, sector, position, off track, wrong way, track limits and finish.
- A grid fly-over before the start lights, smooth blended camera transitions, impact shake, and anti-clipping
  against the ground and barriers.

**Audio.** All audio is synthesised with the Web Audio API:

- V6-style engine pitched by RPM, with turbo whistle
- tyre squeal, wind, and gravel/grass rumble
- a nearby-rival engine with doppler
- gear shifts, impacts, countdown beeps, GO, UI sounds
- a generative menu music loop

Audio starts after your first click or key press, as browsers require.

**Settings** (saved to `localStorage`, with safe fallbacks if the stored data is corrupted):

- graphics quality: Low, Medium or High (render scale, shadow map size, tree and crowd density, fog distance)
- volume, mute and menu music
- default camera and camera shake
- rival pace and race distance

## Project structure

```
src/
  main.js                     boot + loading screen
  core/        Game.js (orchestrator), GameState.js (state machine), GameLoop.js (fixed-step loop)
  scene/       createScene.js, SkyDome.js, Lighting.js, Environment.js, TerrainData.js, Textures.js
  track/       HungaroringLayout.js (corner sequence), TrackGeometry.js (spline data),
               Hungaroring.js (circuit meshes), TrackColliders.js, Checkpoints.js, TrackMap.js (minimap)
  vehicle/     FormulaCar.js (model), VehiclePhysics.js (Rapier vehicle), CarController.js, CarAudio.js
  ai/          AIDriver.js, AIOpponentManager.js
  race/        RaceManager.js, LapSystem.js, RacePosition.js
  camera/      ChaseCamera.js, CameraManager.js
  ui/          MainMenu.js, HUD.js, Countdown.js, PauseMenu.js, ResultsScreen.js, SettingsMenu.js, ControlsPanel.js
  systems/     InputManager.js, AudioManager.js, LocalStorage.js
  effects/     Particles.js (tyre smoke & dust)
styles/main.css
tools/         headless test & design tools (Node, no browser needed)
```

## Headless test tools

The track and physics modules have no DOM dependencies, so they also run in Node:

```bash
npm run sim                     # autopilot lap: lap time, 0-100, top speed, braking distance
node tools/flip-test.mjs        # violent steering, barrier hits and gravel at speed: checks the car never rolls
node tools/race-sim.mjs 8 200   # 8 seeded races vs AI with a "chaotic" player: checks contact never flips the car
node tools/layout-preview.mjs out.svg   # render the circuit layout to SVG
```

## Notes and credits

- The circuit is a hand-reconstructed approximation of the Hungaroring's layout and character. It is not
  official survey data.
- All teams, drivers, liveries and sponsor brands are fictional. No official F1 branding or third-party
  game assets are used.
- Libraries: [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache-2.0),
  [Vite](https://vitejs.dev) (MIT). The font [Titillium Web](https://fonts.google.com/specimen/Titillium+Web)
  (SIL OFL 1.1) is bundled locally via `@fontsource`.
