// ミニゲーム「ケーキ つみつみ」:うごくクレーンから タップで スポンジをおとして つみあげる。

import { MiniGameBase, THREE, toonMat, toonMatUnique } from './base.js';
import { audio } from '../audio.js';

const LAYER_COLORS = [0xfff0c8, 0xffb7d0, 0x9c6b3f, 0xfff6a8, 0xc19bff];
const LAYER_H = 0.5;
const LAYER_R = 1.05;

export class CakeGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.42, 0.38, 0.35, 0.4];
    this.buildSkyAndLight({ ground: 0x8fdf6a });
    this.addClouds(6, 8, 20);

    // テーブルとおさら
    const table = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 0.5, 22), toonMat(0xd88a5c));
    table.position.y = 0.25;
    table.receiveShadow = true;
    this.scene.add(table);
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.9, 0.14, 22), toonMat(0xffffff));
    plate.position.y = 0.57;
    plate.receiveShadow = true;
    this.scene.add(plate);

    // つみあがるケーキ
    this.stack = new THREE.Group();
    this.stack.position.set(0, 0.64, 0);
    this.scene.add(this.stack);
    this.layers = 0;
    this.wobble = 0;

    // クレーン(よこにうごく うで)
    this.crane = new THREE.Group();
    const rail = new THREE.Mesh(new THREE.BoxGeometry(9, 0.18, 0.18), toonMat(0xff8fb5));
    this.crane.add(rail);
    this.hand = new THREE.Group();
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), toonMat(0x8a8a8a));
    wire.position.y = -0.5;
    this.hand.add(wire);
    this.heldLayer = null;
    this.crane.add(this.hand);
    this.scene.add(this.crane);
    this._newHeldLayer();

    this.falling = null; // 落下中のスポンジ
    this.camera.position.set(0, 3.4, 9.5);
    this.camera.lookAt(0, 2.2, 0);
  }

  _stackTopY() {
    return 0.64 + this.layers * LAYER_H;
  }

  _newHeldLayer() {
    const color = LAYER_COLORS[this.layers % LAYER_COLORS.length];
    const layer = new THREE.Mesh(
      new THREE.CylinderGeometry(LAYER_R, LAYER_R * 1.04, LAYER_H * 0.92, 20),
      toonMat(color),
    );
    layer.castShadow = true;
    layer.position.y = -1.3;
    this.hand.add(layer);
    this.heldLayer = layer;
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);
    const t = this.time;

    // クレーンは ケーキのうえを いったりきたり
    const topY = this._stackTopY();
    this.crane.position.y = topY + 3.2;
    const speed = 1.1 + Math.min(1.2, this.layers * 0.08);
    this.hand.position.x = Math.sin(t * speed) * 3.2;

    // カメラは ケーキとともに のぼる
    const camY = 2.6 + Math.max(0, this.layers - 2) * LAYER_H;
    this.camera.position.y += (camY + 1.2 - this.camera.position.y) * Math.min(1, dt * 3);
    this.camera.lookAt(0, camY - 0.4, 0);

    // ぐらぐら(みためだけ・たおれない)
    this.wobble *= 1 - dt * 2.2;
    this.stack.rotation.z = Math.sin(t * 7) * this.wobble;

    // 落下中のスポンジ
    if (this.falling) {
      const f = this.falling;
      f.position.y -= dt * 9;
      if (f.position.y <= topY + LAYER_H / 2) {
        // ちゃくち!(はみ出しても だいじょうぶ、まんなかに近いと ボーナス)
        this.scene.remove(f);
        const off = THREE.MathUtils.clamp(f.position.x, -LAYER_R * 0.8, LAYER_R * 0.8);
        const layer = new THREE.Mesh(f.geometry, f.material);
        layer.castShadow = true;
        layer.position.set(off * 0.6, this.layers * LAYER_H + LAYER_H / 2, 0);
        this.stack.add(layer);
        this.layers++;
        this.wobble = 0.05 + Math.abs(off) * 0.05;
        this.falling = null;
        audio.boing();
        const centered = Math.abs(off) < 0.34;
        this.addPlayerPoint(centered ? 2 : 1);
        this.fx.sparkleBurst(
          new THREE.Vector3(layer.position.x, this._stackTopY(), 0),
          centered ? 10 : 4, centered ? 0xffe066 : 0xffffff, 1.2,
        );
        if (centered) audio.sparkle();
        // 5だんごとに いちごをのせる
        if (this.layers % 5 === 0) {
          const berry = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), toonMatUnique(0xff4d5e, {
            emissive: 0xc02030, emissiveIntensity: 0.3,
          }));
          berry.position.set(0, this.layers * LAYER_H + 0.2, 0);
          this.stack.add(berry);
          audio.yay();
        }
        this._newHeldLayer();
      }
    }
  }

  pointerDown() {
    if (this.falling || !this.heldLayer) return;
    // クレーンから ぱっ!とはなす
    const world = new THREE.Vector3();
    this.heldLayer.getWorldPosition(world);
    this.hand.remove(this.heldLayer);
    this.heldLayer.position.copy(world);
    this.scene.add(this.heldLayer);
    this.falling = this.heldLayer;
    this.heldLayer = null;
    audio.tap();
  }

  fitCamera(aspect) {
    this.camera.position.z = aspect < 1 ? 12 : 9.5;
  }
}
