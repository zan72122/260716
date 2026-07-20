/* ============================================================
   テニス フィーバー!  —  effects.js
   Juicy feedback: ball trails, hit bursts, shock rings,
   confetti rain, fireworks. Everything pooled — zero
   allocations during play.
   ============================================================ */

import * as THREE from 'three';
import { radialTexture } from './world.js';

function starTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  ctx.translate(cx, cy);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = size * 0.12;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = (i % 2 === 0) ? size * 0.42 : size * 0.18;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const g = ctx.createRadialGradient(cx, cx, size * 0.28, cx, cx, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.85, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const RAINBOW = ['#ff5f7e', '#ff9d1b', '#ffd23f', '#4dff7c', '#37b6ff', '#b44dff'];

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;

    this.glowTex = radialTexture(64, [
      [0, 'rgba(255,255,255,1)'],
      [0.4, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.starTex = starTexture();
    this.ringTex = ringTexture();

    /* ---------- sprite particle pool ---------- */
    this.pool = [];
    const N = 240;
    for (let i = 0; i < N; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.pool.push({
        sprite: s, vel: new THREE.Vector3(), life: 0, maxLife: 1,
        size0: 1, size1: 0, gravity: 0, damping: 1, active: false,
        normalBlend: false,
      });
    }
    this._poolIdx = 0;

    /* ---------- shock rings ---------- */
    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this.ringTex, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, opacity: 0,
        })
      );
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, maxLife: 0.5, size: 3, active: false });
    }

    /* ---------- confetti (instanced) ---------- */
    const CN = 260;
    this.confettiN = CN;
    const geo = new THREE.PlaneGeometry(0.16, 0.24);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.confetti = new THREE.InstancedMesh(geo, mat, CN);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    const col = new THREE.Color();
    this.confettiData = [];
    for (let i = 0; i < CN; i++) {
      col.set(RAINBOW[i % RAINBOW.length]);
      this.confetti.setColorAt(i, col);
      this.confettiData.push({
        pos: new THREE.Vector3(0, -50, 0),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(1 + Math.random() * 4, 1 + Math.random() * 4, 1 + Math.random() * 3),
        active: false,
      });
    }
    scene.add(this.confetti);
    this.feverRain = false;
    this._dummy = new THREE.Object3D();

    /* ---------- ball blob shadow ---------- */
    this.blobTex = radialTexture(64, [
      [0, 'rgba(10,40,80,0.4)'],
      [0.7, 'rgba(10,40,80,0.18)'],
      [1, 'rgba(10,40,80,0)'],
    ]);
    this.ballShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.015;
    scene.add(this.ballShadow);

    this._color = new THREE.Color();
  }

  _spawn(pos, opts = {}) {
    const p = this.pool[this._poolIdx];
    this._poolIdx = (this._poolIdx + 1) % this.pool.length;
    p.active = true;
    p.sprite.visible = true;
    p.sprite.position.copy(pos);
    p.sprite.material.map = opts.star ? this.starTex : this.glowTex;
    p.sprite.material.blending = opts.normalBlend ? THREE.NormalBlending : THREE.AdditiveBlending;
    p.sprite.material.color.set(opts.color || '#ffffff');
    p.sprite.material.opacity = opts.opacity ?? 1;
    p.sprite.material.rotation = opts.rotation ?? (opts.star ? Math.random() * Math.PI : 0);
    p.vel.copy(opts.vel || ZERO);
    p.life = 0;
    p.maxLife = opts.life ?? 0.5;
    p.size0 = opts.size0 ?? 0.5;
    p.size1 = opts.size1 ?? 0;
    p.gravity = opts.gravity ?? 0;
    p.damping = opts.damping ?? 1;
    p.baseOpacity = opts.opacity ?? 1;
    p.sprite.scale.setScalar(p.size0);
  }

  /* ---------- public: ball trail (call every frame) ---------- */
  ballTrail(pos, fever, speed01 = 1) {
    // soft glow ribbon
    this._spawn(pos, {
      color: fever ? RAINBOW[(this.t * 12 | 0) % 6] : '#fff6a8',
      size0: fever ? 0.5 : 0.34,
      size1: 0.02,
      life: fever ? 0.4 : 0.26,
      opacity: 0.55 * speed01,
    });
    if (fever && (this.t * 60 | 0) % 3 === 0) {
      this._spawn(pos, {
        star: true,
        color: RAINBOW[(Math.random() * 6) | 0],
        size0: 0.36, size1: 0.05, life: 0.55,
        vel: TMP.set((Math.random() - 0.5) * 1.6, (Math.random() - 0.2) * 1.4, (Math.random() - 0.5) * 1.6),
        gravity: -1.2, opacity: 0.95,
      });
    }
  }

  /* ---------- public: racket hit burst ---------- */
  hitBurst(pos, { nice = false, fever = false } = {}) {
    const n = nice ? 14 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 2.2 + Math.random() * 2.4;
      this._spawn(pos, {
        star: true,
        color: fever ? RAINBOW[i % 6] : (nice ? '#ffd23f' : '#fff2b0'),
        vel: TMP.set(Math.cos(a) * sp, 1.4 + Math.random() * 2.4, Math.sin(a) * sp),
        size0: nice ? 0.4 : 0.28, size1: 0.03,
        life: 0.5 + Math.random() * 0.25,
        gravity: -6, damping: 0.92,
      });
    }
    this._spawn(pos, {
      color: '#ffffff', size0: 0.4, size1: nice ? 2.6 : 1.8,
      life: 0.22, opacity: 0.9,
    });
    this.shockRing(pos, nice ? 3.4 : 2.4);
  }

  shockRing(pos, size = 3, flat = false) {
    for (const r of this.rings) {
      if (r.active) continue;
      r.active = true;
      r.mesh.visible = true;
      r.mesh.position.copy(pos);
      if (flat) {
        r.mesh.rotation.set(-Math.PI / 2, 0, 0);
        r.mesh.position.y = 0.03;
      } else {
        r.mesh.rotation.set(0, 0, 0);
        r.mesh.quaternion.copy(this._camQuat || r.mesh.quaternion);
      }
      r.life = 0;
      r.maxLife = 0.45;
      r.size = size;
      r.mesh.material.opacity = 0.9;
      return;
    }
  }

  /* ---------- public: ball landing puff ---------- */
  bouncePuff(pos, fever) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this._spawn(TMP2.set(pos.x, 0.08, pos.z), {
        color: fever ? RAINBOW[i % 6] : '#ffffff',
        vel: TMP.set(Math.cos(a) * 1.6, 0.7, Math.sin(a) * 1.6),
        size0: 0.26, size1: 0.02, life: 0.35, gravity: -3, opacity: 0.7,
      });
    }
    this.shockRing(TMP2.set(pos.x, 0.03, pos.z), 1.6, true);
  }

  /* ---------- public: confetti ---------- */
  confettiBurst(center, n = 60) {
    let spawned = 0;
    for (const d of this.confettiData) {
      if (d.active) continue;
      d.active = true;
      d.pos.set(
        center.x + (Math.random() - 0.5) * 2,
        center.y + Math.random() * 1.5,
        center.z + (Math.random() - 0.5) * 2);
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 5;
      d.vel.set(Math.cos(a) * sp * 0.6, 4 + Math.random() * 5, Math.sin(a) * sp * 0.6);
      if (++spawned >= n) break;
    }
  }

  setFeverRain(on) { this.feverRain = on; }

  /* ---------- public: fireworks ---------- */
  firework(pos) {
    const col = RAINBOW[(Math.random() * 6) | 0];
    const col2 = RAINBOW[(Math.random() * 6) | 0];
    for (let i = 0; i < 26; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = 4.5 + Math.random() * 3;
      this._spawn(pos, {
        star: Math.random() < 0.4,
        color: Math.random() < 0.5 ? col : col2,
        vel: TMP.set(
          Math.sin(ph) * Math.cos(th) * sp,
          Math.cos(ph) * sp * 0.8 + 1,
          Math.sin(ph) * Math.sin(th) * sp),
        size0: 0.5, size1: 0.04, life: 0.9 + Math.random() * 0.4,
        gravity: -3.2, damping: 0.94,
      });
    }
    this._spawn(pos, { color: '#ffffff', size0: 1, size1: 6, life: 0.3, opacity: 0.9 });
  }

  /* ---------- public: sparkle teleport (ball reset) ---------- */
  sparkleAt(pos) {
    for (let i = 0; i < 10; i++) {
      this._spawn(pos, {
        star: true, color: '#aef3ff',
        vel: TMP.set((Math.random() - 0.5) * 2, Math.random() * 2.4, (Math.random() - 0.5) * 2),
        size0: 0.3, size1: 0.02, life: 0.5, gravity: -1,
      });
    }
  }

  updateBallShadow(ballPos, visible) {
    this.ballShadow.visible = visible;
    if (!visible) return;
    this.ballShadow.position.x = ballPos.x;
    this.ballShadow.position.z = ballPos.z;
    const h = Math.max(0, ballPos.y);
    const s = THREE.MathUtils.clamp(0.55 - h * 0.035, 0.2, 0.55) * 1.6;
    this.ballShadow.scale.setScalar(s);
    this.ballShadow.material.opacity = THREE.MathUtils.clamp(1 - h * 0.09, 0.25, 1);
  }

  /* ============================================================ */
  update(dt, t, camera) {
    this.t = t;
    this._camQuat = camera.quaternion;

    /* particles */
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life += dt;
      const k = p.life / p.maxLife;
      if (k >= 1) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.damping, dt * 60));
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.scale.setScalar(THREE.MathUtils.lerp(p.size0, p.size1, k));
      p.sprite.material.opacity = p.baseOpacity * (1 - k * k);
    }

    /* rings */
    for (const r of this.rings) {
      if (!r.active) continue;
      r.life += dt;
      const k = r.life / r.maxLife;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const s = 0.3 + (r.size - 0.3) * (1 - Math.pow(1 - k, 2.4));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 0.9 * (1 - k);
    }

    /* confetti */
    let anyConfetti = false;
    for (let i = 0; i < this.confettiN; i++) {
      const d = this.confettiData[i];
      if (this.feverRain && !d.active && Math.random() < dt * 1.4) {
        d.active = true;
        d.pos.set((Math.random() - 0.5) * 26, 13 + Math.random() * 4, (Math.random() - 0.5) * 26);
        d.vel.set((Math.random() - 0.5) * 1.2, -1.6 - Math.random() * 1.4, (Math.random() - 0.5) * 1.2);
      }
      if (!d.active) {
        if (d.pos.y > -40) {
          d.pos.y = -50;
          this._dummy.position.copy(d.pos);
          this._dummy.updateMatrix();
          this.confetti.setMatrixAt(i, this._dummy.matrix);
          anyConfetti = true;
        }
        continue;
      }
      anyConfetti = true;
      d.vel.y += -5.5 * dt;
      if (d.vel.y < -2.2) d.vel.y = -2.2;      // flutter terminal velocity
      d.vel.x += Math.sin(t * 3 + i) * dt * 1.4;
      d.pos.addScaledVector(d.vel, dt);
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;
      if (d.pos.y < 0.05) d.active = false;
      this._dummy.position.copy(d.pos);
      this._dummy.rotation.copy(d.rot);
      this._dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this._dummy.matrix);
    }
    if (anyConfetti) this.confetti.instanceMatrix.needsUpdate = true;
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const ZERO = new THREE.Vector3();
