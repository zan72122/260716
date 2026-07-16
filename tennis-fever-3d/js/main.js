/* ============================================================
   テニス フィーバー!  —  main.js
   Game flow, ball physics, friendly AI, fever mode, input,
   camera, and all the glue. Designed for a 4-year-old:
   one tap does everything, and nothing is ever punishing.
   ============================================================ */

import * as THREE from 'three';
import { createWorld, COURT } from './world.js';
import { createCharacter } from './character.js';
import { FX } from './effects.js';
import { AudioEngine } from './audio.js';

/* ---------------- renderer ---------------- */

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let maxDPR = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(maxDPR);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);

const world = createWorld(scene);
const fx = new FX(scene);
const audio = new AudioEngine();

/* ---------------- camera / orientation ---------------- */

const camBase = new THREE.Vector3();
const camLook = new THREE.Vector3();
let shake = 0;

function layoutCamera() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  const portrait = h > w;
  if (portrait) {
    camera.fov = 68;
    camBase.set(0, 9.6, 17.6);
    camLook.set(0, 0.4, -4.2);
  } else {
    camera.fov = 52;
    camBase.set(0, 7.8, 17.4);
    camLook.set(0, 0.4, -3.4);
  }
  camera.updateProjectionMatrix();
}
layoutCamera();
window.addEventListener('resize', layoutCamera);
window.addEventListener('orientationchange', () => setTimeout(layoutCamera, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', layoutCamera);

/* ---------------- DOM helpers ---------------- */

const $ = (id) => document.getElementById(id);
const hud = $('hud'), pops = $('pops');
const starBox = $('star-box'), starCountEl = $('star-count');
const rallyBox = $('rally-box'), rallyCountEl = $('rally-count');
const feverGauge = $('fever-gauge'), feverFill = $('fever-fill'), feverLabel = $('fever-label');
const feverFlash = $('fever-flash');

const POP_COLORS = { nice: '#ffb300', great: '#ff5f3a', fever: '#ff3f8e', info: '#2b8de0', point: '#8e44e8' };

function popAtScreen(xFrac, yFrac, text, { size = 40, color = '#ff5f3a', big = false } = {}) {
  const el = document.createElement('div');
  el.className = 'pop' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = (xFrac * 100) + '%';
  el.style.top = (yFrac * 100) + '%';
  el.style.fontSize = size + 'px';
  el.style.color = color;
  pops.appendChild(el);
  setTimeout(() => el.remove(), big ? 1500 : 1000);
}

const _proj = new THREE.Vector3();
function popAtWorld(pos, text, opts = {}) {
  _proj.copy(pos).project(camera);
  popAtScreen(
    THREE.MathUtils.clamp((_proj.x + 1) / 2, 0.12, 0.88),
    THREE.MathUtils.clamp((1 - _proj.y) / 2, 0.12, 0.8),
    text, opts);
}

/* ---------------- persistent stars ---------------- */

let stars = 0;
try { stars = parseInt(localStorage.getItem('tf_stars') || '0', 10) || 0; } catch (e) { /* private mode */ }
function addStars(n, worldPos) {
  stars += n;
  starCountEl.textContent = stars;
  starBox.classList.remove('bump');
  void starBox.offsetWidth;
  starBox.classList.add('bump');
  setTimeout(() => starBox.classList.remove('bump'), 200);
  try { localStorage.setItem('tf_stars', String(stars)); } catch (e) { /* ignore */ }
  if (worldPos) popAtWorld(worldPos, `+${n}★`, { size: 30, color: POP_COLORS.nice });
}
starCountEl.textContent = stars;

/* ---------------- characters ---------------- */

let player = null;
let cpu = null;
let playerKind = 'bunny';

function spawnCharacters(kind) {
  if (player) scene.remove(player.group);
  if (cpu) scene.remove(cpu.group);
  playerKind = kind;
  player = createCharacter(kind);
  player.group.position.set(0, 0, COURT.playerZ);
  player.group.rotation.y = Math.PI;   // face the net
  scene.add(player.group);

  const others = ['bunny', 'cat', 'dino'].filter(k => k !== kind);
  cpu = createCharacter(others[(Math.random() * others.length) | 0]);
  cpu.group.position.set(0, 0, COURT.cpuZ);
  scene.add(cpu.group);
}

/* ---------------- ball ---------------- */

const BALL_R = 0.24;
const G = 9.2;

const ballGroup = new THREE.Group();
const ballMat = new THREE.MeshStandardMaterial({
  color: '#e8ff4a', roughness: 0.55,
  emissive: '#a4c020', emissiveIntensity: 0.35,
});
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 16), ballMat);
ballMesh.castShadow = true;
// classic tennis seam for readable spin
const seam = new THREE.Mesh(
  new THREE.TorusGeometry(BALL_R * 0.98, 0.02, 6, 32),
  new THREE.MeshBasicMaterial({ color: '#ffffff' })
);
seam.rotation.x = Math.PI / 3;
ballGroup.add(ballMesh, seam);
ballGroup.visible = false;
scene.add(ballGroup);

