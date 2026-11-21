# HUNGARORING GP — Racing Challenge

*Master the circuit. Own the race.*

A single-player 3D Formula racing game built with **Three.js** and **Rapier** physics. It runs entirely in the
browser, with no backend and no accounts. Every model, texture and sound is generated procedurally in code,
so the game needs no downloads and works offline.

It features four circuits (Hungaroring, Monaco, Spa-Francorchamps and Suzuka), **three eras of Formula cars**
(2020, 2000s V10/V8, 1990s early/mid/late) with their own geometry and engine character, **real crash damage**,
red-hot brake discs, a free-look camera, an immersive cockpit view and an optional manual gearbox.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Requires a WebGL 2 browser (recent Chrome, Edge or Firefox). Each circuit is generated when it loads (terrain,
forests, buildings), which takes a few seconds. Recommended preset: **Medium** on laptop GPUs (such as an
RTX 2050), **High** on desktop GPUs.

## Controls

Every key can be remapped in **Settings → Controls**.

| Default key | Action |
| --- | --- |
| **W / ↑** | Accelerate |
| **S / ↓** | Brake (hold at a standstill to reverse) |
| **A / ←**, **D / →** | Steer |
| **Space** | Strong brake |
| **E / Right Shift** | Shift up (manual transmission) |
| **Q / Right Ctrl** | Shift down (manual transmission) |
| **C** | Cycle camera: Chase → Far chase → Cockpit |
| **R** | Reset / respawn the car onto the track (fully repaired) |
| **Mouse drag** | Orbit the camera around the car (cockpit: look around); **wheel** zooms |
| **V** or **double-click** | Reset the camera view |
| **Z / X** (hold) | Look left / right in the cockpit |
| **Esc** | Pause (resume, restart, controls, settings, main menu) |
| **M** | Mute all sound |

**Gamepad** (standard mapping): left stick steers, RT and LT for throttle and brake, RB and LB (or A and X)
shift, Y changes camera, B resets the car, Start pauses, the **right stick looks around** and R3 resets the view.

## Game modes

- **Start Race**: you against 4 AI rivals, over 3 or 5 laps, starting from the back of the grid. The race starts
  with five red lights and a randomised hold, and you cannot move before the lights go out.
- **Time Trial**: a solo session with unlimited flying laps, sector times, a best lap per circuit saved to
  `localStorage`, and track limits (a lap is deleted when all four wheels leave the track).
- **Circuit** and **Car** buttons in the main menu open the track selection and the era / car selection.

## Circuits

Each circuit is a definition file in `src/track/circuits/`. It describes the corner sequence (direction, angle
and radius of every turn), elevation keyframes, track width, run-off style, pit lane, grandstands, environment
theme and sky. The sequence is integrated into a closed centreline (two straights are solved so the loop closes
exactly), scaled to the real lap length, and fed into a `CatmullRomCurve3`. Road, kerbs, barriers, colliders,
AI racing line, minimap and timing all come from that one spline.

| Circuit | Length | Character |
| --- | --- | --- |
| **Hungaroring** | 4.381 km | Technical, in a wooded valley, with downhill T1–T2 and the T4 crest |
| **Monaco** | 3.337 km | Narrow streets with walls right at the racing line, a 40 m climb to Casino, the Grand Hotel hairpin, a lit **tunnel** (the light really changes inside), the harbour with moored yachts, and terraced apartment blocks |
| **Spa-Francorchamps** | 7.004 km | Ardennes forest, the **Eau Rouge / Raidillon** compression and 18% climb, the Kemmel straight, Pouhon, Blanchimont and the Bus Stop |
| **Suzuka** | 5.807 km | **Figure-eight** with a real crossover bridge (the Degner–Hairpin road passes 10 m under the back straight), the S-curves, Degner, the Hairpin, Spoon, 130R, the Casio chicane, and the amusement-park Ferris wheel |

