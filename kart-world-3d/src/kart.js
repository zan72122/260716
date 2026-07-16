// kart.js — カート本体とかわいい動物ドライバーの生成
import * as THREE from 'three';
import { toonMat } from './world.js';

/* キャラクター定義 */
export const CHARACTERS = [
  {
    id: 'moka', name: 'くまの モカ', short: 'モカ',
    fur: '#b47a44', furLight: '#e8c79a', kart: '#ff4d4d', kartDark: '#c22020',
    ears: 'round', cheeks: '#ff9d9d',
  },
  {
    id: 'mimi', name: 'うさぎの ミミ', short: 'ミミ',
    fur: '#ffffff', furLight: '#ffe4ef', kart: '#ff7bb0', kartDark: '#d64d86',
    ears: 'long', cheeks: '#ffb3cd',
  },
  {
    id: 'pen', name: 'ぺんぎんの ペン', short: 'ペン',
    fur: '#3b4a63', furLight: '#ffffff', kart: '#3d9bff', kartDark: '#1e6ed1',
    ears: 'none', cheeks: '#ffca7a',
  },
  {
    id: 'tora', name: 'ねこの トラ', short: 'トラ',
    fur: '#f5a340', furLight: '#ffe0b0', kart: '#ffd23d', kartDark: '#e0a11d',
    ears: 'pointy', cheeks: '#ffb98a',
  },
];

/* 顔テクスチャ（canvas に にっこり顔 を描く） */
export function makeFaceTexture(char, size = 256) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const s = size / 256;
  ctx.clearRect(0, 0, size, size);

  // マズル（口まわりの明るい部分）
  ctx.fillStyle = char.furLight;
  ctx.beginPath();
  ctx.ellipse(128 * s, 168 * s, 62 * s, 48 * s, 0, 0, Math.PI * 2);
  ctx.fill();

  // 目（大きくてキラキラ）
  for (const ex of [82, 174]) {
    ctx.fillStyle = '#26221f';
    ctx.beginPath();
    ctx.ellipse(ex * s, 112 * s, 21 * s, 26 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse((ex - 7) * s, 102 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse((ex + 8) * s, 122 * s, 4 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ほっぺ
  ctx.fillStyle = char.cheeks;
  ctx.globalAlpha = 0.85;
  for (const ex of [52, 204]) {
    ctx.beginPath();
    ctx.ellipse(ex * s, 150 * s, 17 * s, 12 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 鼻
  ctx.fillStyle = char.id === 'pen' ? '#ff9f1c' : '#4a3428';
  ctx.beginPath();
  if (char.id === 'pen') {
    ctx.moveTo(112 * s, 142 * s);
    ctx.lineTo(144 * s, 142 * s);
    ctx.lineTo(128 * s, 168 * s);
    ctx.closePath();
  } else {
    ctx.ellipse(128 * s, 152 * s, 13 * s, 9 * s, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // にっこりお口
  ctx.strokeStyle = '#4a3428';
  ctx.lineWidth = 6 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(128 * s, 168 * s, 26 * s, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* キャラカード用（タイトル画面のアイコン画像 dataURL） */
export function makeCharIcon(char) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = char.kart;
  ctx.fillRect(0, 0, 256, 256);
  const grad = ctx.createRadialGradient(128, 100, 20, 128, 128, 180);
  grad.addColorStop(0, 'rgba(255,255,255,.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  // 顔ベース
  ctx.fillStyle = char.fur;
  ctx.beginPath();
  ctx.ellipse(128, 140, 88, 84, 0, 0, Math.PI * 2);
  ctx.fill();
  // 耳
  ctx.fillStyle = char.fur;
  if (char.ears === 'round') {
    for (const ex of [58, 198]) { ctx.beginPath(); ctx.ellipse(ex, 66, 30, 30, 0, 0, Math.PI * 2); ctx.fill(); }
  } else if (char.ears === 'long') {
    for (const [ex, rot] of [[80, -0.25], [176, 0.25]]) {
      ctx.save(); ctx.translate(ex, 44); ctx.rotate(rot);
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 52, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
  } else if (char.ears === 'pointy') {
    for (const [ex, dir] of [[62, -1], [194, 1]]) {
      ctx.beginPath();
      ctx.moveTo(ex - 24 * dir, 92); ctx.lineTo(ex + 8 * dir, 22); ctx.lineTo(ex + 26 * dir, 84);
      ctx.closePath(); ctx.fill();
    }
  }
  // 顔テクスチャを重ねる
  const face = makeFaceTexture(char).image;
  ctx.drawImage(face, 30, 44, 196, 196);
  return cv.toDataURL();
}

/* 耳などの立体パーツ */
function addEars(head, char, matFur) {
  if (char.ears === 'round') {
    const g = new THREE.SphereGeometry(0.34, 10, 8);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(g, matFur);
      e.position.set(sx * 0.62, 0.72, 0);
      head.add(e);
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), toonMat(char.furLight));
      inner.position.set(sx * 0.62, 0.72, 0.14);
      head.add(inner);
    }
  } else if (char.ears === 'long') {
    const g = new THREE.CapsuleGeometry(0.2, 0.85, 4, 8);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(g, matFur);
      e.position.set(sx * 0.4, 1.05, -0.05);
      e.rotation.z = sx * -0.18;
      head.add(e);
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.6, 4, 6), toonMat(char.furLight));
      inner.position.set(sx * 0.4, 1.05, 0.08);
      inner.rotation.z = sx * -0.18;
      head.add(inner);
    }
  } else if (char.ears === 'pointy') {
    const g = new THREE.ConeGeometry(0.3, 0.55, 4);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(g, matFur);
      e.position.set(sx * 0.52, 0.86, 0);
      e.rotation.y = Math.PI / 4;
      head.add(e);
    }
  }
  // ペンギンは頭のてっぺんに小さな羽
  if (char.id === 'pen') {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 6), matFur);
    tuft.position.set(0, 0.95, 0);
    tuft.rotation.z = 0.3;
    head.add(tuft);
  }
}

/* ドライバー（頭 + 胴体 + 腕） */
function buildDriver(char) {
  const g = new THREE.Group();
  const matFur = toonMat(char.fur);

  // 胴体
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.5, 6, 12), matFur);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  // おなか
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), toonMat(char.furLight));
  belly.position.set(0, 0.55, 0.3);
  belly.scale.set(1, 1.15, 0.6);
  g.add(belly);

  // 頭（顔テクスチャ付き球）
  const head = new THREE.Group();
  const faceTex = makeFaceTexture(char);
  const headMat = new THREE.MeshToonMaterial({
    color: char.fur, map: null, gradientMap: matFur.gradientMap,
  });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 16), headMat);
  skull.castShadow = true;
  head.add(skull);
  // 顔は前面に貼る板（球に沿わせる）
  const facePlane = new THREE.Mesh(
    new THREE.SphereGeometry(0.79, 20, 16, Math.PI / 2 - Math.PI / 3.2, Math.PI / 1.6, Math.PI / 4.2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: faceTex, transparent: true })
  );
  head.add(facePlane);
  addEars(head, char, matFur);
  head.position.y = 1.75;
  g.add(head);
  g.userData.head = head;

  // 腕（ハンドルへ）
  const armGeo = new THREE.CapsuleGeometry(0.16, 0.55, 4, 8);
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, matFur);
    arm.position.set(sx * 0.52, 0.95, 0.42);
    arm.rotation.x = -1.0;
    arm.rotation.z = sx * -0.35;
    g.add(arm);
    arms.push(arm);
  }
  g.userData.arms = arms;
  return g;
}

