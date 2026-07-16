// ================================================================
// パーティクル — 紙吹雪・キラキラ・ヒットリング
// InstancedMesh をプールして毎フレームCPU更新(数百個なので軽い)
// ================================================================

import * as THREE from 'three';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

const CONFETTI_COLORS = [0xff5c8d, 0xffd94a, 0x7ce8c4, 0x7fd4ff, 0x8f7bff, 0xffffff, 0xffa94d];

class InstancePool {
  constructor(scene, geometry, material, count) {
    this.count = count;
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.items = [];
    for (let i = 0; i < count; i++) {
      this.items.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        rotVel: new THREE.Vector3(),
        life: 0, maxLife: 1, size: 1,
      });
      this.mesh.setMatrixAt(i, _m4.makeScale(0, 0, 0));
    }
    this.cursor = 0;
  }

  spawn() {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.count;
    it.alive = true;
    return { item: it, index: (this.cursor + this.count - 1) % this.count };
  }
}

export class Particles {
  constructor(scene) {
    this.scene = scene;

    // --- 紙吹雪(ひらひら落ちる長方形) ---
    const confGeo = new THREE.PlaneGeometry(0.09, 0.06);
    const confMat = new THREE.MeshToonMaterial({ side: THREE.DoubleSide });
    this.confetti = new InstancePool(scene, confGeo, confMat, 260);
    this.confetti.mesh.receiveShadow = false;
    const col = new THREE.Color();
    for (let i = 0; i < this.confetti.count; i++) {
      col.setHex(CONFETTI_COLORS[i % CONFETTI_COLORS.length]);
      this.confetti.mesh.setColorAt(i, col);
    }
    this.confetti.mesh.instanceColor.needsUpdate = true;

    // --- キラキラ(発光ダイヤ、上にふわっと) ---
    const sparkGeo = new THREE.OctahedronGeometry(0.06);
    const sparkMat = new THREE.MeshBasicMaterial({
      color: 0xfff2b0,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.sparks = new InstancePool(scene, sparkGeo, sparkMat, 160);

    // --- ヒットリング(広がって消える輪) ---
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(0.5, 0.035, 8, 40);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xffe066, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, maxLife: 0.5 });
    }
    this._ringCursor = 0;
  }

  /** 紙吹雪バースト */
  burstConfetti(origin, count = 40, power = 3.2) {
    for (let i = 0; i < count; i++) {
      const { item } = this.confetti.spawn();
      item.pos.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const up = 1.8 + Math.random() * power;
      item.vel.set(Math.cos(a) * (0.5 + Math.random() * 1.6), up, Math.sin(a) * (0.5 + Math.random() * 1.6));
      item.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      item.rotVel.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      item.maxLife = 1.6 + Math.random() * 0.9;
      item.life = item.maxLife;
      item.size = 0.8 + Math.random() * 0.9;
    }
  }

  /** キラキラバースト */
  burstSparks(origin, count = 14, power = 1.6) {
    for (let i = 0; i < count; i++) {
      const { item } = this.sparks.spawn();
      item.pos.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      item.vel.set(
        Math.cos(a) * Math.cos(b) * power * (0.4 + Math.random()),
        Math.sin(b) * power * (0.6 + Math.random()) + 0.8,
        Math.sin(a) * Math.cos(b) * power * (0.4 + Math.random())
      );
      item.rotVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, 0);
      item.maxLife = 0.55 + Math.random() * 0.4;
      item.life = item.maxLife;
      item.size = 0.7 + Math.random() * 1.1;
    }
  }

  /** ヒットリング(向き: 'y'=水平, 'z'=カメラ向き) */
  ring(origin, color = 0xffe066, axis = 'z', scale = 1) {
    const r = this.rings[this._ringCursor];
    this._ringCursor = (this._ringCursor + 1) % this.rings.length;
    r.mesh.position.copy(origin);
    r.mesh.material.color.setHex(color);
    r.mesh.rotation.set(axis === 'y' ? Math.PI / 2 : 0, 0, 0);
    r.mesh.visible = true;
    r.life = r.maxLife;
    r.baseScale = scale;
  }

  update(dt) {
    // confetti
    const cm = this.confetti.mesh;
    this.confetti.items.forEach((it, i) => {
      if (!it.alive) return;
      it.life -= dt;
      if (it.life <= 0) {
        it.alive = false;
        cm.setMatrixAt(i, _m4.makeScale(0, 0, 0));
        return;
      }
      it.vel.y -= 6.2 * dt;
      it.vel.multiplyScalar(Math.pow(0.35, dt)); // 空気抵抗
      // ひらひら
      it.pos.addScaledVector(it.vel, dt);
      it.pos.x += Math.sin(it.life * 9 + i) * 0.35 * dt;
      it.rot.x += it.rotVel.x * dt;
      it.rot.y += it.rotVel.y * dt;
      it.rot.z += it.rotVel.z * dt;
      const fade = Math.min(1, it.life / 0.4);
      _q.setFromEuler(it.rot);
      _s.setScalar(it.size * fade);
      cm.setMatrixAt(i, _m4.compose(it.pos, _q, _s));
    });
    cm.instanceMatrix.needsUpdate = true;

    // sparks
    const sm = this.sparks.mesh;
    this.sparks.items.forEach((it, i) => {
      if (!it.alive) return;
      it.life -= dt;
      if (it.life <= 0) {
        it.alive = false;
        sm.setMatrixAt(i, _m4.makeScale(0, 0, 0));
        return;
      }
      it.vel.y += 0.4 * dt; // ふわっと浮く
      it.pos.addScaledVector(it.vel, dt);
      it.rot.x += it.rotVel.x * dt;
      it.rot.y += it.rotVel.y * dt;
      const k = it.life / it.maxLife;
      _q.setFromEuler(it.rot);
      _s.setScalar(it.size * k);
      sm.setMatrixAt(i, _m4.compose(it.pos, _q, _s));
    });
    sm.instanceMatrix.needsUpdate = true;

    // rings
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      const k = 1 - r.life / r.maxLife;
      const s = (0.4 + k * 2.2) * (r.baseScale || 1);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - k) * 0.85;
    }
  }
}
