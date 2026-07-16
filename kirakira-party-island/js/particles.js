// お祝いパーティクル:紙ふぶき・キラキラ・コイン・土ぼこり。
// シーンごとに1つ生成して update(dt) を呼ぶ。

import * as THREE from '../vendor/three.module.min.js';
import { sparkleTexture, glowTexture, toonMat } from './gfx.js';

const CONFETTI_COLORS = [0xff5c8d, 0xffc93e, 0x43c04e, 0x4da3ff, 0xb06ce0, 0xff9d3c];

export class ParticleFX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];

    // 紙ふぶき用インスタンスメッシュ
    this.confettiCount = 260;
    const geo = new THREE.PlaneGeometry(0.16, 0.24);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: false });
    this.confetti = new THREE.InstancedMesh(geo, mat, this.confettiCount);
    this.confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.confetti.frustumCulled = false;
    const colorArr = [];
    for (let i = 0; i < this.confettiCount; i++) {
      const c = new THREE.Color(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      this.confetti.setColorAt(i, c);
      colorArr.push(c);
    }
    this.confettiData = new Array(this.confettiCount).fill(null).map(() => ({
      alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      rot: new THREE.Euler(), rotVel: new THREE.Vector3(), life: 0,
    }));
    this._dummy = new THREE.Object3D();
    this._hideAll();
    scene.add(this.confetti);

    // スプライトプール(キラキラ)
    this.sprites = [];
    for (let i = 0; i < 60; i++) {
      const mat = new THREE.SpriteMaterial({
        map: sparkleTexture(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, color: 0xffffff,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.userData = { alive: false, vel: new THREE.Vector3(), life: 0, maxLife: 1, baseScale: 1 };
      scene.add(sp);
      this.sprites.push(sp);
    }

    // 土ぼこりプール
    this.puffs = [];
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.SpriteMaterial({
        map: glowTexture(), transparent: true, depthWrite: false, color: 0xfff3d8, opacity: 0.8,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.userData = { alive: false, vel: new THREE.Vector3(), life: 0, maxLife: 1 };
      scene.add(sp);
      this.puffs.push(sp);
    }

    // コイン(飛び出す小さな金貨)
    this.coins = [];
    const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(coinGeo, toonMat(0xffd23e));
      m.visible = false;
      m.userData = { alive: false, vel: new THREE.Vector3(), life: 0, spin: 0 };
      scene.add(m);
      this.coins.push(m);
    }
  }

  _hideAll() {
    this._dummy.position.set(0, -999, 0);
    this._dummy.updateMatrix();
    for (let i = 0; i < this.confettiCount; i++) {
      this.confetti.setMatrixAt(i, this._dummy.matrix);
    }
    this.confetti.instanceMatrix.needsUpdate = true;
  }

  // 紙ふぶきを場所 pos から量 n だけ吹き上げる
  burstConfetti(pos, n = 60, spread = 3.5, up = 7) {
    let spawned = 0;
    for (let i = 0; i < this.confettiCount && spawned < n; i++) {
      const d = this.confettiData[i];
      if (d.alive) continue;
      d.alive = true;
      d.life = 2.2 + Math.random() * 1.2;
      d.pos.copy(pos);
      d.vel.set(
        (Math.random() - 0.5) * spread,
        up * (0.55 + Math.random() * 0.7),
        (Math.random() - 0.5) * spread,
      );
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.rotVel.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9);
      spawned++;
    }
  }

  // 空から降らせる(結果発表用)
  rainConfetti(center, radius = 10, n = 90, height = 14) {
    let spawned = 0;
    for (let i = 0; i < this.confettiCount && spawned < n; i++) {
      const d = this.confettiData[i];
      if (d.alive) continue;
      d.alive = true;
      d.life = 4 + Math.random() * 2;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      d.pos.set(center.x + Math.cos(a) * r, center.y + height + Math.random() * 4, center.z + Math.sin(a) * r);
      d.vel.set((Math.random() - 0.5) * 1.2, -1.2 - Math.random(), (Math.random() - 0.5) * 1.2);
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.rotVel.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
      spawned++;
    }
  }

  sparkleBurst(pos, n = 8, color = 0xfff6a8, scale = 1) {
    let spawned = 0;
    for (const sp of this.sprites) {
      if (spawned >= n) break;
      if (sp.userData.alive) continue;
      sp.userData.alive = true;
      sp.userData.life = 0;
      sp.userData.maxLife = 0.5 + Math.random() * 0.4;
      sp.userData.baseScale = (0.4 + Math.random() * 0.5) * scale;
      sp.userData.vel.set(
        (Math.random() - 0.5) * 3.4,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 3.4,
      );
      sp.position.copy(pos);
      sp.material.color.set(color);
      sp.material.opacity = 1;
      sp.visible = true;
      spawned++;
    }
  }

  dustPuff(pos, n = 4) {
    let spawned = 0;
    for (const sp of this.puffs) {
      if (spawned >= n) break;
      if (sp.userData.alive) continue;
      sp.userData.alive = true;
      sp.userData.life = 0;
      sp.userData.maxLife = 0.45 + Math.random() * 0.2;
      sp.userData.vel.set((Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 2);
      sp.position.copy(pos).add(new THREE.Vector3(0, 0.1, 0));
      sp.scale.setScalar(0.3);
      sp.material.opacity = 0.75;
      sp.visible = true;
      spawned++;
    }
  }

  coinBurst(pos, n = 5) {
    let spawned = 0;
    for (const c of this.coins) {
      if (spawned >= n) break;
      if (c.userData.alive) continue;
      c.userData.alive = true;
      c.userData.life = 0.9 + Math.random() * 0.3;
      c.userData.vel.set((Math.random() - 0.5) * 3, 5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      c.userData.spin = (Math.random() - 0.5) * 16;
      c.position.copy(pos);
      c.visible = true;
      spawned++;
    }
  }

  update(dt) {
    // 紙ふぶき
    let dirty = false;
    for (let i = 0; i < this.confettiCount; i++) {
      const d = this.confettiData[i];
      if (!d.alive) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.alive = false;
        this._dummy.position.set(0, -999, 0);
        this._dummy.rotation.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.confetti.setMatrixAt(i, this._dummy.matrix);
        dirty = true;
        continue;
      }
      d.vel.y -= 9 * dt;
      d.vel.multiplyScalar(1 - 1.4 * dt); // 空気抵抗でひらひら
      d.pos.addScaledVector(d.vel, dt);
      d.rot.x += d.rotVel.x * dt;
      d.rot.y += d.rotVel.y * dt;
      d.rot.z += d.rotVel.z * dt;
      this._dummy.position.copy(d.pos);
      this._dummy.rotation.copy(d.rot);
      this._dummy.updateMatrix();
      this.confetti.setMatrixAt(i, this._dummy.matrix);
      dirty = true;
    }
    if (dirty) this.confetti.instanceMatrix.needsUpdate = true;

    // キラキラ
    for (const sp of this.sprites) {
      if (!sp.userData.alive) continue;
      const u = sp.userData;
      u.life += dt;
      if (u.life >= u.maxLife) { u.alive = false; sp.visible = false; continue; }
      const t = u.life / u.maxLife;
      sp.position.addScaledVector(u.vel, dt);
      u.vel.y -= 3 * dt;
      sp.scale.setScalar(u.baseScale * (1 - t * 0.6));
      sp.material.opacity = 1 - t;
    }

    // 土ぼこり
    for (const sp of this.puffs) {
      if (!sp.userData.alive) continue;
      const u = sp.userData;
      u.life += dt;
      if (u.life >= u.maxLife) { u.alive = false; sp.visible = false; continue; }
      const t = u.life / u.maxLife;
      sp.position.addScaledVector(u.vel, dt);
      sp.scale.setScalar(0.3 + t * 0.9);
      sp.material.opacity = 0.75 * (1 - t);
    }

    // コイン
    for (const c of this.coins) {
      if (!c.userData.alive) continue;
      const u = c.userData;
      u.life -= dt;
      if (u.life <= 0) { u.alive = false; c.visible = false; continue; }
      u.vel.y -= 14 * dt;
      c.position.addScaledVector(u.vel, dt);
      c.rotation.z += u.spin * dt;
      c.rotation.x += u.spin * 0.6 * dt;
    }
  }
}
