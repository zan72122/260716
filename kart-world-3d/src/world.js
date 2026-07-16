// world.js — 島・コース・空・海・草木・ギミックなど、世界のすべてを生成する
import * as THREE from 'three';

/* ============================================================
 *  ノイズ（軽量 value-noise + fbm）
 * ============================================================ */
function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let f = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) { f += amp * vnoise(x * fr, y * fr); amp *= 0.5; fr *= 2.03; }
  return f;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, t) => { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function gauss(x, z, cx, cz, r) {
  const dx = x - cx, dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (r * r));
}

/* ============================================================
 *  トゥーン用グラデーションマップ / 共通マテリアル
 * ============================================================ */
let _gradTex = null;
function gradientMap() {
  if (_gradTex) return _gradTex;
  const data = new Uint8Array([110, 170, 225, 255]);
  _gradTex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  _gradTex.minFilter = _gradTex.magFilter = THREE.NearestFilter;
  _gradTex.needsUpdate = true;
  return _gradTex;
}
export function toonMat(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

/* ============================================================
 *  地形の高さ関数
 * ============================================================ */
const ISLAND_R = 250;
export const WATER_Y = 0;

function baseTerrainHeight(x, z) {
  const r = Math.hypot(x, z) / ISLAND_R;
  const falloff = 1 - smoothstep(0.62, 1.05, r);
  if (falloff <= 0) return -6 - 8 * smoothstep(1.0, 1.4, r);
  let h = falloff * (2.2 + fbm(x * 0.012 + 7.3, z * 0.012 + 2.1) * 9.5);
  // 北側の丘（コースの高台に合わせる）
  h += 17 * gauss(x, z, 30, -110, 130) * falloff;
  h += 9 * gauss(x, z, -120, -60, 90) * falloff;
  // 中央のラグーン（にじの橋の下）
  h -= 26 * gauss(x, z, -35, -125, 46);
  h -= 6 * gauss(x, z, 20, 30, 70);
  return h;
}

/* ============================================================
 *  コース（閉じたスプライン）
 * ============================================================ */
export const ROAD_HALF = 8.5;      // 走行可能な半幅
export const WALL_HALF = 10.2;     // 見えない壁

export function buildTrackData() {
  const pts = [
    new THREE.Vector3(-40, 1.2, 152),
    new THREE.Vector3(60, 1.2, 150),
    new THREE.Vector3(142, 2.5, 118),
    new THREE.Vector3(178, 6.0, 36),
    new THREE.Vector3(150, 13.5, -58),
    new THREE.Vector3(76, 19.5, -116),
    new THREE.Vector3(-12, 21.5, -132),
    new THREE.Vector3(-64, 20.0, -124),
    new THREE.Vector3(-118, 14.0, -92),
    new THREE.Vector3(-156, 7.5, -16),
    new THREE.Vector3(-142, 3.0, 66),
    new THREE.Vector3(-98, 1.4, 126),
  ];
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
  const N = 1200;
  const points = [], tangents = [], sides = [], cum = [0];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    points.push(curve.getPointAt(t));
    const tan = curve.getTangentAt(t);
    tangents.push(tan.clone().normalize());
    sides.push(new THREE.Vector3(-tan.z, 0, tan.x).normalize());
  }
  for (let i = 1; i <= N; i++) {
    cum.push(cum[i - 1] + points[i - 1].distanceTo(points[i % N]));
  }
  const total = cum[N];

  const data = {
    curve, N, points, tangents, sides, cum, total,
    // 距離 s (0..total) → サンプル情報
    sample(s, out) {
      s = ((s % total) + total) % total;
      // 二分探索
      let lo = 0, hi = N;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid + 1] < s) lo = mid + 1; else hi = mid; }
      const i = lo, i2 = (i + 1) % N;
      const f = clamp((s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-6), 0, 1);
      out = out || {};
      out.pos = (out.pos || new THREE.Vector3()).copy(points[i]).lerp(points[i2], f);
      out.tan = (out.tan || new THREE.Vector3()).copy(tangents[i]).lerp(tangents[i2], f).normalize();
      out.side = (out.side || new THREE.Vector3()).copy(sides[i]).lerp(sides[i2], f).normalize();
      return out;
    },
    // XZ座標 → コースまでの近似距離（配置用の粗い判定）
    distToRoad(x, z) {
      let best = Infinity;
      for (let i = 0; i < N; i += 6) {
        const p = points[i];
        const dx = p.x - x, dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    },
    roadHeightAt(x, z) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < N; i += 3) {
        const p = points[i];
        const dx = p.x - x, dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bi = i; }
      }
      return { dist: Math.sqrt(best), y: points[bi].y };
    },
  };
  return data;
}

/* ============================================================
 *  地形メッシュ
 * ============================================================ */
function terrainHeightWithRoad(track, x, z) {
  let h = baseTerrainHeight(x, z);
  const { dist, y } = track.roadHeightAt(x, z);
  const flat = 1 - smoothstep(15, 34, dist);
  if (flat > 0) {
    const target = y - 0.35;
    // 橋区間（道路が地形よりずっと高い）は地形を持ち上げない
    if (target - h < 7) h = lerp(h, target, flat);
  }
  return h;
}

