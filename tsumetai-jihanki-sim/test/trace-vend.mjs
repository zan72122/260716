/* ベンドサイクルのトレース: node test/trace-vend.mjs [col] */
import { World } from '../js/physics.js';
import { Rack } from '../js/rack.js';
import { PHYS, RACK, genShelves, PRODUCTS, COLUMNS } from '../js/config.js';

const colIdx = Number(process.argv[2] ?? 0);
const world = new World();
const events = [];
const rack = new Rack(world, (t, d) => events.push(`${world.time.toFixed(2)} ${t} col=${d.col ?? ''}`), (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })());
const counts = [0, 0, 0, 0, 0]; counts[colIdx] = 3;
rack.preload(counts);

const step = () => { rack.tick(PHYS.h); world.step(PHYS.h); };
for (let i = 0; i < 480 * 13; i++) step();

const col = rack.cols[colIdx];
console.log('shelves:', col.shelves.map(s => `(${s.a[0].toFixed(2)},${s.a[1].toFixed(2)})->(${s.b[0].toFixed(2)},${s.b[1].toFixed(2)})`).join(' '));
console.log('pins: lower z=' + col.zPinLower.toFixed(4) + ' upper z=' + col.zPinUpper.toFixed(4));
console.log('r=' + col.product.r);
const dump = (label) => {
  console.log(label, world.bodies.filter(b => b.layer === col.layer)
    .map(b => `(${b.x.toFixed(3)},${b.y.toFixed(3)})${b.sleeping ? 's' : ''}`).join(' '));
};
dump('settled:');
rack.vend(colIdx);
for (let i = 0; i < 480 * 4; i++) {
  step();
  if (i % 240 === 0) dump(`t=${world.time.toFixed(2)}:`);
}
console.log('events:', events.filter(e => !e.includes('Spawn')));

// 追加デバッグ: 残存物体の速度と接触状況
for (const b of world.bodies.filter(b => b.layer === col.layer)) {
  console.log(`body (${b.x.toFixed(4)},${b.y.toFixed(4)}) v=(${b.vx.toExponential(2)},${b.vy.toExponential(2)}) w=${b.w.toExponential(2)} sleep=${b.sleeping} sleepT=${b.sleepTimer.toFixed(2)}`);
}
console.log('pinLower.enabled=', col.pinLower.enabled, 'pinUpper.enabled=', col.pinUpper.enabled);
console.log('pinUpper seg:', col.pinUpper.ax, col.pinUpper.ay, col.pinUpper.bx, col.pinUpper.by);
// 前方の商品に接触しうる全コライダを列挙
const fb = world.bodies.filter(b => b.layer === col.layer).sort((a,b)=>b.x-a.x)[1];
console.log('front queued body:', fb.x.toFixed(4), fb.y.toFixed(4));
for (const s of world.segs) {
  if (s.layer !== col.layer || !s.enabled) continue;
  const abx = s.bx - s.ax, aby = s.by - s.ay;
  const len2 = abx*abx + aby*aby;
  let t = len2 > 0 ? ((fb.x - s.ax)*abx + (fb.y - s.ay)*aby)/len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = s.ax + abx*t, cy = s.ay + aby*t;
  const d = Math.hypot(fb.x-cx, fb.y-cy);
  if (d < fb.r + 0.002) console.log(`  near seg mat=${s.material} a=(${s.ax.toFixed(3)},${s.ay.toFixed(3)}) b=(${s.bx.toFixed(3)},${s.by.toFixed(3)}) d=${d.toFixed(4)} r=${fb.r}`);
}
