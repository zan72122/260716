/* ============================================================
   テニス フィーバー!  —  world.js
   The stadium: sky, sun, clouds, court, net, stands with a
   living crowd, floodlights, flags, balloons, hills & trees.
   Everything is generated procedurally — no asset downloads.
   ============================================================ */

import * as THREE from 'three';

export const COURT = {
  halfW: 4.6,     // court half width
  halfL: 9.0,     // court half length (net at z=0)
  netH: 0.95,
  playerZ: 7.6,   // where the child's character stands
  cpuZ: -7.6,
};

/* ---------- canvas texture helper ---------- */
function canvasTexture(w, h, draw, { repeat = null, aniso = 4 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

/* soft radial sprite texture (glow / blob shadow / cloud puff) */
export function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* 4-step toon gradient shared by all toon materials */
let _gradMap = null;
export function toonGradient() {
  if (_gradMap) return _gradMap;
  const data = new Uint8Array([110, 110, 110, 255, 170, 170, 170, 255, 215, 215, 215, 255, 255, 255, 255, 255]);
  _gradMap = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  _gradMap.minFilter = THREE.NearestFilter;
  _gradMap.magFilter = THREE.NearestFilter;
  _gradMap.needsUpdate = true;
  return _gradMap;
}

export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...opts });
}

/* ============================================================ */

