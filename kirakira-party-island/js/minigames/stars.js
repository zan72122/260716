// ミニゲーム「きらきら タッチ」:おやまから ぴょこっと でてくる ほしを タッチ!

import { MiniGameBase, THREE, toonMat, toonMatUnique } from './base.js';
import { starGeometry } from '../gfx.js';
import { audio } from '../audio.js';

export class StarsGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.5, 0.46, 0.42, 0.48];
    this.buildSkyAndLight({ ground: 0x8fdf6a });
    this.addClouds(5, 10, 20);

    this.camera.position.set(0, 9.5, 9);
    this.camera.lookAt(0, 0, -0.5);

    // 3x3 のおやま(モグラの穴がわり)
    this.mounds = [];
    for (let gz = -1; gz <= 1; gz++) {
      for (let gx = -1; gx <= 1; gx++) {
        const mound = new THREE.Mesh(
          new THREE.SphereGeometry(1.25, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          toonMat(0x6fc957),
        );
        mound.position.set(gx * 3.4, 0, gz * 3.1);
        mound.castShadow = true;
        mound.receiveShadow = true;
        this.scene.add(mound);
        const hole = new THREE.Mesh(
          new THREE.CircleGeometry(0.72, 16),
          new THREE.MeshBasicMaterial({ color: 0x3a5a2e }),
        );
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(gx * 3.4, 1.05, gz * 3.1);
        // 穴はおやまのてっぺんに
        this.scene.add(hole);
        this.mounds.push({ x: gx * 3.4, z: gz * 3.1, busy: false });
      }
    }

    // 出てくる星のプール
    this.stars = [];
    for (let i = 0; i < 4; i++) {
      const star = new THREE.Mesh(
        starGeometry(0.72, 0.34, 0.26),
        toonMatUnique(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.55 }),
      );
      star.castShadow = true;
      star.visible = false;
      star.userData = { state: 'hidden', t: 0, mound: null, up: 1.4 };
      this.scene.add(star);
      this.stars.push(star);
    }
    this.spawnT = 0.3;
  }

  _spawn() {
    const star = this.stars.find((s) => s.userData.state === 'hidden');
    const free = this.mounds.filter((m) => !m.busy);
    if (!star || !free.length) return;
    const mound = free[Math.floor(Math.random() * free.length)];
    mound.busy = true;
    star.userData.state = 'up';
    star.userData.t = 0;
    star.userData.mound = mound;
    star.position.set(mound.x, 0.6, mound.z);
    star.visible = true;
    audio.boing();
  }

  _hide(star) {
    star.userData.state = 'hidden';
    star.visible = false;
    if (star.userData.mound) star.userData.mound.busy = false;
    star.userData.mound = null;
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);

    this.spawnT -= dt;
    const active = this.stars.filter((s) => s.userData.state !== 'hidden').length;
    if (this.spawnT <= 0 && active < 2 + (this.time > 10 ? 1 : 0)) {
      this._spawn();
      this.spawnT = 0.55 + Math.random() * 0.5;
    }

    this.stars.forEach((star) => {
      const u = star.userData;
      if (u.state === 'hidden') return;
      u.t += dt;
      star.rotation.y += dt * 3;
      if (u.state === 'up') {
        const k = Math.min(1, u.t / 0.25);
        star.position.y = 0.6 + k * u.up;
        if (k >= 1) { u.state = 'stay'; u.t = 0; }
      } else if (u.state === 'stay') {
        star.position.y = 0.6 + u.up + Math.sin(u.t * 6) * 0.08;
        if (u.t > 1.5) { u.state = 'down'; u.t = 0; }
      } else if (u.state === 'down') {
        const k = Math.min(1, u.t / 0.3);
        star.position.y = 0.6 + u.up * (1 - k);
        if (k >= 1) this._hide(star);
      } else if (u.state === 'pop') {
        const k = Math.min(1, u.t / 0.18);
        star.scale.setScalar(1 + k * 0.8);
        star.material.opacity = 1 - k;
        if (k >= 1) {
          star.material.transparent = false;
          star.material.opacity = 1;
          star.scale.setScalar(1);
          this._hide(star);
        }
      }
    });
  }

  pointerDown(ndc, px) {
    const targets = this.stars.filter((s) => s.visible && s.userData.state !== 'pop');
    const hits = this.raycast(ndc, targets);
    if (!hits.length) return;
    let star = hits[0].object;
    while (star.parent && !this.stars.includes(star)) star = star.parent;
    const u = star.userData;
    if (!u || u.state === 'pop' || u.state === 'hidden') return;
    u.state = 'pop';
    u.t = 0;
    star.material.transparent = true;
    audio.sparkle();
    this.fx.sparkleBurst(star.position, 10, 0xffe066, 1.6);
    this.fx.burstConfetti(star.position, 10, 2, 2.5);
    this.addPlayerPoint(1);
    if (px) this.ctx.ui.emojiBurst(px.x, px.y, '⭐');
  }

  fitCamera(aspect) {
    // 縦画面ではぐっと引いて 3x3 ぜんぶ見えるように
    this.camera.position.set(0, aspect < 1 ? 15 : 9.5, aspect < 1 ? 13 : 9);
    this.camera.lookAt(0, 0, -0.5);
  }
}
