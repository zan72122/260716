/* ============================================================
   main.js — つめた〜い じはんきシミュレーター エントリポイント
   (実機準拠版: FR30A6R40TK)
   固定タイムステップ物理 + 描画補間 + モード管理 + 全イベント結線
   ============================================================ */
import * as THREE from '../vendor/three.module.js';
import { World } from './physics.js';
import { CoinMech } from './coin-mech.js';
import { Rack } from './rack.js';
import { VendingState } from './vending-state.js';
import { MachineScene } from './machine-scene.js';
import { MechVisuals } from './mech-visuals.js';
import { ColdFx } from './fx.js';
import { CameraRig } from './camera.js';
import { InputManager } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';
import { makeRng } from './lib3d.js';
import {
  PHYS, PRODUCTS, COLUMNS, SELECTIONS, CHAMBERS, CABINET, TIMES, FASCIA,
} from './config.js';
import { setupDebug } from './debug.js';

/* ================= レンダラ ================= */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3542);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 30);

/* ---- 環境マップ (金属の映り込み) ---- */
{
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 128; envCanvas.height = 64;
  const ctx = envCanvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, '#b8d4e8');
  g.addColorStop(0.5, '#5a6a78');
  g.addColorStop(0.55, '#3a424c');
  g.addColorStop(1, '#23282e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(18, 4, 16, 22);
  ctx.fillRect(88, 6, 20, 18);
  const envTex = new THREE.CanvasTexture(envCanvas);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envTex).texture;
  pmrem.dispose();
}

/* ---- ライティング ---- */
{
  scene.add(new THREE.HemisphereLight(0xcfe4f4, 0x3a3f46, 0.8));
  const sun = new THREE.DirectionalLight(0xfff2df, 1.35);
  sun.position.set(1.7, 2.6, 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -1.6;
  sun.shadow.camera.right = 1.6;
  sun.shadow.camera.top = 2.2;
  sun.shadow.camera.bottom = -0.2;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 7;
  scene.add(sun);
}

/* ================= シミュレーション構築 ================= */
const world = new World();
const mechListeners = [];
const rackListeners = [];
const mech = new CoinMech(world, (t, d) => { for (const l of mechListeners) l(t, d); });
const rack = new Rack(world, (t, d) => { for (const l of rackListeners) l(t, d); }, makeRng(7));
const uiListeners = [];
const state = new VendingState(mech, rack, (t, d) => { for (const l of uiListeners) l(t, d); });
mechListeners.push((t, d) => state.onMechEvent(t, d));
rackListeners.push((t, d) => state.onRackEvent(t, d));

/* ================= ビジュアル構築 ================= */
const ms = new MachineScene(scene);
const mv = new MechVisuals(ms, world, mech, rack);
mechListeners.push((t, d) => mv.onMechEvent(t, d));
rackListeners.push((t, d) => mv.onRackEvent(t, d));
const fx = new ColdFx(scene);
const cameraRig = new CameraRig(camera);
const audio = new GameAudio();

/* ================= ゲーム状態 ================= */
const game = {
  mode: 'title',
  timeScale: 1,
  xray: false,
  operator: false,
  doorAngle: 0,
  doorTarget: 0,
  doorOpen: false,
  muted: false,
  leverTimer: 0,
  cupLidTimer: 0,
  portToastCount: 0,
  settled: false,
  time: 0,
  ledText: '',
};

/* ================= UI ================= */
const ui = new UI({
  onInsert(denom) {
    if (game.mode !== 'play' || game.operator) return;
    if (denom === 'bill') {
      audio.unlock();
      if (state.insertBill()) {
        audio.billFeed();
        ui.flashCoin('bill');
      } else if (state.billStop()) {
        audio.buzz();
        ui.toast('お札中止ランプが\nついているよ');
      }
      return;
    }
    if (state.insert(denom)) {
      audio.unlock();
      audio.coinInsert();
      ui.flashCoin(denom);
      refreshWallet();
    }
  },
  onTimeScale(s) {
    game.timeScale = s;
    ui.setTimeScale(s);
    audio.setTimeScale(s);
  },
  onXray() {
    game.xray = !game.xray;
    ms.setXray(game.xray);
    fx.setFog(game.xray);
    ui.setXray(game.xray);
    if (!game.operator) cameraRig.setMode(game.xray ? 'xray' : 'customer');
  },
  onOperator() { setOperator(!game.operator); },
  onMute() {
    game.muted = !game.muted;
    audio.setMuted(game.muted);
    ui.setMuted(game.muted);
  },
});

function setOperator(on) {
  game.operator = on;
  state.setOperator(on);
  ms.setOperatorProps(on);
  ui.setOperator(on);
  cameraRig.setMode(on ? 'operator' : (game.xray ? 'xray' : 'customer'));
  if (on) {
    ui.setOpHint('じはんきの まえ面をタップして とびらをあけてね');
  } else if (game.doorOpen || game.doorTarget > 0) {
    toggleDoor(false);
  }
  refreshLamps();
}

function toggleDoor(open) {
  game.doorTarget = open ? 1.85 : 0;
  audio.doorCreak(open);
  if (open) {
    ui.setOpHint('ラック(室のたな)をタップ=補充 / チューブ=釣銭補充 / 金庫=売上回収');
  }
}

/* ================= 3D タップ操作 ================= */
const input = new InputManager(document.getElementById('game'), camera, {
  onTap(tap) {
    if (game.mode !== 'play' || !tap) return;
    audio.unlock();
    handleTap(tap);
  },
  onOrbit(dx, dy) { if (game.mode === 'play') cameraRig.orbit(dx, dy); },
  onPinch(scale) { if (game.mode === 'play') cameraRig.pinch(scale); },
});
input.register(ms.root);

function mkHit(parent, w, h, d, x, y, z, tap) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  m.position.set(x, y, z);
  m.userData.tap = tap;
  parent.add(m);
  return m;
}
// 返却レバー / 札口 / つり銭口 / 取出口
mkHit(ms.doorContent, 0.075, 0.10, 0.05, FASCIA.lever.u, FASCIA.lever.v, 0.365, { type: 'lever' });
mkHit(ms.doorContent, 0.13, 0.08, 0.05, 0.495, 1.185, 0.365, { type: 'bill' });
mkHit(ms.doorContent, 0.14, 0.15, 0.07, 0.501, 0.47, 0.35, { type: 'cup' });
mkHit(ms.cabinet, CABINET.portX[1] - CABINET.portX[0] + 0.06, 0.3, 0.12,
  (CABINET.portX[0] + CABINET.portX[1]) / 2, 0.43, 0.31, { type: 'port' });
