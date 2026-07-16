// main.js — 起動・レンダリング・カメラ・入力・UI・ゲームループ
import * as THREE from 'three';
import { buildWorld, SUN_DIR } from './world.js';
import { CHARACTERS, buildKart, makeCharIcon } from './kart.js';
import { FX, makeBoostFlames } from './fx.js';
import { Race, Racer, LAPS } from './race.js';
import { GameAudio } from './audio.js';

/* ============================================================
 *  レンダラー・シーン
 * ============================================================ */
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
// CSS 側で常に全画面に広げ、描画バッファだけ追従させる（iOS のバー伸縮対策）
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe8ff, 260, 900);

const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.5, 2200);
camera.position.set(0, 40, 200);

/* ---- ライト ---- */
const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
sun.position.copy(SUN_DIR).multiplyScalar(160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 420;
const SB = 70;
sun.shadow.camera.left = -SB; sun.shadow.camera.right = SB;
sun.shadow.camera.top = SB; sun.shadow.camera.bottom = -SB;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8ec46f, 0.85);
scene.add(hemi);
const amb = new THREE.AmbientLight(0xffffff, 0.28);
scene.add(amb);

/* ============================================================
 *  ワールド・カート・FX・音
 * ============================================================ */
const world = buildWorld(scene);
const fx = new FX(scene);
const audio = new GameAudio();

const kartMeshes = CHARACTERS.map((c) => {
  const k = buildKart(c);
  k.userData.flames = makeBoostFlames(k);
  scene.add(k);
  return k;
});

/* ============================================================
 *  UI 要素
 * ============================================================ */
const el = (id) => document.getElementById(id);
const ui = {
  loading: el('loading'), title: el('title-screen'), charRow: el('char-row'),
  btnStart: el('btn-start'), hud: el('hud'), countdown: el('countdown'),
  countNum: el('count-num'), lapText: el('lap-text'), coinText: el('coin-text'),
  rankNum: el('rank-num'), rankChip: el('hud-rank'), toast: el('toast'),
  btnLeft: el('btn-left'), btnRight: el('btn-right'), btnItem: el('btn-item'),
  itemIcon: el('item-icon'), finish: el('finish-screen'), finishRank: el('finish-rank'),
  finishMsg: el('finish-msg'), btnAgain: el('btn-again'),
};