function buildTerrain(track) {
  const SIZE = 720, SEG = 190;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color('#f0dfa6'), cSand2 = new THREE.Color('#e3c98b');
  const cGrass = new THREE.Color('#7ed957'), cGrass2 = new THREE.Color('#4fae3f');
  const cRock = new THREE.Color('#b09a7e'), cDeep = new THREE.Color('#3f7fbe');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeightWithRoad(track, x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.05 + 3.1, z * 0.05 + 8.7);
    if (h < WATER_Y - 0.5) {
      c.copy(cDeep).lerp(cSand2, smoothstep(-6, -0.5, h) * 0.7);
    } else if (h < 1.4) {
      c.copy(cSand).lerp(cSand2, n);
    } else if (h < 2.6) {
      c.copy(cSand2).lerp(cGrass, smoothstep(1.4, 2.6, h));
    } else if (h < 15) {
      c.copy(cGrass).lerp(cGrass2, n * 0.9 + smoothstep(4, 15, h) * 0.25);
    } else {
      c.copy(cGrass2).lerp(cRock, smoothstep(15, 22, h) * (0.5 + n * 0.5));
    }
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = toonMat(0xffffff, { vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/* ============================================================
 *  道路・縁石・ライン・橋
 * ============================================================ */
function ribbonGeometry(track, segStep, halfL, halfR, yOff, colorFn) {
  const N = track.N;
  const count = Math.floor(N / segStep);
  const verts = [], cols = [], idx = [], uvs = [];
  const p = new THREE.Vector3();
  for (let k = 0; k <= count; k++) {
    const i = (k * segStep) % N;
    const P = track.points[i], S = track.sides[i];
    for (const off of [halfL, halfR]) {
      p.copy(P).addScaledVector(S, off);
      verts.push(p.x, P.y + yOff, p.z);
      uvs.push(off, track.cum[i]);
      const col = colorFn ? colorFn(k, off) : [1, 1, 1];
      cols.push(col[0], col[1], col[2]);
    }
    if (k < count) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function buildRoad(track, bridgeRanges) {
  const group = new THREE.Group();

  // --- アスファルト本体 ---
  const cA = new THREE.Color('#6d7287'), cB = new THREE.Color('#7b8098');
  const roadGeo = ribbonGeometry(track, 4, -ROAD_HALF - 1.7, ROAD_HALF + 1.7, 0.02, (k) => {
    const n = hash2(k * 1.7, 3.3) * 0.5;
    const c = cA.clone().lerp(cB, n);
    return [c.r, c.g, c.b];
  });
  const road = new THREE.Mesh(roadGeo, toonMat(0xffffff, { vertexColors: true }));
  road.receiveShadow = true;
  group.add(road);

  // --- 外周の白線 ---
  for (const sgn of [-1, 1]) {
    const g = ribbonGeometry(track, 4, sgn * (ROAD_HALF - 0.4), sgn * (ROAD_HALF + 0.15), 0.06);
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf6f6ee })));
  }

  // --- 中央の黄色い破線 ---
  {
    const N = track.N, step = 5, dashOn = 4;
    const verts = [], idx = []; let vi = 0;
    const p = new THREE.Vector3();
    for (let k = 0; k * step < N; k++) {
      if (k % (dashOn * 2) >= dashOn) continue;
      const i0 = (k * step) % N, i1 = ((k + 1) * step) % N;
      for (const i of [i0, i1]) {
        const P = track.points[i], S = track.sides[i];
        for (const off of [-0.35, 0.35]) {
          p.copy(P).addScaledVector(S, off);
          verts.push(p.x, P.y + 0.06, p.z);
        }
      }
      idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2);
      vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffd23d })));
  }

  // --- 縁石（赤白ストライプ） ---
  const cRed = new THREE.Color('#ff5a5a'), cWhite = new THREE.Color('#ffffff');
  for (const sgn of [-1, 1]) {
    const g = ribbonGeometry(track, 4, sgn * (ROAD_HALF + 0.2), sgn * (ROAD_HALF + 1.7), 0.09, (k) => {
      const c = (Math.floor(k / 3) % 2 === 0) ? cRed : cWhite;
      return [c.r, c.g, c.b];
    });
    const m = new THREE.Mesh(g, toonMat(0xffffff, { vertexColors: true }));
    m.receiveShadow = true;
    group.add(m);
  }

  // --- 橋区間の虹の路面・欄干 ---
  const rainbow = ['#ff5a5a', '#ff9f3d', '#ffe93d', '#5ad66f', '#4db9ff', '#7a6bff', '#c46bff'].map(c => new THREE.Color(c));
  for (const [a, b] of bridgeRanges) {
    // 虹ストライプ（進行方向に流れる 7 本）
    for (let r = 0; r < 7; r++) {
      const w = (ROAD_HALF * 2 - 1) / 7;
      const off0 = -ROAD_HALF + 0.5 + r * w;
      const verts = [], idx = []; let vi = 0;
      const p = new THREE.Vector3();
      for (let i = a; i <= b; i += 4) {
        const ii = i % track.N;
        const P = track.points[ii], S = track.sides[ii];
        for (const off of [off0, off0 + w]) {
          p.copy(P).addScaledVector(S, off);
          verts.push(p.x, P.y + 0.045, p.z);
        }
        if (i + 4 <= b) { idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); }
        vi += 2;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx); g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color: rainbow[r], transparent: true, opacity: 0.85,
      })));
    }
    // 欄干と支柱
    const postMat = toonMat('#fefefe');
    const postGeo = new THREE.CylinderGeometry(0.28, 0.34, 1.5, 8);
    const railGeo = new THREE.BoxGeometry(1, 0.28, 0.28);
    const railMat = toonMat('#ffb1c9');
    const pierMat = toonMat('#e8ecf4');
    for (let i = a; i <= b; i += 12) {
      const ii = i % track.N;
      const P = track.points[ii], S = track.sides[ii], T = track.tangents[ii];
      for (const sgn of [-1, 1]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.copy(P).addScaledVector(S, sgn * (ROAD_HALF + 1.4));
        post.position.y = P.y + 0.75;
        group.add(post);
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.copy(post.position); rail.position.y = P.y + 1.45;
        rail.scale.x = 12.5;
        rail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), T);
        group.add(rail);
      }
      // 水面までの支柱
      if (i % 24 === 0) {
        const h = P.y - WATER_Y + 2;
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, h, 10), pierMat);
        pier.position.set(P.x, WATER_Y + h / 2 - 2, P.z);
        group.add(pier);
      }
    }
  }

  // --- 道路脇の土手（すき間が見えないように） ---
  {
    const N = track.N, step = 6;
    const verts = [], cols = [], idx = []; let vi = 0;
    const cDirt = new THREE.Color('#8a6f4d');
    const p = new THREE.Vector3();
    for (let k = 0; k * step <= N; k++) {
      const i = (k * step) % N;
      const P = track.points[i], S = track.sides[i];
      const onBridge = bridgeRanges.some(([a, b]) => i >= a && i <= b);
      const drop = onBridge ? 2.2 : 30;
      for (const sgn of [-1, 1]) {
        p.copy(P).addScaledVector(S, sgn * (ROAD_HALF + 1.72));
        verts.push(p.x, P.y + 0.05, p.z);
        cols.push(cDirt.r, cDirt.g, cDirt.b);
        p.copy(P).addScaledVector(S, sgn * (ROAD_HALF + (onBridge ? 1.9 : 4.5)));
        verts.push(p.x, P.y - drop, p.z);
        const c2 = cDirt.clone().multiplyScalar(0.75);
        cols.push(c2.r, c2.g, c2.b);
      }
      if (k * step < N) {
        for (const base of [0, 2]) {
          const a2 = vi + base;
          idx.push(a2, a2 + 4, a2 + 1, a2 + 1, a2 + 4, a2 + 5);
        }
      }
      vi += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, toonMat(0xffffff, { vertexColors: true, side: THREE.DoubleSide }));
    group.add(m);
  }

  // --- スタートラインの市松模様 ---
  {
    const i0 = 0;
    const P = track.points[i0], S = track.sides[i0], T = track.tangents[i0];
    const cells = 8, rows = 2, cw = (ROAD_HALF * 2) / cells, ch = 1.4;
    const g = new THREE.PlaneGeometry(cw, ch);
    const dark = new THREE.MeshBasicMaterial({ color: 0x20242e });
    const light = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
    for (let r = 0; r < rows; r++) {
      for (let cix = 0; cix < cells; cix++) {
        const m = new THREE.Mesh(g, (r + cix) % 2 ? dark : light);
        m.position.copy(P)
          .addScaledVector(S, -ROAD_HALF + cw * (cix + 0.5))
          .addScaledVector(T, r * ch - ch / 2);
        m.position.y = P.y + 0.07;
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = Math.atan2(T.x, T.z) + Math.PI;
        group.add(m);
      }
    }
  }
  return group;
}

