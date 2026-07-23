// ミニゲーム「トロッコ コースター」:みぎ・ひだりをタップして レーンをえらび、ほしをあつめる。

import { MiniGameBase, THREE, toonMat, toonMatUnique } from './base.js';
import { starGeometry } from '../gfx.js';
import { audio } from '../audio.js';

const LANE_X = [-1.7, 1.7];
const SPEED = 7;

export class CartGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.5, 0.46, 0.42, 0.48];
    this.buildSkyAndLight({ ground: 0xc9a06a, fog: 0xe8c8a0 });
    this.addClouds(4, 12, 22);

    // トロッコ
    this.cart = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.7), toonMat(0x9c6b3f));
    box.castShadow = true;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1.8), toonMat(0xd35454));
    trim.position.y = 0.45;
    const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.15, 10);
    [[-0.75, 0.55], [0.75, 0.55], [-0.75, -0.55], [0.75, -0.55]].forEach(([x, z]) => {
      const w = new THREE.Mesh(wheelGeo, toonMat(0x4a4a58));
      w.rotation.z = Math.PI / 2;
      w.position.set(x, -0.42, z);
      this.cart.add(w);
    });
    this.cart.add(box, trim);
    this.cart.position.set(LANE_X[0], 0.7, 0);
    this.scene.add(this.cart);
    this.lane = 0;
    this.cartZ = 0;

    // レール(2レーンぶんの みため。うごきにあわせて リサイクル)
    this.railSegs = [];
    const railMat = toonMat(0x8a7a6e);
    const tieMat = toonMat(0x6b5a48);
    for (let i = 0; i < 26; i++) {
      const seg = new THREE.Group();
      LANE_X.forEach((lx) => {
        [-0.5, 0.5].forEach((off) => {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 4), railMat);
          rail.position.set(lx + off, 0.06, 0);
          seg.add(rail);
        });
        const tie = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.3), tieMat);
        tie.position.set(lx, 0.03, 0);
        seg.add(tie);
      });
      seg.position.z = i * 4;
      this.scene.add(seg);
      this.railSegs.push(seg);
    }

    // キャニオンのかべ
    this.walls = [];
    for (let i = 0; i < 14; i++) {
      [-1, 1].forEach((side) => {
        const h = 2 + Math.random() * 3;
        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, h, 7.6),
          toonMat(side < 0 ? 0xb8895c : 0xa87d54),
        );
        wall.position.set(side * 6.2, h / 2, i * 8);
        wall.castShadow = true;
        this.scene.add(wall);
        this.walls.push(wall);
      });
    }

    // ほし
    this.starPool = [];
    for (let i = 0; i < 14; i++) {
      const star = new THREE.Mesh(
        starGeometry(0.5, 0.24, 0.18),
        toonMatUnique(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.5 }),
      );
      star.visible = false;
      star.userData = { active: false, golden: false };
      this.scene.add(star);
      this.starPool.push(star);
    }
    this.nextSpawnZ = 10;
  }

  _spawnStarRow() {
    // かたほうに 2こ、もうかたほうに きんの1こ …などランダム
    const lane = Math.floor(Math.random() * 2);
    const golden = Math.random() < 0.3;
    const n = golden ? 1 : 2;
    for (let i = 0; i < n; i++) {
      const star = this.starPool.find((s) => !s.userData.active);
      if (!star) return;
      star.userData.active = true;
      star.userData.golden = golden;
      star.material.emissive.set(golden ? 0xff8a00 : 0xffb300);
      star.scale.setScalar(golden ? 1.35 : 1);
      star.position.set(LANE_X[lane], 1.1, this.nextSpawnZ + i * 1.6);
      star.visible = true;
    }
    // はんたいレーンにも ときどき 1こ
    if (Math.random() < 0.55) {
      const star = this.starPool.find((s) => !s.userData.active);
      if (star) {
        star.userData.active = true;
        star.userData.golden = false;
        star.material.emissive.set(0xffb300);
        star.scale.setScalar(1);
        star.position.set(LANE_X[1 - lane], 1.1, this.nextSpawnZ + 0.8);
        star.visible = true;
      }
    }
    this.nextSpawnZ += 6 + Math.random() * 4;
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);
    const t = this.time;

    // トロッコぜんしん
    this.cartZ += SPEED * dt;
    this.cart.position.z = this.cartZ;
    this.cart.position.x += (LANE_X[this.lane] - this.cart.position.x) * Math.min(1, dt * 8);
    this.cart.position.y = 0.7 + Math.abs(Math.sin(t * 9)) * 0.05;
    this.cart.rotation.z = (LANE_X[this.lane] - this.cart.position.x) * -0.08;

    // ほしをわく
    while (this.nextSpawnZ < this.cartZ + 40) this._spawnStarRow();

    // ほしの回転と キャッチはんてい
    this.starPool.forEach((star) => {
      if (!star.userData.active) return;
      star.rotation.y += dt * 3;
      if (star.position.z < this.cartZ - 3) {
        star.userData.active = false;
        star.visible = false;
        return;
      }
      if (Math.abs(star.position.z - this.cartZ) < 1.0 &&
          Math.abs(star.position.x - this.cart.position.x) < 1.1) {
        star.userData.active = false;
        star.visible = false;
        audio.sparkle();
        this.fx.sparkleBurst(star.position, star.userData.golden ? 12 : 6,
          star.userData.golden ? 0xffe066 : 0xfff6a8, 1.4);
        this.addPlayerPoint(star.userData.golden ? 2 : 1);
      }
    });

    // レールとかべを まえへ リサイクル
    this.railSegs.forEach((seg) => {
      if (seg.position.z < this.cartZ - 12) seg.position.z += this.railSegs.length * 4;
    });
    this.walls.forEach((wall) => {
      if (wall.position.z < this.cartZ - 14) wall.position.z += 14 * 8;
    });

    // カメラは トロッコのうしろ
    this.camera.position.set(0, 4.6, this.cartZ - 7.5);
    this.camera.lookAt(this.cart.position.x * 0.6, 1.2, this.cartZ + 6);
  }

  pointerDown(ndc) {
    // ひだり半分タップ→ひだりレーン、みぎ半分→みぎレーン
    this.lane = ndc.x < 0 ? 0 : 1;
    audio.tap();
  }

  fitCamera(aspect) {
    this.camera.fov = aspect < 1 ? 66 : 55;
    this.camera.updateProjectionMatrix();
  }
}
