/* ============================================================
   rider.js — オリジナルキャラクター「ピュン」たちと
   星型エアライドマシンの造形・アニメーション
   ============================================================ */
import * as THREE from 'three';
import { toon, mergeGeoms, mat4, starGeometry, addRim } from './lib3d.js';

/**
 * キャラクター+マシンを組み立てる
 * palette: { body, belly, ear, cheek, star, starRim, earStyle }
 * earStyle: 'bunny' | 'cat' | 'round'
 */
export function buildRider(palette) {
  const P = {
    body: 0xfff3da, belly: 0xfffdf5, ear: 0xffb7cd, cheek: 0xff9db8,
    star: 0xffd344, starRim: 0xff8fc0, earStyle: 'bunny',
    ...palette,
  };
  const group = new THREE.Group();

  /* ================= マシン: コメットスター ================= */
  const machine = new THREE.Group();
  // 本体の星
  const starMat = toon(P.star, {
    emissive: new THREE.Color(P.star).multiplyScalar(0.22),
    rimColor: 0xfff0c0, rimStrength: 0.45,
  });
  const star = new THREE.Mesh(starGeometry(2.5, 1.35, 0.5), starMat);
  star.rotation.x = -Math.PI / 2; // 平らに寝かせる
  star.castShadow = true;
  machine.add(star);
  // ふちどり (少し大きい星を下に)
  const rimStar = new THREE.Mesh(
    starGeometry(2.72, 1.5, 0.3),
    toon(P.starRim, { rimStrength: 0.3 })
  );
  rimStar.rotation.x = -Math.PI / 2;
  rimStar.position.y = -0.18;
  machine.add(rimStar);
  // ノーズの飾り玉
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), toon(0xffffff));
  nose.position.set(0, 0.15, 2.05);
  machine.add(nose);
  // ホバーの光の輪 (加算)
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.3, 28),
    new THREE.MeshBasicMaterial({
      color: 0x9fdcff, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.55;
  machine.add(glow);
  machine.position.y = 0.6;
  group.add(machine);

  /* ================= キャラクター ================= */
  const chara = new THREE.Group();
  const bodyMat = toon(P.body, { rimColor: 0xfff6ff, rimStrength: 0.4 });

  // 胴体 (まるい)
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 16), bodyMat);
  body.scale.set(1, 0.96, 1);
  body.castShadow = true;
  chara.add(body);

  // おなか
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), toon(P.belly, { rim: false }));
  belly.position.set(0, -0.18, 0.42);
  belly.scale.set(0.9, 0.8, 0.62);
  chara.add(belly);

  // 耳
  const earMat = toon(P.body, { rimStrength: 0.3 });
  const earInMat = toon(P.ear, { rim: false });
  const ears = new THREE.Group();
  if (P.earStyle === 'bunny') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.9, 6, 10), earMat);
      ear.position.set(side * 0.42, 1.18, -0.18);
      ear.rotation.z = side * -0.22;
      ear.rotation.x = -0.3;
      ear.castShadow = true;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.6, 4, 8), earInMat);
      inner.position.set(0, 0.06, 0.16);
      ear.add(inner);
      ears.add(ear);
    }
  } else if (P.earStyle === 'cat') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 4), earMat);
      ear.position.set(side * 0.52, 0.98, 0);
      ear.rotation.z = side * -0.32;
      ear.castShadow = true;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.4, 4), earInMat);
      inner.position.set(0, -0.04, 0.06);
      ear.add(inner);
      ears.add(ear);
    }
  } else {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), earMat);
      ear.position.set(side * 0.62, 0.86, 0);
      ear.castShadow = true;
      const inner = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), earInMat);
      inner.position.set(0, 0.02, 0.14);
      ear.add(inner);
      ears.add(ear);
    }
  }
  chara.add(ears);

  // 目 (くりくり)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b2233 });
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8), eyeMat);
    eye.position.set(side * 0.34, 0.28, 0.82);
    eye.scale.set(1, 1.55, 0.6);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), hiMat);
    hi.position.set(side * 0.04, 0.09, 0.1);
    eye.add(hi);
    chara.add(eye);
  }

  // ほっぺ
  for (const side of [-1, 1]) {
    const cheek = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshToonMaterial({ color: P.cheek, gradientMap: null })
    );
    cheek.position.set(side * 0.62, 0.02, 0.72);
    cheek.scale.set(1, 0.7, 0.5);
    chara.add(cheek);
  }

  // くち (ちいさな笑み)
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.035, 6, 12, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0x8a4a5a })
  );
  mouth.position.set(0, 0.02, 0.95);
  mouth.rotation.set(Math.PI, 0, 0);
  chara.add(mouth);

  // うで
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), bodyMat);
    arm.position.set(side * 0.95, -0.15, 0.05);
    arm.scale.set(0.8, 1.15, 0.8);
    arm.castShadow = true;
    chara.add(arm);
    arms.push(arm);
  }

  // せなかの星バッジ (チャージで光る)
  const capeMat = toon(P.star, {
    emissive: new THREE.Color(P.star).multiplyScalar(0.25),
    rimStrength: 0.3, rimColor: 0xfff0c0,
  });
  const cape = new THREE.Mesh(starGeometry(0.42, 0.19, 0.14), capeMat);
  cape.position.set(0, 0.22, -0.98);
  cape.rotation.y = Math.PI;
  chara.add(cape);

  // あし
  for (const side of [-1, 1]) {
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), toon(P.ear, { rim: false }));
    foot.position.set(side * 0.42, -0.88, 0.1);
    foot.scale.set(0.85, 0.55, 1.15);
    chara.add(foot);
  }

  chara.position.y = 1.9;
  group.add(chara);

  return {
    group, machine, chara, ears, arms, glow, star, cape,
    baseCharaY: 1.9,
    baseMachineY: 0.6,
  };
}

