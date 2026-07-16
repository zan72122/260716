// ================================================================
// キャラクター — うさぎ・ねこ・くま・ほしさん
// プリミティブの組み合わせ + トゥーン素材 + 黒フチ(インバーテッドハル)
// Critter クラスが「呼吸・まばたき・よろこび・おっとっと」を共通管理。
// ================================================================

import * as THREE from 'three';
import { toonMat, glowMat, outlineGroup } from '../core/toon.js';
import { COLORS } from '../config.js';

const INK = 0x2b2350;

/* 目・ほっぺなどの共有ジオメトリ */
const eyeGeo = new THREE.SphereGeometry(0.058, 10, 8);
const eyeHiGeo = new THREE.SphereGeometry(0.02, 6, 5);
const happyEyeGeo = new THREE.TorusGeometry(0.055, 0.02, 6, 10, Math.PI);
const cheekGeo = new THREE.CircleGeometry(0.062, 10);
const mouthGeo = new THREE.TorusGeometry(0.05, 0.016, 6, 10, Math.PI);

const eyeMat = new THREE.MeshBasicMaterial({ color: INK });
const eyeHiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const cheekMat = new THREE.MeshBasicMaterial({ color: 0xffa3bc, transparent: true, opacity: 0.85 });

/** 顔パーツ(開き目 / にこにこ目 / 口)を head に付ける */
function makeFace(head, { faceZ = 0.42, eyeX = 0.17, eyeY = 0.06, cheekY = -0.08, mouthY = -0.1 } = {}) {
  const face = new THREE.Group();

  const mkEye = (sx) => {
    const g = new THREE.Group();
    const open = new THREE.Mesh(eyeGeo, eyeMat);
    open.name = 'eyeOpen';
    const hi = new THREE.Mesh(eyeHiGeo, eyeHiMat);
    hi.position.set(0.02, 0.02, 0.045);
    open.add(hi);
    const happy = new THREE.Mesh(happyEyeGeo, eyeMat);
    happy.name = 'eyeHappy';
    happy.visible = false;
    g.add(open, happy);
    g.position.set(sx * eyeX, eyeY, 0);
    return g;
  };
  const eyeL = mkEye(-1);
  const eyeR = mkEye(1);

  const cheekL = new THREE.Mesh(cheekGeo, cheekMat);
  cheekL.position.set(-eyeX - 0.1, cheekY, -0.015);
  const cheekR = new THREE.Mesh(cheekGeo, cheekMat);
  cheekR.position.set(eyeX + 0.1, cheekY, -0.015);

  const mouth = new THREE.Mesh(mouthGeo, eyeMat);
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, mouthY, 0.005);

  face.add(eyeL, eyeR, cheekL, cheekR, mouth);
  face.position.z = faceZ;
  head.add(face);
  return { face, eyeL, eyeR, mouth };
}

/**
 * キャラ共通の振る舞い。
 *  update(dt): 呼吸・まばたき・感情の減衰
 *  happy() / oops(): リアクション再生
 *  squash: 外からアニメで使える(root.scale を直接いじらないこと)
 */
export class Critter {
  constructor(root, parts) {
    this.root = root;          // 配置用(position/rotationはこれをいじる)
    this.body = parts.body;    // 伸び縮み用
    this.baseScale = root.scale.x; // 生成時の縮尺(setSquashで保持する)
    this.parts = parts;
    this.t = Math.random() * 10;
    this._blink = 1.5 + Math.random() * 2.5;
    this._emotion = null;
    this._emoT = 0;
    this.idleAmp = 1;
    this.baseY = 0;
  }

  happy(dur = 0.9) { this._emotion = 'happy'; this._emoT = dur; this._setHappyEyes(true); }
  oops(dur = 0.8) { this._emotion = 'oops'; this._emoT = dur; }