const ball = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  flying: false,
  bounces: 0,
  towardPlayer: false,
  targetX: 0,
  spin: new THREE.Vector3(),
};

function launchBall(from, tx, tz, T) {
  ball.pos.copy(from);
  ball.vel.set(
    (tx - from.x) / T,
    (BALL_R - from.y + 0.5 * G * T * T) / T,
    (tz - from.z) / T);
  ball.flying = true;
  ball.bounces = 0;
  ball.towardPlayer = ball.vel.z > 0;
  ball.targetX = tx;
  ball.spin.set(-ball.vel.z, 0, ball.vel.x).multiplyScalar(1.4);
  ballGroup.visible = true;
}

/* ---------------- game state ---------------- */

const S = {
  screen: 'title',        // title | select | howto | play
  phase: 'wait',          // wait | serve | rally | celebrate
  rally: 0,
  gauge: 0,
  gaugeMax: 8,
  fever: false,
  feverLeft: 0,
  swingCooldown: 0,
  serveTimer: 0,
  cpuMissIn: 7,           // CPU gives the child a point after this many returns
  cpuSwingDelay: 0,
  celebrateTimer: 0,
  serveCount: 0,
  excitementDecay: 0,
};

function setRally(n) {
  S.rally = n;
  rallyCountEl.textContent = n;
  rallyBox.classList.toggle('hidden', n < 2);
  world.drawJumbo(n, S.fever);
  world.setExcitement(Math.min(n / 12, 1));
}

function setGauge(n) {
  S.gauge = Math.min(n, S.gaugeMax);
  feverFill.style.width = (S.gauge / S.gaugeMax * 100) + '%';
  feverGauge.classList.toggle('full', S.gauge >= S.gaugeMax);
  if (S.gauge >= S.gaugeMax) feverLabel.textContent = 'フィーバー!!';
  else feverLabel.textContent = 'フィーバー';
}

function scheduleServe(delay = 1.2) {
  S.phase = 'serve';
  S.serveTimer = delay;
  ball.flying = false;
}

function doServe() {
  S.serveCount++;
  const tx = THREE.MathUtils.randFloat(-2.2, 2.2);
  const tz = THREE.MathUtils.randFloat(4.8, 6.8);
  const from = cpu.group.position.clone().add(new THREE.Vector3(0.3, 1.1, 0.4));
  launchBall(from, tx, tz, 1.7);
  cpu.swing();
  audio.hit(0);
  S.phase = 'rally';
  if (S.serveCount <= 2) {
    popAtScreen(0.5, 0.62, 'ボールが きたら タッチ!', { size: 26, color: POP_COLORS.info, big: true });
  } else {
    popAtScreen(0.5, 0.3, 'いくよ~!', { size: 30, color: POP_COLORS.info });
  }
}

/* ---------------- fever ---------------- */