/* カート本体 */
export function buildKart(char) {
  const root = new THREE.Group();          // 位置・向き
  const chassis = new THREE.Group();       // 傾き・バウンド用
  root.add(chassis);

  const matBody = toonMat(char.kart);
  const matDark = toonMat(char.kartDark);
  const matGrey = toonMat('#3a3f4d');

  // ボディ（丸みのある形：カプセルとボックスの組合せ）
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.95, 1.7, 8, 14), matBody);
  hull.rotation.x = Math.PI / 2;
  hull.position.y = 0.62;
  hull.scale.set(1, 1, 0.62);
  hull.castShadow = true;
  chassis.add(hull);

  // ノーズ（前方の丸い先端）
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 12), matBody);
  nose.position.set(0, 0.6, 1.55);
  nose.scale.set(1.05, 0.62, 0.9);
  nose.castShadow = true;
  chassis.add(nose);

  // フロントの飾り（キャラ色の濃い縁 + ライト）
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.14, 8, 16, Math.PI), matDark);
  bumper.position.set(0, 0.55, 2.05);
  bumper.rotation.x = Math.PI / 2;
  chassis.add(bumper);
  for (const sx of [-1, 1]) {
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
    light.position.set(sx * 0.34, 0.68, 2.12);
    chassis.add(light);
  }

  // サイドポンツーン
  for (const sx of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.2, 6, 10), matDark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(sx * 0.95, 0.45, -0.1);
    pod.castShadow = true;
    chassis.add(pod);
  }

  // シート
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.28), matDark);
  seat.position.set(0, 1.05, -0.95);
  seat.rotation.x = -0.15;
  chassis.add(seat);

  // リアウィング
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.5), matBody);
  wing.position.set(0, 1.35, -1.75);
  chassis.add(wing);
  for (const sx of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), matGrey);
    strut.position.set(sx * 0.6, 1.05, -1.75);
    chassis.add(strut);
  }

  // マフラー（後ろに2本）＋ ブースト炎の取付位置
  const exhausts = [];
  for (const sx of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.55, 10), matGrey);
    pipe.rotation.x = Math.PI / 2 - 0.3;
    pipe.position.set(sx * 0.42, 0.62, -1.85);
    chassis.add(pipe);
    exhausts.push(pipe);
  }

  // ハンドル
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.6, 6), matGrey);
  column.position.set(0, 1.1, 0.55);
  column.rotation.x = 0.5;
  chassis.add(column);
  const wheelHandle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 16), matGrey);
  wheelHandle.position.set(0, 1.32, 0.42);
  wheelHandle.rotation.x = 0.9;
  chassis.add(wheelHandle);

  // タイヤ（白いハブキャップ付き）
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.42, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.45, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const tireMat = toonMat('#2b2b33');
  const hubMat = toonMat('#f2f2f2');
  for (const [sx, sz] of [[-1, 1.35], [1, 1.35], [-1, -1.25], [1, -1.25]]) {
    const w = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    w.add(tire, hub);
    w.position.set(sx * 1.06, 0.52, sz);
    chassis.add(w);
    wheels.push({ g: w, front: sz > 0, spin: 0 });
  }

  // ドライバー
  const driver = buildDriver(char);
  driver.position.set(0, 0.85, -0.55);
  driver.scale.setScalar(0.92);
  chassis.add(driver);

  // 影を柔らかくする丸影（実シャドウ + 補助）
  const blobTex = makeBlobShadowTexture();
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.6),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity: 0.42, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.075;
  blob.renderOrder = 2;
  root.add(blob);

  root.userData = {
    chassis, wheels, driver, exhausts, wheelHandle,
    char,
    bodyMats: [matBody, matDark],
    baseColors: [new THREE.Color(char.kart), new THREE.Color(char.kartDark)],
  };
  return root;
}