  _setHappyEyes(on) {
    for (const eye of [this.parts.eyeL, this.parts.eyeR]) {
      if (!eye) continue;
      eye.children[0].visible = !on;
      eye.children[1].visible = on;
    }
  }

  /** 全身のむにゅっと(1=通常) */
  setSquash(s) {
    const b = this.baseScale;
    this.root.scale.set(b / Math.sqrt(s), b * s, b / Math.sqrt(s));
  }

  update(dt) {
    this.t += dt;

    // 呼吸(からだが伸び縮み)
    const br = 1 + Math.sin(this.t * 2.4) * 0.02 * this.idleAmp;
    if (this.body) this.body.scale.set(1, br, 1);

    // まばたき
    this._blink -= dt;
    if (this._blink <= 0) this._blink = 1.8 + Math.random() * 2.8;
    const blinkK = this._blink < 0.12 ? 0.15 : 1;
    for (const eye of [this.parts.eyeL, this.parts.eyeR]) {
      if (eye && eye.children[0].visible) eye.children[0].scale.y = blinkK;
    }

    // 感情リアクション
    if (this._emotion) {
      this._emoT -= dt;
      const k = Math.max(0, this._emoT);
      if (this._emotion === 'happy') {
        const wig = Math.sin(this.t * 18) * 0.12 * Math.min(1, k * 2);
        if (this.parts.head) this.parts.head.rotation.z = wig;
        if (this.parts.armL) this.parts.armL.rotation.z = 2.4 + wig;
        if (this.parts.armR) this.parts.armR.rotation.z = -2.4 + wig;
      } else if (this._emotion === 'oops') {
        const wob = Math.sin(this.t * 13) * 0.16 * Math.min(1, k * 2);
        this.root.rotation.z = wob;
        if (this.parts.head) this.parts.head.rotation.z = -0.18 * Math.min(1, k * 2);
      }
      if (this._emoT <= 0) {
        this._emotion = null;
        this._setHappyEyes(false);
        this.root.rotation.z = 0;
        if (this.parts.head) this.parts.head.rotation.z = 0;
        if (this.parts.armL) this.parts.armL.rotation.z = this.parts.armL.userData.restZ;
        if (this.parts.armR) this.parts.armR.rotation.z = this.parts.armR.userData.restZ;
      }
    } else {
      // 耳・しっぽの待機ゆれ
      if (this.parts.earL) this.parts.earL.rotation.z = 0.1 + Math.sin(this.t * 2.1) * 0.06;
      if (this.parts.earR) this.parts.earR.rotation.z = -0.1 - Math.sin(this.t * 2.1 + 1) * 0.06;
      if (this.parts.tail) this.parts.tail.rotation.y = Math.sin(this.t * 3.1) * 0.35;
    }
  }
}

/* ---------------- うさぎ ---------------- */

export function makeRabbit({ scale = 1 } = {}) {
  const g = new THREE.Group();
  const furMat = toonMat(COLORS.rabbit, { rim: 0.3 });
  const innerMat = toonMat(COLORS.rabbitEar, { rim: 0 });

  const body = new THREE.Group();
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), furMat);
  belly.scale.set(0.92, 1.05, 0.85);
  belly.position.y = 0.52;
  belly.castShadow = true;
  body.add(belly);

  const head = new THREE.Group();
  head.position.y = 1.28;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), furMat);
  skull.scale.set(1, 0.92, 0.9);
  skull.castShadow = true;
  head.add(skull);

  // 耳
  const mkEar = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.2, 0.36, 0);
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 6, 12), furMat);
    ear.position.y = 0.32;
    ear.castShadow = true;
    const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 4, 8), innerMat);
    inner.position.set(0, 0.34, 0.07);
    inner.userData.noOutline = true;
    pivot.add(ear, inner);
    pivot.rotation.z = -sx * 0.15;
    head.add(pivot);
    return pivot;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  const { eyeL, eyeR } = makeFace(head, { faceZ: 0.38, eyeY: 0.08 });

  // 鼻
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8fb1 }));
  nose.position.set(0, 0.0, 0.42);
  head.add(nose);

  // 腕
  const mkArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.42, 0.85, 0.05);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.3, 6, 10), furMat);
    arm.position.y = -0.18;
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.z = sx * 0.5;
    pivot.userData.restZ = sx * 0.5;
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  // 足
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), furMat);
    foot.scale.set(1, 0.6, 1.5);
    foot.position.set(sx * 0.22, 0.1, 0.12);
    foot.castShadow = true;
    body.add(foot);
  }

  // しっぽ
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), furMat);
  tail.position.set(0, 0.42, -0.44);
  body.add(tail);

  outlineGroup(g, 0.03);
  g.scale.setScalar(scale);
  return new Critter(g, { body, head, earL, earR, armL, armR, eyeL, eyeR, tail });
}

