// Dev probe: measure deceleration for raw Rapier wheel-brake values on flat ground.
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics.js';
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = 1/120;
const g = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0,-0.5,0), g);
for (const raw of [5, 20, 50, 100, 200, 400]) {
  const car = new VehiclePhysics(RAPIER, world, { position: new THREE.Vector3(0, 0.6, -2000) });
  for (let i = 0; i < 60; i++) { car.preStep(1/120); world.step(); car.postStep(1/120); }
  car.body.setLinvel({ x: 0, y: 0, z: 55 }, true);
  let t = 0;
  while (car.body.linvel().z > 28 && t < 20) {
    car.throttle = 0; car.brake = 0; car.preStep(1/120);
    for (let i = 0; i < 4; i++) car.vc.setWheelBrake(i, raw);
    car.vc.updateVehicle(1/120);
    world.step(); car.postStep(1/120); t += 1/120;
  }
  console.log('brake', raw, '200->100 km/h', t.toFixed(2), 's  decel', ((55 - 27.8) / t / 9.81).toFixed(2), 'g');
  car.dispose();
}
