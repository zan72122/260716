/* ============================================================
   main.js — そらのエアライダー
   エントリポイント: レンダリング / 物理 / カメラ / ゲーム進行
   ============================================================ */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { World, ROAD_HW } from './world.js';
import { buildRider, animateRider } from './rider.js';
import { ParticlePool, RainbowTrail, Overlay2D } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { hsl } from './lib3d.js';

/* ================= 基本セットアップ ================= */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 3200);

/* ---- ポストプロセス: ブルームで「にじみ光る」質感 ---- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.33, 0.55, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ================= 世界とキャスト ================= */
const world = new World(scene);

const player = buildRider({
  body: 0xfff3da, ear: 0xffb7cd, cheek: 0xff9db8,
  star: 0xffd344, starRim: 0xff8fc0, earStyle: 'bunny',
});
scene.add(player.group);

const npcs = [
  {
    rider: buildRider({
      body: 0xd8c2ff, ear: 0xb494ee, cheek: 0xcf9be2,
      star: 0x8fd8ff, starRim: 0x6fb4e8, earStyle: 'cat',
    }),
    s: 60, x: -2.5, speed: 22.5, phase: 0.8, prevRel: 1,
  },
  {
    rider: buildRider({
      body: 0xffd9b8, ear: 0xff9a70, cheek: 0xff8f66,
      star: 0xa8ff8f, starRim: 0x66cc7a, earStyle: 'round',
    }),
    s: 130, x: 2.5, speed: 25, phase: 2.4, prevRel: 1,
  },
];
for (const n of npcs) scene.add(n.rider.group);

const particles = new ParticlePool(scene, 700);
const trail = new RainbowTrail(scene, 44);
const overlay = new Overlay2D(document.getElementById('fx'));

const ui = new UI();
const audio = new GameAudio();
const input = new Input(document.getElementById('game'), (x, y) => {
  if (state.mode === 'play') overlay.addRipple(x, y);
});

/* ================= ゲーム状態 ================= */
const state = {
  mode: 'title',        // 'title' | 'play'
  s: 0,                 // コース上の走行距離
  x: 0,                 // 横位置
  v: 0,                 // 前進速度
  vBoost: 0,            // ブースト加速分 (減衰)
  boostTimer: 0,
  charge: 0,
  hover: 0,             // ジャンプ中の追加高度
  vy: 0,
  airborne: false,
  stars: 0,
  lap: 1,
  time: 0,
  bumpCooldown: 0,
  muted: false,
};
const BASE_SPEED = 26;
const GRAVITY = 26;
const HOVER_BASE = 1.15;

const PRAISES = ['やったね!', 'すごい!', 'いいね!', 'キラキラ!', 'その ちょうし!'];

/* ================= リサイズ ================= */
let isPortrait = false;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality.ratio;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  isPortrait = h > w;
  camera.updateProjectionMatrix();
  overlay.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 80));