/* ---------------- ねこ ---------------- */

export function makeCat({ scale = 1 } = {}) {
  const g = new THREE.Group();
  const furMat = toonMat(COLORS.cat, { rim: 0.3 });
  const stripeMat = toonMat(COLORS.catStripe, { rim: 0 });

  const body = new THREE.Group();
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), furMat);
  belly.scale.set(0.9, 1.0, 0.85);
  belly.position.y = 0.5;
  belly.castShadow = true;
  body.add(belly);

  const head = new THREE.Group();
  head.position.y = 1.24;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.46, 20, 16), furMat);
  skull.scale.set(1.05, 0.9, 0.9);
  skull.castShadow = true;
  head.add(skull);

  // 三角耳
  const mkEar = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.26, 0.3, 0);
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.28, 4), furMat);
    ear.position.y = 0.12;
    ear.rotation.y = Math.PI / 4;
    ear.castShadow = true;
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.16, 4), toonMat(0xffc9d8, { rim: 0 }));
    inner.position.set(0, 0.08, 0.045);
    inner.rotation.y = Math.PI / 4;
    inner.userData.noOutline = true;
    pivot.add(ear, inner);
    pivot.rotation.z = -sx * 0.12;
    head.add(pivot);
    return pivot;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  // おでこのしま模様(トラねこの「M」)
  for (const sx of [-0.12, 0, 0.12]) {
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 8), stripeMat);
    stripe.position.set(sx, 0.36, 0.17);
    stripe.rotation.x = -0.9; // 頭頂に沿って前傾
    stripe.userData.noOutline = true;
    head.add(stripe);
  }

  const { eyeL, eyeR } = makeFace(head, { faceZ: 0.38, eyeY: 0.06 });

  // ひげ
  const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const sx of [-1, 1]) {
    for (const dy of [-0.02, 0.04]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.22, 4), whiskerMat);
      w.rotation.z = Math.PI / 2 + sx * 0.18 + dy;
      w.position.set(sx * 0.32, -0.06 + dy, 0.36);
      w.userData.noOutline = true;
      head.add(w);
    }
  }

  const mkArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.4, 0.8, 0.05);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.28, 6, 10), furMat);
    arm.position.y = -0.17;
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.z = sx * 0.5;
    pivot.userData.restZ = sx * 0.5;
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), furMat);
    foot.scale.set(1, 0.6, 1.4);
    foot.position.set(sx * 0.2, 0.09, 0.12);
    foot.castShadow = true;
    body.add(foot);
  }

  // くるんとしたしっぽ
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.35, -0.42);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16, Math.PI * 1.3), furMat);
  tail.rotation.x = 0.4;
  tail.castShadow = true;
  tailPivot.add(tail);
  body.add(tailPivot);

  outlineGroup(g, 0.03);
  g.scale.setScalar(scale);
  return new Critter(g, { body, head, earL, earR, armL, armR, eyeL, eyeR, tail: tailPivot });
}

/* ---------------- くま ---------------- */

