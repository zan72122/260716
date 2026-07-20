// fx.js — パーティクル・ブースト炎・紙吹雪・スピードライン等の演出
import * as THREE from 'three';

/* ============================================================
 *  汎用パーティクル（インスタンス板ポリ）
 * ============================================================ */
class ParticlePool {
  constructor(scene, count, { additive = false, round = true } = {}) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = round ? makeRoundTexture() : null;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.count = count;
    this.parts = new Array(count).fill(null).map(() => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      life: 0, maxLife: 1, size: 1, endSize: 0, gravity: 0,
      color: new THREE.Color(), spin: 0, rot: 0,
    }));
    this.cursor = 0;
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);
  }
  spawn(pos, vel, color, life, size, { gravity = 0, endSize = 0, spin = 0 } = {}) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    p.alive = true;
    p.pos.copy(pos); p.vel.copy(vel);
    p.color.set(color);
    p.life = 0; p.maxLife = life;
    p.size = size; p.endSize = endSize;
    p.gravity = gravity; p.spin = spin; p.rot = Math.random() * Math.PI;
  }
  update(dt, camera) {
    const d = this.dummy;
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (!p.alive) {
        d.scale.setScalar(0.00001);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        d.scale.setScalar(0.00001);
        d.updateMatrix();
        this.mesh.setMatrixAt(i, d.matrix);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
      const k = p.life / p.maxLife;
      const s = p.size + (p.endSize - p.size) * k;
      d.position.copy(p.pos);
      d.quaternion.copy(camera.quaternion);
      d.rotateZ(p.rot);
      d.scale.setScalar(Math.max(s * (1 - k * 0.35), 0.0001));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

let _roundTex = null;
function makeRoundTexture() {
  if (_roundTex) return _roundTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _roundTex = new THREE.CanvasTexture(cv);
  return _roundTex;
}

/* ============================================================
 *  紙吹雪（ゴール用・回転する色紙）
 * ============================================================ */
class Confetti {
  constructor(scene, count = 320) {
    const geo = new THREE.PlaneGeometry(0.32, 0.5);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.count = count;
    this.parts = [];
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);
    this.colors = ['#ff5a5a', '#ffd23d', '#5ad66f', '#4db9ff', '#c46bff', '#ff9f3d', '#ff8ab5', '#63e0d8']
      .map(c => new THREE.Color(c));
  }
  burst(center) {
    this.mesh.visible = true;
    this.parts = [];
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 22;
      this.parts.push({
        pos: new THREE.Vector3(
          center.x + Math.cos(a) * r,
          center.y + 9 + Math.random() * 14,
          center.z + Math.sin(a) * r),
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, -(1.2 + Math.random() * 2.2), (Math.random() - 0.5) * 2),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3(Math.random() * 5 + 2, Math.random() * 5, Math.random() * 4),
        sway: Math.random() * 6,
      });
      this.mesh.setColorAt(i, this.colors[i % this.colors.length]);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.t = 0;
  }
  stop() { this.mesh.visible = false; this.parts = []; }
  update(dt, t) {
    if (!this.mesh.visible || !this.parts.length) return;
    const d = this.dummy;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += Math.sin(t * 2 + p.sway) * dt * 1.6;
      if (p.pos.y < 0.2) { p.pos.y = 14 + Math.random() * 8; }
      p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
      d.position.copy(p.pos);
      d.rotation.copy(p.rot);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ============================================================
 *  ブーストの炎（マフラーに付くコーン）
 * ============================================================ */
export function makeBoostFlames(kart) {
  const flames = [];
  const u = kart.userData;
  for (const pipe of u.exhausts) {
    const g = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 1.5, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8420, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    outer.rotation.x = -Math.PI / 2 - 0.3;
    const inner = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 1.0, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe86b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    inner.rotation.x = -Math.PI / 2 - 0.3;
    inner.position.z = -0.15;
    g.add(outer, inner);
    g.position.copy(pipe.position);
    g.position.z -= 0.55;
    g.position.y -= 0.12;
    g.visible = false;
    u.chassis.add(g);
    flames.push(g);
  }
  return flames;
}

/* ============================================================
 *  スピードライン（画面端の集中線オーバーレイ）
 * ============================================================ */
class SpeedLines {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmp: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime, uAmp;
        varying vec2 vUv;
        float hash(float n){ return fract(sin(n) * 43758.5453); }
        void main(){
          if (uAmp < 0.01) discard;
          vec2 p = vUv - 0.5;
          float ang = atan(p.y, p.x);
          float r = length(p);
          float n = hash(floor(ang * 26.0)) ;
          float line = step(0.82, fract(ang * 4.15 + uTime * (2.0 + n * 6.0) * sign(n - 0.5)));
          float mask = smoothstep(0.32, 0.62, r);
          float a = line * mask * uAmp * 0.5;
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }
  render(renderer, t, amp) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uAmp.value += (amp - this.mat.uniforms.uAmp.value) * 0.1;
    if (this.mat.uniforms.uAmp.value < 0.01) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}

/* ============================================================
 *  FX マネージャ
 * ============================================================ */
export class FX {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticlePool(scene, 240, { additive: true });
    this.soft = new ParticlePool(scene, 200, { additive: false });
    this.confetti = new Confetti(scene);
    this.speedLines = new SpeedLines();
    this._v = new THREE.Vector3();
  }

  /* ドリフト火花（後輪の位置から） */
  driftSparks(kart, steer, speedRatio) {
    if (Math.abs(steer) < 0.55 || speedRatio < 0.5) return;
    if (Math.random() > 0.55) return;
    const u = kart.userData;
    for (const w of u.wheels) {
      if (w.front) continue;
      this._v.copy(w.g.position);
      kart.localToWorld(this._v);
      this._v.y = kart.position.y + 0.15;
      const col = Math.random() < 0.5 ? '#ffe86b' : (Math.random() < 0.5 ? '#ff9f3d' : '#7ad7ff');
      this.sparks.spawn(this._v,
        new THREE.Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3),
        col, 0.35 + Math.random() * 0.2, 0.28, { gravity: 9, endSize: 0.05 });
    }
  }

  /* 土けむり（オフロード時） */
  dust(kart, speedRatio) {
    if (speedRatio < 0.15 || Math.random() > 0.5) return;
    this._v.copy(kart.position);
    this._v.y += 0.3;
    this._v.x += (Math.random() - 0.5) * 1.6;
    this._v.z += (Math.random() - 0.5) * 1.6;
    this.soft.spawn(this._v,
      new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5),
      '#cbb98f', 0.7, 0.7, { endSize: 2.2 });
  }

  /* コイン取得キラキラ */
  coinBurst(pos) {
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.sparks.spawn(pos,
        new THREE.Vector3(Math.cos(a) * 4, 3 + Math.random() * 2, Math.sin(a) * 4),
        i % 2 ? '#ffd23d' : '#fff6c0', 0.45, 0.42, { gravity: 10, endSize: 0.06 });
    }
  }

  /* アイテムボックス破壊 */
  boxBurst(pos) {
    const cols = ['#ff5a5a', '#ffd23d', '#5ad66f', '#4db9ff', '#c46bff'];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.sparks.spawn(pos,
        new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 4), 4 + Math.random() * 3, Math.sin(a) * (3 + Math.random() * 4)),
        cols[i % cols.length], 0.6, 0.5, { gravity: 9, endSize: 0.08, spin: 5 });
    }
  }

  /* ブースト後方の粒 */
  boostTrail(kart) {
    if (Math.random() > 0.75) return;
    this._v.copy(kart.position);
    this._v.y += 0.5;
    this.sparks.spawn(this._v,
      new THREE.Vector3((Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2),
      Math.random() < 0.5 ? '#ffb35c' : '#ffe86b', 0.4, 0.55, { endSize: 0.1 });
  }

  /* スター中の虹の星屑 */
  starTrail(kart, t) {
    if (Math.random() > 0.6) return;
    this._v.copy(kart.position);
    this._v.y += 0.8 + Math.random() * 0.8;
    this._v.x += (Math.random() - 0.5) * 2;
    this._v.z += (Math.random() - 0.5) * 2;
    const c = new THREE.Color().setHSL((t * 2 + Math.random()) % 1, 0.9, 0.65);
    this.sparks.spawn(this._v,
      new THREE.Vector3((Math.random() - 0.5) * 2, 2.2, (Math.random() - 0.5) * 2),
      c, 0.55, 0.45, { gravity: 2, endSize: 0.08, spin: 4 });
  }

  update(dt, t, camera) {
    this.sparks.update(dt, camera);
    this.soft.update(dt, camera);
    this.confetti.update(dt, t);
  }
}
