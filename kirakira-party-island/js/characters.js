// どうぶつフレンズのチビキャラ生成。
// すべて Three.js のプリミティブから組み立て、スカッシュ&ストレッチで生き生き動かす。

import * as THREE from '../vendor/three.module.min.js';
import { toonMat, addOutline, blobShadow } from './gfx.js';

const EYE_MAT = toonMat(0x2c2438);
const EYE_HI_MAT = new THREE.MeshBasicMaterial({ color: 0xffffff });
const BLUSH_MAT = new THREE.MeshBasicMaterial({ color: 0xff9db4, transparent: true, opacity: 0.75 });

function eye(x, y, z, s = 1) {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075 * s, 10, 10), EYE_MAT);
  const hi = new THREE.Mesh(new THREE.SphereGeometry(0.028 * s, 8, 8), EYE_HI_MAT);
  hi.position.set(0.025 * s, 0.03 * s, 0.055 * s);
  g.add(ball, hi);
  g.position.set(x, y, z);
  return g;
}

function blush(x, y, z) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.055, 10), BLUSH_MAT);
  m.position.set(x, y, z);
  return m;
}

function part(geo, mat, x = 0, y = 0, z = 0, outline = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  if (outline) addOutline(m);
  return m;
}

// ---- 各キャラの見た目 ----

function buildBunny(color) {
  const g = new THREE.Group();
  const main = toonMat(color);
  const cream = toonMat(0xfff6ee);
  const innerEar = toonMat(0xffd3e0);

  const body = part(new THREE.SphereGeometry(0.42, 20, 16), main, 0, 0.42, 0, true);
  body.scale.set(1, 1.02, 0.95);
  const belly = part(new THREE.SphereGeometry(0.3, 16, 12), cream, 0, 0.38, 0.17);
  belly.scale.set(0.82, 0.8, 0.55);
  const head = part(new THREE.SphereGeometry(0.36, 20, 16), main, 0, 1.0, 0.02, true);

  const earGeo = new THREE.CapsuleGeometry(0.09, 0.42, 6, 10);
  const earL = part(earGeo, main, -0.16, 1.48, 0, true);
  earL.rotation.z = 0.18;
  const earR = part(earGeo, main, 0.16, 1.48, 0, true);
  earR.rotation.z = -0.18;
  const inL = part(new THREE.CapsuleGeometry(0.045, 0.3, 4, 8), innerEar, -0.16, 1.48, 0.06);
  inL.rotation.z = 0.18;
  const inR = part(new THREE.CapsuleGeometry(0.045, 0.3, 4, 8), innerEar, 0.16, 1.48, 0.06);
  inR.rotation.z = -0.18;

  const eyes = new THREE.Group();
  eyes.add(eye(-0.14, 1.06, 0.3), eye(0.14, 1.06, 0.3));
  const nose = part(new THREE.SphereGeometry(0.045, 8, 8), toonMat(0xff7fa5), 0, 0.97, 0.35);
  const cheeks = new THREE.Group();
  cheeks.add(blush(-0.24, 0.95, 0.31), blush(0.24, 0.95, 0.31));

  const armGeo = new THREE.CapsuleGeometry(0.09, 0.16, 6, 8);
  const armL = part(armGeo, main, -0.4, 0.52, 0.1);
  armL.rotation.z = 0.9;
  const armR = part(armGeo, main, 0.4, 0.52, 0.1);
  armR.rotation.z = -0.9;

  const footGeo = new THREE.SphereGeometry(0.14, 10, 8);
  const footL = part(footGeo, main, -0.17, 0.09, 0.16);
  footL.scale.set(1, 0.6, 1.4);
  const footR = part(footGeo, main, 0.17, 0.09, 0.16);
  footR.scale.set(1, 0.6, 1.4);
  const tail = part(new THREE.SphereGeometry(0.12, 10, 8), cream, 0, 0.34, -0.4);

  g.add(body, belly, head, earL, earR, inL, inR, eyes, nose, cheeks, armL, armR, footL, footR, tail);
  return { group: g, eyes, head, arms: [armL, armR], ears: [earL, earR, inL, inR] };
}

function buildChick(color) {
  const g = new THREE.Group();
  const main = toonMat(color);
  const orange = toonMat(0xff9d3c);

  const body = part(new THREE.SphereGeometry(0.46, 20, 16), main, 0, 0.52, 0, true);
  body.scale.set(0.95, 1.12, 0.92);

  const beak = part(new THREE.ConeGeometry(0.09, 0.16, 8), orange, 0, 0.62, 0.45);
  beak.rotation.x = Math.PI / 2;

  const eyes = new THREE.Group();
  eyes.add(eye(-0.15, 0.74, 0.37), eye(0.15, 0.74, 0.37));
  const cheeks = new THREE.Group();
  cheeks.add(blush(-0.26, 0.6, 0.37), blush(0.26, 0.6, 0.37));

  // あたまの毛
  const tuft = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = part(new THREE.ConeGeometry(0.05, 0.2, 6), main, (i - 1) * 0.08, 1.06, 0);
    c.rotation.z = (i - 1) * -0.5;
    tuft.add(c);
  }

  const wingGeo = new THREE.SphereGeometry(0.18, 10, 8);
  const armL = part(wingGeo, main, -0.42, 0.55, 0);
  armL.scale.set(0.5, 1, 0.8);
  const armR = part(wingGeo, main, 0.42, 0.55, 0);
  armR.scale.set(0.5, 1, 0.8);

  const footGeo = new THREE.SphereGeometry(0.11, 8, 6);
  const footL = part(footGeo, orange, -0.15, 0.06, 0.1);
  footL.scale.set(1, 0.5, 1.5);
  const footR = part(footGeo, orange, 0.15, 0.06, 0.1);
  footR.scale.set(1, 0.5, 1.5);

  g.add(body, beak, eyes, cheeks, tuft, armL, armR, footL, footR);
  return { group: g, eyes, head: body, arms: [armL, armR], ears: [] };
}

