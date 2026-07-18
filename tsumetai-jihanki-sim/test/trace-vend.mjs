/* ベンドサイクルのトレース: node test/trace-vend.mjs [colIndex] */
import { World } from '../js/physics.js';
import { Rack } from '../js/rack.js';
import { PHYS } from '../js/config.js';
const colIdx = Number(process.argv[2] ?? 20);
const world = new World();
const events = [];
const rng = (() => { let s = 7; return () => { s = (s*1664525+1013904223)>>>0; return s/4294967296; }; })();
const rack = new Rack(world, (t, d) => events.push(`${world.time.toFixed(2)} ${t} col=${d.col ?? ''}`), rng);
const counts = new Array(30).fill(0); counts[colIdx] = 3;
rack.preloadDirect(counts);
const step = () => { rack.tick(PHYS.h); world.step(PHYS.h); };
for (let i = 0; i < 480 * 3; i++) step();
const col = rack.cols[colIdx];
console.log('col conf:', JSON.stringify(col.conf), 'cap=', col.capacity, 'yExit=', col.gen.yExit.toFixed(3));
const track = () => world.bodies.map(b => `(${b.x.toFixed(3)},${b.y.toFixed(3)})${b.layer}${b.sleeping?'s':''}`).join(' ');
console.log('settled:', track());
rack.vend(colIdx);
for (let i = 0; i < 480 * 5; i++) {
  step();
  if (i % 240 === 0) console.log(`t=${world.time.toFixed(2)}:`, track());
}
console.log(events.filter(e => !e.includes('Spawn')).join('\n'));
