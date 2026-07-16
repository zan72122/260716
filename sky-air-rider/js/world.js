/* ============================================================
   world.js — そらのエアライダーの世界
   空・海・浮島・草原・スプラインコース・アイテムの生成と更新
   ============================================================ */
import * as THREE from 'three';
import { toon, hsl, mergeGeoms, mat4, canvasTexture, starGeometry, makeRng, addRim } from './lib3d.js';

export const ROAD_HW = 6.5;          // コース半幅
const LUT_N = 1024;                  // コース標本数
const WATER_Y = -2.6;

/* ============================================================ */
export class World {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(20260716);
    this.time = 0;

    this._buildCurve();
    this._buildLighting();
    this._buildSky();
    this._buildSea();
    this._buildTerrain();
    this._buildRoad();
    this._buildGate();
    this._buildDecorations();
    this._buildItems();
  }

  /* ------------------------------------------------------------
     コースのスプラインと参照テーブル (位置・接線・バンクした右/上)
     ------------------------------------------------------------ */
  _buildCurve() {
    const pts = [];
    const NP = 14;
    for (let i = 0; i < NP; i++) {
      const a = (i / NP) * Math.PI * 2;
      const r = 225 + Math.sin(a * 3 + 1.7) * 48 + Math.cos(a * 2 + 0.4) * 30;
      const h = 10 + Math.sin(a * 2 + 0.9) * 7.5 + Math.cos(a * 3 + 2.1) * 5;
      pts.push(new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r));
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.length = this.curve.getLength();

    const UP = new THREE.Vector3(0, 1, 0);
    const lut = { pos: [], tan: [], right: [], up: [] };
    const headings = [];
    for (let i = 0; i < LUT_N; i++) {
      const u = i / LUT_N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u);
      lut.pos.push(p); lut.tan.push(t);
      headings.push(Math.atan2(t.x, t.z));
    }
    // 符号つき曲率 → バンク角 (箱型平滑化でなめらかに)
    const ds = this.length / LUT_N;
    const bank = new Float32Array(LUT_N);
    for (let i = 0; i < LUT_N; i++) {
      let d = headings[(i + 1) % LUT_N] - headings[i];
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      // カーブの外側が持ち上がるように傾ける (d>0 = 世界+X方向へ旋回 → +X側が内側)
      bank[i] = THREE.MathUtils.clamp(-(d / ds) * 22.0, -0.5, 0.5);
    }
    const sm = new Float32Array(LUT_N);
    const W = 18;
    for (let i = 0; i < LUT_N; i++) {
      let acc = 0;
      for (let k = -W; k <= W; k++) acc += bank[(i + k + LUT_N) % LUT_N];
      sm[i] = acc / (W * 2 + 1);
    }
    for (let i = 0; i < LUT_N; i++) {
      const t = lut.tan[i];
      const right = new THREE.Vector3().crossVectors(UP, t).normalize();
      const up = new THREE.Vector3().crossVectors(t, right).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(t, sm[i]);
      right.applyQuaternion(q);
      up.applyQuaternion(q);
      lut.right.push(right); lut.up.push(up);
    }
    this.lut = lut;

    // 地形の平坦化・配置判定用の間引き標本
    this.roadSamples = [];
    for (let i = 0; i < LUT_N; i += 4) {
      const p = lut.pos[i];
      this.roadSamples.push([p.x, p.y, p.z]);
    }
  }

  /** 走行距離 s (0..length) におけるコース座標系を out に書き込む */
  frameAt(s, out) {
    const L = this.length;
    s = ((s % L) + L) % L;
    const f = (s / L) * LUT_N;
    const i0 = Math.floor(f) % LUT_N;
    const i1 = (i0 + 1) % LUT_N;
    const a = f - Math.floor(f);
    out.pos.lerpVectors(this.lut.pos[i0], this.lut.pos[i1], a);
    out.tan.lerpVectors(this.lut.tan[i0], this.lut.tan[i1], a).normalize();
    out.right.lerpVectors(this.lut.right[i0], this.lut.right[i1], a).normalize();
    out.up.lerpVectors(this.lut.up[i0], this.lut.up[i1], a).normalize();
    return out;
  }

  static makeFrame() {
    return {
      pos: new THREE.Vector3(), tan: new THREE.Vector3(),
      right: new THREE.Vector3(), up: new THREE.Vector3(),
    };
  }

  /* ------------------------------------------------------------
     ライティング
     ------------------------------------------------------------ */
  _buildLighting() {
    const hemi = new THREE.HemisphereLight(0xbfe4ff, 0xffd9bd, 0.72);
    this.scene.add(hemi);

    this.sunDir = new THREE.Vector3(0.45, 0.62, 0.34).normalize();
    const sun = new THREE.DirectionalLight(0xfff3dc, 1.55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 20;
    sun.shadow.camera.far = 420;
    const S = 60;
    sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
    sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;

    this.scene.fog = new THREE.Fog(0xc8e2ff, 320, 1250);
  }

  /** 太陽の影カメラをプレイヤーに追従させる */
  updateShadowTarget(p) {
    this.sun.position.copy(p).addScaledVector(this.sunDir, 180);
    this.sun.target.position.copy(p);
  }

  /* ------------------------------------------------------------
     空: グラデーションドーム + 太陽 + 遠景の山
     ------------------------------------------------------------ */
  _buildSky() {
    const geo = new THREE.SphereGeometry(1500, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      uniforms: {
        uSunDir: { value: this.sunDir },
        uZenith: { value: new THREE.Color(0x3d9af0) },
        uMid: { value: new THREE.Color(0x9fd6ff) },
        uHorizon: { value: new THREE.Color(0xfeeedd) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uSunDir, uZenith, uMid, uHorizon;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.08, 1.0);
          vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.24, h));
          col = mix(col, uZenith, smoothstep(0.2, 0.75, h));
          float sd = clamp(dot(d, uSunDir), 0.0, 1.0);
          col += vec3(1.0, 0.86, 0.6) * pow(sd, 90.0) * 0.3;    // 太陽まわりの照り
          col += vec3(1.0, 0.95, 0.8) * smoothstep(0.9993, 0.9997, sd) * 2.4; // 太陽円盤
          col += vec3(1.0, 0.72, 0.5) * pow(1.0 - abs(d.y), 6.0) * 0.12;      // 地平の暖気
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    // 太陽の発光スプライト (ブルーム源)
    const sunTex = canvasTexture(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,250,235,1)');
      g.addColorStop(0.25, 'rgba(255,240,200,0.85)');
      g.addColorStop(0.6, 'rgba(255,215,150,0.25)');
      g.addColorStop(1, 'rgba(255,200,130,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    });
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: sunTex, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending,
    }));
    sunSpr.position.copy(this.sunDir).multiplyScalar(1350);
    sunSpr.scale.setScalar(210);
    this.scene.add(sunSpr);

    // 遠景の山なみ (雪冠つき)
    const mats = [toon(0x7fa5dd, { rim: false }), toon(0x93b9e8, { rim: false })];
    const capMat = toon(0xfefeff, { rim: false });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rng() * 0.4;
      const r = 820 + this.rng() * 220;
      const h = 130 + this.rng() * 190;
      const R = 90 + this.rng() * 130;
      const m = new THREE.Mesh(new THREE.ConeGeometry(R, h, 6), mats[i % 2]);
      m.position.set(Math.cos(a) * r, h * 0.28 + WATER_Y, Math.sin(a) * r);
      m.rotation.y = this.rng() * Math.PI;
      const capH = h * 0.26;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(R * 0.285, capH, 6), capMat);
      cap.position.y = h / 2 - capH / 2 + 0.5;
      m.add(cap);
      this.scene.add(m);
    }
  }

  /* ------------------------------------------------------------
     海: きらめきアニメーションつきシェーダー
     ------------------------------------------------------------ */
  _buildSea() {
    const geo = new THREE.CircleGeometry(2400, 48);
    geo.rotateX(-Math.PI / 2);
    this.seaMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x2f8fdb) },
        uLight: { value: new THREE.Color(0x7fd8f7) },
        uFog: { value: new THREE.Color(0xcbe6ff) },
        uSunDir: { value: this.sunDir },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeep, uLight, uFog, uSunDir;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz;
          float w1 = sin(p.x * 0.055 + uTime * 0.9) * sin(p.y * 0.047 - uTime * 0.7);
          float w2 = sin(p.x * 0.021 - uTime * 0.4 + p.y * 0.031);
          float mixv = 0.5 + 0.32 * w1 + 0.18 * w2;
          vec3 col = mix(uDeep, uLight, mixv);
          // 太陽のきらめき
          float sp = sin(p.x * 0.9 + uTime * 2.2) * sin(p.y * 1.1 - uTime * 1.9)
                   * sin(p.x * 0.53 - uTime * 1.2);
          float glint = smoothstep(0.86, 0.99, sp) * 1.6;
          col += vec3(1.0, 0.96, 0.8) * glint;
          // 距離フォグへ溶かす
          float dist = distance(vWorld, cameraPosition);
          col = mix(col, uFog, smoothstep(320.0, 1200.0, dist));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sea = new THREE.Mesh(geo, this.seaMat);
    sea.position.y = WATER_Y;
    this.scene.add(sea);
  }

  /* ------------------------------------------------------------
     地形ノイズ
     ------------------------------------------------------------ */
  _hash(ix, iz) {
    let n = (ix * 374761393 + iz * 668265263) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }
  _vnoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = this._hash(ix, iz), b = this._hash(ix + 1, iz);
    const c = this._hash(ix, iz + 1), d = this._hash(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }
  _fbm(x, z) {
    return this._vnoise(x, z) * 0.6 + this._vnoise(x * 2.13, z * 2.13) * 0.28
      + this._vnoise(x * 4.7, z * 4.7) * 0.12;
  }
  /** 島の素の高さ (道の平坦化なし) */
  islandHeight(x, z) {
    let h = this._fbm(x * 0.008 + 10, z * 0.008 + 10) * 30 - 8;
    h += this._fbm(x * 0.028, z * 0.028) * 4 - 2;
    const r = Math.hypot(x, z);
    const fall = Math.max(0, (r - 540) / 90);
    h -= fall * fall * 14;
    return h;
  }
  /** 道からの最短距離(平面) */
  roadDistance(x, z) {
    let best = 1e9;
    const rs = this.roadSamples;
    for (let i = 0; i < rs.length; i++) {
      const dx = x - rs[i][0], dz = z - rs[i][2];
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
  _roadInfoAt(x, z) {
    let best = 1e9, bi = 0;
    const rs = this.roadSamples;
    for (let i = 0; i < rs.length; i++) {
      const dx = x - rs[i][0], dz = z - rs[i][2];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    return { dist: Math.sqrt(best), roadY: rs[bi][1] };
  }

  /* ------------------------------------------------------------
     地形: ゆるやかな丘の島 (頂点カラー / 道の下は平坦化)
     ------------------------------------------------------------ */
  _buildTerrain() {
    const SIZE = 1360, SEG = 130;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cGrass1 = new THREE.Color(0x63cc58), cGrass2 = new THREE.Color(0x3fae4e);
    const cGrassHi = new THREE.Color(0x8ce27e);
    const cSand = new THREE.Color(0xf7dfa1);
    const cCliff = new THREE.Color(0xc9a06a);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = this.islandHeight(x, z);
      const info = this._roadInfoAt(x, z);
      if (info.dist < 34) {
        const under = info.roadY - 3.2;
        if (info.dist < 10) {
          h = under;
        } else {
          const a = (info.dist - 10) / 24;
          const k = a * a * (3 - 2 * a);
          h = under * (1 - k) + h * k;
        }
      }
      pos.setY(i, h);

      // 頂点カラー
      const n = this._fbm(x * 0.02 + 55, z * 0.02 + 55);
      if (h < WATER_Y + 1.6) {
        tmp.copy(cSand);
      } else if (h < WATER_Y + 3.2) {
        tmp.copy(cSand).lerp(cGrass1, (h - WATER_Y - 1.6) / 1.6);
      } else {
        tmp.copy(cGrass1).lerp(cGrass2, n);
        tmp.lerp(cGrassHi, THREE.MathUtils.clamp((h - 14) / 22, 0, 1) * 0.7);
        if (this._hash(Math.round(x * 3), Math.round(z * 3)) > 0.985) {
          tmp.lerp(new THREE.Color(0xfff3a8), 0.55); // 花のきらめき
        }
      }
      if (h > 26) tmp.lerp(cCliff, THREE.MathUtils.clamp((h - 26) / 18, 0, 0.5));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = toon(0xffffff, { vertexColors: true, rimStrength: 0.1 });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    this.terrain = terrain;
  }

  /* ------------------------------------------------------------
     コース: にじの縁どり + クリーム色の路面 + 側面スカート
     ------------------------------------------------------------ */
  _buildRoad() {
    const hw = ROAD_HW;
    const cross = [
      { x: -hw,        y: -2.0,  c: 'side' },
      { x: -hw,        y: 0.06,  c: 'stripe' },
      { x: -hw + 1.3,  y: 0.16,  c: 'stripe' },
      { x: -hw + 1.3,  y: 0.16,  c: 'main' },
      { x: -2.2,       y: 0.22,  c: 'main' },
      { x: 0,          y: 0.26,  c: 'mainC' },
      { x: 2.2,        y: 0.22,  c: 'main' },
      { x: hw - 1.3,   y: 0.16,  c: 'main' },
      { x: hw - 1.3,   y: 0.16,  c: 'stripe' },
      { x: hw,         y: 0.06,  c: 'stripe' },
      { x: hw,         y: -2.0,  c: 'side' },
    ];
    const CW = cross.length;
    const rows = LUT_N + 1;
    const positions = new Float32Array(rows * CW * 3);
    const colors = new Float32Array(rows * CW * 3);
    const cMain = new THREE.Color(0xfff5e8);
    const cMainC = new THREE.Color(0xffeaf2);
    const cSide = new THREE.Color(0xd987c3);
    const tmp = new THREE.Color();
    const v = new THREE.Vector3();

    for (let r = 0; r < rows; r++) {
      const i = r % LUT_N;
      const p = this.lut.pos[i], right = this.lut.right[i], up = this.lut.up[i];
      // にじ色は行ごと (トラック12周期のレインボー)
      const hue = (i / LUT_N) * 12;
      for (let ci = 0; ci < CW; ci++) {
        const cp = cross[ci];
        v.copy(p).addScaledVector(right, cp.x).addScaledVector(up, cp.y);
        const idx = (r * CW + ci) * 3;
        positions[idx] = v.x; positions[idx + 1] = v.y; positions[idx + 2] = v.z;
        if (cp.c === 'stripe') tmp.copy(hsl(hue, 0.82, 0.62));
        else if (cp.c === 'main') tmp.copy(cMain);
        else if (cp.c === 'mainC') tmp.copy(cMainC);
        else tmp.copy(cSide);
        colors[idx] = tmp.r; colors[idx + 1] = tmp.g; colors[idx + 2] = tmp.b;
      }
    }
    const indices = [];
    for (let r = 0; r < LUT_N; r++) {
      for (let ci = 0; ci < CW - 1; ci++) {
        const a = r * CW + ci, b = a + CW;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = toon(0xffffff, { vertexColors: true, rimStrength: 0.08 });
    const road = new THREE.Mesh(geo, mat);
    road.receiveShadow = true;
    this.scene.add(road);

    // ---- ふちどりのキャンディポール ----
    const poleGeom = mergeGeoms([
      { geom: new THREE.CylinderGeometry(0.16, 0.2, 1.5, 6), matrix: mat4(0, 0.75, 0), color: 0xfff6ee },
      { geom: new THREE.SphereGeometry(0.5, 10, 8), matrix: mat4(0, 1.7, 0), color: 0xffffff },
    ]);
    const poleMat = toon(0xffffff, { vertexColors: true });
    const NPOLE = 128;
    const poles = new THREE.InstancedMesh(poleGeom, poleMat, NPOLE);
    const dummy = new THREE.Object3D();
    const pcol = new THREE.Color();
    for (let k = 0; k < NPOLE; k++) {
      const i = Math.floor((k / NPOLE) * LUT_N);
      const side = k % 2 === 0 ? 1 : -1;
      const p = this.lut.pos[i], right = this.lut.right[i], up = this.lut.up[i];
      dummy.position.copy(p).addScaledVector(right, side * (hw + 1.1)).addScaledVector(up, -0.4);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      dummy.updateMatrix();
      poles.setMatrixAt(k, dummy.matrix);
      poles.setColorAt(k, pcol.copy(hsl(k / 10, 0.8, 0.66)));
    }
    poles.castShadow = true;
    this.scene.add(poles);
  }

  /* ------------------------------------------------------------
     スタートゲート
     ------------------------------------------------------------ */
  _buildGate() {
    const f = World.makeFrame();
    this.frameAt(2, f);
    const group = new THREE.Group();
    group.position.copy(f.pos);
    const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.tan);
    group.quaternion.setFromRotationMatrix(m);

    // だんご柱 (カラフルな球を積む)
    const ballGeo = new THREE.SphereGeometry(1.05, 14, 12);
    const palette = [0xff6fa8, 0xffd93d, 0x6fd8ff, 0x9dff6f, 0xc98fff];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(ballGeo, toon(palette[i % palette.length]));
        b.position.set(side * (ROAD_HW + 1.6), 0.6 + i * 1.75, 0);
        b.castShadow = true;
        group.add(b);
      }
    }
    // バナー
    const bannerTex = canvasTexture(512, 128, (c, w, h) => {
      c.fillStyle = '#ff5fa8';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffffff';
      for (let i = 0; i < 16; i++) {
        c.beginPath();
        c.arc((i + 0.5) * (w / 16), i % 2 === 0 ? 14 : h - 14, 7, 0, Math.PI * 2);
        c.fill();
      }
      c.font = '900 76px sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 10; c.strokeStyle = '#c22e78';
      c.strokeText('すたーと', w / 2, h / 2 + 4);
      c.fillStyle = '#fff';
      c.fillText('すたーと', w / 2, h / 2 + 4);
    });
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry((ROAD_HW + 1.6) * 2 + 2.4, 3.4, 0.7),
      new THREE.MeshToonMaterial({ map: bannerTex, gradientMap: null })
    );
    banner.position.set(0, 14.4, 0);
    banner.castShadow = true;
    group.add(banner);
    // てっぺんの星
    const topStar = new THREE.Mesh(
      starGeometry(2.0, 0.9, 0.5),
      toon(0xffd93d, { emissive: 0xffb830, emissiveIntensity: 0.8 })
    );
    topStar.position.set(0, 18.4, 0);
    group.add(topStar);
    this.gateStar = topStar;

    // チェッカー帯 (路面)
    const checkTex = canvasTexture(256, 128, (c, w, h) => {
      const n = 8;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 4; j++) {
          c.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#5a4a6a';
          c.fillRect(i * (w / n), j * (h / 4), w / n, h / 4);
        }
      }
    });
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HW * 2 - 0.8, 5),
      new THREE.MeshBasicMaterial({ map: checkTex })
    );
    band.position.set(0, 0.42, 0);
    band.rotation.x = -Math.PI / 2;
    group.add(band);

    this.scene.add(group);
  }

  /* ------------------------------------------------------------
     デコレーション: 木・花・きのこ・気球・浮島・雲
     ------------------------------------------------------------ */
  _placeOnLand(minR, maxR, minRoadDist, tries = 60) {
    for (let t = 0; t < tries; t++) {
      const a = this.rng() * Math.PI * 2;
      const r = minR + this.rng() * (maxR - minR);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = this.islandHeight(x, z);
      if (h < WATER_Y + 2.2) continue;
      if (this.roadDistance(x, z) < minRoadDist) continue;
      return [x, h, z];
    }
    return null;
  }

  _buildDecorations() {
    const rng = this.rng;
    /* ---- 木 (インスタンス化したもこもこツリー) ---- */
    const treeGeom = mergeGeoms([
      { geom: new THREE.CylinderGeometry(0.32, 0.48, 2.4, 7), matrix: mat4(0, 1.2, 0), color: 0x9a6540 },
      { geom: new THREE.SphereGeometry(1.75, 12, 10), matrix: mat4(0, 3.6, 0), color: 0x54c46a },
      { geom: new THREE.SphereGeometry(1.25, 10, 8), matrix: mat4(-1.1, 2.9, 0.35), color: 0x47b45d },
      { geom: new THREE.SphereGeometry(1.3, 10, 8), matrix: mat4(1.05, 3.05, -0.3), color: 0x66d377 },
      { geom: new THREE.SphereGeometry(1.0, 10, 8), matrix: mat4(0.15, 4.7, 0.2), color: 0x7fe288 },
    ]);
    const treeMat = toon(0xffffff, { vertexColors: true, rimStrength: 0.18 });
    const NT = 90;
    const trees = new THREE.InstancedMesh(treeGeom, treeMat, NT);
    const dummy = new THREE.Object3D();
    let placed = 0;
    while (placed < NT) {
      const spot = this._placeOnLand(30, 520, 13);
      if (!spot) break;
      dummy.position.set(spot[0], spot[1] - 0.3, spot[2]);
      dummy.rotation.y = rng() * Math.PI * 2;
      const s = 0.7 + rng() * 1.1;
      dummy.scale.set(s, s * (0.9 + rng() * 0.3), s);
      dummy.updateMatrix();
      trees.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    trees.count = placed;
    trees.castShadow = true;
    this.scene.add(trees);

    /* ---- 花 (インスタンスカラーで色とりどり) ---- */
    const petal = new THREE.SphereGeometry(0.3, 8, 6);
    const flowerEntries = [
      { geom: new THREE.CylinderGeometry(0.05, 0.07, 0.9, 5), matrix: mat4(0, 0.45, 0), color: 0x4faf55 },
      { geom: new THREE.SphereGeometry(0.19, 8, 6), matrix: mat4(0, 1.0, 0), color: 0xffe066 },
    ];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      flowerEntries.push({
        geom: petal,
        matrix: mat4(Math.cos(a) * 0.42, 1.0, Math.sin(a) * 0.42, 0, 0, 0, 1, 0.45, 1),
        color: 0xffffff,
      });
    }
    const flowerGeom = mergeGeoms(flowerEntries);
    const flowerMat = toon(0xffffff, { vertexColors: true, rim: false });
    const NF = 170;
    const flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, NF);
    const fcol = new THREE.Color();
    let fp = 0;
    while (fp < NF) {
      const spot = this._placeOnLand(20, 420, 9);
      if (!spot) break;
      dummy.position.set(spot[0], spot[1] - 0.1, spot[2]);
      dummy.rotation.y = rng() * Math.PI * 2;
      const s = 0.8 + rng() * 1.3;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      flowers.setMatrixAt(fp, dummy.matrix);
      flowers.setColorAt(fp, fcol.copy(hsl(rng(), 0.85, 0.72)));
      fp++;
    }
    flowers.count = fp;
    this.scene.add(flowers);

    /* ---- 大きなきのこ ---- */
    for (let i = 0; i < 7; i++) {
      const spot = this._placeOnLand(45, 460, 16);
      if (!spot) continue;
      const capCol = [0xff6f8f, 0xff9a56, 0x6fc8ff][i % 3];
      const dots = [];
      for (let d = 0; d < 6; d++) {
        const a = rng() * Math.PI * 2, rr = 1.1 + rng() * 1.4;
        dots.push({
          geom: new THREE.SphereGeometry(0.42, 8, 6),
          matrix: mat4(Math.cos(a) * rr, 2.9 + rng() * 0.7, Math.sin(a) * rr, 0, 0, 0, 1, 0.5, 1),
          color: 0xfff8ee,
        });
      }
      const g = mergeGeoms([
        { geom: new THREE.CylinderGeometry(0.9, 1.2, 2.6, 10), matrix: mat4(0, 1.3, 0), color: 0xfff0d8 },
        { geom: new THREE.SphereGeometry(2.6, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), matrix: mat4(0, 2.4, 0), color: capCol },
        ...dots,
      ]);
      const m = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true }));
      const s = 0.8 + rng() * 1.2;
      m.scale.setScalar(s);
      m.position.set(spot[0], spot[1] - 0.2, spot[2]);
      m.castShadow = true;
      this.scene.add(m);
    }

    /* ---- 気球 ---- */
    this.balloons = [];
    const balloonPalette = [0xff6fa8, 0xffd93d, 0x7fd4ff, 0xa8ff8f, 0xd8a8ff];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const r = 130 + rng() * 300;
      const g = new THREE.Group();
      const col = balloonPalette[i % balloonPalette.length];
      const body = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 14), toon(col, { rimStrength: 0.35 }));
      body.scale.y = 1.18;
      const basket = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 2.0), toon(0xb98a5e));
      basket.position.y = -6.4;
      const strMat = new THREE.LineBasicMaterial({ color: 0x8a6a4a });
      for (const [sx, sz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        const pts = [new THREE.Vector3(sx * 2, -3.4, sz * 2), new THREE.Vector3(sx, -5.7, sz)];
        g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), strMat));
      }
      g.add(body, basket);
      g.position.set(Math.cos(a) * r, 34 + rng() * 30, Math.sin(a) * r);
      g.userData.phase = rng() * Math.PI * 2;
      g.userData.baseY = g.position.y;
      this.scene.add(g);
      this.balloons.push(g);
    }

    /* ---- 浮島 ---- */
    this.floatIslands = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 1.2;
      const r = 240 + rng() * 320;
      const g = new THREE.Group();
      const size = 7 + rng() * 8;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(size, size * 1.5, 7), toon(0xb98a5e));
      rock.rotation.x = Math.PI;
      rock.position.y = -size * 0.75;
      const grass = new THREE.Mesh(
        new THREE.SphereGeometry(size, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.4),
        toon(0x63cc58, { rimStrength: 0.3 })
      );
      grass.scale.y = 0.45;
      const tree = new THREE.Mesh(
        mergeGeoms([
          { geom: new THREE.CylinderGeometry(0.3, 0.45, 2.2, 6), matrix: mat4(0, 1.1, 0), color: 0x9a6540 },
          { geom: new THREE.SphereGeometry(1.7, 10, 8), matrix: mat4(0, 3.4, 0), color: 0x54c46a },
        ]),
        toon(0xffffff, { vertexColors: true })
      );
      tree.position.y = size * 0.16;
      tree.scale.setScalar(size / 9);
      g.add(rock, grass, tree);
      g.position.set(Math.cos(a) * r, 46 + rng() * 42, Math.sin(a) * r);
      g.userData.phase = rng() * Math.PI * 2;
      g.userData.baseY = g.position.y;
      this.scene.add(g);
      this.floatIslands.push(g);
    }

    /* ---- 雲 (もこもこ球のクラスタ) ---- */
    this.cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshToonMaterial({
      color: 0xffffff, gradientMap: null,
      emissive: 0xdfeeff, emissiveIntensity: 0.28,
      transparent: true, opacity: 0.96,
    });
    for (let i = 0; i < 17; i++) {
      const puffs = [];
      const n = 3 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) {
        const rr = 4.5 + rng() * 6;
        puffs.push({
          geom: new THREE.SphereGeometry(rr, 10, 8),
          matrix: mat4((k - n / 2) * rr * 1.1, rng() * 2.4, (rng() - 0.5) * 4, 0, 0, 0, 1, 0.55, 1),
          color: 0xffffff,
        });
      }
      const cloud = new THREE.Mesh(mergeGeoms(puffs), cloudMat);
      const a = rng() * Math.PI * 2;
      const r = 220 + rng() * 620;
      cloud.position.set(Math.cos(a) * r, 55 + rng() * 110, Math.sin(a) * r);
      const s = 0.8 + rng() * 1.6;
      cloud.scale.setScalar(s);
      this.cloudGroup.add(cloud);
    }
    this.scene.add(this.cloudGroup);
  }

  /* ------------------------------------------------------------
     アイテム: 星 / にじリング / ダッシュパネル / ジャンプ台
     ------------------------------------------------------------ */
  _buildItems() {
    const rng = this.rng;
    /* ---- 星 (集めもの) ---- */
    this.stars = [];
    const starGeo = starGeometry(0.95, 0.42, 0.34);
    const starMat = toon(0xffd93d, {
      emissive: 0xffb010, emissiveIntensity: 1.25, rimStrength: 0.4, rimColor: 0xfff2b0,
    });
    // 配置パターン: 直線 / ゆるいスラローム / アーチ
    let s = 26;
    while (s < this.length - 30) {
      const kind = rng();
      if (kind < 0.45) {
        const x = (rng() - 0.5) * 7;
        for (let k = 0; k < 5; k++) this.stars.push({ s: s + k * 4.5, x, h: 2.1, taken: false });
        s += 5 * 4.5 + 26 + rng() * 26;
      } else if (kind < 0.8) {
        const dir = rng() > 0.5 ? 1 : -1;
        for (let k = 0; k < 6; k++) {
          this.stars.push({ s: s + k * 5, x: Math.sin(k / 5 * Math.PI) * 4 * dir, h: 2.1, taken: false });
        }
        s += 6 * 5 + 26 + rng() * 26;
      } else {
        for (let k = 0; k < 7; k++) {
          this.stars.push({ s: s + k * 4, x: 0, h: 2.1 + Math.sin(k / 6 * Math.PI) * 4.2, taken: false });
        }
        s += 7 * 4 + 30 + rng() * 30;
      }
    }
    this.starMesh = new THREE.InstancedMesh(starGeo, starMat, this.stars.length);
    this.starMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.starMesh);
    this._starFrame = World.makeFrame();
    this._starDummy = new THREE.Object3D();

    /* ---- にじリング ---- */
    this.rings = [];
    const ringGeo = new THREE.TorusGeometry(3.6, 0.45, 12, 40);
    for (let i = 0; i < 5; i++) {
      const rs = (i + 0.5) / 5 * this.length;
      const mat = toon(hsl(i / 5, 0.85, 0.6), {
        emissive: hsl(i / 5, 0.9, 0.5), emissiveIntensity: 1.5, rim: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      const f = World.makeFrame();
      this.frameAt(rs, f);
      mesh.position.copy(f.pos).addScaledVector(f.up, 3.4);
      const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.tan);
      mesh.quaternion.setFromRotationMatrix(m);
      // 内側のうっすら光る膜
      const film = new THREE.Mesh(
        new THREE.CircleGeometry(3.2, 32),
        new THREE.MeshBasicMaterial({
          color: hsl(i / 5, 0.8, 0.75), transparent: true, opacity: 0.16,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        })
      );
      mesh.add(film);
      this.scene.add(mesh);
      this.rings.push({ s: rs, h: 3.4, mesh, cooldown: 0 });
    }

    /* ---- ダッシュパネル ---- */
    this.dashTex = canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#ff8a00';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffe94d';
      for (const oy of [8, 56, 104]) {
        c.beginPath();
        c.moveTo(14, oy + 26); c.lineTo(w / 2, oy); c.lineTo(w - 14, oy + 26);
        c.lineTo(w - 14, oy + 4); c.lineTo(w / 2, oy - 22); c.lineTo(14, oy + 4);
        c.closePath(); c.fill();
      }
    }, { repeat: [1, 1] });
    this.dashTex.wrapT = THREE.RepeatWrapping;
    const dashMat = new THREE.MeshBasicMaterial({ map: this.dashTex });
    dashMat.color.setRGB(1.9, 1.5, 0.9); // ブルームに乗る明るさ
    this.dashPanels = [];
    const dashGeo = new THREE.PlaneGeometry(4.2, 5.4);
    for (let i = 0; i < 6; i++) {
      const dsPos = (i + 0.35) / 6 * this.length;
      const f = World.makeFrame();
      this.frameAt(dsPos, f);
      const mesh = new THREE.Mesh(dashGeo, dashMat);
      const off = (rng() - 0.5) * 4;
      mesh.position.copy(f.pos).addScaledVector(f.up, 0.42).addScaledVector(f.right, off);
      // 面の法線=up、テクスチャ上方向=進行方向
      const m = new THREE.Matrix4().makeBasis(f.right, f.tan, f.up);
      mesh.quaternion.setFromRotationMatrix(m);
      this.scene.add(mesh);
      this.dashPanels.push({ s: dsPos, x: off, cooldown: 0 });
    }

    /* ---- ジャンプ台 ---- */
    this.jumpPads = [];
    const rampMat = toon(0x6fc8ff, { emissive: 0x2f8fdb, emissiveIntensity: 0.9 });
    for (let i = 0; i < 2; i++) {
      const js = (i + 0.7) / 2 * this.length;
      const f = World.makeFrame();
      this.frameAt(js, f);
      // くさび形ランプ
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(5.6, 1.5, 6), rampMat);
      ramp.geometry.translate(0, 0.75, 0);
      const posArr = ramp.geometry.attributes.position;
      for (let vi = 0; vi < posArr.count; vi++) {
        if (posArr.getY(vi) > 1 && posArr.getZ(vi) > 0) posArr.setY(vi, 0.12);
      }
      ramp.geometry.computeVertexNormals();
      ramp.position.copy(f.pos).addScaledVector(f.up, 0.1);
      const m = new THREE.Matrix4().makeBasis(f.right, f.up, f.tan);
      ramp.quaternion.setFromRotationMatrix(m);
      ramp.castShadow = true;
      this.scene.add(ramp);
      this.jumpPads.push({ s: js, cooldown: 0 });
      // 空中の星アーチ
      for (let k = 0; k < 6; k++) {
        this.stars.push({ s: js + 8 + k * 5.5, x: 0, h: 3 + Math.sin((k / 5) * Math.PI) * 6.5, taken: false });
      }
    }
    // ジャンプ台の追加分を含めて星メッシュを作り直し
    this.scene.remove(this.starMesh);
    this.starMesh.dispose();
    this.starMesh = new THREE.InstancedMesh(starGeo, starMat, this.stars.length);
    this.starMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.starMesh.castShadow = false;
    this.scene.add(this.starMesh);
  }

  /** 星をぜんぶ復活させる (ラップごと) */
  respawnStars() {
    for (const st of this.stars) st.taken = false;
  }

  /* ------------------------------------------------------------
     毎フレーム更新
     ------------------------------------------------------------ */
  update(dt, camera) {
    this.time += dt;
    const t = this.time;

    // 星スピン
    const f = this._starFrame, d = this._starDummy;
    const spin = t * 2.2;
    for (let i = 0; i < this.stars.length; i++) {
      const st = this.stars[i];
      if (st.taken) {
        d.scale.setScalar(0.0001);
        d.position.set(0, -100, 0);
      } else {
        this.frameAt(st.s, f);
        d.position.copy(f.pos)
          .addScaledVector(f.right, st.x)
          .addScaledVector(f.up, st.h + Math.sin(t * 2.4 + st.s * 0.4) * 0.25);
        d.rotation.set(0, spin + st.s * 0.15, 0);
        d.scale.setScalar(1);
      }
      d.updateMatrix();
      this.starMesh.setMatrixAt(i, d.matrix);
    }
    this.starMesh.instanceMatrix.needsUpdate = true;

    // リングくるくる & 膜のゆらぎ
    for (const r of this.rings) {
      r.mesh.rotateZ(dt * 0.7);
      if (r.cooldown > 0) r.cooldown -= dt;
    }
    for (const p of this.dashPanels) if (p.cooldown > 0) p.cooldown -= dt;
    for (const p of this.jumpPads) if (p.cooldown > 0) p.cooldown -= dt;

    // ダッシュパネルの矢印スクロール
    this.dashTex.offset.y = -t * 1.6;

    // ゲートの星
    if (this.gateStar) this.gateStar.rotation.y = t * 1.4;

    // 気球・浮島・雲
    for (const b of this.balloons) {
      b.position.y = b.userData.baseY + Math.sin(t * 0.5 + b.userData.phase) * 2.4;
      b.rotation.y = t * 0.1 + b.userData.phase;
    }
    for (const isl of this.floatIslands) {
      isl.position.y = isl.userData.baseY + Math.sin(t * 0.4 + isl.userData.phase) * 3;
    }
    this.cloudGroup.rotation.y = t * 0.004;

    // 海
    this.seaMat.uniforms.uTime.value = t;

    // 空ドームはカメラに追従 (どこまでも続く空)
    if (camera) this.sky.position.copy(camera.position);
  }
}