The layouts are hand-reconstructed from each circuit's corner sequence and character. They are recognisable,
but they are not survey-accurate maps. `tools/layout-optimize.mjs` was used to close each loop with the right
net rotation (−360° for clockwise loops, 0° for Suzuka's figure-eight) and the right crossover count.

## Eras and cars

Choose an **era**, then a **variant**, then a car (`src/vehicle/CarCatalog.js`). The selected car is shown live
as a 3D preview in the menu: drag to rotate it, scroll to zoom. The panel shows era, team, engine and gearbox.

| Era | Variants | Identity |
| --- | --- | --- |
| **2020** | the nine original teams | halo, complex multi-element wings and bargeboards, high nose / slim sidepods, 13" wheels, V6 turbo-hybrid (12 500 rpm, 8 gears) |
| **2000s** | **V10 2000–05** · **V8 2006–08** | no halo, high nose with a spoon-shaped front wing, periscope exhausts, chimneys, V10 cars with flick-ups, V8 cars with horn wings and shark fin; screaming V10 18 500 rpm / V8 19 000 rpm, 7 gears |
| **1990s** | **Early 1990–93** · **Mid 1994–97** · **Late 1998–99** | early: low nose, wide slick tyres, big sidepods; mid: raised nose; late: narrow cars on **grooved tyres**; low exhausts, round steering wheel with a dash pod; V12/V10 sound, 6 gears |

Historical cars use period-style colour schemes (no logos, no sponsor names, fictional drivers). The 2020 teams
keep their own chassis concepts (nose, sidepods, wings, airbox), so cars differ in shape, not just colour.
Era also changes the feel: power, downforce, drag, grip, rev range, gear count and engine note. Visual
proportions vary per era, but the physics wheelbase is shared, so the handling you know stays consistent.
AI rivals always drive cars from **your** era.

Each car model has spoked rims, **vented brake discs with bells and calipers**, wishbone/push-rod
suspension, endplates, rear-wing supports, a cockpit opening with headrest, mirrors, an era-specific steering
wheel, a carbon-fibre floor, exhausts and an airbox.

**Brake glow:** the discs sit right behind the spokes, so you can see them from the chase, external and
cockpit views. They go from dark metal through dull red to bright orange depending on how hard and how often
you brake, then cool down. It is visual only and has no effect on grip.

## Crash damage

Damage comes from the real Rapier collisions (`src/vehicle/DamageModel.js`). Each impact is measured by the
car's velocity change during the contact, the direction of that change in the car's frame (front, rear or
side, left or right), and the collider that was hit (front wing, rear wing, sidepods or tub).

| Level | Velocity change | What happens |
| --- | --- | --- |
| none | < 5 m/s | small touches: just a thump |
| **Minor** | 5–11 m/s | wing bent, slight aero loss |
| **Moderate** | 11–20 m/s | nose crumples, wing angle lost, a corner can be bent (the car pulls to one side) |
| **Severe** | 20–30 m/s | wings break off, suspension bends (camber/toe), a wheel can be torn off in a side hit |
| **Terminal** | > 30 m/s | multiple parts and wheels detach, the engine is damaged, and the car is undrivable: **press R** |

Detached parts become physical debris that bounces and tumbles on the track, with carbon shards, sparks and a
crash sound. The HUD shows a damage diagram of the car. Damage affects physics only where it should: downforce
is lost with a wing, steering pulls with a bent corner, grip drops on bent corners, a lost wheel has no
contact, and engine damage cuts power. **R** respawns a fully repaired car.

## Driving simulation

The base is Rapier's `DynamicRayCastVehicleController`: front steering, rear drive, four-wheel brakes and
spring/damper suspension, stepped at a fixed 120 Hz with interpolated rendering. On top of it:

- **Arcade layer** (unchanged from v1): aero downforce and drag, speed-sensitive steering, grass and gravel
  penalties, a yaw-stability assist and a tilt limiter. Springs stiffen with downforce (an aero platform), so
  the floor only kisses the road at very high speed, throwing **sparks**.
- **Braking:** the original v1 brake response (260 → 100 km/h in about 2.0 s / 99 m). There is no tyre
  temperature, wear or wheel lock-up model, so grip never changes with driving style. Sliding tyres still
  leave **rubber marks** and smoke.
- **Brake temperatures:** each disc heats under braking (fronts more than rears, matching the 56/44 brake
  bias) and cools with airflow. This drives the glow only and has no effect on braking.
- **Suspension and weight transfer:** independent wheel travel is visible. The body pitches under
  braking and acceleration, rolls in fast corners and heaves with the real suspension compression. Kerbs apply
  alternating forces per wheel, so the chassis chatters and the camera shakes on them.
- **Transmission:** **Automatic** is the default and unchanged. In **Manual** mode you shift yourself through
  the era's gears (8, 7 or 6) with realistic ratios. Power depends on where the engine sits in its rev band, the rev limiter cuts
  drive at the top of each gear, downshifts that would over-rev are refused, and you can't go past 8th or
  below 1st.
- **Details:** exhaust flames on lift-off and upshifts, a dust puff and camera bump when landing after a kerb
  hop, floor sparks, and an engine note that follows the era's cylinder count.

## Cameras

- **Chase** and **Far chase**: speed-sensitive, look-ahead, clip-proof. Response is adjustable in Settings.
- **Free look:** hold the mouse and drag on the 3D view to orbit the camera around the car (smooth yaw and
  pitch, never under the ground, distance limits), and scroll to zoom. **V** or double-click resets it.
  Steering and throttle keep working while you look. Sensitivity is in Settings → Driving. The gamepad's
  right stick does the same.
- **Cockpit**: the driver's eye line through the halo. It includes a steering wheel that turns with your
  inputs, a **live wheel display** (gear, speed, rev LEDs, AUTO/MANUAL, damage), team-coloured gloves and
  **working rear-view mirrors** (a low-resolution rear render, Medium/High only). Head motion is
  spring-damped: you're pushed forward under braking and back under acceleration, you lean in corners, and
  there's subtle vibration at speed. The FOV is adjustable. Drag the mouse or hold **Z / X** to look
  around the cockpit (limited range), and V re-centres the view.
- Switching cameras always blends smoothly. The menu showcase, grid fly-over and finish orbit are kept.

## Settings

Settings are saved to `localStorage` and persist between sessions. They're organised in five tabs:

- **Gameplay**: transmission (automatic or manual), rival pace, race distance.
- **Driving**: steering sensitivity, default camera, cockpit FOV, chase camera response, camera shake.
- **Audio**: master volume, mute, menu music.
- **Graphics**: Low, Medium or High, controlling render scale, shadow map size, scenery density and mirrors.
- **Controls**: remap any action (each action can have two keys).

## Race system, AI, presentation and audio

These work as in v1, on every circuit:

- **Race rules:** ordered checkpoints (no shortcuts), lap and sector timing interpolated between physics
  steps, live positions with broadcast-style gaps, a chequered-flag rule, and a results screen.
- **AI:** four rivals with different pace and racecraft. They follow a minimum-curvature racing line, look
  far enough ahead to stop for slow or stopped cars, overtake, and sidestep on contact.
- **Engine audio:** synthesised, now with richer V6 harmonics, lift-off exhaust pops, a rev-limiter stutter
  and kerb rumble.

## Project structure

```
src/
  main.js                     boot + loading screen
  core/        Game.js (orchestrator, circuit loading), GameState.js, GameLoop.js (fixed-step loop)
  scene/       createScene.js (renderer, per-circuit sky), SkyDome.js, Lighting.js (incl. tunnel dimming),
               Environment.js (terrain, forests, grandstands, harbour/city, Ferris wheel), TerrainData.js, Textures.js
  track/       circuits/*.js (circuit definitions), layout.js (corner-sequence integration), TrackGeometry.js,
               Hungaroring.js (circuit mesh builder: road, kerbs, barriers, pit lane, tunnel, bridges),
               TrackColliders.js, Checkpoints.js, TrackMap.js
  vehicle/     Teams.js, CarCatalog.js (eras / cars), FormulaCar.js (era models, cockpit, brake glow, detachable
               parts), DamageModel.js, VehiclePhysics.js (Rapier vehicle + brake temps + gearbox + damage
               effects), CarController.js, CarAudio.js
  ai/          AIDriver.js, AIOpponentManager.js
  race/        RaceManager.js, LapSystem.js, RacePosition.js
  camera/      ChaseCamera.js, CameraManager.js
  effects/     Particles.js (smoke, dust, sparks), SkidMarks.js, Debris.js (detached parts & carbon shards)
  ui/          MainMenu.js, SelectionScreens.js, HUD.js, Countdown.js, PauseMenu.js, ResultsScreen.js,
               SettingsMenu.js, ControlsPanel.js
  systems/     InputManager.js (bindings + gamepad), CameraInput.js (mouse look), AudioManager.js, LocalStorage.js
tools/         headless tests & design tools (Node, no browser needed)
```

## Headless tests

The track and physics modules have no DOM dependencies, so the real physics runs in Node. Set
`TRACK=monaco|spa|suzuka|hungaroring` on any of these:

```bash
npm run sim             # autopilot lap: lap time, top speed, braking distance, brake temperatures
npm run test:brakes     # no tyre model, original braking, disc heating/cooling, manual gearbox
npm run test:damage     # wall impacts 12-280 km/h, front/side/rear zones, parts/wheels detach, repair
npm run test:tracks     # every circuit: length, reference lap, speed range, gradient, crossover clearance
npm run test:rollover   # violent steering, barrier hits, gravel at speed: the car never rolls
npm run test:race       # seeded races vs AI with a "chaotic" player: contact never flips the car
node tools/layout-preview.mjs suzuka out.svg   # render a circuit layout to SVG
```

## Credits

- Libraries: [three.js](https://threejs.org) (MIT), [Rapier](https://rapier.rs) (Apache-2.0),
  [Vite](https://vitejs.dev) (MIT). The font [Titillium Web](https://fonts.google.com/specimen/Titillium+Web)
  (SIL OFL 1.1) is bundled locally via `@fontsource`.
- All models, textures and sounds are procedural. Sponsor brands and drivers are fictional, and no official
  F1, team or circuit logos are used.