/**
 * ライダーのぷにぷにアニメーション
 * state: { speedNorm 0..1, charge 0..1, lean -1..1, boostTimer, airborne, time }
 */
export function animateRider(r, state) {
  const { time: t } = state;
  const bounce = Math.sin(t * 7) * 0.05 * (0.4 + state.speedNorm);

  // キャラ: しゃがみ(チャージ) / ジャンプ姿勢 / ぷにぷに上下
  const squash = 1 - state.charge * 0.28;
  const stretch = 1 + state.charge * 0.14;
  r.chara.scale.set(stretch, squash, stretch);
  r.chara.position.y = r.baseCharaY - state.charge * 0.34 + bounce
    + (state.airborne ? 0.25 : 0);
  r.chara.rotation.z = state.lean * 0.35;
  r.chara.rotation.x = state.charge * 0.22 - (state.airborne ? 0.3 : 0)
    + state.speedNorm * 0.06;

  // 耳: スピードでなびく
  const flap = Math.sin(t * 9) * 0.1;
  r.ears.children.forEach((ear, i) => {
    const side = i === 0 ? -1 : 1;
    ear.rotation.x = -(0.3 + state.speedNorm * 0.55) + flap * (i === 0 ? 1 : -1) * 0.4;
    ear.rotation.z = side * -(0.22 + state.speedNorm * 0.1) + state.lean * 0.2;
  });

  // 背中の星バッジ: くるくる + チャージで発光
  r.cape.rotation.z = t * 1.5;
  const badgeGlow = 0.25 + state.charge * 1.4 + Math.min(state.boostTimer, 1) * 1.0;
  r.cape.material.emissiveIntensity = badgeGlow;
  const badgeScale = 1 + state.charge * 0.35;
  r.cape.scale.setScalar(badgeScale);

  // うで: ブースト時にばんざい
  const up = state.boostTimer > 0 ? 0.9 : 0;
  r.arms.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    arm.position.y = -0.15 + up * 0.55 + Math.sin(t * 7 + i) * 0.03;
    arm.rotation.z = side * up * 1.1;
  });

  // マシン: ホバーゆらぎ + チャージで鼻先を下げ、発射でウィリー
  r.machine.position.y = r.baseMachineY + Math.sin(t * 3.1) * 0.09;
  r.machine.rotation.x = state.charge * 0.12 - Math.min(state.boostTimer, 0.5) * 0.5;
  r.machine.rotation.z = state.lean * 0.18;

  // ホバーグロー: チャージ・ブーストで強く
  const g = 0.22 + state.charge * 0.4 + Math.min(state.boostTimer, 1) * 0.32
    + Math.sin(t * 12) * 0.04;
  r.glow.material.opacity = Math.min(g, 0.75);
  const gs = 1 + state.charge * 0.25 + Math.min(state.boostTimer, 1) * 0.4;
  r.glow.scale.setScalar(gs);
}
