import { World, Disc, Seg } from '../js/physics.js';
import { PHYS } from '../js/config.js';
const world = new World();
// 10度斜面
world.addSeg(new Seg({ layer: 'L', a: [-0.5, 0.1], b: [0.5, -0.076], friction: 0.32 }));
const mk = (x) => world.addBody(new Disc({ layer: 'L', x, y: 0.2, r: 0.0264, m: 0.21, friction: 0.3, rollResist: 0.10 }));
const b1 = mk(0.0), b2 = mk(-0.054);
for (let i = 0; i < 480 * 3; i++) {
  world.step(PHYS.h);
  if (i % 480 === 0) console.log(`t=${(i/480)} b1=(${b1.x.toFixed(3)},${b1.y.toFixed(3)}) v=${b1.vx.toFixed(3)} b2=(${b2.x.toFixed(3)}) v=${b2.vx.toFixed(3)}`);
}
console.log(`final b1 x=${b1.x.toFixed(3)} vx=${b1.vx.toFixed(4)} sleeping=${b1.sleeping}`);
