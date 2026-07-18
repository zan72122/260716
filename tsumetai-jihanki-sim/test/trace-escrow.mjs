import { World } from '../js/physics.js';
import { CoinMech } from '../js/coin-mech.js';
import { PHYS } from '../js/config.js';
const world = new World();
const ev = [];
const mech = new CoinMech(world, (t, d) => ev.push(`${world.time.toFixed(2)} ${t} ${d?.denom ?? ''}`));
mech.insertCoin(500);
const body = world.bodies[0];
const step = () => { mech.tick(PHYS.h); world.step(PHYS.h); };
for (let i = 0; i < 480 * 3; i++) step();
console.log('after settle:', body.x.toFixed(3), body.y.toFixed(3), 'layer=', body.layer, 'escrow=', mech.escrow.length);
mech.setReturnLever(true);
for (let i = 0; i < 480 * 3; i++) {
  step();
  if (i % 120 === 0) console.log(`t=${world.time.toFixed(2)} (${body.x.toFixed(3)},${body.y.toFixed(3)}) layer=${body.layer} sleep=${body.sleeping}`);
}
console.log(ev.join('\n'));
