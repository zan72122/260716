/* 単一硬貨の軌道トレース (デバッグ用): node test/trace-coin.mjs 10 */
import { World } from '../js/physics.js';
import { CoinMech } from '../js/coin-mech.js';
import { PHYS } from '../js/config.js';

const denom = Number(process.argv[2] ?? 10);
const world = new World();
const events = [];
const mech = new CoinMech(world, (t, d) => events.push(`${world.time.toFixed(3)} ${t} ${d.denom ?? ''}`));
mech.insertCoin(denom);
const body = world.bodies[0];
let lastLog = 0;
for (let i = 0; i < 480 * 5; i++) {
  mech.tick(PHYS.h);
  world.step(PHYS.h);
  if (world.time - lastLog >= 0.1) {
    lastLog = world.time;
    console.log(`t=${world.time.toFixed(2)} x=${body.x.toFixed(4)} y=${body.y.toFixed(4)} vx=${body.vx.toFixed(3)} vy=${body.vy.toFixed(3)} sleep=${body.sleeping}`);
  }
  if (body.dead) { console.log('body removed at t=' + world.time.toFixed(3)); break; }
}
console.log('events:', events);
