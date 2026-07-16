// ミニゲーム共通の土台:専用シーン・カメラ・空・地面・CPU得点シミュレーション。

import * as THREE from '../../vendor/three.module.min.js';
import { skyMaterial, toonMat, toonMatUnique, glowTexture } from '../gfx.js';
import { ParticleFX } from '../particles.js';

export class MiniGameBase {
  /**
   * ctx: { chars, playerIndex, ui }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.fx = new ParticleFX(this.scene);
    this.scores = [0, 0, 0, 0];
    this.done = false;        // true で早期終了
    this.time = 0;
    this._ray = new THREE.Raycaster();
    this._cpuAcc = [0, 0, 0, 0];
    this.cpuRates = [0.5, 0.45, 0.4, 0.5]; // 1秒あたりの期待得点(charIndexごと)
  }

  buildSkyAndLight({ ground = 0x7ed957, groundY = 0, fog = 0xa8d8ff } = {}) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 14), skyMaterial());
    this.scene.add(dome);
    this.scene.fog = new THREE.Fog(fog, 60, 170);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7fb56a, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.8);
    sun.position.set(10, 22, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -18;
    sun.shadow.camera.far = 70;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    this.sun = sun;

    if (ground !== null) {
      const g = new THREE.Mesh(
        new THREE.CircleGeometry(90, 48),
        toonMat(ground),
      );
      g.rotation.x = -Math.PI / 2;
      g.position.y = groundY;
      g.receiveShadow = true;
      this.scene.add(g);
    }
  }

  // ふわふわ雲を n 個そらに置く
  addClouds(n = 6, yMin = 10, yMax = 22) {
    for (let i = 0; i < n; i++) {
      const cloud = new THREE.Group();
      const m = 3 + Math.floor(Math.random() * 2);
      for (let k = 0; k < m; k++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(1.2 + Math.random() * 1.2, 10, 8),
          toonMat(0xffffff),
        );
        puff.position.set(k * 1.6 - m * 0.8, Math.random() * 0.5, 0);
        puff.scale.y = 0.6;
        cloud.add(puff);
      }
      cloud.position.set(
        (Math.random() - 0.5) * 60,
        yMin + Math.random() * (yMax - yMin),
        -20 - Math.random() * 30,
      );
      this.scene.add(cloud);
    }
  }

  raycast(ndc, objects) {
    this._ray.setFromCamera(ndc, this.camera);
    return this._ray.intersectObjects(objects, true);
  }

  // CPU の得点をランダムに刻む(体感で「みんなもがんばってる」感)
  tickCpu(dt) {
    for (let i = 0; i < 4; i++) {
      if (i === this.ctx.playerIndex) continue;
      this._cpuAcc[i] += this.cpuRates[i] * dt * (0.6 + Math.random() * 0.8);
      if (this._cpuAcc[i] >= 1) {
        this._cpuAcc[i] -= 1;
        this.scores[i] += 1;
      }
    }
  }

  addPlayerPoint(n = 1) {
    this.scores[this.ctx.playerIndex] += n;
    this.ctx.ui.setScore(this.scores[this.ctx.playerIndex]);
  }

  // ---- サブクラスが実装するもの ----
  update(dt) {}            // 毎フレーム
  pointerDown(ndc, px) {}  // タップ(ndc と ピクセル座標)
  pointerMove(ndc, px) {}
  fitCamera(aspect) {}     // 縦横で構図を調整
  onFinish() {}            // タイムアップ時

  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
  }
}

// 地面にぽわんと落ちる影スプライトを作る簡易ヘルパー
export function softShadow(scene, scale = 1) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0x1a2a44, transparent: true, opacity: 0.25, depthWrite: false,
  }));
  sp.scale.setScalar(scale);
  scene.add(sp);
  return sp;
}

export { THREE, toonMat, toonMatUnique };