export function makeBear({ scale = 1 } = {}) {
  const g = new THREE.Group();
  const furMat = toonMat(COLORS.bear, { rim: 0.28 });
  const muzzleMat = toonMat(COLORS.bearMuzzle, { rim: 0 });

  const body = new THREE.Group();
  g.add(body);

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 16), furMat);
  belly.scale.set(0.95, 1.02, 0.9);
  belly.position.y = 0.54;
  belly.castShadow = true;
  body.add(belly);

  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), muzzleMat);
  tummy.scale.set(1, 1.15, 0.5);
  tummy.position.set(0, 0.48, 0.28);
  tummy.userData.noOutline = true;
  body.add(tummy);

  const head = new THREE.Group();
  head.position.y = 1.34;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.48, 20, 16), furMat);
  skull.scale.set(1.05, 0.92, 0.92);
  skull.castShadow = true;
  head.add(skull);

  // まる耳
  const mkEar = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.32, 0.34, -0.02);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), furMat);
    ear.castShadow = true;
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.08, 10), muzzleMat);
    inner.position.z = 0.13;
    inner.userData.noOutline = true;
    pivot.add(ear, inner);
    head.add(pivot);
    return pivot;
  };
  const earL = mkEar(-1);
  const earR = mkEar(1);

  // マズル
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), muzzleMat);
  muzzle.scale.set(1.15, 0.8, 0.8);
  muzzle.position.set(0, -0.1, 0.36);
  muzzle.userData.noOutline = true;
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshBasicMaterial({ color: INK }));
  nose.position.set(0, -0.04, 0.55);
  head.add(nose);

  const { eyeL, eyeR } = makeFace(head, { faceZ: 0.4, eyeY: 0.12, mouthY: -0.5, cheekY: 0.0 });

  const mkArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.46, 0.86, 0.05);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.32, 6, 10), furMat);
    arm.position.y = -0.19;
    arm.castShadow = true;
    pivot.add(arm);
    pivot.rotation.z = sx * 0.5;
    pivot.userData.restZ = sx * 0.5;
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);

  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), furMat);
    foot.scale.set(1, 0.62, 1.4);
    foot.position.set(sx * 0.24, 0.1, 0.12);
    foot.castShadow = true;
    body.add(foot);
  }

  outlineGroup(g, 0.03);
  g.scale.setScalar(scale);
  return new Critter(g, { body, head, earL, earR, armL, armR, eyeL, eyeR });
}

/* ---------------- ほしさん(星のなかま) ---------------- */

export function makeStarBuddy({ scale = 1, color = COLORS.star } = {}) {
  const g = new THREE.Group();

  const body = new THREE.Group();
  g.add(body);

  const shape = new THREE.Shape();
  const R = 0.62, r = 0.28;
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.3, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.09, bevelSegments: 3,
  });
  geo.center();
  const star = new THREE.Mesh(geo, glowMat(color, 0.4));
  star.position.y = 0.75;
  star.castShadow = true;
  body.add(star);

  const head = new THREE.Group();
  head.position.set(0, 0.72, 0.2);
  body.add(head);
  const { eyeL, eyeR } = makeFace(head, { faceZ: 0.05, eyeX: 0.14, eyeY: 0.05, cheekY: -0.1, mouthY: -0.12 });

  // ちいさな手足
  const limbMat = glowMat(color, 0.25);
  const mkArm = (sx) => {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.55, 0.78, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.2, 4, 8), limbMat);
    arm.position.y = -0.12;
    pivot.add(arm);
    pivot.rotation.z = sx * 0.7;
    pivot.userData.restZ = sx * 0.7;
    body.add(pivot);
    return pivot;
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.16, 4, 8), limbMat);
    leg.position.set(sx * 0.2, 0.12, 0);
    body.add(leg);
  }

  outlineGroup(g, 0.035);
  g.scale.setScalar(scale);
  return new Critter(g, { body, head, armL, armR, eyeL, eyeR });
}