function startFever() {
  S.fever = true;
  S.feverLeft = 12;
  world.setFever(true);
  audio.setFever(true);
  audio.fanfare();
  fx.setFeverRain(true);
  world.drawJumbo(S.rally, true);
  feverFlash.classList.remove('burst');
  feverFlash.classList.add('active');
  popAtScreen(0.5, 0.4, 'フィーバー!!', { size: 64, color: POP_COLORS.fever, big: true });
  fx.confettiBurst(new THREE.Vector3(0, 4, 2), 80);
  shake = Math.max(shake, 0.35);
}

function endFever() {
  S.fever = false;
  world.setFever(false);
  audio.setFever(false);
  fx.setFeverRain(false);
  setGauge(0);
  world.drawJumbo(S.rally, false);
  feverFlash.classList.remove('active');
  feverFlash.classList.add('burst');
  setTimeout(() => feverFlash.classList.remove('burst'), 600);
  popAtScreen(0.5, 0.4, 'たのしかったね!', { size: 34, color: POP_COLORS.info, big: true });
  audio.cheer(1.3);
}

/* ---------------- player actions ---------------- */

function playerSwing() {
  if (S.phase !== 'rally' && S.phase !== 'serve') return;
  if (S.swingCooldown > 0) return;
  S.swingCooldown = 0.32;
  player.swing();

  if (!ball.flying || !ball.towardPlayer) {
    audio.swishMiss();
    return;
  }
  const dx = ball.pos.x - player.group.position.x;
  const dz = ball.pos.z - player.group.position.z;
  const dist = Math.hypot(dx, dz);
  const reachable = ball.pos.z > 1.5 && ball.pos.y < 3.4 && dist < 2.8;
  if (!reachable) {
    audio.swishMiss();
    return;
  }

  // ---- HIT! ----
  const sweet = dist < 1.25 && ball.pos.y > 0.25 && ball.pos.y < 1.9;
  const rally = S.rally + 1;
  setRally(rally);

  const tx = THREE.MathUtils.randFloat(-2.8, 2.8);
  const tz = THREE.MathUtils.randFloat(-7.6, -4.6);
  const T = THREE.MathUtils.clamp(1.35 - rally * 0.012, 1.02, 1.35);
  launchBall(ball.pos.clone(), tx, tz, T);

  const hitPos = ball.pos.clone();
  fx.hitBurst(hitPos, { nice: sweet, fever: S.fever });
  audio.hit(rally, sweet);
  shake = Math.max(shake, sweet ? 0.3 : 0.16);

  let gain = S.fever ? 2 : 1;
  if (sweet) gain += 1;
  addStars(gain, hitPos);

  if (sweet) {
    popAtWorld(hitPos, 'ナイス!', { size: 44, color: POP_COLORS.nice });
  }
  if (rally > 0 && rally % 5 === 0) {
    popAtScreen(0.5, 0.28, 'すごい! ' + rally + 'かい!', { size: 40, color: POP_COLORS.great, big: true });
    audio.cheer(1);
  }
  if (S.fever) {
    fx.confettiBurst(hitPos, 24);
  }

  if (!S.fever) {
    setGauge(S.gauge + 1);
    if (S.gauge >= S.gaugeMax) startFever();
  }

  // CPU may "just miss" soon to hand the child a point
  S.cpuMissIn--;
}

/* ---------------- point celebration ---------------- */

function playerPoint() {
  S.phase = 'celebrate';
  S.celebrateTimer = 2.6;
  player.celebrate();
  cpu.sad();
  audio.fanfare();
  popAtScreen(0.5, 0.35, 'ポイント!', { size: 56, color: POP_COLORS.point, big: true });
  addStars(5);
  const fw = () => fx.firework(new THREE.Vector3(
    THREE.MathUtils.randFloat(-12, 12), THREE.MathUtils.randFloat(9, 14), THREE.MathUtils.randFloat(-20, -6)));
  fw();
  setTimeout(() => { fw(); audio.firework(); }, 350);
  setTimeout(() => { fw(); audio.firework(); }, 750);
  audio.firework();
  S.cpuMissIn = 6 + ((Math.random() * 5) | 0);
  setRally(0);
}