/* ================= 自動品質調整 ================= */
const quality = { ratio: 1, acc: 0, frames: 0, cooldown: 0 };
function tuneQuality(dt) {
  quality.acc += dt; quality.frames++;
  if (quality.cooldown > 0) { quality.cooldown -= dt; }
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

/* ================= プレイヤー更新 ================= */
const pf = World.makeFrame();       // プレイヤーの現在フレーム
const tmpFrame = World.makeFrame(); // 汎用
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function ringDist(a, b) {
  const L = world.length;
  return Math.abs(((a - b + L * 1.5) % L) - L * 0.5);
}

function updatePlayer(dt) {
  // ---- チャージ ----
  const holdRaw = input.holding ? Math.max(0, input.holdTime - 0.22) : 0;
  state.charge = Math.min(1, holdRaw / 1.15);
  ui.setCharge(state.charge);
  audio.setCharge(input.holding ? state.charge : 0);

  // ---- リリース → ブースト ----
  const released = input.consumeRelease();
  if (released > 0.22) {
    const c = Math.min(1, Math.max(0, released - 0.22) / 1.15);
    if (c > 0.12) {
      state.vBoost = Math.max(state.vBoost, 14 + 26 * c);
      state.boostTimer = 0.7 + c * 0.9;
      audio.boost(0.5 + c * 0.5);
      ui.pop('ビューン!');
      particles.burst(player.group.position, 26, {
        color: new THREE.Color(0xfff0a0), spread: 8, size: 1.6, life: 0.7, up: 1.5, gravity: 2,
      });
    }
  }

  // ---- 速度 ----
  const slow = input.holding ? 1 - state.charge * 0.38 : 1;
  const target = BASE_SPEED * slow;
  state.v += (target - state.v) * (1 - Math.exp(-dt * 2.2));
  state.vBoost *= Math.exp(-dt / 1.15);
  if (state.vBoost < 0.3) state.vBoost = 0;
  state.boostTimer = Math.max(0, state.boostTimer - dt);
  const speed = state.v + state.vBoost;

  // ---- 前進 & ラップ ----
  const prevS = state.s;
  state.s += speed * dt;
  if (state.s >= world.length) {
    state.s -= world.length;
    state.lap++;
    ui.setLap(state.lap);
    ui.big(`${state.lap}しゅうめ!`);
    audio.lap();
    world.respawnStars();
    particles.burst(player.group.position, 60, {
      hueSpread: 1, spread: 11, size: 1.7, life: 1.6, up: 9, gravity: 9,
    });
  }

  // ---- ハンドル ----
  const steerPow = state.airborne ? 7 : 13;
  state.x += input.steer * steerPow * dt;
  // ゆるい中央アシスト (はしっこに行きすぎたら戻す)
  const edge = ROAD_HW - 1.5;
  if (Math.abs(state.x) > edge * 0.82 && Math.abs(input.steer) < 0.25) {
    state.x -= Math.sign(state.x) * dt * 2.2;
  }
  if (state.x > edge) {
    state.x = edge;
    if (state.bumpCooldown <= 0 && Math.abs(input.steer) > 0.4) {
      audio.bump(); state.bumpCooldown = 0.7;
      particles.burst(player.group.position, 8, { color: new THREE.Color(0xffffff), spread: 4, size: 1, life: 0.4, up: 2, gravity: 8 });
    }
  } else if (state.x < -edge) {
    state.x = -edge;
    if (state.bumpCooldown <= 0 && Math.abs(input.steer) > 0.4) {
      audio.bump(); state.bumpCooldown = 0.7;
      particles.burst(player.group.position, 8, { color: new THREE.Color(0xffffff), spread: 4, size: 1, life: 0.4, up: 2, gravity: 8 });
    }
  }
  state.bumpCooldown -= dt;

  // ---- ジャンプ / 重力 ----
  if (state.airborne) {
    state.hover += state.vy * dt;
    state.vy -= GRAVITY * dt;
    if (state.hover <= 0) {
      state.hover = 0; state.vy = 0; state.airborne = false;
      audio.land();
      particles.burst(player.group.position, 14, {
        color: new THREE.Color(0xffffff), spread: 6, size: 1.3, life: 0.5, up: 1, gravity: 4,
      });
    }
  }

  // ---- ワールド座標へ ----
  world.frameAt(state.s, pf);
  const pos = player.group.position;
  pos.copy(pf.pos)
    .addScaledVector(pf.right, state.x)
    .addScaledVector(pf.up, HOVER_BASE + state.hover);
  tmpM.makeBasis(pf.right, pf.up, pf.tan);
  player.group.quaternion.setFromRotationMatrix(tmpM);
  tmpQ.setFromAxisAngle(pf.up, -input.steer * 0.22);
  player.group.quaternion.premultiply(tmpQ);

  animateRider(player, {
    speedNorm: Math.min(1, speed / 55),
    charge: state.charge,
    lean: -input.steer,
    boostTimer: state.boostTimer,
    airborne: state.airborne,
    time: state.time,
  });

  // ---- トレイル ----
  tmpV.copy(pos).addScaledVector(pf.up, -0.35);
  const trailPower = Math.min(1, (state.vBoost / 22) + state.charge * 0.2 + 0.05);
  trail.update(dt, tmpV, pf.right, trailPower);

  // ---- ブースト中のうしろ噴射 ----
  if (state.boostTimer > 0.15) {
    for (let k = 0; k < 2; k++) {
      tmpV.copy(pos).addScaledVector(pf.tan, -2.6)
        .addScaledVector(pf.right, (Math.random() - 0.5) * 1.6);
      tmpV2.copy(pf.tan).multiplyScalar(-14 - Math.random() * 8);
      tmpV2.y += (Math.random() - 0.5) * 3;
      particles.emit(tmpV, tmpV2, hsl(0.07 + Math.random() * 0.08, 0.95, 0.55), 1.4, 0.45, 0);
    }
  }

  return speed;
}

/* ================= アイテム判定 ================= */
function checkItems() {
  const heightNow = HOVER_BASE + state.hover;

  // ---- 星 ----
  for (const st of world.stars) {
    if (st.taken) continue;
    if (ringDist(state.s, st.s) > 3.1) continue;
    if (Math.abs(state.x - st.x) > 2.7) continue;
    if (Math.abs(heightNow - st.h) > 2.8) continue;
    st.taken = true;
    state.stars++;
    ui.setStars(state.stars);
    audio.collect();
    world.frameAt(st.s, tmpFrame);
    tmpV.copy(tmpFrame.pos)
      .addScaledVector(tmpFrame.right, st.x)
      .addScaledVector(tmpFrame.up, st.h);
    particles.burst(tmpV, 12, {
      color: new THREE.Color(0xffe27a), spread: 5, size: 1.5, life: 0.6, up: 3, gravity: 7,
    });
    if (state.stars % 10 === 0) {
      ui.pop(`ほし ${state.stars}こ!`);
    } else if (Math.random() < 0.12) {
      ui.pop(PRAISES[Math.floor(Math.random() * PRAISES.length)]);
    }
  }

  // ---- にじリング ----
  for (const r of world.rings) {
    if (r.cooldown > 0) continue;
    if (ringDist(state.s, r.s) > 2.6) continue;
    if (Math.abs(state.x) > 3.4) continue;
    if (Math.abs(heightNow - r.h) > 3.2) continue;
    r.cooldown = 5;
    state.vBoost = Math.max(state.vBoost, 24);
    state.boostTimer = Math.max(state.boostTimer, 1.0);
    audio.ring();
    ui.pop('ナイス!');
    particles.burst(player.group.position, 34, {
      hueSpread: 1, spread: 9, size: 1.6, life: 1.0, up: 4, gravity: 5,
    });
  }

  // ---- ダッシュパネル ----
  for (const p of world.dashPanels) {
    if (p.cooldown > 0) continue;
    if (state.airborne) continue;
    if (ringDist(state.s, p.s) > 2.8) continue;
    if (Math.abs(state.x - p.x) > 2.6) continue;
    p.cooldown = 2;
    state.vBoost = Math.max(state.vBoost, 20);
    state.boostTimer = Math.max(state.boostTimer, 0.8);
    audio.dash();
  }

  // ---- ジャンプ台 ----
  for (const p of world.jumpPads) {
    if (p.cooldown > 0) continue;
    if (state.airborne) continue;
    if (ringDist(state.s, p.s) > 2.6) continue;
    if (Math.abs(state.x) > 3.2) continue;
    p.cooldown = 2;
    state.airborne = true;
    state.vy = 13.5;
    audio.jump();
    ui.pop('ジャンプ!');
  }
}

/* ================= NPC更新 ================= */
function updateNPCs(dt) {
  for (const n of npcs) {
    n.s = (n.s + n.speed * dt) % world.length;
    n.x = Math.sin(state.time * 0.45 + n.phase) * 2.8;
    world.frameAt(n.s, tmpFrame);
    n.rider.group.position.copy(tmpFrame.pos)
      .addScaledVector(tmpFrame.right, n.x)
      .addScaledVector(tmpFrame.up, HOVER_BASE);
    tmpM.makeBasis(tmpFrame.right, tmpFrame.up, tmpFrame.tan);
    n.rider.group.quaternion.setFromRotationMatrix(tmpM);
    animateRider(n.rider, {
      speedNorm: n.speed / 55, charge: 0, lean: Math.cos(state.time * 0.45 + n.phase) * 0.5,
      boostTimer: 0, airborne: false, time: state.time + n.phase * 10,
    });

    // 追いぬき判定
    const L = world.length;
    const rel = ((n.s - state.s + L * 1.5) % L) - L * 0.5;
    if (n.prevRel > 0 && rel <= 0 && Math.abs(rel) < 15 && state.mode === 'play') {
      audio.pass();
      ui.pop('ぬかした!');
      particles.burst(n.rider.group.position, 14, {
        hueSpread: 1, spread: 5, size: 1.2, life: 0.7, up: 3, gravity: 5,
      });
    }
    n.prevRel = rel;
  }
}

/* ================= カメラ ================= */
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
let fovKick = 0;
let camInit = false;

function updateCamera(dt, speed) {
  const boostF = Math.min(1, state.vBoost / 24);
  fovKick += ((boostF * 11) - fovKick) * (1 - Math.exp(-dt * 4));

  const baseFov = isPortrait ? 76 : 63;
  camera.fov = baseFov + fovKick;
  camera.updateProjectionMatrix();

  const dist = (isPortrait ? 12.2 : 10.4) - state.charge * 1.2;
  const height = (isPortrait ? 5.4 : 4.4);

  tmpV.copy(player.group.position)
    .addScaledVector(pf.tan, -dist)
    .addScaledVector(pf.up, height);
  // 地形より下にもぐらない
  const minY = pf.pos.y + 1.6;
  if (tmpV.y < minY) tmpV.y = minY;

  if (!camInit) { camPos.copy(tmpV); camInit = true; }
  camPos.lerp(tmpV, 1 - Math.exp(-dt * 5.2));

  // ブースト中の小さなゆれ
  if (boostF > 0.2) {
    camPos.x += (Math.random() - 0.5) * 0.12 * boostF;
    camPos.y += (Math.random() - 0.5) * 0.12 * boostF;
  }
  camera.position.copy(camPos);

  tmpV2.copy(player.group.position).addScaledVector(pf.tan, 9).addScaledVector(pf.up, 1.8);
  camLook.lerp(tmpV2, 1 - Math.exp(-dt * 7));
  // コースのバンクにあわせてカメラもすこし傾く
  camera.up.copy(UP).lerp(pf.up, 0.35).normalize();
  camera.lookAt(camLook);
}

/* ---- タイトル画面用のゆったり旋回カメラ ---- */
function titleCamera(dt) {
  const t = state.time * 0.12;
  world.frameAt(6, tmpFrame);
  const c = tmpFrame.pos;
  camera.fov = isPortrait ? 74 : 60;
  camera.updateProjectionMatrix();
  camera.position.set(
    c.x + Math.cos(t) * 26,
    c.y + 10 + Math.sin(t * 0.7) * 3,
    c.z + Math.sin(t) * 26
  );
  camera.up.copy(UP);
  camera.lookAt(c.x, c.y + 2, c.z);
  camPos.copy(camera.position);
  camLook.set(c.x, c.y + 2, c.z);
}

/* ================= ゲーム開始 ================= */
document.getElementById('start-btn').addEventListener('click', () => {
  audio.unlock();
  audio.startBGM();
  ui.showGame();
  state.mode = 'play';
  camInit = false;
  ui.big('よーい どん!');
  audio.lap();
});

ui.muteBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  state.muted = !state.muted;
  audio.setMuted(state.muted);
  ui.setMuted(state.muted);
});
ui.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend(); else audio.resume();
});