/* アイテムアイコンを canvas で描く */
function drawItemIcon(type) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.lineJoin = 'round';
  if (type === 'rocket') {
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.moveTo(64, 8); ctx.quadraticCurveTo(96, 44, 88, 86);
    ctx.lineTo(40, 86); ctx.quadraticCurveTo(32, 44, 64, 8);
    ctx.fill();
    ctx.fillStyle = '#8ed4ff';
    ctx.beginPath(); ctx.arc(64, 50, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(48, 86); ctx.lineTo(64, 122); ctx.lineTo(80, 86);
    ctx.fill();
    ctx.fillStyle = '#c22020';
    ctx.beginPath(); ctx.moveTo(40, 86); ctx.lineTo(24, 104); ctx.lineTo(44, 98); ctx.fill();
    ctx.beginPath(); ctx.moveTo(88, 86); ctx.lineTo(104, 104); ctx.lineTo(84, 98); ctx.fill();
  } else if (type === 'star') {
    ctx.fillStyle = '#ffd23d';
    ctx.strokeStyle = '#e0a11d'; ctx.lineWidth = 6;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 54 : 24;
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      const x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#26221f';
    ctx.beginPath(); ctx.arc(52, 62, 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(76, 62, 5, 0, Math.PI * 2); ctx.fill();
  } else if (type === 'magnet') {
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 26; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.arc(64, 56, 34, Math.PI, 0, false); ctx.stroke();
    ctx.strokeStyle = '#ff4d4d';
    ctx.beginPath(); ctx.moveTo(30, 56); ctx.lineTo(30, 92); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(98, 56); ctx.lineTo(98, 92); ctx.stroke();
    ctx.fillStyle = '#e8eef8';
    ctx.fillRect(17, 92, 26, 20); ctx.fillRect(85, 92, 26, 20);
    ctx.fillStyle = '#ffd23d';
    for (const [x, y] of [[64, 14], [24, 30], [104, 30]]) {
      ctx.beginPath();
      ctx.moveTo(x, y - 7); ctx.lineTo(x + 2, y - 2); ctx.lineTo(x + 7, y);
      ctx.lineTo(x + 2, y + 2); ctx.lineTo(x, y + 7); ctx.lineTo(x - 2, y + 2);
      ctx.lineTo(x - 7, y); ctx.lineTo(x - 2, y - 2);
      ctx.closePath(); ctx.fill();
    }
  }
  return cv.toDataURL();
}
const itemIcons = { rocket: drawItemIcon('rocket'), star: drawItemIcon('star'), magnet: drawItemIcon('magnet') };

/* キャラ選択カード */
let selectedChar = 0;
CHARACTERS.forEach((c, i) => {
  const card = document.createElement('div');
  card.className = 'char-card' + (i === 0 ? ' sel' : '');
  const img = document.createElement('img');
  img.src = makeCharIcon(c);
  img.alt = c.name;
  const name = document.createElement('span');
  name.className = 'cname';
  name.textContent = c.short;
  card.append(img, name);
  card.addEventListener('pointerdown', () => {
    selectedChar = i;
    audio.unlock(); audio.coin();
    document.querySelectorAll('.char-card').forEach((x, xi) => x.classList.toggle('sel', xi === i));
  });
  ui.charRow.appendChild(card);
});

/* ============================================================
 *  入力
 * ============================================================ */
const input = { steer: 0, left: false, right: false, dragSteer: 0, keys: {} };
function currentSteer() {
  let s = 0;
  if (input.left) s -= 1;
  if (input.right) s += 1;
  if (input.keys.ArrowLeft || input.keys.a) s -= 1;
  if (input.keys.ArrowRight || input.keys.d) s += 1;
  s += input.dragSteer;
  return THREE.MathUtils.clamp(s, -1, 1);
}

function bindHold(elBtn, prop) {
  const on = (e) => { e.preventDefault(); input[prop] = true; elBtn.classList.add('pressed'); audio.unlock(); };
  const off = () => { input[prop] = false; elBtn.classList.remove('pressed'); };
  elBtn.addEventListener('pointerdown', on);
  elBtn.addEventListener('pointerup', off);
  elBtn.addEventListener('pointercancel', off);
  elBtn.addEventListener('pointerleave', off);
}
bindHold(ui.btnLeft, 'left');
bindHold(ui.btnRight, 'right');

/* 画面ドラッグでもハンドル操作できる */
let dragId = null, dragStartX = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'race') return;
  dragId = e.pointerId; dragStartX = e.clientX;
  audio.unlock();
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerId !== dragId) return;
  input.dragSteer = THREE.MathUtils.clamp((e.clientX - dragStartX) / (window.innerWidth * 0.16), -1, 1);
});
const endDrag = (e) => { if (e.pointerId === dragId) { dragId = null; input.dragSteer = 0; } };
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

window.addEventListener('keydown', (e) => {
  input.keys[e.key] = true;
  if (e.key === ' ' && race && playerRacer()?.item) race.useItem(playerRacer());
});
window.addEventListener('keyup', (e) => { input.keys[e.key] = false; });

ui.btnItem.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const p = playerRacer();
  if (race && p?.item) race.useItem(p);
});

// iOS のダブルタップズーム等を抑止
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

/* ============================================================
 *  ゲーム状態
 * ============================================================ */
let state = 'loading'; // loading | title | countdown | race | finish
let race = null;
let racerOrder = [];   // Racer[]（[0] がプレイヤー）
let shakeAmp = 0;
let toastTimer = null;

function playerRacer() { return racerOrder[0]; }

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('show');
  void ui.toast.offsetWidth; // アニメーション再始動
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1400);
}