// 店員: 補充ゾーン (室×段 = 6)
for (let ch = 0; ch < 3; ch++) {
  for (let stage = 0; stage < 2; stage++) {
    mkHit(ms.cabinet, CHAMBERS[ch].width - 0.02, 0.42, 0.6,
      CHAMBERS[ch].x, stage === 0 ? 1.52 : 1.02, -0.05, { type: 'restock', ch, stage });
  }
}
// 扉開閉
ms.doorMesh.userData.tap = { type: 'door' };
ms.doorHandle.userData.tap = { type: 'door' };
ms.crate.traverse((o) => { if (o.isMesh) o.userData.tap = { type: 'crate' }; });

function handleTap(tap) {
  switch (tap.type) {
    case 'button': {
      if (game.operator) break;
      if (state.pressButton(tap.i)) {
        audio.beep();
      } else {
        audio.buzz();
        const col = SELECTIONS[tap.i].column;
        if (rack.soldOut(col)) ui.toast('うりきれ…');
        else if (state.credit < state.selectionPrice(tap.i)) ui.toast('おかねが たりないよ');
        else if (state.phase !== 'idle') ui.toast('ちょっとまってね');
        else ui.toast('おつりが たりないみたい');
      }
      break;
    }
    case 'lever': {
      if (game.operator) break;
      audio.lever();
      ms.setLever(true);
      state.pullLever();
      game.leverTimer = 1.1;
      break;
    }
    case 'bill': {
      if (game.operator) break;
      ui.h.onInsert('bill');
      break;
    }
    case 'port': {
      const taken = state.takeProduct();
      if (taken.length > 0) {
        audio.take();
        mv.manualFlap = 0.85;
        setTimeout(() => { mv.manualFlap = 0; }, 700);
        const names = taken.map(b => b.userData.product.short).join('・');
        ui.toast(`つめた〜い ${names} ゲット!`);
        fx.puff((CABINET.portX[0] + CABINET.portX[1]) / 2, 0.45, 0.34, 10);
      }
      break;
    }
    case 'cup': {
      const got = state.scoopCup();
      if (got.length > 0) {
        ms.openCupLid(true);
        game.cupLidTimer = 0.8;
        audio.jingle(got.length);
        const total = got.reduce((s, d) => s + d, 0);
        ui.toast(`${total}円 かいしゅう!`);
        refreshWallet();
      }
      break;
    }
    case 'door': {
      if (!game.operator) break;
      toggleDoor(game.doorTarget === 0);
      break;
    }
    case 'restock': {
      if (!game.operator || !game.doorOpen) break;
      const res = state.restock(tap.ch, tap.stage);
      if (!res) {
        audio.buzz();
        ui.toast('この室は まんぱいか トレーがふさがってるよ');
      } else {
        audio.take();
        ui.toast(`${res.product.short} を トレーにほじゅう!`);
      }
      break;
    }
    case 'tube': {
      if (!game.operator || !game.doorOpen) break;
      const n = state.refillTube(tap.denom, 5);
      if (n > 0) {
        audio.jingle(n);
        ui.toast(`${tap.denom}円チューブに ${n}まい ほじゅう`);
      } else {
        audio.buzz();
        ui.toast('チューブは まんぱい!');
      }
      break;
    }
    case 'cash': {
      if (!game.operator || !game.doorOpen) break;
      const got = state.collectCash();
      if (got && got.total > 0) {
        audio.jingle(8);
        ui.toast(`うりあげ ${got.total}円 かいしゅう!\n(硬貨 + 千円札${got.bills}まい)`);
      } else {
        audio.buzz();
        ui.toast('金庫は からっぽ');
      }
      break;
    }
    case 'crate': {
      ui.toast('ほじゅうしたい ラックをタップしてね');
      break;
    }
  }
}