function buildPenguin(color) {
  const g = new THREE.Group();
  const main = toonMat(color);
  const white = toonMat(0xffffff);
  const orange = toonMat(0xffab4a);

  const body = part(new THREE.SphereGeometry(0.46, 20, 16), main, 0, 0.5, 0, true);
  body.scale.set(0.92, 1.16, 0.9);
  const belly = part(new THREE.SphereGeometry(0.36, 16, 12), white, 0, 0.42, 0.14);
  belly.scale.set(0.78, 0.92, 0.5);

  const beak = part(new THREE.ConeGeometry(0.08, 0.18, 8), orange, 0, 0.72, 0.42);
  beak.rotation.x = Math.PI / 2;

  const eyes = new THREE.Group();
  eyes.add(eye(-0.14, 0.84, 0.34), eye(0.14, 0.84, 0.34));
  const cheeks = new THREE.Group();
  cheeks.add(blush(-0.25, 0.7, 0.36), blush(0.25, 0.7, 0.36));

  const wingGeo = new THREE.CapsuleGeometry(0.09, 0.3, 6, 8);
  const armL = part(wingGeo, main, -0.42, 0.5, 0);
  armL.rotation.z = 0.5;
  const armR = part(wingGeo, main, 0.42, 0.5, 0);
  armR.rotation.z = -0.5;

  const footGeo = new THREE.SphereGeometry(0.12, 8, 6);
  const footL = part(footGeo, orange, -0.16, 0.06, 0.12);
  footL.scale.set(1.1, 0.5, 1.5);
  const footR = part(footGeo, orange, 0.16, 0.06, 0.12);
  footR.scale.set(1.1, 0.5, 1.5);

  // ぼうし(ちょこんとした水色ニット帽)
  const hat = part(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), toonMat(0x9bdcff), 0, 0.94, 0);
  const pom = part(new THREE.SphereGeometry(0.07, 8, 8), white, 0, 1.12, 0);

  g.add(body, belly, beak, eyes, cheeks, armL, armR, footL, footR, hat, pom);
  return { group: g, eyes, head: body, arms: [armL, armR], ears: [] };
}

function buildFrog(color) {
  const g = new THREE.Group();
  const main = toonMat(color);
  const cream = toonMat(0xfff9d6);

  const body = part(new THREE.SphereGeometry(0.46, 20, 16), main, 0, 0.46, 0, true);
  body.scale.set(1.02, 0.98, 0.95);
  const belly = part(new THREE.SphereGeometry(0.34, 16, 12), cream, 0, 0.4, 0.16);
  belly.scale.set(0.8, 0.82, 0.5);

  // あたまの上の目
  const bumpGeo = new THREE.SphereGeometry(0.17, 12, 10);
  const bumpL = part(bumpGeo, main, -0.2, 0.92, 0.08, true);
  const bumpR = part(bumpGeo, main, 0.2, 0.92, 0.08, true);
  const eyes = new THREE.Group();
  eyes.add(eye(-0.2, 0.94, 0.2, 1.15), eye(0.2, 0.94, 0.2, 1.15));
  const cheeks = new THREE.Group();
  cheeks.add(blush(-0.3, 0.56, 0.35), blush(0.3, 0.56, 0.35));

  // にっこりお口
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.022, 6, 12, Math.PI),
    toonMat(0x2c2438),
  );
  mouth.position.set(0, 0.62, 0.42);
  mouth.rotation.z = Math.PI;

  const armGeo = new THREE.CapsuleGeometry(0.08, 0.18, 6, 8);
  const armL = part(armGeo, main, -0.42, 0.42, 0.1);
  armL.rotation.z = 0.8;
  const armR = part(armGeo, main, 0.42, 0.42, 0.1);
  armR.rotation.z = -0.8;

  const footGeo = new THREE.SphereGeometry(0.13, 8, 6);
  const footL = part(footGeo, main, -0.2, 0.07, 0.14);
  footL.scale.set(1.2, 0.55, 1.5);
  const footR = part(footGeo, main, 0.2, 0.07, 0.14);
  footR.scale.set(1.2, 0.55, 1.5);

  g.add(body, belly, bumpL, bumpR, eyes, cheeks, mouth, armL, armR, footL, footR);
  return { group: g, eyes, head: body, arms: [armL, armR], ears: [] };
}

