/* ============================================================
   debug.js — ?debug=1 で有効になる開発用オーバーレイ
   FPS / 剛体数 / 状態表示 + 物理コライダのワイヤ表示
   ============================================================ */
import * as THREE from 'three';
import { CABINET, COLUMNS, CHAMBERS } from './config.js';
import { LAYER_MECH, LAYER_MECH_BACK, LAYER_ESCROW_RET } from './coin-mech.js';

export function setupDebug(ctx) {
  const enabled = new URLSearchParams(location.search).has('debug');
  const el = document.getElementById('debug-overlay');
  if (!enabled) return { update() {} };
  el.classList.remove('hidden');

  // ---- コライダのワイヤ表示 ----
  const mechLines = buildLines(ctx.world, (s) => s.layer === LAYER_MECH, CABINET.mechZ + 0.03, 'xy', 0x00ff88);
  const backLines = buildLines(ctx.world, (s) => s.layer === LAYER_MECH_BACK, CABINET.mechBackZ - 0.01, 'xy', 0xff8800);
  const escLines = buildLines(ctx.world, (s) => s.layer === LAYER_ESCROW_RET, CABINET.mechZ + 0.04, 'xy', 0xffee44);
  ctx.ms.doorContent.add(mechLines, backLines, escLines);
  for (let i = 0; i < COLUMNS.length; i++) {
    const lines = buildLines(ctx.world, (s) => s.layer === `col${i}`, COLUMNS[i].x, 'zy',
      COLUMNS[i].stage === 0 ? 0x66aaff : 0x6688dd);
    ctx.ms.cabinet.add(lines);
  }
  for (let ch = 0; ch < 3; ch++) {
    ctx.ms.cabinet.add(buildLines(ctx.world, (s) => s.layer === `chute${ch}`, CHAMBERS[ch].x + 0.02, 'zy', 0xff66aa));
    for (let st = 0; st < 2; st++) {
      ctx.ms.cabinet.add(buildLines(ctx.world, (s) => s.layer === `tray${ch}${st}`, CHAMBERS[ch].x - 0.02, 'zy', 0x44ffee));
    }
  }

  let acc = 0, frames = 0, fps = 0;
  return {
    update(dt) {
      acc += dt; frames++;
      if (acc >= 0.5) {
        fps = Math.round(frames / acc);
        acc = 0; frames = 0;
      }
      const awake = ctx.world.bodies.filter(b => !b.sleeping).length;
      el.textContent =
        `fps ${fps}  ratio ${ctx.game?.timeScale ?? 1}\n` +
        `bodies ${ctx.world.bodies.length} (awake ${awake})\n` +
        `phase ${ctx.state.phase} credit ${ctx.state.credit}\n` +
        `tubes 10:${ctx.mech.tubes[10]} 50:${ctx.mech.tubes[50]} 100:${ctx.mech.tubes[100]} 500:${ctx.mech.tubes[500]}\n` +
        `cash ${ctx.mech.cashTotal()}円 sales ${ctx.state.sales}円\n` +
        `stock ${[0, 1, 2].map(ch => ctx.rack.cols.filter(c => c.conf.chamber === ch).reduce((s, c) => s + c.stock.length, 0)).join('/')}本 ` +
        `escrow ${ctx.mech.escrow.length} bill ${ctx.mech.bill.stacked}\n` +
        `draws ${ctx.renderer.info.render.calls}`;
    },
  };
}

function buildLines(world, filter, planeCoord, plane, color) {
  const pts = [];
  for (const s of world.segs) {
    if (!filter(s)) continue;
    if (plane === 'xy') {
      pts.push(s.ax, s.ay, planeCoord, s.bx, s.by, planeCoord);
    } else {
      pts.push(planeCoord, s.ay, s.ax, planeCoord, s.by, s.bx);
    }
  }
  for (const sen of world.sensors) {
    if (!filter(sen)) continue;
    if (plane === 'xy') {
      pts.push(sen.ax, sen.ay, planeCoord, sen.bx, sen.by, planeCoord);
    } else {
      pts.push(planeCoord, sen.ay, sen.ax, planeCoord, sen.by, sen.bx);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false })
  );
}
