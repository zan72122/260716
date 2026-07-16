// ================================================================
// main — 起動・状態遷移(boot → menu → game → result)・メインループ
// ================================================================

import * as THREE from 'three';
import { Renderer3D } from './core/three-setup.js';
import { World } from './world/stage.js';
import { Particles } from './core/particles.js';
import { AudioEngine } from './audio/engine.js';
import { UI } from './ui.js';
import { SONG_MENU } from './audio/songs.js';
import { MochiGame } from './games/mochi.js';
import { CatchGame } from './games/catch.js';
import { JumpGame } from './games/jump.js';
import { GAMES } from './config.js';

const canvas = document.getElementById('stage');
const r3d = new Renderer3D(canvas);
const world = new World(r3d.scene);
const particles = new Particles(r3d.scene);
const audio = new AudioEngine();
const ui = new UI();

const ctx = { audio, world, particles, ui, r3d };

const gameClasses = { mochi: MochiGame, catch: CatchGame, jump: JumpGame };
const games = {};   // 遅延生成してキャッシュ

let state = 'boot';       // boot | menu | game | result
let currentKey = null;
let currentGame = null;
let menuAngle = 0;

/* ---------------- 状態遷移 ---------------- */

function toMenu() {
  if (currentGame) { currentGame.stop(); currentGame = null; }
  state = 'menu';
  ui.show('menu');
  ui.showTapHint(false);
  audio.playSong(SONG_MENU, { loop: true });
}

function startGame(key) {
  audio.select();
  currentKey = key;
  if (!games[key]) games[key] = new gameClasses[key](ctx);
  currentGame = games[key];

  // ほかのゲームの小道具は隠す
  for (const [k, g] of Object.entries(games)) {
    if (k !== key) g.group.visible = false;
  }

  state = 'game';
  ui.show('game');
  ui.banner(`<b>${GAMES[key].name}</b>`, 1800);
  ui.showTapHint(true);

  const cam = currentGame.camera();
  r3d.setCamera(cam.pos, cam.target);

  currentGame.start((result) => {
    state = 'result';
    ui.showTapHint(false);
    audio.fanfare();
    // 舞台の上に紙吹雪の雨
    const p = new THREE.Vector3(0, 4.5, 1);
    particles.burstConfetti(p, 90, 4.5);
    world.onBeat(1.2);
    setTimeout(() => {
      ui.showResult(currentKey, result, {
        audio,
        onAgain: () => { audio.select(); startGame(currentKey); },
        onMenu: () => { audio.select(); toMenu(); },
      });
    }, 900);
  });
}

/* ---------------- 入力 ---------------- */

document.getElementById('btn-boot').addEventListener('click', () => {
  audio.unlock();
  toMenu();
});

for (const card of document.querySelectorAll('.game-card')) {
  card.addEventListener('click', () => {
    if (state !== 'menu') return;
    startGame(card.dataset.game);
  });
}

document.getElementById('btn-home').addEventListener('click', (e) => {
  e.stopPropagation();
  if (state !== 'game') return;
  audio.select();
  toMenu();
});

// プレイ中は画面のどこをタップしてもOK(4歳児仕様)
function handleTap(e) {
  if (state !== 'game' || !currentGame) return;
  // HUDのボタンは除外
  if (e.target.closest && e.target.closest('button')) return;
  currentGame.onTap();
  tapRipple(e);
}
window.addEventListener('pointerdown', handleTap, { passive: true });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state === 'game' && currentGame) {
    e.preventDefault();
    currentGame.onTap();
  }
});

// iOSのピンチ・ダブルタップズームを抑止
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

/* タップ位置に波紋(DOMで軽量に) */
function tapRipple(e) {
  const x = e.clientX ?? window.innerWidth / 2;
  const y = e.clientY ?? window.innerHeight * 0.7;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:14px;height:14px;`
    + 'margin:-7px 0 0 -7px;border-radius:50%;border:3px solid rgba(255,224,102,.9);'
    + 'pointer-events:none;z-index:50;transform:scale(1);opacity:.9;'
    + 'transition:transform .45s ease-out,opacity .45s ease-out;';
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = 'scale(5)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 500);
}

/* ---------------- メインループ ---------------- */

const menuCam = {
  pos: new THREE.Vector3(0, 3.6, 11),
  target: new THREE.Vector3(0, 1.4, 0),
};

let last = performance.now();
let menuBeatAcc = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state === 'menu' || state === 'boot' || state === 'result') {
    // ゆっくり回るカメラ
    menuAngle += dt * (state === 'result' ? 0.1 : 0.06);
    const r = 11;
    menuCam.pos.set(Math.sin(menuAngle) * r, 3.8, Math.cos(menuAngle) * r);
    r3d.setCamera(menuCam.pos, menuCam.target);

    // メニューBGMの拍で世界をはずませる
    if (audio.ctx && audio.songTime >= 0) {
      const spb = 60 / SONG_MENU.bpm;
      menuBeatAcc += dt;
      const beat = audio.songTime / spb;
      if (Math.floor(beat) !== Math.floor(beat - dt / spb)) {
        world.onBeat(Math.floor(beat) % 4 === 0 ? 0.8 : 0.4);
      }
    }
  }

  if (state === 'game' && currentGame) currentGame.update(dt);

  world.update(dt);
  particles.update(dt);
  r3d.updateCamera(now / 1000, dt);
  r3d.render();
}
requestAnimationFrame(loop);
