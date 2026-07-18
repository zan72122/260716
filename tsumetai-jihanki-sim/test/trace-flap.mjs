import { World } from '../js/physics.js';
import { Rack } from '../js/rack.js';
import { PHYS } from '../js/config.js';
const world = new World();
const rack = new Rack(world, () => {}, (() => { let s = 7; return () => { s = (s*1664525+1013904223)>>>0; return s/4294967296; }; })());
const counts = new Array(30).fill(0); counts[5] = 1;
rack.preloadDirect(counts);
const b = world.bodies[0];
const inner = rack.chuteFlaps[0].inner;
const step = () => { rack.tick(PHYS.h); world.step(PHYS.h); };
for (let i = 0; i < 480 * 2; i++) step();
rack.vend(5);
for (let i = 0; i < 480 * 3; i++) {
  step();
  if (b.y < 0.75 && i % 24 === 0) {
    console.log(`t=${(world.time-2).toFixed(2)} p=(${b.x.toFixed(3)},${b.y.toFixed(3)}) v=(${b.vx.toFixed(2)},${b.vy.toFixed(2)}) flap=${inner.angle.toFixed(3)} layer=${b.layer}`);
  }
}