const hooks = {
  onLap: (lap) => {
    ui.lapText.textContent = `${lap}/${LAPS} しゅうめ`;
    showToast(lap === LAPS ? 'さいごの しゅう！' : `${lap}しゅうめ！`);
  },
  onCoin: (n) => { ui.coinText.textContent = n; },
  onItem: (item) => {
    if (item) {
      ui.itemIcon.src = itemIcons[item];
      ui.btnItem.style.display = 'flex';
    } else {
      ui.btnItem.style.display = 'none';
    }
  },
  onRank: (rank, up) => {
    ui.rankNum.textContent = rank;
    ui.rankChip.classList.toggle('first', rank === 1);
    if (up && rank === 1) showToast('1い だ！');
  },
  onBoost: () => {},
  toast: showToast,
  shake: (amp) => { shakeAmp = Math.max(shakeAmp, amp); },
  onFinish: (rank, coins) => {
    state = 'finish';
    audio.fanfare();
    audio.stopEngine();
    fx.confetti.burst(playerRacer().kart.position);
    const rankText = ['', '🥇 1い！', '🥈 2い！', '🥉 3い！', '4い！'][rank] || `${rank}い`;
    ui.finishRank.textContent = rankText;
    ui.finishMsg.textContent = rank === 1
      ? 'すごい！ チャンピオンだ！'
      : (rank === 2 ? 'おしい！ かっこよかった！' : 'さいごまで はしれたね！');
    setTimeout(() => {
      ui.finish.classList.remove('hidden');
      ui.hud.classList.add('hidden');
    }, 1600);
  },
};

/* レースのセットアップ（プレイヤーのキャラを先頭に） */
function setupRace() {
  const order = [selectedChar, ...CHARACTERS.map((_, i) => i).filter(i => i !== selectedChar)];
  racerOrder = order.map((ci, slot) => new Racer(kartMeshes[ci], slot, slot === 0));
  race = new Race(world, racerOrder, fx, audio, hooks);
  // コイン・アイテムボックスをリセット
  for (const c of world.coins.defs) c.taken = false;
  for (const b of world.itemBoxes.defs) { b.taken = false; b.respawn = 0; }
  ui.lapText.textContent = `1/${LAPS} しゅうめ`;
  ui.coinText.textContent = '0';
  ui.rankNum.textContent = racerOrder[0].rank;
  ui.rankChip.classList.remove('first');
  ui.btnItem.style.display = 'none';
  fx.confetti.stop();
}

/* カウントダウン演出 */
function startCountdown() {
  state = 'countdown';
  ui.title.classList.add('hidden');
  ui.finish.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  ui.countdown.classList.remove('hidden');
  setupRace();
  const seq = ['3', '2', '1', 'GO!'];
  let i = 0;
  const step = () => {
    if (i < seq.length) {
      ui.countNum.textContent = seq[i];
      ui.countNum.classList.remove('pop');
      void ui.countNum.offsetWidth;
      ui.countNum.classList.add('pop');
      audio.countBeep(i === 3);
      if (i === 3) {
        race.start();
        state = 'race';
        audio.startEngine();
        audio.startMusic();
        setTimeout(() => ui.countdown.classList.add('hidden'), 900);
      } else {
        setTimeout(step, 1000);
      }
      i++;
    }
  };
  setTimeout(step, 350);
}

ui.btnStart.addEventListener('pointerdown', () => {
  audio.unlock();
  audio.itemGet();
  startCountdown();
});
ui.btnAgain.addEventListener('pointerdown', () => {
  audio.unlock();
  startCountdown();
});

/* ============================================================
 *  カメラ
 * ============================================================ */
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3(0, 50, 240);
const _fwd = new THREE.Vector3();
const _look = new THREE.Vector3();
let titleS = 0;
const titleSmp = {};

function isPortrait() { return window.innerHeight > window.innerWidth * 1.05; }

