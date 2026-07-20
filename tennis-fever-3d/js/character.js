/* ============================================================
   テニス フィーバー!  —  character.js
   Cute toon-shaded animal players built from primitives:
   ミミ (bunny) / トラ (cat) / ガオ (dino).
   All animation is procedural: idle bob, run lean, swing,
   celebrate, "donmai" wobble, blinking.
   ============================================================ */

import * as THREE from 'three';
import { toonMat } from './world.js';

const OUTLINE_COLOR = '#2f3050';

function outlineFor(mesh, thickness = 1.06) {
  const o = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide })
  );
  o.position.copy(mesh.position);
  o.rotation.copy(mesh.rotation);
  o.scale.copy(mesh.scale).multiplyScalar(thickness);
  o.castShadow = false;
  return o;
}

const PALETTES = {
  bunny: { main: '#ff8fb8', light: '#ffd7e6', belly: '#fff3f8', accent: '#e2557f', racket: '#ff5f7e' },
  cat:   { main: '#ffb347', light: '#ffe3b3', belly: '#fff6e6', accent: '#e8923c', racket: '#ff9d1b' },
  dino:  { main: '#5fd18a', light: '#c3f3d4', belly: '#eafff2', accent: '#38a869', racket: '#2fbf6b' },
};

function buildRacket(color) {
  const racket = new THREE.Group();
  const handleMat = toonMat('#f4c96b');
  const frameMat = toonMat(color);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.5, 10), handleMat);
  handle.position.y = 0.25;
  racket.add(handle);

  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 10, 24), frameMat);
  frame.position.y = 0.82;
  racket.add(frame);
  racket.add(outlineFor(frame, 1.12));

  // strings: simple crisp grid on a transparent canvas
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 3;
  for (let i = 10; i < 128; i += 16) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  const strings = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 24),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, opacity: 0.9 })
  );
  strings.position.y = 0.82;
  racket.add(strings);
  return racket;
}