function playerMissed() {
  S.phase = 'celebrate';                 // reuse the pause, but gently
  S.celebrateTimer = 1.4;
  audio.miss();
  player.sad();
  popAtScreen(0.5, 0.45, 'どんまい!', { size: 38, color: POP_COLORS.info, big: true });
  fx.sparkleAt(ball.pos.clone());
  audio.sparkle();
  ballGroup.visible = false;
  ball.flying = false;
  setRally(0);
}

/* ---------------- CPU brain ---------------- */

function updateCPU(dt) {
  const c = cpu.group.position;
  let targetX = 0;
  if (ball.flying && !ball.towardPlayer) targetX = ball.targetX;
  targetX = THREE.MathUtils.clamp(targetX, -3.8, 3.8);
  const vx = (targetX - c.x) * 5.5;
  c.x += THREE.MathUtils.clamp(vx, -7, 7) * dt;
  cpu.setMove(THREE.MathUtils.clamp(vx, -3, 3));

  if (!ball.flying || ball.towardPlayer || S.phase !== 'rally') return;

  // in reach?
  const dx = ball.pos.x - c.x;
  const dz = ball.pos.z - c.z;
  if (Math.hypot(dx, dz) < 1.9 && ball.pos.y < 3.2) {
    if (S.cpuMissIn <= 0 && !S.fever) {
      // deliberately let it pass — child gets the point when it double-bounces
      return;
    }
    // return the ball
    const tx = THREE.MathUtils.randFloat(-2.6, 2.6);
    const tz = THREE.MathUtils.randFloat(4.6, 7.0);
    const T = THREE.MathUtils.clamp(1.5 - S.rally * 0.014, 1.08, 1.5);
    launchBall(ball.pos.clone(), tx, tz, T);
    cpu.swing();
    audio.hit(S.rally);
    fx.hitBurst(ball.pos.clone(), { fever: S.fever });
  }
}

/* ---------------- ball physics ---------------- */

function updateBall(dt) {
  if (!ball.flying) {
    fx.updateBallShadow(ball.pos, false);
    return;
  }
  ball.vel.y -= G * dt;
  ball.pos.addScaledVector(ball.vel, dt);

  // bounce
  if (ball.pos.y < BALL_R && ball.vel.y < 0) {
    ball.pos.y = BALL_R;
    ball.vel.y *= -0.62;
    ball.vel.x *= 0.86;
    ball.vel.z *= 0.86;
    ball.bounces++;
    if (Math.abs(ball.vel.y) > 1) {
      audio.bounce();
      fx.bouncePuff(ball.pos, S.fever);
    }

    if (ball.bounces >= 2 && S.phase === 'rally') {
      if (ball.pos.z < 0) {
        playerPoint();       // double bounce on CPU side => child's point!
        ballGroup.visible = false;
        ball.flying = false;
      } else {
        playerMissed();
      }
      return;
    }
  }

  // rolled past the player
  if (S.phase === 'rally' && ball.towardPlayer && ball.pos.z > COURT.playerZ + 2.6) {
    playerMissed();
    return;
  }
  // safety: way out of bounds
  if (ball.pos.z < -COURT.halfL - 6 || Math.abs(ball.pos.x) > 14) {
    scheduleServe(0.8);
    ballGroup.visible = false;
    return;
  }

  ballGroup.position.copy(ball.pos);
  ballMesh.rotation.x += ball.spin.x * dt;
  ballMesh.rotation.z += ball.spin.z * dt;
  seam.rotation.x += ball.spin.x * dt * 0.9;

  const spd = ball.vel.length();
  fx.ballTrail(ball.pos, S.fever, THREE.MathUtils.clamp(spd / 10, 0.3, 1));
  fx.updateBallShadow(ball.pos, true);

  // fever ball glows hot
  ballMat.emissiveIntensity = S.fever ? 0.9 + Math.sin(clock.elapsedTime * 10) * 0.3 : 0.35;
  ballMat.emissive.set(S.fever ? '#ff8a3c' : '#a4c020');
}

/* ---------------- player auto-run ---------------- */