export function createWorld(scene) {
  const world = { fever: 0, excitement: 0 };
  const disposables = [];

  /* ---------------- SKY DOME ---------------- */
  const skyUniforms = {
    uTime: { value: 0 },
    uFever: { value: 0 },
    uTop: { value: new THREE.Color('#1e8fe8') },
    uMid: { value: new THREE.Color('#7fd4ff') },
    uBot: { value: new THREE.Color('#eafaff') },
  };
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime, uFever;
      uniform vec3 uTop, uMid, uBot;
      vec3 hsv(float h, float s, float v) {
        vec3 k = vec3(1.0, 2.0/3.0, 1.0/3.0);
        vec3 p = abs(fract(vec3(h) + k) * 6.0 - 3.0);
        return v * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), s);
      }
      void main() {
        float h = clamp(vDir.y, -0.05, 1.0);
        vec3 col = mix(uBot, uMid, smoothstep(-0.05, 0.22, h));
        col = mix(col, uTop, smoothstep(0.18, 0.75, h));
        // dreamy fever rainbow: soft moving bands across the whole sky
        float ang = atan(vDir.x, vDir.z);
        float band = sin(ang * 3.0 + h * 6.0 - uTime * 0.9) * 0.5 + 0.5;
        vec3 rainbow = hsv(fract(ang / 6.2831 + h * 0.6 + uTime * 0.06), 0.55, 1.0);
        col = mix(col, mix(col, rainbow, 0.75), uFever * (0.5 + 0.35 * band));
        // subtle top vignette keeps the sun area bright
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 20), skyMat);
  sky.renderOrder = -10;
  scene.add(sky);

  /* sun glow sprite */
  const sunTex = radialTexture(256, [
    [0, 'rgba(255,255,240,1)'],
    [0.25, 'rgba(255,246,190,0.95)'],
    [0.5, 'rgba(255,230,140,0.35)'],
    [1, 'rgba(255,220,120,0)'],
  ]);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.95,
  }));
  sun.scale.setScalar(90);
  sun.position.set(-70, 110, -150);
  scene.add(sun);

  /* ---------------- CLOUDS ---------------- */
  const puffTex = radialTexture(128, [
    [0, 'rgba(255,255,255,0.95)'],
    [0.6, 'rgba(255,255,255,0.5)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const clouds = new THREE.Group();
  const cloudList = [];
  for (let i = 0; i < 12; i++) {
    const cl = new THREE.Group();
    const puffs = 4 + ((i * 7) % 4);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: puffTex, transparent: true, depthWrite: false, opacity: 0.9,
      }));
      s.position.set((p - puffs / 2) * 5.2 + Math.sin(i * 13 + p * 7) * 2.5,
        Math.sin(p * 2.7 + i) * 2.0, Math.cos(p * 1.9) * 2.0);
      s.scale.setScalar(9 + ((p * 37 + i * 11) % 6));
      cl.add(s);
    }
    const ang = (i / 12) * Math.PI * 2;
    const r = 110 + (i % 4) * 22;
    cl.position.set(Math.cos(ang) * r, 42 + (i % 5) * 12, Math.sin(ang) * r);
    clouds.add(cl);
    cloudList.push({ g: cl, speed: 0.6 + (i % 3) * 0.35, baseY: cl.position.y, ph: i * 1.7 });
  }
  scene.add(clouds);

  /* ---------------- LIGHTING ---------------- */
  const hemi = new THREE.HemisphereLight('#bfe3ff', '#79c46a', 0.75);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight('#fff4dd', 2.6);
  sunLight.position.set(-14, 26, -8);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 4;
  sunLight.shadow.camera.far = 70;
  sunLight.shadow.camera.left = -18;
  sunLight.shadow.camera.right = 18;
  sunLight.shadow.camera.top = 20;
  sunLight.shadow.camera.bottom = -18;
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.02;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fill = new THREE.DirectionalLight('#cfe8ff', 0.5);
  fill.position.set(12, 10, 16);
  scene.add(fill);

  // fever party lights (start dark)
  const partyLights = [];
  const partyCols = ['#ff3f8e', '#37b6ff', '#ffd23f', '#4dff7c'];
  for (let i = 0; i < 4; i++) {
    const pl = new THREE.PointLight(partyCols[i], 0, 40, 1.6);
    const a = (i / 4) * Math.PI * 2;
    pl.position.set(Math.cos(a) * 12, 8, Math.sin(a) * 12);
    scene.add(pl);
    partyLights.push(pl);
  }

  scene.fog = new THREE.Fog('#a5ddff', 90, 230);

  /* ---------------- GROUND ---------------- */
  const groundTex = canvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#7ecf6a');
    g.addColorStop(0.7, '#5fbf58');
    g.addColorStop(1, '#4aa94c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // gentle mottling
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.045})`;
      const r = 2 + Math.random() * 8;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, r, 0, 7);
      ctx.fill();
    }
  });
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(200, 48),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  /* ---------------- COURT ---------------- */
  const CW = COURT.halfW * 2, CL = COURT.halfL * 2;
  const apron = 3.2; // colored surround
  const courtTex = canvasTexture(1024, 1638, (ctx, w, h) => {
    const px = w / (CW + apron * 2); // pixels per meter
    // apron — warm sunny coral
    const ag = ctx.createLinearGradient(0, 0, 0, h);
    ag.addColorStop(0, '#ff9d6b');
    ag.addColorStop(0.5, '#ff8a58');
    ag.addColorStop(1, '#ff9d6b');
    ctx.fillStyle = ag;
    ctx.fillRect(0, 0, w, h);
    // court — bright playful blue with a soft center glow
    const cx = w / 2, cy = h / 2;
    const cwPx = CW * px, clPx = CL * (h / (CL + apron * 2));
    const x0 = cx - cwPx / 2, y0 = cy - clPx / 2;
    const cg = ctx.createRadialGradient(cx, cy, 60, cx, cy, h * 0.52);
    cg.addColorStop(0, '#31c8ff');
    cg.addColorStop(0.6, '#1ba9ef');
    cg.addColorStop(1, '#0f8fd6');
    ctx.fillStyle = cg;
    ctx.fillRect(x0, y0, cwPx, clPx);
    // big friendly star at center
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 170 : 72;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // sparkle noise on court
    for (let i = 0; i < 1400; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      ctx.fillRect(x0 + Math.random() * cwPx, y0 + Math.random() * clPx, 2, 2);
    }
    // ---- white lines ----
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    const lw = Math.max(6, px * 0.08);
    ctx.lineWidth = lw;
    ctx.strokeRect(x0 + lw / 2, y0 + lw / 2, cwPx - lw, clPx - lw);
    // service lines & center line
    const svc = clPx * 0.28;
    ctx.beginPath();
    ctx.moveTo(x0, cy - svc); ctx.lineTo(x0 + cwPx, cy - svc);
    ctx.moveTo(x0, cy + svc); ctx.lineTo(x0 + cwPx, cy + svc);
    ctx.moveTo(cx, cy - svc); ctx.lineTo(cx, cy + svc);
    ctx.stroke();
    // net shadow-ish center band
    ctx.fillStyle = 'rgba(10,60,110,0.10)';
    ctx.fillRect(x0, cy - 6, cwPx, 12);
  });

  const courtMat = new THREE.MeshPhysicalMaterial({
    map: courtTex,
    roughness: 0.62,
    clearcoat: 0.5,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.6,
  });
  const court = new THREE.Mesh(new THREE.PlaneGeometry(CW + apron * 2, CL + apron * 2), courtMat);
  court.rotation.x = -Math.PI / 2;
  court.receiveShadow = true;
  scene.add(court);

  // fever rainbow ring on the court (hidden until fever)
  const ringTex = canvasTexture(512, 512, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 360; i += 2) {
      ctx.strokeStyle = `hsla(${i}, 95%, 62%, 1)`;
      ctx.lineWidth = 36;
      ctx.beginPath();
      ctx.arc(cx, cy, 190, (i - 1) * Math.PI / 180, (i + 2) * Math.PI / 180);
      ctx.stroke();
    }
  });
  const feverRing = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: ringTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  feverRing.rotation.x = -Math.PI / 2;
  feverRing.position.y = 0.02;
  scene.add(feverRing);

  /* ---------------- NET ---------------- */
  const net = new THREE.Group();
  const postMat = toonMat('#f6f9ff');
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, COURT.netH + 0.25, 12);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(sx * (COURT.halfW + 0.55), (COURT.netH + 0.25) / 2, 0);
    post.castShadow = true;
    net.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), toonMat('#ffd23f'));
    cap.position.set(sx * (COURT.halfW + 0.55), COURT.netH + 0.3, 0);
    net.add(cap);
  }
  const netTex = canvasTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(240,248,255,0.9)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 10) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += 10) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }, { repeat: [3, 1] });
  const netMesh = new THREE.Mesh(
    new THREE.PlaneGeometry((COURT.halfW + 0.55) * 2, COURT.netH - 0.1),
    new THREE.MeshStandardMaterial({
      map: netTex, transparent: true, side: THREE.DoubleSide,
      roughness: 0.9, alphaTest: 0.15,
    })
  );
  netMesh.position.y = (COURT.netH - 0.1) / 2;
  netMesh.castShadow = true;
  net.add(netMesh);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry((COURT.halfW + 0.55) * 2, 0.09, 0.03),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 })
  );
  band.position.y = COURT.netH - 0.05;
  band.castShadow = true;
  net.add(band);
  scene.add(net);

  /* ---------------- STADIUM STANDS + CROWD ---------------- */
  const stadium = new THREE.Group();
  // ring parameters: superellipse-ish oval around the court
  const RX = 21, RZ = 26;
  const tierMatA = new THREE.MeshStandardMaterial({ color: '#5f8fd0', roughness: 0.85 });
  const tierMatB = new THREE.MeshStandardMaterial({ color: '#4a79b8', roughness: 0.85 });

  // stands: 3 stepped rings built from many box segments
  const SEG = 40;
  const tierGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let tier = 0; tier < 3; tier++) {
    const inst = new THREE.InstancedMesh(tierGeo, tier % 2 ? tierMatB : tierMatA, SEG);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const rx = RX + tier * 2.4, rz = RZ + tier * 2.4;
      const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      const segLen = 2 * Math.PI * ((rx + rz) / 2) / SEG * 1.06;
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      m.compose(
        new THREE.Vector3(x, 1.0 + tier * 1.7, z),
        q,
        new THREE.Vector3(segLen, 1.7, 2.6)
      );
      inst.setMatrixAt(i, m);
    }
    inst.receiveShadow = true;
    stadium.add(inst);
  }

  // outer wall
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(31, 31, 7.5, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: '#e8f1fb', roughness: 0.95, side: THREE.DoubleSide })
  );
  wall.scale.set(1, 1, (RZ + 7) / (RX + 7));
  wall.position.y = 3.75;
  stadium.add(wall);

  // colorful rim band on the wall top
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(31, 0.45, 8, 64),
    new THREE.MeshStandardMaterial({ color: '#ff6b8d', roughness: 0.6 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1, (RZ + 7) / (RX + 7), 1);
  rim.position.y = 7.6;
  stadium.add(rim);

  scene.add(stadium);

  /* crowd — instanced happy blobs that bounce in the vertex shader */
  const CROWD_N = 640;
  const crowdGeo = new THREE.SphereGeometry(0.34, 10, 9);
  crowdGeo.scale(1, 1.25, 1);
  const crowdMat = new THREE.MeshLambertMaterial({});
  const crowdUniforms = { uTime: { value: 0 }, uAmp: { value: 0.05 }, uSpeed: { value: 3.0 } };
  crowdMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = crowdUniforms.uTime;
    sh.uniforms.uAmp = crowdUniforms.uAmp;
    sh.uniforms.uSpeed = crowdUniforms.uSpeed;
    sh.vertexShader = `
      attribute float aPhase;
      uniform float uTime, uAmp, uSpeed;
    ` + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float bounce = abs(sin(uTime * uSpeed + aPhase));
       transformed.y += bounce * uAmp * (14.0 + 6.0 * sin(aPhase * 3.7));`
    );
  };
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, CROWD_N);
  crowd.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const phases = new Float32Array(CROWD_N);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const happy = ['#ff8fb8', '#ffb347', '#5fd18a', '#7db9ff', '#c39bff', '#ff8a58', '#ffe066', '#7fe3e0'];
    const col = new THREE.Color();
    for (let i = 0; i < CROWD_N; i++) {
      const tier = i % 3;
      const a = Math.random() * Math.PI * 2;
      const rx = RX + tier * 2.4 + (Math.random() - 0.5) * 1.2;
      const rz = RZ + tier * 2.4 + (Math.random() - 0.5) * 1.2;
      q.setFromAxisAngle(up, -a + Math.PI / 2);
      m.compose(
        new THREE.Vector3(Math.cos(a) * rx, 2.15 + tier * 1.7, Math.sin(a) * rz),
        q,
        new THREE.Vector3(0.9 + Math.random() * 0.35, 0.9 + Math.random() * 0.4, 0.9)
      );
      crowd.setMatrixAt(i, m);
      col.set(happy[i % happy.length]);
      col.offsetHSL((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.08);
      crowd.setColorAt(i, col);
      phases[i] = Math.random() * Math.PI * 2;
    }
  }
  crowdGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  crowd.castShadow = false;
  scene.add(crowd);

  /* ---------------- JUMBOTRON (big screen shows the rally) ---------------- */
  const jumboCanvas = document.createElement('canvas');
  jumboCanvas.width = 512; jumboCanvas.height = 288;
  const jumboCtx = jumboCanvas.getContext('2d');
  const jumboTex = new THREE.CanvasTexture(jumboCanvas);
  jumboTex.colorSpace = THREE.SRGBColorSpace;
  function drawJumbo(rally, feverOn) {
    const ctx = jumboCtx, w = 512, h = 288;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    if (feverOn) {
      g.addColorStop(0, '#ff3f8e'); g.addColorStop(0.5, '#b44dff'); g.addColorStop(1, '#37b6ff');
    } else {
      g.addColorStop(0, '#123c78'); g.addColorStop(1, '#0a2a58');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (feverOn) {
      ctx.fillStyle = '#fff';
      ctx.font = '900 84px sans-serif';
      ctx.fillText('FEVER!!', w / 2, h / 2 - 20);
      ctx.font = '900 44px sans-serif';
      ctx.fillText('★★★★★', w / 2, h / 2 + 62);
    } else {
      ctx.fillStyle = '#ffd23f';
      ctx.font = '900 120px sans-serif';
      ctx.fillText(String(rally), w / 2, h / 2 - 8);
      ctx.fillStyle = '#bfe0ff';
      ctx.font = '700 40px sans-serif';
      ctx.fillText('RALLY', w / 2, h / 2 + 80);
    }
    jumboTex.needsUpdate = true;
  }
  drawJumbo(0, false);
  const jumbo = new THREE.Group();
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 5.1),
    new THREE.MeshBasicMaterial({ map: jumboTex, toneMapped: false })
  );
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(9.7, 5.8, 0.5),
    new THREE.MeshStandardMaterial({ color: '#2c3e57', roughness: 0.7 })
  );
  frame.position.z = -0.3;
  jumbo.add(frame, screen);
  jumbo.position.set(0, 10.2, -33);
  scene.add(jumbo);

  /* ---------------- FLOODLIGHT TOWERS ---------------- */
  const flareTex = radialTexture(128, [
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,250,220,0.7)'],
    [1, 'rgba(255,250,220,0)'],
  ]);
  const towerMat = new THREE.MeshStandardMaterial({ color: '#dfe9f5', roughness: 0.8 });
  for (const [tx, tz] of [[-24, -20], [24, -20], [-24, 20], [24, 20]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 14, 10), towerMat);
    pole.position.set(tx, 7, tz);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.6, 0.7), towerMat);
    head.position.set(tx, 14.4, tz);
    head.lookAt(0, 2, 0);
    scene.add(head);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flareTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.85,
    }));
    flare.position.set(tx * 0.97, 14.4, tz * 0.97);
    flare.scale.setScalar(5.5);
    scene.add(flare);
  }

  /* ---------------- BUNTING FLAGS ---------------- */
  const flagCols = ['#ff6b8d', '#ffd23f', '#5fd18a', '#37b6ff', '#c39bff'];
  const flags = [];
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setFromPoints([
    new THREE.Vector3(-0.45, 0, 0), new THREE.Vector3(0.45, 0, 0), new THREE.Vector3(0, -0.85, 0),
  ]);
  flagGeo.setIndex([0, 2, 1]);
  flagGeo.computeVertexNormals();
  const FSEG = 44;
  for (let i = 0; i < FSEG; i++) {
    const a = (i / FSEG) * Math.PI * 2;
    const f = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({
      color: flagCols[i % flagCols.length], side: THREE.DoubleSide,
    }));
    f.position.set(Math.cos(a) * (RX - 1.6), 6.9 + Math.sin(i * 2.3) * 0.15, Math.sin(a) * (RZ - 1.6));
    f.lookAt(0, 6.5, 0);
    scene.add(f);
    flags.push({ m: f, ph: i * 0.6, baseRotZ: 0 });
  }

  /* ---------------- BALLOONS ---------------- */
  const balloons = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const col = flagCols[i % flagCols.length];
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 14), toonMat(col));
    b.scale.y = 1.15;
    const shine = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
    shine.position.set(-0.3, 0.35, 0.55);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.25, 8), toonMat(col));
    knot.position.y = -1.05;
    knot.rotation.x = Math.PI;
    g.add(b, shine, knot);
    const a = (i / 8) * Math.PI * 2 + 0.4;
    g.position.set(Math.cos(a) * (RX + 3), 10.5 + (i % 3) * 1.6, Math.sin(a) * (RZ + 3));
    scene.add(g);
    balloons.push({ g, ph: i * 1.31, baseY: g.position.y });
  }

  /* ---------------- HILLS & TREES (outside stadium) ---------------- */
  const hillMat = toonMat('#8fd47e');
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 70 + (i % 4) * 22;
    const s = 14 + ((i * 5) % 4) * 7;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    hill.scale.set(s * 1.6, s * 0.55, s * 1.6);
    hill.position.set(Math.cos(a) * r, -0.1, Math.sin(a) * r);
    scene.add(hill);
  }
  const trunkMat = toonMat('#a4715c');
  const leafMat = toonMat('#4faf58');
  const leafMat2 = toonMat('#63c46b');
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + 0.9;
    const r = 44 + ((i * 13) % 5) * 9;
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.6, 8), trunkMat);
    trunk.position.y = 1.3;
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.1, 12, 10), (i % 2) ? leafMat : leafMat2);
    crown.position.y = 3.6;
    crown.scale.y = 1.15;
    t.add(trunk, crown);
    const sc = 0.9 + ((i * 7) % 4) * 0.28;
    t.scale.setScalar(sc);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(t);
  }

  /* ============================================================
     per-frame update
  ============================================================ */
  world.update = (dt, t) => {
    skyUniforms.uTime.value = t;
    skyUniforms.uFever.value += ((world.fever ? 1 : 0) - skyUniforms.uFever.value) * Math.min(1, dt * 2.2);
    const fv = skyUniforms.uFever.value;

    crowdUniforms.uTime.value = t;
    const targetAmp = 0.012 + world.excitement * 0.02 + fv * 0.05;
    crowdUniforms.uAmp.value += (targetAmp - crowdUniforms.uAmp.value) * Math.min(1, dt * 3);
    crowdUniforms.uSpeed.value = 3.0 + fv * 3.5;

    for (const c of cloudList) {
      c.g.position.x += c.speed * dt;
      if (c.g.position.x > 160) c.g.position.x = -160;
      c.g.position.y = c.baseY + Math.sin(t * 0.3 + c.ph) * 1.2;
    }

    for (const f of flags) {
      f.m.rotation.z = Math.sin(t * 2.4 + f.ph) * 0.24;
    }
    for (const b of balloons) {
      b.g.position.y = b.baseY + Math.sin(t * 0.8 + b.ph) * 0.7;
      b.g.rotation.z = Math.sin(t * 0.6 + b.ph) * 0.1;
    }

    // fever visuals
    feverRing.material.opacity += ((world.fever ? 0.5 : 0) - feverRing.material.opacity) * Math.min(1, dt * 3);
    feverRing.rotation.z = t * 0.8;
    const s = 1 + Math.sin(t * 4) * 0.05;
    feverRing.scale.set(s, s, 1);

    for (let i = 0; i < partyLights.length; i++) {
      const pl = partyLights[i];
      pl.intensity += ((world.fever ? 55 : 0) - pl.intensity) * Math.min(1, dt * 3);
      if (world.fever) {
        const a = t * 1.4 + (i / 4) * Math.PI * 2;
        pl.position.set(Math.cos(a) * 11, 7 + Math.sin(t * 2 + i) * 2.5, Math.sin(a) * 13);
      }
    }

    // sunlight warms up during fever
    sunLight.intensity = 2.6 + fv * 0.5;
    hemi.intensity = 0.75 + fv * 0.2;
  };

  world.setFever = (on) => { world.fever = on; };
  world.setExcitement = (v) => { world.excitement = v; };
  world.drawJumbo = drawJumbo;

  return world;
}