/* ================= プレイヤー初期位置 ================= */
{
  world.frameAt(6, pf);
  player.group.position.copy(pf.pos).addScaledVector(pf.up, HOVER_BASE);
  tmpM.makeBasis(pf.right, pf.up, pf.tan);
  player.group.quaternion.setFromRotationMatrix(tmpM);
}

/* ================= メインループ ================= */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1; // タブ復帰などの巨大なdtを抑制
  state.time += dt;

  input.update(dt);

  let speed = 0;
  if (state.mode === 'play') {
    speed = updatePlayer(dt);
    checkItems();
    updateCamera(dt, speed);
  } else {
    titleCamera(dt);
    // タイトル中もキャラをふわふわさせる
    animateRider(player, {
      speedNorm: 0.15, charge: 0, lean: Math.sin(state.time * 0.8) * 0.2,
      boostTimer: 0, airborne: false, time: state.time,
    });
  }

  updateNPCs(dt);
  world.update(dt, camera);
  world.updateShadowTarget(player.group.position);
  particles.update(dt);

  const speedFactor = state.mode === 'play'
    ? Math.min(1, Math.max(0, (speed - BASE_SPEED) / 26)) : 0;
  overlay.update(dt, speedFactor);

  tuneQuality(dt);
  composer.render();
}

resize();
requestAnimationFrame(loop);

// 動作検証用フック (ゲームからは未使用)
window.__sky = { state, world };
