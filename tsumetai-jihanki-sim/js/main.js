/* ============================================================
   main.js — つめた〜い じはんきシミュレーター エントリポイント
   固定タイムステップ物理 + 描画補間 + モード管理 + 全イベント結線
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { World } from './physics.js';
import { CoinMech } from './coin-mech.js';
import { Rack } from './rack.js';
import { VendingState } from './vending-state.js';
import { MachineScene } from './machine-scene.js';
import { MechVisuals } from './mech-visuals.js';
import { ColdFx, addCondensation } from './fx.js';
import { CameraRig } from './camera.js';
import { InputManager } from './input.js';
import { UI } from './ui.js';
import { GameAudio } from './audio.js';
import { makeRng } from './lib3d.js';
import { PHYS, PRODUCTS, COLUMNS, PRICES, CABINET, TIMES, DENOMS, MECH } from './config.js';
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

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---- 環境マップ (金属の映り込み用・手続き生成) ---- */
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
  scene.add(new THREE.HemisphereLight(0xcfe4f4, 0x3a3f46, 0.75));
  const sun = new THREE.DirectionalLight(0xfff2df, 1.45);
  sun.position.set(1.6, 2.6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -1.4;
  sun.shadow.camera.right = 1.4;
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

// 商品に結露シェルを付ける
rackListeners.push((t, d) => {
  if (t === 'productSpawn') {
    const e = mv.products.get(d.body.id);
    if (e) addCondensation(e.grp.children[0], d.body.userData.product);
  }
});

/* ================= ゲーム状態 ================= */
const game = {
  mode: 'title',        // 'title' | 'play'
  timeScale: 1,
  xray: false,
  operator: false,
  doorAngle: 0,
  doorTarget: 0,
  doorOpen: false,
  muted: false,
  leverTimer: 0,
  portToastCount: 0,
  settled: false,
  time: 0,
  ledText: '',
};

/* ================= UI ================= */
const ui = new UI({
  onInsert(denom) {
    if (game.mode !== 'play' || game.operator) return;
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
  onOperator() {
    setOperator(!game.operator);
  },
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
    ui.setOpHint('コラム=補充 / チューブ=釣銭補充 / 金庫=売上回収');
  }
}

/* ================= 3D タップ操作の登録 ================= */
const input = new InputManager(document.getElementById('game'), camera, {
  onTap(tap) {
    if (game.mode !== 'play' || !tap) return;
    audio.unlock();
    handleTap(tap);
  },
  onOrbit(dx, dy) {
    if (game.mode === 'play') cameraRig.orbit(dx, dy);
  },
  onPinch(scale) {
    if (game.mode === 'play') cameraRig.pinch(scale);
  },
});
input.register(ms.root);

// ボタン
for (const b of ms.buttons) b.mesh.userData.tap = { type: 'button', i: b.index };
// 不可視ヒットボックス
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
mkHit(ms.doorContent, 0.09, 0.13, 0.05, 0.27, 1.03, 0.355, { type: 'lever' });
mkHit(ms.doorContent, 0.13, 0.17, 0.06, 0.367, 0.50, 0.33, { type: 'cup' });
mkHit(ms.cabinet, CABINET.portX[1] - CABINET.portX[0] + 0.05, 0.3, 0.1, (CABINET.portX[0] + CABINET.portX[1]) / 2, 0.42, 0.3, { type: 'port' });
// 店員: コラム補充ゾーン
for (let i = 0; i < COLUMNS.length; i++) {
  mkHit(ms.cabinet, ms.columnBounds[i + 1] - ms.columnBounds[i] - 0.02, 1.05, 0.46,
    COLUMNS[i].x, 1.25, -0.06, { type: 'column', i });
}
// 店員: 金庫
ms.cabinetTap = null;
mv.cashBoxMesh.userData.tap = { type: 'cash' };
// 店員: チューブ (メッシュはチューブ円筒。userData を仕込む)
{
  let idx = 0;
  for (const child of mv.mechGroup.children) {
    if (child.geometry && child.geometry.type === 'CylinderGeometry' && child.material.transparent && child.material.opacity < 0.5) {
      // 透明チューブと判断
      const denoms = [50, 100, 10, 500];
      // 位置から金種を逆引き
      for (const dnm of DENOMS) {
        if (Math.abs(child.position.x - (mech.channels[dnm]?.cx ?? -1)) < 0.001) {
          child.userData.tap = { type: 'tube', denom: dnm };
        }
      }
    }
  }
}
// 扉パネル (店員モードで開閉)
for (const child of ms.doorContent.children) {
  if (child.isMesh && child.geometry?.attributes?.position?.count > 100 && !child.userData.tap) {
    // 扉のストリップ結合メッシュ
    child.userData.tap = child.userData.tap ?? { type: 'door' };
    break;
  }
}
ms.doorHandle.userData.tap = { type: 'door' };
// クレート
ms.crate.traverse((o) => { if (o.isMesh) o.userData.tap = { type: 'crate' }; });

function handleTap(tap) {
  switch (tap.type) {
    case 'button': {
      if (game.operator) break;
      if (state.pressButton(tap.i)) {
        audio.beep();
      } else {
        audio.buzz();
        const col = tap.i;
        if (rack.soldOut(col)) ui.toast('うりきれ…');
        else if (state.credit < PRICES[COLUMNS[col].product]) ui.toast('おかねが たりないよ');
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
      game.leverTimer = 1.0;
      break;
    }
    case 'port': {
      const taken = state.takeProduct();
      if (taken.length > 0) {
        audio.take();
        const names = taken.map(b => b.userData.product.short).join('・');
        ui.toast(`つめた〜い ${names} ゲット!`);
        fx.puff((CABINET.portX[0] + CABINET.portX[1]) / 2, 0.45, 0.34, 10);
      }
      break;
    }
    case 'cup': {
      const got = state.scoopCup();
      if (got.length > 0) {
        audio.jingle(got.length);
        const total = got.reduce((s, d) => s + d, 0);
        ui.toast(`おつり ${total}円 かいしゅう!`);
        refreshWallet();
      }
      break;
    }
    case 'door': {
      if (!game.operator) break;
      toggleDoor(game.doorTarget === 0);
      break;
    }
    case 'column': {
      if (!game.operator || !game.doorOpen) break;
      const n = state.restock(tap.i);
      if (n < 0) {
        audio.buzz();
        ui.toast('このコラムは まんぱい!');
      } else {
        audio.take();
        ui.toast(`${PRODUCTS[COLUMNS[tap.i].product].short} をほじゅう!`);
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
        ui.toast(`うりあげ ${got.total}円 かいしゅう!`);
      } else {
        audio.buzz();
        ui.toast('金庫は からっぽ');
      }
      break;
    }
    case 'crate': {
      ui.toast('ほじゅうしたいコラムを タップしてね');
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
  } else if (t === 'gate') {
    if (!d.returning) ms.setLever(false);
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
  }
});

/* 物理接触 → 効果音 */
world.onContact = (info) => {
  if (game.mode === 'play') audio.contact(info);
};

function refreshLamps() {
  for (let i = 0; i < COLUMNS.length; i++) ms.setLamp(i, state.lampState(i));
  ms.setShortage(state.changeShortage());
  refreshWallet();
}
function refreshWallet() {
  ui.setWallet(state.wallet, (denom) => state.canInsert(denom) && !game.operator);
}

/* ================= リサイズ & 品質 ================= */
let isPortrait = false;
const quality = { ratio: 1, acc: 0, frames: 0, cooldown: 0 };
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality.ratio;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setSize(w, h);
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
      if (avg > 1 / 38 && quality.ratio > 0.6) {
        quality.ratio = Math.max(0.6, quality.ratio - 0.15);
        quality.cooldown = 2; resize();
      } else if (avg > 1 / 30 && quality.ratio <= 0.6 && bloom.enabled) {
        bloom.enabled = false;
        quality.cooldown = 3;
      } else if (avg < 1 / 57 && quality.ratio < 1) {
        quality.ratio = Math.min(1, quality.ratio + 0.1);
        quality.cooldown = 2; resize();
      }
    }
  }
}