/* ================= 状態イベント → UI/音 ================= */
uiListeners.push((t, d) => {
  if (t === 'credit') {
    ui.setCredit(d.credit);
    refreshLamps();
  } else if (t === 'vending') {
    audio.motorStart();
  } else if (t === 'vendComplete') {
    audio.motorStop();
  } else if (t === 'changeStart') {
    if (d.amount > 0) ui.toast(`おつり ${d.amount}円`);
  } else if (t === 'refund') {
    ui.toast(`へんきゃく ${d.amount}円`);
  } else if (t === 'vendFailed') {
    audio.motorStop();
    ui.toast('うまくでなかった… ぜんがくへんきん');
  } else if (t === 'lamps') {
    refreshLamps();
  } else if (t === 'walletChange') {
    refreshWallet();
  }
});

mechListeners.push((t, d) => {
  if (t === 'accept') {
    audio.accept(d.denom);
  } else if (t === 'payoutCoin') {
    audio.eject();
    ms.openCupLid(true);
    game.cupLidTimer = 1.2;
  } else if (t === 'gate') {
    if (!d.returning) ms.setLever(false);
  } else if (t === 'escrowCommit' || t === 'escrowReturn') {
    audio.clunk(0.5);
  } else if (t === 'billAccept') {
    audio.accept(500);
    ui.toast('1000円 うけつけ');
  } else if (t === 'billReject') {
    audio.billReject();
  } else if (t === 'billRejected') {
    audio.buzz();
    ui.toast('お札が もどってきた…\n(おつりが たりないみたい)');
    refreshWallet();
  }
});

rackListeners.push((t, d) => {
  if (t === 'productAtPort') {
    fx.puff((CABINET.portX[0] + CABINET.portX[1]) / 2, 0.46, 0.32, 16);
    if (game.portToastCount < 2) {
      game.portToastCount++;
      ui.toast('ガコンッ!\nとりだしぐちを タップ!');
    }
    refreshLamps();
  } else if (t === 'soldOut') {
    ui.toast('うりきれ が でたよ');
  } else if (t === 'vendRetry') {
    audio.motorStart();
  } else if (t === 'trayIn') {
    audio.clunk(0.3);
  }
});

world.onContact = (info) => {
  if (game.mode === 'play') audio.contact(info);
};

function refreshLamps() {
  for (let i = 0; i < SELECTIONS.length; i++) ms.setLamp(i, state.lampState(i));
  ms.setShortage(state.changeShortage());
  ms.setBillStop(state.billStop());
  refreshWallet();
}
function refreshWallet() {
  ui.setWallet(state.wallet, (denom) => {
    if (game.operator) return false;
    if (denom === 'bill') return state.wallet.bill > 0 && !state.billStop() && !mech.bill.busy;
    return state.canInsert(denom);
  });
}

/* ================= リサイズ & 品質 ================= */
let isPortrait = false;
const quality = { ratio: 1, acc: 0, frames: 0, cooldown: 0 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality.ratio;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  isPortrait = h > w;
  camera.updateProjectionMatrix();
  cameraRig.setOrientation(isPortrait);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 80));

function tuneQuality(dt) {
  quality.acc += dt; quality.frames++;
  if (quality.cooldown > 0) quality.cooldown -= dt;
  if (quality.frames >= 50) {
    const avg = quality.acc / quality.frames;
    quality.acc = 0; quality.frames = 0;
    if (quality.cooldown <= 0) {
      if (avg > 1 / 38 && quality.ratio > 0.55) {
        quality.ratio = Math.max(0.55, quality.ratio - 0.15);
        quality.cooldown = 2; resize();
      } else if (avg > 1 / 30 && quality.ratio <= 0.55 && renderer.shadowMap.enabled) {
        // それでも重い端末は影を切る
        renderer.shadowMap.enabled = false;
        quality.cooldown = 3;
      } else if (avg < 1 / 57 && quality.ratio < 1) {
        quality.ratio = Math.min(1, quality.ratio + 0.1);
        quality.cooldown = 2; resize();
      }
    }
  }
}

