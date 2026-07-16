/* ============================================================
   effects.js — パーティクル / 虹のリボントレイル / 2Dオーバーレイ
   ============================================================ */
import * as THREE from 'three';
import { hsl } from './lib3d.js';

/* ============================================================
   GPUポイントパーティクル (CPU更新のプール)
   ============================================================ */
export class ParticlePool {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);     // 残り寿命
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.head = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFade', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uScale: { value: 300 } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aFade;
        varying vec3 vColor;
        varying float vFade;
        uniform float uScale;
        void main() {
          vColor = aColor;
          vFade = aFade;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          if (r > 0.5) discard;
          float a = smoothstep(0.5, 0.08, r) * clamp(vFade, 0.0, 1.0);
          gl_FragColor = vec4(vColor * (1.0 + (1.0 - r * 2.0) * 0.8), a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = geo;
    // 全部を「死んだ」状態に
    this.life.fill(0);
    this.pos.fill(-9999);
  }

  emit(p, v, color, size, lifeSec, gravity = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size[i] = size;
    this.life[i] = lifeSec;
    this.maxLife[i] = lifeSec;
    this.grav[i] = gravity;
  }

  /** 放射バースト */
  burst(center, count, { color, spread = 6, size = 1.4, life = 0.8, up = 2, gravity = 6, hueSpread = 0 }) {
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let k = 0; k < count; k++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * 0.9 + 0.1, (Math.random() - 0.5) * 2)
        .normalize().multiplyScalar(spread * (0.4 + Math.random() * 0.6));
      v.y += up;
      if (hueSpread > 0) {
        c.copy(hsl(Math.random(), 0.85, 0.65));
      } else {
        c.copy(color);
      }
      this.emit(center, v, c, size * (0.6 + Math.random() * 0.8), life * (0.7 + Math.random() * 0.6), gravity);
    }
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    // フェード値 = 残り寿命割合
    const fade = this.geo.attributes.aFade.array;
    for (let i = 0; i < this.max; i++) {
      fade[i] = this.maxLife[i] > 0 ? this.life[i] / this.maxLife[i] : 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aFade.needsUpdate = true;
  }
}

/* ============================================================
   虹のリボントレイル
   ============================================================ */
export class RainbowTrail {
  constructor(scene, maxPoints = 42) {
    this.max = maxPoints;
    this.centers = [];   // {p: Vector3, r: Vector3 (右方向), w: 幅}
    const verts = maxPoints * 2;
    this.positions = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.geo = geo;
    this.hueBase = 0;
    this._acc = 0;
  }

  /** 毎フレーム: 現在位置とコース右方向・強さ(0..1)を渡す */
  update(dt, pos, right, intensity) {
    this._acc += dt;
    const STEP = 1 / 45;
    if (this._acc >= STEP) {
      this._acc %= STEP;
      this.centers.unshift({ p: pos.clone(), r: right.clone(), i: intensity });
      if (this.centers.length > this.max) this.centers.pop();
    }
    this.hueBase += dt * 0.35;

    const n = this.centers.length;
    const P = this.positions, C = this.colors;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.max; i++) {
      const c = this.centers[Math.min(i, n - 1)];
      if (!c) break;
      const t = i / (this.max - 1);
      const w = (1.1 + c.i * 1.5) * (1 - t * 0.85);
      for (const [k, sgn] of [[0, -1], [1, 1]]) {
        const vi = (i * 2 + k) * 3;
        tmp.copy(c.p).addScaledVector(c.r, sgn * w);
        P[vi] = tmp.x; P[vi + 1] = tmp.y; P[vi + 2] = tmp.z;
        const col = hsl(this.hueBase + t * 0.9, 0.85, 0.62);
        const ci = (i * 2 + k) * 4;
        C[ci] = col.r; C[ci + 1] = col.g; C[ci + 2] = col.b;
        C[ci + 3] = (1 - t) * (0.03 + c.i * 0.42);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (Math.min(n, this.max) - 1) * 6));
  }
}

/* ============================================================
   2D オーバーレイ (スピードライン / タッチリップル / ビネット)
   ============================================================ */
export class Overlay2D {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.ripples = [];   // {x,y,t}
    this.lines = [];     // スピードライン {a(角度), r0, len, w, life, maxLife}
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
  }

  addRipple(x, y) {
    this.ripples.push({ x: x * this.dpr, y: y * this.dpr, t: 0 });
  }

  update(dt, speedFactor) {
    const { ctx, cv } = this;
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    /* --- スピードライン (中心から放射) --- */
    if (speedFactor > 0.25) {
      const want = Math.floor(speedFactor * 14);
      while (this.lines.length < want) {
        this.lines.push({
          a: Math.random() * Math.PI * 2,
          r0: 0.25 + Math.random() * 0.2,
          len: 0.1 + Math.random() * 0.25,
          w: 1 + Math.random() * 2.5,
          life: 0, maxLife: 0.2 + Math.random() * 0.25,
        });
      }
    }
    const cx = w / 2, cy = h * 0.46;
    const R = Math.hypot(w, h) * 0.5;
    ctx.lineCap = 'round';
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const L = this.lines[i];
      L.life += dt;
      if (L.life > L.maxLife) { this.lines.splice(i, 1); continue; }
      const k = L.life / L.maxLife;
      const r0 = (L.r0 + k * 0.55) * R;
      const r1 = r0 + L.len * R * (1 - k * 0.4);
      const alpha = Math.sin(k * Math.PI) * 0.5 * Math.min(1, speedFactor);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = L.w * this.dpr;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(L.a) * r0, cy + Math.sin(L.a) * r0);
      ctx.lineTo(cx + Math.cos(L.a) * r1, cy + Math.sin(L.a) * r1);
      ctx.stroke();
    }

    /* --- タッチリップル --- */
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.t += dt;
      const k = rp.t / 0.5;
      if (k >= 1) { this.ripples.splice(i, 1); continue; }
      const rr = (10 + k * 46) * this.dpr;
      ctx.strokeStyle = `rgba(255,255,255,${(0.7 * (1 - k)).toFixed(3)})`;
      ctx.lineWidth = 3 * this.dpr * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rr, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* --- やわらかいビネット --- */
    const vg = ctx.createRadialGradient(cx, h * 0.5, R * 0.55, cx, h * 0.5, R * 1.05);
    vg.addColorStop(0, 'rgba(90,60,120,0)');
    vg.addColorStop(1, 'rgba(90,60,120,0.16)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }
}