/* ============================================================
 *  空（シェーダー：グラデ + 太陽 + 流れる雲）
 * ============================================================ */
export const SUN_DIR = new THREE.Vector3(0.45, 0.72, 0.35).normalize();

function buildSky() {
  const geo = new THREE.SphereGeometry(1500, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uSun: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uSun;
      varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm(vec2 p){
        float v = 0.0, a = 0.5;
        for(int i=0;i<5;i++){ v += a*noise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.12, 1.0);
        vec3 top = vec3(0.18, 0.48, 0.92);
        vec3 mid = vec3(0.42, 0.72, 0.98);
        vec3 hor = vec3(0.86, 0.94, 1.0);
        vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h));
        col = mix(col, top, smoothstep(0.22, 0.85, h));
        // 太陽
        float sd = dot(d, normalize(uSun));
        col += vec3(1.0, 0.95, 0.75) * pow(clamp(sd, 0.0, 1.0), 700.0) * 3.0;
        col += vec3(1.0, 0.9, 0.6) * pow(clamp(sd, 0.0, 1.0), 18.0) * 0.22;
        // 雲（2層でもくもく）
        if (d.y > 0.02) {
          vec2 uv = d.xz / (d.y + 0.18);
          float c1 = fbm(uv * 1.6 + vec2(uTime * 0.010, 0.0));
          float c2 = fbm(uv * 3.4 + vec2(uTime * 0.017, 4.0));
          float cl = smoothstep(0.52, 0.74, c1 * 0.72 + c2 * 0.38);
          float shade = smoothstep(0.5, 0.95, c1);
          vec3 cloudCol = mix(vec3(0.86, 0.90, 0.97), vec3(1.0), shade);
          float fade = smoothstep(0.02, 0.12, d.y);
          col = mix(col, cloudCol, cl * fade * 0.95);
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -10;
  return sky;
}

/* ============================================================
 *  海（波 + きらめき + 岸の泡）
 * ============================================================ */
function buildSea() {
  const geo = new THREE.PlaneGeometry(2600, 2600, 140, 140);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color('#1a6fce') },
      uShallow: { value: new THREE.Color('#5fd4e8') },
      uSun: { value: SUN_DIR.clone() },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    },
    fog: true,
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vWorld;
      varying float vWave;
      void main(){
        vec3 p = position;
        float w = sin(p.x * 0.055 + uTime * 1.1) * 0.35
                + sin(p.z * 0.042 + uTime * 0.8) * 0.3
                + sin((p.x + p.z) * 0.09 + uTime * 1.7) * 0.16;
        p.y += w;
        vWave = w;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSun;
      uniform vec3 fogColor;
      uniform float fogNear, fogFar;
      varying vec3 vWorld;
      varying float vWave;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      void main(){
        float r = length(vWorld.xz);
        // 島に近いほど浅い色
        float shore = smoothstep(330.0, 160.0, r);
        vec3 col = mix(uDeep, uShallow, shore * 0.85 + vWave * 0.12);
        // きらめき
        float sp = noise(vWorld.xz * 0.55 + vec2(uTime * 0.6, -uTime * 0.4));
        sp *= noise(vWorld.xz * 1.3 - vec2(uTime * 0.5, uTime * 0.3));
        col += vec3(1.0, 1.0, 0.9) * smoothstep(0.42, 0.62, sp) * 0.35;
        // 岸辺の泡リング
        float foamBand = smoothstep(0.0, 1.0, sin(r * 0.16 - uTime * 1.4) * 0.5 + 0.5);
        float foamZone = smoothstep(305.0, 250.0, r) * smoothstep(180.0, 235.0, r);
        float fn = noise(vWorld.xz * 0.8 + uTime * 0.2);
        col = mix(col, vec3(0.97), foamZone * foamBand * smoothstep(0.35, 0.7, fn) * 0.9);
        // 波頭の白
        col = mix(col, vec3(0.95), smoothstep(0.55, 0.8, vWave) * 0.25);
        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogF = smoothstep(fogNear, fogFar, depth);
        col = mix(col, fogColor, fogF);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = WATER_Y;
  return sea;
}

/* ============================================================
 *  木・花・岩（インスタンス配置）
 * ============================================================ */
function scatterPositions(track, count, test, seed = 1) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries < count * 40) {
    tries++;
    const x = (hash2(tries * 1.37 + seed, seed * 3.1) * 2 - 1) * (ISLAND_R + 20);
    const z = (hash2(seed * 7.7, tries * 2.11 + seed) * 2 - 1) * (ISLAND_R + 20);
    const h = baseTerrainHeight(x, z);
    const rd = track.distToRoad(x, z);
    if (rd < 15) continue;
    if (test(x, z, h, rd)) out.push({ x, z, h });
  }
  return out;
}