const BUILDERS = {
  bunny: buildBunny,
  chick: buildChick,
  penguin: buildPenguin,
  frog: buildFrog,
};

// ---- キャラクター本体(アニメーション付き) ----

export class PartyCharacter {
  constructor(def) {
    this.def = def;
    this.root = new THREE.Group();      // 接地点(足元)
    this.inner = new THREE.Group();     // スカッシュ&ジャンプ用
    const built = BUILDERS[def.species](def.color);
    this.parts = built;
    // 腕のもとの角度(チア後に戻すため)
    this.armRest = built.arms.map((a) => a.rotation.z);
    this.inner.add(built.group);
    this.root.add(this.inner);

    this.shadow = blobShadow(0.62, 0.28);
    this.shadow.position.y = 0.03;
    this.root.add(this.shadow);

    // ゲーム状態
    this.coins = 0;
    this.stars = 0;
    this.tileIndex = 0;
    this.isPlayer = false;

    // アニメ状態
    this.mode = 'idle';   // idle | cheer | dance | hop(外部駆動)
    this.animT = Math.random() * 10;
    this.blinkTimer = 1 + Math.random() * 3;
    this.blinkPhase = 0;
    this.squash = 1;       // 1=通常。着地時に0.6ぐらいへ
    this.hopY = 0;
  }

  setMode(m) { this.mode = m; }

  // 着地のむにゅ
  land() { this.squash = 0.55; }

  // ホップ中の高さを外(ボード側)から与える
  setHopHeight(y) { this.hopY = y; }

  faceTowards(target) {
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    if (Math.abs(dx) + Math.abs(dz) < 0.001) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  update(dt) {
    this.animT += dt;
    const t = this.animT;

    // まばたき
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkPhase = 0.14;
      this.blinkTimer = 1.6 + Math.random() * 3.2;
    }
    if (this.blinkPhase > 0) {
      this.blinkPhase -= dt;
      this.parts.eyes.scale.y = 0.12;
    } else {
      this.parts.eyes.scale.y = 1;
    }

    // スカッシュ回復
    this.squash += (1 - this.squash) * Math.min(1, dt * 10);

    let bobY = 0;
    let sq = this.squash;
    if (this.mode === 'idle') {
      bobY = Math.abs(Math.sin(t * 2.2)) * 0.045;
      sq *= 1 + Math.sin(t * 2.2 * 2) * 0.02;
      this.parts.arms[0].rotation.x = Math.sin(t * 2.2) * 0.12;
      this.parts.arms[1].rotation.x = -Math.sin(t * 2.2) * 0.12;
      // チアなどで上げた腕をゆっくり元へ
      const back = Math.min(1, dt * 8);
      this.parts.arms[0].rotation.z += (this.armRest[0] - this.parts.arms[0].rotation.z) * back;
      this.parts.arms[1].rotation.z += (this.armRest[1] - this.parts.arms[1].rotation.z) * back;
    } else if (this.mode === 'cheer') {
      bobY = Math.abs(Math.sin(t * 7)) * 0.3;
      this.parts.arms[0].rotation.z = 2.4 + Math.sin(t * 10) * 0.4;
      this.parts.arms[1].rotation.z = -2.4 - Math.sin(t * 10) * 0.4;
    } else if (this.mode === 'dance') {
      bobY = Math.abs(Math.sin(t * 5)) * 0.18;
      this.inner.rotation.y += dt * 3.2;
      this.parts.arms[0].rotation.z = 1.6 + Math.sin(t * 8) * 0.8;
      this.parts.arms[1].rotation.z = -1.6 - Math.sin(t * 8) * 0.8;
    } else if (this.mode === 'hop') {
      // ボードが hopY を駆動。うさぎの耳などは風になびく
      this.parts.arms[0].rotation.z = 1.8;
      this.parts.arms[1].rotation.z = -1.8;
    }
    if (this.mode !== 'dance') {
      // ゆっくり向きを合わせる
      if (this.targetYaw !== undefined) {
        let d = this.targetYaw - this.inner.rotation.y;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        this.inner.rotation.y += d * Math.min(1, dt * 10);
      }
    }

    // 耳ぴょこ(うさぎ)
    if (this.parts.ears.length) {
      const wob = (this.mode === 'hop' ? 0.35 : 0.08) * Math.sin(t * 9);
      this.parts.ears.forEach((e, i) => {
        e.rotation.x = wob * (i % 2 === 0 ? 1 : 0.8);
      });
    }

    this.inner.position.y = this.hopY + bobY;
    this.inner.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));

    // 影:高く飛ぶほど小さく薄く
    const h = this.inner.position.y;
    const shScale = Math.max(0.35, 1 - h * 0.35);
    this.shadow.scale.setScalar(shScale);
    this.shadow.material.opacity = 0.28 * shScale;
  }
}

export function createCharacter(def) {
  return new PartyCharacter(def);
}