function updatePlayer(dt) {
  const p = player.group.position;
  let targetX = 0;
  if (ball.flying && ball.towardPlayer) targetX = ball.targetX;
  targetX = THREE.MathUtils.clamp(targetX, -3.8, 3.8);
  const vx = (targetX - p.x) * 5.0;
  const cl = THREE.MathUtils.clamp(vx, -6.5, 6.5);
  p.x += cl * dt;
  // the player model is rotated 180°, so flip the lean direction
  player.setMove(-THREE.MathUtils.clamp(cl, -3, 3));
}

/* ---------------- input ---------------- */

function onTap() {
  if (S.screen === 'play') playerSwing();
}
window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  onTap();
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') onTap();
});

// iOS: block double-tap zoom / scroll / long-press
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd < 350) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

/* ---------------- UI flow ---------------- */

$('start-btn').addEventListener('click', () => {
  audio.unlock();
  audio.uiTap();
  $('title-screen').classList.add('fade-out');
  setTimeout(() => $('title-screen').classList.add('hidden'), 520);
  $('select-screen').classList.remove('hidden');
  S.screen = 'select';
});

for (const card of document.querySelectorAll('.char-card')) {
  card.addEventListener('click', () => {
    audio.unlock();
    audio.uiTap();
    audio.sparkle();
    spawnCharacters(card.dataset.char);
    $('select-screen').classList.add('hidden');
    $('howto-screen').classList.remove('hidden');
    S.screen = 'howto';
  });
}

$('go-btn').addEventListener('click', () => {
  audio.unlock();
  audio.uiTap();
  $('howto-screen').classList.add('hidden');
  hud.classList.remove('hidden');
  S.screen = 'play';
  audio.startBGM();
  audio.cheer(0.8);
  setGauge(0);
  setRally(0);
  scheduleServe(1.4);
});

$('mute-btn').addEventListener('click', () => {
  audio.unlock();
  const m = !audio.muted;
  audio.setMuted(m);
  $('mute-btn').textContent = m ? '🔇' : '🔊';
});

/* pre-spawn default characters so the world never looks empty */
spawnCharacters('bunny');

/* ---------------- adaptive quality ---------------- */

let slowFrames = 0;
function adaptQuality(dt) {
  if (dt > 0.034) slowFrames++; else slowFrames = Math.max(0, slowFrames - 2);
  if (slowFrames > 90 && maxDPR > 1.2) {
    maxDPR = Math.max(1.2, maxDPR - 0.35);
    renderer.setPixelRatio(maxDPR);
    slowFrames = 0;
  }
}

/* ---------------- main loop ---------------- */

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  adaptQuality(dt);

  /* game phases */
  if (S.screen === 'play') {
    S.swingCooldown = Math.max(0, S.swingCooldown - dt);

    if (S.phase === 'serve') {
      S.serveTimer -= dt;
      if (S.serveTimer <= 0) doServe();
    } else if (S.phase === 'celebrate') {
      S.celebrateTimer -= dt;
      if (S.celebrateTimer <= 0) scheduleServe(0.6);
    }

    if (S.fever) {
      S.feverLeft -= dt;
      if (S.feverLeft <= 0) endFever();
    }

    updatePlayer(dt);
    updateCPU(dt);
    updateBall(dt);
  }

  /* characters & world always animate (nice behind menus too) */
  if (player) player.update(dt, t);
  if (cpu) cpu.update(dt, t);
  world.update(dt, t);
  fx.update(dt, t, camera);

  /* camera: follow the action a little, plus shake */
  shake = Math.max(0, shake - dt * 1.6);
  const followX = ball.flying ? ball.pos.x * 0.14 : 0;
  camera.position.x += (camBase.x + followX - camera.position.x) * Math.min(1, dt * 3);
  camera.position.y += (camBase.y - camera.position.y) * Math.min(1, dt * 3);
  camera.position.z += (camBase.z - camera.position.z) * Math.min(1, dt * 3);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.3;
    camera.position.y += (Math.random() - 0.5) * shake * 0.22;
  }
  camera.lookAt(camLook);

  renderer.render(scene, camera);
}

camera.position.copy(camBase);
frame();

/* tiny debug handle (harmless in production, handy for testing) */
window.__tfDebug = { startFever, endFever, playerPoint, state: S };