function windSway(material, strength = 1) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    material.userData.shader = shader;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         vec4 wpos = instanceMatrix * vec4(transformed, 1.0);
         float sway = sin(uTime * 1.7 + wpos.x * 0.35 + wpos.z * 0.27) * ${(0.10 * strength).toFixed(3)};
         transformed.x += sway * smoothstep(0.5, 3.0, transformed.y);
       }`
    );
  };
}

function buildFlora(track, scene, animated) {
  const dummy = new THREE.Object3D();

  // ---- まるい木 ----
  {
    const spots = scatterPositions(track, 110, (x, z, h) => h > 2.2 && h < 16, 11);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 2.6, 7);
    trunkGeo.translate(0, 1.3, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.1, 1);
    crownGeo.translate(0, 3.6, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, toonMat('#8b5a2b'), spots.length);
    const crownMatA = toonMat('#4fae3f');
    windSway(crownMatA, 1);
    const crown = new THREE.InstancedMesh(crownGeo, crownMatA, spots.length);
    const cols = ['#4fae3f', '#63c24e', '#3d9a4f', '#7bc95a', '#e97fb2'];
    spots.forEach((s, i) => {
      const sc = 0.7 + hash2(i, 5.5) * 0.9;
      dummy.position.set(s.x, s.h - 0.2, s.z);
      dummy.scale.setScalar(sc);
      dummy.rotation.y = hash2(i, 9.1) * Math.PI * 2;
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);
      crown.setMatrixAt(i, dummy.matrix);
      crown.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    });
    trunk.castShadow = crown.castShadow = true;
    scene.add(trunk, crown);
    animated.push(crownMatA);
  }

  // ---- ヤシの木（浜辺） ----
  {
    const spots = scatterPositions(track, 46, (x, z, h) => h > 0.6 && h < 2.4, 23);
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.45, 5.2, 7);
    trunkGeo.translate(0, 2.6, 0);
    // 葉：細長い板を放射状に
    const leafGeo = new THREE.BufferGeometry();
    {
      const verts = [], idx = [];
      const L = 8;
      for (let l = 0; l < L; l++) {
        const a = (l / L) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        const b = verts.length / 3;
        verts.push(dx * 0.2, 5.2, dz * 0.2);
        verts.push(dx * 3.2 - dz * 0.55, 4.6, dz * 3.2 + dx * 0.55);
        verts.push(dx * 3.2 + dz * 0.55, 4.6, dz * 3.2 - dx * 0.55);
        idx.push(b, b + 1, b + 2);
      }
      leafGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      leafGeo.setIndex(idx);
      leafGeo.computeVertexNormals();
    }
    const trunk = new THREE.InstancedMesh(trunkGeo, toonMat('#a97142'), spots.length);
    const leafMat = toonMat('#3fa653', { side: THREE.DoubleSide });
    windSway(leafMat, 1.6);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.h - 0.15, s.z);
      dummy.scale.setScalar(0.8 + hash2(i, 2.2) * 0.6);
      dummy.rotation.set(hash2(i, 3) * 0.25 - 0.12, hash2(i, 4) * Math.PI * 2, hash2(i, 5) * 0.25 - 0.12);
      dummy.updateMatrix();
      trunk.setMatrixAt(i, dummy.matrix);
      leaves.setMatrixAt(i, dummy.matrix);
    });
    trunk.castShadow = leaves.castShadow = true;
    scene.add(trunk, leaves);
    animated.push(leafMat);
  }

  // ---- 花畑 ----
  {
    const spots = scatterPositions(track, 240, (x, z, h, rd) => h > 2.0 && h < 13 && rd > 16 && rd < 42, 41);
    const g = new THREE.ConeGeometry(0.32, 0.5, 5);
    g.translate(0, 0.5, 0);
    const flowers = new THREE.InstancedMesh(g, toonMat('#ffffff'), spots.length);
    const palette = ['#ff6b8a', '#ffd23d', '#ff9f3d', '#c46bff', '#ffffff', '#63c9ff'].map(c => new THREE.Color(c));
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.h, s.z);
      dummy.scale.setScalar(0.7 + hash2(i, 8.8));
      dummy.rotation.y = hash2(i, 7) * Math.PI;
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      flowers.setColorAt(i, palette[i % palette.length]);
    });
    scene.add(flowers);
  }

  // ---- 岩 ----
  {
    const spots = scatterPositions(track, 40, (x, z, h) => h > 1.0 && h < 20, 77);
    const g = new THREE.IcosahedronGeometry(1.1, 0);
    const rocks = new THREE.InstancedMesh(g, toonMat('#b8b2ac'), spots.length);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.h + 0.2, s.z);
      dummy.scale.set(0.6 + hash2(i, 1) * 1.6, 0.5 + hash2(i, 2), 0.6 + hash2(i, 3) * 1.6);
      dummy.rotation.set(hash2(i, 4), hash2(i, 5) * Math.PI, hash2(i, 6));
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    });
    rocks.castShadow = true;
    scene.add(rocks);
  }
}

/* ============================================================
 *  ランドマーク（観覧車・気球・ヨット・ゲート・旗）
 * ============================================================ */
function buildFerrisWheel() {
  const g = new THREE.Group();
  const R = 26;
  const wheel = new THREE.Group();
  const rimMat = toonMat('#ff6b8a');
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 1.0, 10, 48), rimMat);
  wheel.add(rim);
  const spokeGeo = new THREE.CylinderGeometry(0.4, 0.4, R * 2, 6);
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(spokeGeo, toonMat('#ffe0ec'));
    sp.rotation.z = (i / 4) * Math.PI;
    wheel.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), toonMat('#ffd23d'));
  wheel.add(hub);
  const gondolaGeo = new THREE.SphereGeometry(2.4, 10, 8);
  const gondCols = ['#ff5a5a', '#ffd23d', '#5ad66f', '#4db9ff', '#c46bff', '#ff9f3d', '#63e0d8', '#ff8ab5'];
  const gondolas = [];
  for (let i = 0; i < 8; i++) {
    const gd = new THREE.Mesh(gondolaGeo, toonMat(gondCols[i]));
    gondolas.push(gd);
    g.add(gd);
  }
  // 支柱
  const legMat = toonMat('#c9cede');
  for (const sgn of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.5, R + 6, 8), legMat);
    leg.position.set(sgn * 8, (R + 6) / 2, 0);
    leg.rotation.z = sgn * -0.25;
    g.add(leg);
  }
  wheel.position.y = R + 4;
  g.add(wheel);
  g.userData.update = (t) => {
    wheel.rotation.z = t * 0.12;
    for (let i = 0; i < 8; i++) {
      const a = t * 0.12 + (i / 8) * Math.PI * 2;
      gondolas[i].position.set(Math.cos(a) * R * Math.cos(0), R + 4 + Math.sin(a) * R - 2.6, 0.2);
      gondolas[i].position.x = Math.cos(a) * R;
    }
  };
  return g;
}

function buildBalloon(colorTop, colorStripe) {
  const g = new THREE.Group();
  const ballGeo = new THREE.SphereGeometry(4.4, 18, 14);
  const pos = ballGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c1 = new THREE.Color(colorTop), c2 = new THREE.Color(colorStripe), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    c.copy(Math.floor(((a / Math.PI) * 4 + 8)) % 2 === 0 ? c1 : c2);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  ballGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  ballGeo.scale(1, 1.15, 1);
  const ball = new THREE.Mesh(ballGeo, toonMat(0xffffff, { vertexColors: true }));
  g.add(ball);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 1.7), toonMat('#8b5a2b'));
  basket.position.y = -6.2;
  g.add(basket);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 4), toonMat('#5a4632'));
    rope.position.set(sx * 0.8, -4.9, sz * 0.8);
    g.add(rope);
  }
  return g;
}

function buildBoat(color) {
  const g = new THREE.Group();
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-3, 0); hullShape.quadraticCurveTo(0, -2.2, 3, 0);
  hullShape.lineTo(2.4, 1); hullShape.lineTo(-2.4, 1); hullShape.closePath();
  const hull = new THREE.Mesh(
    new THREE.ExtrudeGeometry(hullShape, { depth: 2.2, bevelEnabled: false }),
    toonMat(color)
  );
  hull.rotation.x = Math.PI / 2; hull.rotation.z = Math.PI;
  hull.position.y = 1.6;
  g.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), toonMat('#8b5a2b'));
  mast.position.y = 4.2;
  g.add(mast);
  const sailGeo = new THREE.BufferGeometry();
  sailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 7, 0, 0, 2, 0, 2.8, 2, 0], 3));
  sailGeo.setIndex([0, 1, 2]);
  sailGeo.computeVertexNormals();
  const sail = new THREE.Mesh(sailGeo, toonMat('#ffffff', { side: THREE.DoubleSide }));
  sail.position.set(0.12, 0.4, 0);
  g.add(sail);
  return g;
}

function makeBannerTexture(text, bg1, bg2) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, bg1); grad.addColorStop(1, bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 128);
  // 市松の縁
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 0) { ctx.fillRect(i * 32, 0, 32, 14); ctx.fillRect(i * 32 + 32, 114, 32, 14); }
    else { ctx.fillRect(i * 32, 114, 0, 0); }
  }
  ctx.fillStyle = '#20242e';
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1) { ctx.fillRect(i * 32, 0, 32, 14); }
    if (i % 2 === 0) { ctx.fillRect(i * 32, 114, 32, 14); }
  }
  ctx.font = '900 72px "Hiragino Maru Gothic ProN", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,40,110,0.9)';
  ctx.strokeText(text, 256, 66);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildStartGate(track) {
  const g = new THREE.Group();
  const i0 = 6;
  const P = track.points[i0], S = track.sides[i0], T = track.tangents[i0];
  const pillarGeo = new THREE.CylinderGeometry(0.9, 1.1, 11, 10);
  const pillarMat = toonMat('#ff5a5a');
  for (const sgn of [-1, 1]) {
    const p = new THREE.Mesh(pillarGeo, pillarMat);
    p.position.copy(P).addScaledVector(S, sgn * (ROAD_HALF + 2.6));
    p.position.y = P.y + 5.5;
    p.castShadow = true;
    g.add(p);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 10), toonMat('#ffd23d'));
    ball.position.copy(p.position); ball.position.y = P.y + 11.4;
    g.add(ball);
  }
  const bannerW = (ROAD_HALF + 2.6) * 2;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(bannerW, 2.6, 0.5),
    [toonMat('#ffcf3d'), toonMat('#ffcf3d'),
     toonMat('#ffcf3d'), toonMat('#ffcf3d'),
     new THREE.MeshBasicMaterial({ map: makeBannerTexture('スタート', '#ff9f1c', '#f77f00') }),
     new THREE.MeshBasicMaterial({ map: makeBannerTexture('スタート', '#ff9f1c', '#f77f00') })]
  );
  banner.position.copy(P); banner.position.y = P.y + 10.4;
  banner.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), S);
  g.add(banner);
  return g;
}

function buildFlagGarlands(track, animated) {
  const g = new THREE.Group();
  const flagCols = ['#ff5a5a', '#ffd23d', '#5ad66f', '#4db9ff', '#c46bff', '#ff9f3d'].map(c => new THREE.Color(c));
  const flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.55, 0, 0, 0.55, 0, 0, 0, -1.1, 0], 3));
  flagGeo.setIndex([0, 1, 2]);
  flagGeo.computeVertexNormals();
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.2, 5, 6);
  const poleMat = toonMat('#fefefe');
  const spots = [80, 240, 420, 560, 760, 950, 1100];
  let flagCount = 0;
  const flagsPerGarland = 9;
  const flagMesh = new THREE.InstancedMesh(flagGeo,
    toonMat('#ffffff', { side: THREE.DoubleSide }), spots.length * flagsPerGarland);
  const dummy = new THREE.Object3D();
  for (const i of spots) {
    const ii = i % track.N;
    const P = track.points[ii], S = track.sides[ii];
    const a = new THREE.Vector3().copy(P).addScaledVector(S, -(ROAD_HALF + 2.2));
    const b = new THREE.Vector3().copy(P).addScaledVector(S, (ROAD_HALF + 2.2));
    a.y = P.y + 4.6; b.y = P.y + 4.6;
    for (const p of [a, b]) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, P.y + 2.5, p.z);
      g.add(pole);
    }
    for (let f = 0; f < flagsPerGarland; f++) {
      const t = (f + 0.5) / flagsPerGarland;
      dummy.position.lerpVectors(a, b, t);
      dummy.position.y -= Math.sin(t * Math.PI) * 1.1; // たるみ
      dummy.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
      dummy.updateMatrix();
      flagMesh.setMatrixAt(flagCount, dummy.matrix);
      flagMesh.setColorAt(flagCount, flagCols[flagCount % flagCols.length]);
      flagCount++;
    }
  }
  g.add(flagMesh);
  return g;
}

/* ============================================================
 *  コイン・アイテムボックス・ブーストパッド
 * ============================================================ */
function buildCoins(track) {
  const defs = [];
  const lines = [
    { s0: 130, lat: 0, n: 6 }, { s0: 260, lat: -4, n: 5 }, { s0: 262, lat: 4, n: 5 },
    { s0: 430, lat: 0, n: 7 }, { s0: 560, lat: 3, n: 5 }, { s0: 620, lat: -3, n: 5 },
    { s0: 760, lat: 0, n: 8 }, { s0: 905, lat: -4, n: 4 }, { s0: 907, lat: 4, n: 4 },
  ];
  for (const L of lines) {
    for (let k = 0; k < L.n; k++) defs.push({ s: L.s0 + k * 5, lat: L.lat, taken: false });
  }
  const geo = new THREE.CylinderGeometry(1.05, 1.05, 0.25, 18);
  geo.rotateX(Math.PI / 2);
  const mat = toonMat('#ffd23d', { emissive: new THREE.Color('#7a5a00') });
  const mesh = new THREE.InstancedMesh(geo, mat, defs.length);
  mesh.castShadow = true;
  const smp = {};
  const dummy = new THREE.Object3D();
  defs.forEach((d, i) => {
    track.sample(d.s, smp);
    d.pos = smp.pos.clone().addScaledVector(smp.side, d.lat);
    d.pos.y += 1.5;
  });
  return { defs, mesh, update(t) {
    defs.forEach((d, i) => {
      if (d.taken) { dummy.scale.setScalar(0.0001); }
      else {
        dummy.scale.setScalar(1);
        dummy.position.copy(d.pos);
        dummy.position.y = d.pos.y + Math.sin(t * 2.4 + i * 0.7) * 0.18;
        dummy.rotation.set(0, t * 2.8 + i * 0.5, 0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  } };
}

function makeQuestionTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.0)';
  ctx.fillRect(0, 0, 128, 128);
  ctx.font = '900 96px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 12; ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeText('?', 64, 70);
  ctx.fillStyle = '#5a3aa0';
  ctx.fillText('?', 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildItemBoxes(track) {
  const spots = [{ s: 340 }, { s: 344 }, { s: 348 }, { s: 690 }, { s: 694 }, { s: 698 }, { s: 1010 }, { s: 1014 }];
  const lats = [-4.5, 0, 4.5, -4.5, 0, 4.5, -3, 3];
  const defs = spots.map((sp, i) => ({ s: sp.s, lat: lats[i], taken: false, respawn: 0 }));
  const group = new THREE.Group();
  const qTex = makeQuestionTexture();
  const smp = {};
  const boxes = defs.map((d, i) => {
    const mat = toonMat(0xffffff, { transparent: true, opacity: 0.88 });
    mat.emissive = new THREE.Color(0x223366);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), mat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.55, 2.55),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }));
    box.add(edge);
    for (const zz of [1.26, -1.26]) {
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9),
        new THREE.MeshBasicMaterial({ map: qTex, transparent: true, side: THREE.DoubleSide }));
      q.position.z = zz;
      box.add(q);
    }
    track.sample(d.s, smp);
    d.pos = smp.pos.clone().addScaledVector(smp.side, d.lat);
    d.pos.y += 1.9;
    box.position.copy(d.pos);
    box.castShadow = true;
    group.add(box);
    return box;
  });
  const hue = new THREE.Color();
  return { defs, group, update(t) {
    defs.forEach((d, i) => {
      const b = boxes[i];
      if (d.taken) {
        d.respawn -= 1 / 60;
        if (d.respawn <= 0) d.taken = false;
        b.visible = false;
        return;
      }
      b.visible = true;
      b.rotation.set(t * 0.9 + i, t * 1.3, t * 0.7);
      b.position.y = d.pos.y + Math.sin(t * 2 + i) * 0.22;
      hue.setHSL((t * 0.35 + i * 0.13) % 1, 0.95, 0.6);
      b.material.color.copy(hue);
    });
  } };
}

function buildBoostPads(track) {
  const spots = [{ s: 200, lat: 0 }, { s: 510, lat: 0 }, { s: 840, lat: 0 }, { s: 1090, lat: 0 }];
  const group = new THREE.Group();
  const mats = [];
  const smp = {};
  const defs = spots.map((sp) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        void main(){
          float v = fract(vUv.y * 3.0 - uTime * 2.2);
          float chev = smoothstep(0.12, 0.0, abs(v - 0.5 - abs(vUv.x - 0.5) * 0.55));
          vec3 base = mix(vec3(1.0, 0.45, 0.05), vec3(1.0, 0.75, 0.1), vUv.y);
          vec3 col = mix(base, vec3(1.0, 1.0, 0.55), chev);
          float edge = smoothstep(0.5, 0.42, abs(vUv.x - 0.5));
          gl_FragColor = vec4(col, 0.92 * edge);
        }`,
    });
    mats.push(mat);
    const w = 6.5, len = 13;
    const geo = new THREE.PlaneGeometry(w, len, 1, 8);
    const mesh = new THREE.Mesh(geo, mat);
    track.sample(sp.s, smp);
    const pos = smp.pos.clone().addScaledVector(smp.side, sp.lat);
    mesh.position.copy(pos); mesh.position.y += 0.12;
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -Math.atan2(smp.tan.x, smp.tan.z);
    group.add(mesh);
    return { s: sp.s, lat: sp.lat, halfW: 3.4, len };
  });
  return { defs, group, update(t) { mats.forEach(m => m.uniforms.uTime.value = t); } };
}

