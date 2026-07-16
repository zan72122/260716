// ミニゲーム「フルーツ キャッチ」:かごを左右にうごかして くだものをキャッチ。

import { MiniGameBase, THREE, toonMat } from './base.js';
import { audio } from '../audio.js';

const FRUITS = [
  { color: 0xff4d5e, name: 'apple' },   // りんご
  { color: 0xffa53c, name: 'orange' },  // みかん
  { color: 0xffb7d0, name: 'peach' },   // もも
  { color: 0xb06ce0, name: 'grape' },   // ぶどう
];

export class FruitsGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.52, 0.48, 0.44, 0.5];
    this.buildSkyAndLight({ ground: 0x8fdf6a });
    this.addClouds(5, 8, 18);

    this.camera.position.set(0, 5.2, 11);
    this.camera.lookAt(0, 2.6, 0);

    // 大きな木(実がなる)
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 5, 10), toonMat(0x9c6b3f));
    trunk.position.set(0, 2.5, -6);
    trunk.castShadow = true;
    this.scene.add(trunk);
    [[0, 7, -6, 3.4], [-2.6, 6, -6, 2.2], [2.6, 6, -6, 2.2], [0, 8.4, -6, 2.0]].forEach(([x, y, z, r]) => {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), toonMat(0x51b84a));
      blob.position.set(x, y, z);
      blob.castShadow = true;
      this.scene.add(blob);
    });

    // プレイヤーキャラを借りてきて、かごを持たせる
    this.player = ctx.chars[ctx.playerIndex];
    this.scene.add(this.player.root);
    this.player.root.position.set(0, 0, 2.5);
    this.player.root.rotation.set(0, 0, 0);
    this.player.targetYaw = 0; // カメラのほうを向く(キャラの正面は +z)
    this.player.setMode('idle');

    this.basket = new THREE.Group();
    const basketMat = toonMat(0xc08a4a);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.65, 0.7, 14, 1, true),
      basketMat,
    );
    wall.material = basketMat;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.66, 14), toonMat(0x9c6b3f));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -0.32;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 8, 18), toonMat(0xa9743c));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.35;
    this.basket.add(wall, bottom, rim);
    this.basket.position.set(0, 1.15, 3.6);
    this.scene.add(this.basket);

    this.targetX = 0;
    this.fruits = [];
    this.spawnT = 0.4;
    this.fieldW = 4.5; // 画面に入る横はば(fitCamera で更新)
  }

  _spawnFruit() {
    const def = FRUITS[Math.floor(Math.random() * FRUITS.length)];
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), toonMat(def.color));
    body.castShadow = true;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), toonMat(0x51b84a));
    leaf.scale.set(1.4, 0.5, 0.8);
    leaf.position.y = 0.45;
    g.add(body, leaf);
    g.position.set((Math.random() - 0.5) * 2 * this.fieldW, 7.5 + Math.random() * 1.5, 3.6);
    g.userData = { speed: 2.6 + Math.random() * 1.6, spin: (Math.random() - 0.5) * 4 };
    this.scene.add(g);
    this.fruits.push(g);
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);

    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.fruits.length < 6) {
      this._spawnFruit();
      this.spawnT = 0.55 + Math.random() * 0.4;
    }

    // かご(とキャラ)はゆびの位置へするする移動
    const k = Math.min(1, dt * 9);
    this.basket.position.x += (this.targetX - this.basket.position.x) * k;
    this.player.root.position.x = this.basket.position.x;

    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const f = this.fruits[i];
      f.position.y -= f.userData.speed * dt;
      f.rotation.z += f.userData.spin * dt;

      // キャッチ判定
      if (f.position.y < 1.7 && f.position.y > 0.8 &&
          Math.abs(f.position.x - this.basket.position.x) < 1.0) {
        this.scene.remove(f);
        this.fruits.splice(i, 1);
        audio.coin(0);
        this.fx.sparkleBurst(this.basket.position, 8, 0xfff6a8, 1.2);
        this.addPlayerPoint(1);
        this.player.land();
        continue;
      }
      // 地面にぽとん
      if (f.position.y < 0.3) {
        this.fx.dustPuff(f.position, 2);
        this.scene.remove(f);
        this.fruits.splice(i, 1);
      }
    }
  }

  _pointerToX(ndc) {
    // ゆびのX(-1..1)をフィールド幅へマッピング
    return THREE.MathUtils.clamp(ndc.x, -1, 1) * (this.fieldW + 0.4);
  }

  pointerDown(ndc) { this.targetX = this._pointerToX(ndc); }
  pointerMove(ndc) { this.targetX = this._pointerToX(ndc); }

  fitCamera(aspect) {
    const z = aspect < 1 ? 14.5 : 11;
    this.camera.position.z = z;
    this.camera.lookAt(0, 2.6, 0);
    // くだものが落ちる面(z=3.6)で画面に収まる横はば
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (z - 3.6) * aspect;
    this.fieldW = THREE.MathUtils.clamp(halfW * 0.8, 2.0, 5.0);
  }
}