/* ================= 初期在庫 (直接配置 + 短い settle) ================= */
const startBtn = document.getElementById('start-btn');
startBtn.disabled = true;
startBtn.textContent = 'じゅんびちゅう…';
rack.preloadDirect(null);
{
  const totalSteps = Math.round(3.0 / PHYS.h);
  let done = 0;
  const chunk = () => {
    // 1フレームぶんを小さく刻む (モバイルSafariのウォッチドッグ対策)
    const n = Math.min(150, totalSteps - done);
    for (let i = 0; i < n; i++) {
      mech.tick(PHYS.h);
      rack.tick(PHYS.h);
      world.step(PHYS.h);
    }
    done += n;
    if (done < totalSteps) {
      requestAnimationFrame(chunk);
    } else {
      game.settled = true;
      startBtn.disabled = false;
      startBtn.textContent = '▶ あそぶ';
    }
  };
  requestAnimationFrame(chunk);
}

startBtn.addEventListener('click', () => {
  if (game.mode === 'play' || !game.settled) return;
  audio.unlock();
  ui.showGame();
  game.mode = 'play';
  input.enabled = true;
  cameraRig.setMode('customer');
  refreshLamps();
  refreshWallet();
  ui.setCredit(0);
  ui.toast('おかねをいれてね');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend(); else audio.resume();
});

/* ================= デバッグ ================= */
const debug = setupDebug({ world, mech, rack, state, ms, game, renderer });
window.__vending = {
  world, mech, rack, state, game,
  insert: (d) => state.insert(d),
  insertBill: () => state.insertBill(),
  press: (i) => state.pressButton(i),
};
window.__rig = cameraRig;

/* ================= メインループ ================= */
let last = performance.now();
let accumulator = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dtReal = (now - last) / 1000;
  last = now;
  if (dtReal > 0.1) dtReal = 0.1;
  game.time += dtReal;

  const dtSim = dtReal * game.timeScale;
  if (game.settled) {
    accumulator += dtSim;
    let steps = 0;
    while (accumulator >= PHYS.h && steps < PHYS.maxStepsPerFrame) {
      mech.tick(PHYS.h);
      rack.tick(PHYS.h);
      world.step(PHYS.h);
      accumulator -= PHYS.h;
      steps++;
    }
    if (steps === PHYS.maxStepsPerFrame) accumulator = 0;
  }
  const alpha = game.timeScale > 0 ? Math.min(1, accumulator / PHYS.h) : 1;

  // 扉
  {
    const diff = game.doorTarget - game.doorAngle;
    if (Math.abs(diff) > 0.001) {
      game.doorAngle += diff * Math.min(1, dtReal * (2.2 / TIMES.doorOpen));
      ms.setDoorAngle(game.doorAngle);
      const nowOpen = game.doorAngle > 1.4;
      if (nowOpen !== game.doorOpen) {
        game.doorOpen = nowOpen;
        state.setDoor(nowOpen);
      }
    }
  }

  // 返却レバー戻し
  if (game.leverTimer > 0) {
    game.leverTimer -= dtReal;
    if (game.leverTimer <= 0) {
      state.releaseLever();
      ms.setLever(false);
    }
  }
  // つり銭口の蓋
  if (game.cupLidTimer > 0) {
    game.cupLidTimer -= dtReal;
    if (game.cupLidTimer <= 0) ms.openCupLid(false);
  }

  // LED (credit / 払出し残額)
  {
    let text;
    if (state.phase === 'change') {
      const remain = mech.payoutQueue.reduce((s, d) => s + d, 0);
      text = String(remain > 0 ? remain : 0);
    } else {
      text = String(state.credit);
    }
    if (text !== game.ledText) {
      game.ledText = text;
      ms.drawLED(text);
      ui.setCredit(text);
    }
  }

  if (game.operator) {
    ui.setOpSales(`きょうの うりあげ: ${state.sales}円 / 金庫: ${mech.cashTotal() + mech.bill.stacked * 1000}円`);
  }

  ms.update(dtReal, game.time);
  mv.update(dtSim, dtReal, alpha, camera);
  fx.update(dtSim);
  audio.tick(dtSim);
  cameraRig.update(dtReal, game.time);
  tuneQuality(dtReal);
  debug.update(dtReal);
  renderer.render(scene, camera);
}

resize();
requestAnimationFrame(loop);