/* ================= 初期在庫の事前シミュレーション ================= */
const startBtn = document.getElementById('start-btn');
startBtn.disabled = true;
startBtn.textContent = 'じゅんびちゅう…';
rack.preload([6, 5, 5, 4, 4]);
{
  // タイトル画面の裏で少しずつ進める (合計 15 秒ぶん)
  const totalSteps = Math.round(15 / PHYS.h);
  let done = 0;
  const chunk = () => {
    const n = Math.min(600, totalSteps - done);
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

  // ---- 固定ステップ物理 ----
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
    if (steps === PHYS.maxStepsPerFrame) accumulator = 0;   // スパイラル防止
  }
  const alpha = game.timeScale > 0 ? Math.min(1, accumulator / PHYS.h) : 1;

  // ---- 扉アニメーション ----
  {
    const target = game.doorTarget;
    const diff = target - game.doorAngle;
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

  // ---- 返却レバーの自動戻し ----
  if (game.leverTimer > 0) {
    game.leverTimer -= dtReal;
    if (game.leverTimer <= 0) {
      state.releaseLever();
      ms.setLever(false);
    }
  }

  // ---- LED表示 (credit / 払出し残額) ----
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

  // ---- 店員パネルの売上表示 ----
  if (game.operator) {
    ui.setOpSales(`きょうの うりあげ: ${state.sales}円 / 金庫: ${mech.cashTotal()}円`);
  }

  // ---- ビジュアル更新 ----
  ms.update(dtReal, game.time);
  mv.update(dtSim, dtReal, alpha, camera);
  fx.update(dtSim);
  audio.tick(dtSim);
  cameraRig.update(dtReal, game.time);
  tuneQuality(dtReal);
  debug.update(dtReal);
  composer.render();
}

resize();
requestAnimationFrame(loop);
