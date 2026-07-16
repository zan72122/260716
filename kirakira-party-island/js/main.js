// エントリーポイント:レンダラ・カメラ・入力・ゲームループの結線。

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, CHARACTERS } from './config.js';
import { World } from './world.js';
import { createCharacter } from './characters.js';
import { ParticleFX } from './particles.js';
import { UI } from './ui.js';
import { BoardGame } from './board.js';
import { MinigameManager } from './minigames/harness.js';
import { audio } from './audio.js';

// ============ レンダラ ============
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.PIXEL_RATIO_MAX));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);

// ============ カメラリグ ============
class CameraRig {
  constructor(cam) {
    this.camera = cam;
    this.mode = 'overview';
    this.followChar = null;
    this.lookPoint = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 30, 40);
    this.look = new THREE.Vector3(0, 0, 0);
    cam.position.copy(this.pos);
  }

  setOverview() { this.mode = 'overview'; }
  setFollow(char) { this.mode = 'follow'; this.followChar = char; }
  setLookAt(p) { this.mode = 'look'; this.lookPoint.copy(p); }
  setFinale() { this.mode = 'finale'; }

  update(dt, aspect, t) {
    // 縦画面では引き気味にして全体が見えるように
    const pf = aspect < 1 ? Math.min(2.0, (1 / aspect) * 0.95) : 1;
    const desiredPos = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();

    if (this.mode === 'overview') {
      desiredPos.set(0, 25 * pf, 30 * pf);
      desiredLook.set(0, 0.5, 0);
    } else if (this.mode === 'follow' && this.followChar) {
      const p = this.followChar.root.position;
      const out = new THREE.Vector3(p.x, 0, p.z);
      if (out.lengthSq() < 1) out.set(0, 0, 1);
      out.normalize();
      desiredPos.copy(p)
        .addScaledVector(out, 6.8 * pf)
        .add(new THREE.Vector3(0, 4.4 * pf, 0));
      desiredLook.copy(p).add(new THREE.Vector3(0, 1, 0));
    } else if (this.mode === 'look') {
      desiredPos.copy(this.pos);
      desiredLook.copy(this.lookPoint);
    } else if (this.mode === 'finale') {
      const a = t * 0.22;
      desiredPos.set(Math.cos(a) * 12 * pf, 6.6 * pf, Math.sin(a) * 12 * pf);
      desiredLook.set(0, 3.2, 0);
    }

    const k = 1 - Math.exp(-3.2 * dt);
    this.pos.lerp(desiredPos, k);
    this.look.lerp(desiredLook, k);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.fov = aspect < 1 ? 58 : 50;
    this.camera.updateProjectionMatrix();
  }
}

const rig = new CameraRig(camera);

// ============ ワールドとキャラ ============
const world = new World(scene);
const fx = new ParticleFX(scene);
const ui = new UI();

const chars = CHARACTERS.map((def) => createCharacter(def));
chars.forEach((c, i) => {
  const a = (i / 4) * Math.PI * 2 + 0.6;
  const offset = new THREE.Vector3(Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56);
  c.root.position.copy(world.tiles[0].pos).add(offset);
  c.faceTowards(world.tiles[1].pos);
  scene.add(c.root);
});

let playerIndex = 0;

const mgManager = new MinigameManager({ chars, playerIndex, ui, boardScene: scene });
const board = new BoardGame({
  scene, world, chars, ui, fx, rig,
  runMinigame: () => mgManager.run(),
});

// ============ 入力 ============
const getNdc = (e) => new THREE.Vector2(
  (e.clientX / window.innerWidth) * 2 - 1,
  -(e.clientY / window.innerHeight) * 2 + 1,
);

const tapLayer = document.getElementById('tap-layer');
tapLayer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  audio.unlock();
  mgManager.pointerDown(getNdc(e), { x: e.clientX, y: e.clientY });
}, { passive: false });
tapLayer.addEventListener('pointermove', (e) => {
  e.preventDefault();
  mgManager.pointerMove(getNdc(e), { x: e.clientX, y: e.clientY });
}, { passive: false });

document.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
// iOS のダブルタップズーム抑止
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

const soundBtn = document.getElementById('btn-sound');
soundBtn.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  audio.unlock();
  audio.setMuted(!audio.muted);
  soundBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// ============ タイトル画面 ============
const titleScreen = document.getElementById('title-screen');
const charButtons = document.getElementById('char-buttons');
const startBtn = document.getElementById('btn-start');

CHARACTERS.forEach((def, i) => {
  const b = document.createElement('button');
  b.className = 'char-btn';
  b.style.background = def.ui;
  b.textContent = def.emoji;
  b.setAttribute('aria-label', def.name);
  b.addEventListener('pointerdown', () => {
    audio.unlock();
    audio.tap();
    playerIndex = i;
    [...charButtons.children].forEach((x, k) => x.classList.toggle('sel', k === i));
    startBtn.disabled = false;
  });
  charButtons.appendChild(b);
});

startBtn.addEventListener('pointerdown', async () => {
  audio.unlock();
  audio.fanfare();
  chars.forEach((c, i) => { c.isPlayer = i === playerIndex; });
  mgManager.ctx.playerIndex = playerIndex;
  titleScreen.classList.add('fade');
  setTimeout(() => titleScreen.classList.add('hidden'), 600);

  await board.start();

  // ぜんぶ終わったら、タップでもういっかい
  ui.showBanner(
    '<span class="icon">🔁</span>タップで もういっかい あそぶ!',
    1000 * 60 * 10,
  );
  const reload = () => location.reload();
  window.addEventListener('pointerdown', reload, { once: true });
});

// ============ リサイズ ============
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  mgManager.resize(w / h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();

// ============ メインループ ============
const clock = new THREE.Clock();
let firstFrame = true;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);

  world.update(dt);
  chars.forEach((c) => c.update(dt));
  board.update(dt);
  fx.update(dt);
  mgManager.update(dt);

  if (mgManager.active) {
    const g = mgManager.active;
    g.camera.aspect = aspect;
    g.camera.updateProjectionMatrix();
    renderer.render(g.scene, g.camera);
  } else {
    rig.update(dt, aspect, t);
    renderer.render(scene, camera);
  }

  if (firstFrame) {
    firstFrame = false;
    document.getElementById('loading').classList.add('fade');
  }
}
loop();