let _blobTex = null;
function makeBlobShadowTexture() {
  if (_blobTex) return _blobTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, 'rgba(10,20,40,0.85)');
  g.addColorStop(0.7, 'rgba(10,20,40,0.4)');
  g.addColorStop(1, 'rgba(10,20,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(cv);
  return _blobTex;
}

/* 毎フレームのカート演出（傾き・タイヤ回転・キャラの揺れ） */
export function animateKart(kart, dt, t, state) {
  const u = kart.userData;
  const { speed, steer, maxSpeed, boosting, star, airborne } = state;

  // 車体の傾き（ステアでロール、加速でピッチ）
  const targetRoll = -steer * 0.16 * (speed / maxSpeed);
  const targetPitch = boosting ? -0.06 : 0.015;
  u.chassis.rotation.z += (targetRoll - u.chassis.rotation.z) * Math.min(1, dt * 8);
  u.chassis.rotation.x += (targetPitch - u.chassis.rotation.x) * Math.min(1, dt * 5);
  u.chassis.position.y = Math.sin(t * 17) * 0.018 * (speed / maxSpeed);

  // タイヤ
  for (const w of u.wheels) {
    w.spin += speed * dt * 1.9;
    // 回転（左右軸）と前輪の操舵（Y軸）
    w.g.rotation.set(0, w.front ? steer * 0.42 : 0, 0);
    w.g.children[0].rotation.x = w.spin;
    w.g.children[1].rotation.x = w.spin;
  }

  // ハンドルとドライバー
  u.wheelHandle.rotation.z = -steer * 0.7;
  const head = u.driver.userData.head;
  head.rotation.z += ((-steer * 0.22) - head.rotation.z) * Math.min(1, dt * 6);
  head.rotation.y += ((steer * 0.3) - head.rotation.y) * Math.min(1, dt * 6);
  u.driver.rotation.z = -steer * 0.08;
  // 走行中はちょっと弾む
  u.driver.position.y = 0.85 + Math.abs(Math.sin(t * 10)) * 0.03 * (speed / maxSpeed);

  // スターモード：ボディ色を虹色に
  if (star > 0) {
    const h = (t * 1.6) % 1;
    u.bodyMats[0].color.setHSL(h, 0.9, 0.62);
    u.bodyMats[1].color.setHSL((h + 0.15) % 1, 0.9, 0.5);
  } else {
    u.bodyMats[0].color.lerp(u.baseColors[0], Math.min(1, dt * 5));
    u.bodyMats[1].color.lerp(u.baseColors[1], Math.min(1, dt * 5));
  }
}
