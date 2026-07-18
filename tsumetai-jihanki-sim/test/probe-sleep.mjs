import { World } from '../js/physics.js';
import { Rack } from '../js/rack.js';
import { PHYS } from '../js/config.js';
const world = new World();
const rack = new Rack(world, () => {}, (() => { let s = 7; return () => { s = (s*1664525+1013904223)>>>0; return s/4294967296; }; })());
rack.preload([3,2,2,2,2]);
for (let i = 0; i < 480*14; i++) { rack.tick(PHYS.h); world.step(PHYS.h); }
for (const b of world.bodies) {
  console.log(`${b.layer} (${b.x.toFixed(3)},${b.y.toFixed(3)}) sp=${Math.hypot(b.vx,b.vy).toExponential(2)} w=${b.w.toExponential(2)} sleep=${b.sleeping} sT=${b.sleepTimer.toFixed(2)}`);
}