function updateCamera(dt, t) {
  const portrait = isPortrait();
  let targetFov = portrait ? 74 : 63;

  if (state === 'title' || state === 'loading') {
    // タイトル：コース上空をゆっくり周遊
    titleS += dt * 14;
    world.track.sample(titleS, titleSmp);
    const p = titleSmp.pos, tn = titleSmp.tan;
    camPos.lerp(new THREE.Vector3(p.x - tn.x * 26, p.y + 15, p.z - tn.z * 26), Math.min(1, dt * 1.2));
    camTarget.lerp(new THREE.Vector3(p.x + tn.x * 30, p.y + 2, p.z + tn.z * 30), Math.min(1, dt * 1.5));
  } else if (state === 'finish') {
    // ゴール：プレイヤーの周りをぐるり
    const k = playerRacer().kart;
    const a = t * 0.45;
    camPos.lerp(new THREE.Vector3(
      k.position.x + Math.cos(a) * 13,
      k.position.y + 6.5,
      k.position.z + Math.sin(a) * 13), Math.min(1, dt * 2.2));
    camTarget.lerp(new THREE.Vector3(k.position.x, k.position.y + 1.5, k.position.z), Math.min(1, dt * 4));
  } else {
    // チェイスカメラ
    const p = playerRacer();
    const k = p.kart;
    _fwd.set(0, 0, 1).applyQuaternion(k.quaternion);
    const dist = portrait ? 12.6 : 10.2;
    const height = portrait ? 6.2 : 4.7;
    const boostK = p.boostT > 0 ? 1.14 : 1;
    _look.copy(k.position).addScaledVector(_fwd, -dist * boostK);
    _look.y = k.position.y + height;
    camPos.lerp(_look, Math.min(1, dt * 5.5));
    _look.copy(k.position).addScaledVector(_fwd, 7).add({ x: 0, y: 2.1, z: 0 });
    camTarget.lerp(_look, Math.min(1, dt * 9));
    targetFov += p.boostT > 0 ? 12 : (p.speed / 36) * 4;
  }

  // 地形にめり込まないように持ち上げる
  const groundY = world.heightAt(camPos.x, camPos.z) + 1.7;
  if (camPos.y < groundY) camPos.y += (groundY - camPos.y) * Math.min(1, dt * 10);

  camera.position.copy(camPos);
  if (shakeAmp > 0.002) {
    camera.position.x += (Math.random() - 0.5) * shakeAmp;
    camera.position.y += (Math.random() - 0.5) * shakeAmp;
    shakeAmp *= Math.pow(0.001, dt);
  }
  camera.lookAt(camTarget);
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();

  // 影カメラをプレイヤー周辺に追従
  const focus = state === 'race' || state === 'countdown' || state === 'finish'
    ? playerRacer().kart.position : camTarget;
  sun.position.copy(focus).addScaledVector(SUN_DIR, 170);
  sun.target.position.copy(focus);
}

/* ============================================================
 *  リサイズ
 * ============================================================ */
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 300));
window.addEventListener('load', onResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
setTimeout(onResize, 400);
// なにかの拍子にページや body がスクロールしても必ず戻す（画面下に帯が出るのを防ぐ）
document.addEventListener('scroll', (e) => {
  window.scrollTo(0, 0);
  const t = e.target;
  if (t && t.scrollTop) t.scrollTop = 0;
  if (document.body.scrollTop) document.body.scrollTop = 0;
  if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0;
}, { capture: true, passive: true });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

/* タブ非表示で音を止める */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.stopMusic(); audio.stopEngine(); }
  else if (state === 'race') { audio.startMusic(); audio.startEngine(); }
});

/* ============================================================
 *  メインループ
 * ============================================================ */
const clock = new THREE.Clock();
let firstFrame = true;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  input.steer = currentSteer();

  world.update(t, dt);
  if (race && (state === 'race' || state === 'finish' || state === 'countdown')) {
    race.update(dt, t, input);
    const p = playerRacer();
    audio.setEngine(p.speed / 36, p.boostT > 0);
  }
  fx.update(dt, t, camera);
  updateCamera(dt, t);

  renderer.render(scene, camera);
  // ブースト時のスピードライン
  const boostAmp = (race && state === 'race' && playerRacer().boostT > 0) ? 1 : 0;
  const starAmp = (race && state === 'race' && playerRacer().starT > 0) ? 0.5 : 0;
  fx.speedLines.render(renderer, t, Math.max(boostAmp, starAmp));

  if (firstFrame) {
    firstFrame = false;
    ui.loading.classList.add('hidden');
    ui.title.classList.remove('hidden');
    state = 'title';
    // タイトルでもカートを並べて見せる
    setupRaceForTitle();
  }
}

/* タイトル画面用：スタート地点にカートを並べる */
function setupRaceForTitle() {
  racerOrder = CHARACTERS.map((_, i) => new Racer(kartMeshes[i], i, i === 0));
  race = new Race(world, racerOrder, fx, audio, hooks);
}

loop();

// 動作確認用（ゲームには影響しない）
window.__game = { world, getRace: () => race, getState: () => state, player: () => playerRacer() };