/* ============================================================
 *  ワールド構築エントリ
 * ============================================================ */
export function buildWorld(scene) {
  const track = buildTrackData();

  // 橋区間の検出（道路が地形よりかなり高い範囲）
  const bridgeRanges = [];
  {
    let start = -1;
    for (let i = 0; i < track.N; i++) {
      const p = track.points[i];
      const high = p.y - baseTerrainHeight(p.x, p.z) > 6.5;
      if (high && start < 0) start = i;
      if ((!high || i === track.N - 1) && start >= 0) {
        if (i - start > 12) bridgeRanges.push([start, i]);
        start = -1;
      }
    }
  }

  const animatedMats = [];

  scene.add(buildSky());
  const sea = buildSea();
  scene.add(sea);
  scene.add(buildTerrain(track));
  scene.add(buildRoad(track, bridgeRanges));
  buildFlora(track, scene, animatedMats);

  const gate = buildStartGate(track);
  scene.add(gate);
  scene.add(buildFlagGarlands(track, animatedMats));

  // 観覧車（島の東の丘のふもと）
  const ferris = buildFerrisWheel();
  ferris.position.set(95, baseTerrainHeight(95, 60) - 0.5, 60);
  ferris.rotation.y = -0.7;
  scene.add(ferris);

  // 気球
  const balloons = [];
  const balloonDefs = [
    ['#ff5a5a', '#ffe93d', -60, 55, 30], ['#4db9ff', '#ffffff', 120, 70, -160],
    ['#5ad66f', '#ffe93d', -170, 62, -60], ['#c46bff', '#ffd6f2', 40, 80, 90],
    ['#ff9f3d', '#ffffff', -20, 66, -220],
  ];
  for (const [c1, c2, x, y, z] of balloonDefs) {
    const b = buildBalloon(c1, c2);
    b.position.set(x, y, z);
    scene.add(b);
    balloons.push({ b, y0: y, ph: Math.random() * 6 });
  }

  // ヨット
  const boats = [];
  for (const [c, x, z, ry] of [['#ff5a5a', 330, 60, 0.6], ['#4db9ff', -300, -180, 2.4], ['#ffd23d', 120, 330, 4.0]]) {
    const bt = buildBoat(c);
    bt.position.set(x, WATER_Y, z);
    bt.rotation.y = ry;
    scene.add(bt);
    boats.push({ bt, ph: Math.random() * 6 });
  }

  const coins = buildCoins(track);
  scene.add(coins.mesh);
  const itemBoxes = buildItemBoxes(track);
  scene.add(itemBoxes.group);
  const boostPads = buildBoostPads(track);
  scene.add(boostPads.group);

  return {
    track, bridgeRanges, coins, itemBoxes, boostPads,
    heightAt: (x, z) => terrainHeightWithRoad(track, x, z),
    seaMat: sea.material,
    skyMesh: scene.children.find(c => c.renderOrder === -10),
    update(t, dt) {
      sea.material.uniforms.uTime.value = t;
      const sky = this.skyMesh;
      if (sky) sky.material.uniforms.uTime.value = t;
      coins.update(t);
      itemBoxes.update(t);
      boostPads.update(t);
      ferris.userData.update(t);
      for (const { b, y0, ph } of balloons) {
        b.position.y = y0 + Math.sin(t * 0.4 + ph) * 2.2;
        b.rotation.y = Math.sin(t * 0.2 + ph) * 0.2;
      }
      for (const { bt, ph } of boats) {
        bt.position.y = WATER_Y + Math.sin(t * 0.9 + ph) * 0.35;
        bt.rotation.z = Math.sin(t * 0.7 + ph) * 0.06;
      }
      for (const m of animatedMats) {
        if (m.userData.shader) m.userData.shader.uniforms.uTime.value = t;
      }
    },
  };
}