export function createCharacter(kind) {
  const P = PALETTES[kind] || PALETTES.bunny;
  const group = new THREE.Group();

  /* body root — squash/stretch + bob happen here */
  const body = new THREE.Group();
  group.add(body);

  const mainMat = toonMat(P.main);
  const lightMat = toonMat(P.light);
  const bellyMat = toonMat(P.belly);

  /* ---- torso ---- */
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), mainMat);
  torso.scale.set(1, 1.08, 0.92);
  torso.position.y = 0.62;
  torso.castShadow = true;
  body.add(torso, outlineFor(torso));

  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), bellyMat);
  belly.scale.set(1, 1.12, 0.72);
  belly.position.set(0, 0.56, 0.16);
  body.add(belly);

  /* ---- head ---- */
  const head = new THREE.Group();
  head.position.y = 1.32;
  body.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.56, 28, 22), mainMat);
  skull.scale.set(1.02, 0.95, 0.95);
  skull.castShadow = true;
  head.add(skull, outlineFor(skull));

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), bellyMat);
  muzzle.scale.set(1.15, 0.8, 0.62);
  muzzle.position.set(0, -0.14, 0.34);
  head.add(muzzle);

  /* eyes + glints (glints keep that lively Switch-render sparkle) */
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#31283a' });
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const eyes = [];
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 12), eyeMat);
    e.position.set(sx * 0.21, 0.08, 0.47);
    e.scale.y = 1.25;
    head.add(e);
    eyes.push(e);
    const g1 = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), glintMat);
    g1.position.set(sx * 0.18, 0.13, 0.545);
    head.add(g1);
    const g2 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), glintMat);
    g2.position.set(sx * 0.245, 0.045, 0.545);
    head.add(g2);
  }

  /* blush */
  const blushMat = new THREE.MeshBasicMaterial({ color: '#ff9db4', transparent: true, opacity: 0.75 });
  for (const sx of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), blushMat);
    b.scale.set(1, 0.7, 0.4);
    b.position.set(sx * 0.38, -0.08, 0.4);
    head.add(b);
  }

  /* smile */
  const smile = new THREE.Mesh(
    new THREE.TorusGeometry(0.09, 0.022, 8, 16, Math.PI),
    new THREE.MeshBasicMaterial({ color: '#31283a' })
  );
  smile.position.set(0, -0.12, 0.55);
  smile.rotation.z = Math.PI;
  head.add(smile);

  /* nose */
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: P.accent }));
  nose.scale.set(1.2, 0.8, 0.8);
  nose.position.set(0, -0.02, 0.6);
  head.add(nose);

  /* ---- species features ---- */
  const earParts = [];
  if (kind === 'bunny') {
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 6, 12), mainMat);
      outer.castShadow = true;
      const inner = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.34, 6, 10), lightMat);
      inner.position.z = 0.06;
      ear.add(outer, outlineFor(outer), inner);
      ear.position.set(sx * 0.24, 0.72, -0.05);
      ear.rotation.z = -sx * 0.22;
      head.add(ear);
      earParts.push({ g: ear, baseRotZ: ear.rotation.z, sx });
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), bellyMat);
    tail.position.set(0, 0.5, -0.42);
    body.add(tail);
  } else if (kind === 'cat') {
    for (const sx of [-1, 1]) {
      const ear = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.3, 4), mainMat);
      outer.rotation.y = Math.PI / 4;
      outer.castShadow = true;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.18, 4), lightMat);
      inner.rotation.y = Math.PI / 4;
      inner.position.set(0, -0.02, 0.03);
      ear.add(outer, outlineFor(outer, 1.14), inner);
      ear.position.set(sx * 0.3, 0.52, 0);
      ear.rotation.z = -sx * 0.3;
      head.add(ear);
      earParts.push({ g: ear, baseRotZ: ear.rotation.z, sx });
    }
    // stripes
    const stripeMat = new THREE.MeshBasicMaterial({ color: P.accent });
    for (const [y, s] of [[0.32, 0.34], [0.42, 0.26]]) {
      const st = new THREE.Mesh(new THREE.TorusGeometry(s, 0.028, 6, 20, Math.PI * 0.7), stripeMat);
      st.position.set(0, y, 0);
      st.rotation.x = -Math.PI / 2.4;
      head.add(st);
    }
    // tail
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.075, 8, 16, Math.PI * 1.2), mainMat);
    tail.position.set(0.1, 0.42, -0.42);
    tail.rotation.set(0.4, 0.7, 0);
    tail.castShadow = true;
    body.add(tail);
  } else { // dino
    const crestMat = toonMat(P.accent);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.13 - i * 0.02, 0.26 - i * 0.04, 8), crestMat);
      c.position.set(0, 0.52 - i * 0.02, -0.1 - i * 0.24);
      c.rotation.x = -0.5 - i * 0.35;
      c.castShadow = true;
      head.add(c);
      earParts.push({ g: c, baseRotZ: 0, sx: i - 1 });
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.75, 10), mainMat);
    tail.position.set(0, 0.42, -0.55);
    tail.rotation.x = 1.25;
    tail.castShadow = true;
    body.add(tail, outlineFor(tail, 1.1));
    for (let i = 0; i < 2; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 6), crestMat);
      spike.position.set(0, 0.52 + i * 0.02, -0.62 - i * 0.16);
      spike.rotation.x = -0.9;
      body.add(spike);
    }
  }

  /* ---- arms ---- */
  const armGeo = new THREE.CapsuleGeometry(0.11, 0.3, 6, 12);

  const armL = new THREE.Group();
  armL.position.set(-0.44, 0.92, 0);
  const armLMesh = new THREE.Mesh(armGeo, mainMat);
  armLMesh.position.y = -0.2;
  armLMesh.castShadow = true;
  armL.add(armLMesh);
  const pawL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), lightMat);
  pawL.position.y = -0.42;
  armL.add(pawL);
  armL.rotation.z = 0.5;
  body.add(armL);

  const armR = new THREE.Group();
  armR.position.set(0.44, 0.92, 0);
  const armRMesh = new THREE.Mesh(armGeo, mainMat);
  armRMesh.position.y = -0.2;
  armRMesh.castShadow = true;
  armR.add(armRMesh);
  const pawR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), lightMat);
  pawR.position.y = -0.42;
  armR.add(pawR);
  body.add(armR);

  /* racket in right paw */
  const racket = buildRacket(P.racket);
  racket.position.set(0, -0.48, 0.05);
  racket.rotation.set(0.35, 0, -0.2);
  armR.add(racket);
  armR.rotation.set(0.25, 0, -0.75);

  /* ---- legs ---- */
  const legGeo = new THREE.CapsuleGeometry(0.12, 0.16, 6, 10);
  const legs = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.2, 0.3, 0);
    const lm = new THREE.Mesh(legGeo, mainMat);
    lm.position.y = -0.1;
    lm.castShadow = true;
    leg.add(lm);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), lightMat);
    foot.scale.set(1, 0.7, 1.35);
    foot.position.set(0, -0.24, 0.05);
    leg.add(foot);
    body.add(leg);
    legs.push(leg);
  }

  /* ============================================================
     animation state machine
  ============================================================ */
  const st = {
    swingT: -1,          // -1 = not swinging
    celebrateT: -1,
    sadT: -1,
    blinkT: 0,
    nextBlink: 1.5 + Math.random() * 2,
    moveLean: 0,
    runPhase: 0,
    baseArmR: armR.rotation.clone(),
    baseArmL: armL.rotation.clone(),
  };

  const api = { group, kind };

  api.swing = () => { st.swingT = 0; };
  api.isSwinging = () => st.swingT >= 0 && st.swingT < 0.42;
  api.celebrate = () => { st.celebrateT = 0; };
  api.sad = () => { st.sadT = 0; };

  let targetLean = 0;
  api.setMove = (vx) => { targetLean = THREE.MathUtils.clamp(vx * 0.16, -0.45, 0.45); };

  const easeOut = (x) => 1 - Math.pow(1 - x, 3);
  const easeIn = (x) => x * x * x;

  api.update = (dt, t) => {
    /* idle bob + breathing */
    const bob = Math.sin(t * 3.1) * 0.03;
    body.position.y = Math.abs(Math.sin(t * 3.1)) * 0.045;
    body.scale.set(1 + bob * 0.4, 1 - bob * 0.5, 1 + bob * 0.4);
    head.rotation.z = Math.sin(t * 1.7) * 0.05;
    head.rotation.x = Math.sin(t * 2.3) * 0.04;

    /* ear / crest wobble */
    for (const e of earParts) {
      e.g.rotation.z = e.baseRotZ + Math.sin(t * 3.4 + e.sx * 2) * 0.09;
    }

    /* blink */
    st.blinkT += dt;
    if (st.blinkT > st.nextBlink) {
      st.blinkT = 0;
      st.nextBlink = 1.6 + Math.random() * 2.6;
    }
    const blinking = st.blinkT < 0.13;
    for (const e of eyes) e.scale.y = blinking ? 0.12 : 1.25;

    /* run lean + trot */
    st.moveLean += (targetLean - st.moveLean) * Math.min(1, dt * 10);
    group.rotation.z = -st.moveLean;
    const running = Math.abs(targetLean) > 0.04;
    if (running) {
      st.runPhase += dt * 14;
      legs[0].rotation.x = Math.sin(st.runPhase) * 0.7;
      legs[1].rotation.x = -Math.sin(st.runPhase) * 0.7;
      body.position.y += Math.abs(Math.sin(st.runPhase)) * 0.06;
    } else {
      legs[0].rotation.x += (0 - legs[0].rotation.x) * Math.min(1, dt * 8);
      legs[1].rotation.x += (0 - legs[1].rotation.x) * Math.min(1, dt * 8);
    }

    /* left arm sway */
    armL.rotation.z = st.baseArmL.z + Math.sin(t * 3.1) * 0.08;

    /* ---------- swing ---------- */
    if (st.swingT >= 0) {
      st.swingT += dt;
      const T = st.swingT;
      if (T < 0.12) {                       // windup
        const k = easeOut(T / 0.12);
        armR.rotation.set(0.25 - k * 0.9, k * 0.5, -0.75 + k * 0.25);
        body.rotation.y = k * 0.55;
      } else if (T < 0.24) {                // strike!
        const k = easeIn((T - 0.12) / 0.12);
        armR.rotation.set(-0.65 + k * 1.75, 0.5 - k * 1.3, -0.5 - k * 0.4);
        body.rotation.y = 0.55 - k * 1.05;
      } else if (T < 0.55) {                // follow-through & recover
        const k = easeOut((T - 0.24) / 0.31);
        armR.rotation.set(
          THREE.MathUtils.lerp(1.1, st.baseArmR.x, k),
          THREE.MathUtils.lerp(-0.8, st.baseArmR.y, k),
          THREE.MathUtils.lerp(-0.9, st.baseArmR.z, k));
        body.rotation.y = THREE.MathUtils.lerp(-0.5, 0, k);
      } else {
        st.swingT = -1;
        armR.rotation.copy(st.baseArmR);
        body.rotation.y = 0;
      }
    }

    /* ---------- celebrate ---------- */
    if (st.celebrateT >= 0) {
      st.celebrateT += dt;
      const T = st.celebrateT;
      const D = 1.25;
      if (T < D) {
        const hop = Math.abs(Math.sin(T * Math.PI * 2 / (D / 2)));
        body.position.y += hop * 0.5;
        body.scale.y *= 1 + hop * 0.08;
        body.rotation.y += dt * 10 * Math.sin(T * Math.PI / D);
        armR.rotation.x = -2.4;
        armL.rotation.z = 2.6;
        head.rotation.z = Math.sin(T * 12) * 0.12;
      } else {
        st.celebrateT = -1;
        body.rotation.y = 0;
        armR.rotation.copy(st.baseArmR);
        armL.rotation.copy(st.baseArmL);
      }
    }

    /* ---------- sad wobble (never too sad!) ---------- */
    if (st.sadT >= 0) {
      st.sadT += dt;
      const T = st.sadT;
      if (T < 0.9) {
        head.rotation.z += Math.sin(T * 9) * 0.14 * (1 - T / 0.9);
        head.rotation.x += 0.2 * (1 - T / 0.9);
      } else {
        st.sadT = -1;
      }
    }
  };

  return api;
}
