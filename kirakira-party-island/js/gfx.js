// トゥーン(セル)調の見た目をつくる共有ヘルパー。
// Switch風のパキッとした陰影は MeshToonMaterial + 段階グラデーションマップで再現する。

import * as THREE from '../vendor/three.module.min.js';

let _gradientMap = null;

// 3段トゥーングラデーション(暗→中→明)。全トゥーン素材で共有。
export function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 1;
  const g = c.getContext('2d');
  const shades = ['#666666', '#a3a3a3', '#dedede', '#ffffff'];
  shades.forEach((s, i) => { g.fillStyle = s; g.fillRect(i, 0, 1, 1); });
  _gradientMap = new THREE.CanvasTexture(c);
  _gradientMap.minFilter = THREE.NearestFilter;
  _gradientMap.magFilter = THREE.NearestFilter;
  _gradientMap.generateMipmaps = false;
  return _gradientMap;
}

const _matCache = new Map();

// トゥーン素材(色ごとにキャッシュ)
export function toonMat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (_matCache.has(key)) return _matCache.get(key);
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    ...opts,
  });
  _matCache.set(key, m);
  return m;
}

// キャッシュを使わない個別トゥーン素材(emissive をアニメする物向け)
export function toonMatUnique(color, opts = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
}

// キャラの縁取り(反転ハル)。グループ内の指定メッシュを複製して黒淵にする。
const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2c2438, side: THREE.BackSide });
export function addOutline(mesh, thickness = 1.045) {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE_MAT);
  o.scale.setScalar(thickness);
  o.castShadow = false;
  o.receiveShadow = false;
  mesh.add(o);
  return o;
}

// ---- キャンバステクスチャ生成 ----

// 目のテクスチャ:白目+黒目+ハイライト(かわいい大きい瞳)
let _eyeTex = null;
export function eyeTexture() {
  if (_eyeTex) return _eyeTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#2c2438';
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(44, 42, 20, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(82, 84, 10, 0, Math.PI * 2); g.fill();
  _eyeTex = new THREE.CanvasTexture(c);
  _eyeTex.colorSpace = THREE.SRGBColorSpace;
  return _eyeTex;
}

// キラキラ星スプライト
let _sparkTex = null;
export function sparkleTexture() {
  if (_sparkTex) return _sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    g.moveTo(0, -28);
    g.quadraticCurveTo(5, -5, 28, 0);
    g.quadraticCurveTo(5, 5, 0, 28);
    g.quadraticCurveTo(-5, 5, -28, 0);
    g.quadraticCurveTo(-5, -5, 0, -28);
  }
  g.fill();
  _sparkTex = new THREE.CanvasTexture(c);
  return _sparkTex;
}

// ふんわり丸グロー(パーティクル/影用)
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

// サイコロの面テクスチャ(大きくてカラフルな目)
export function diceFaceTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // 面のベース
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#ffe0ec';
  g.lineWidth = 14;
  g.strokeRect(10, 10, 236, 236);
  const colors = ['#ff5c8d', '#4da3ff', '#43c04e', '#ff9d3c', '#b06ce0', '#ffc93e'];
  const dot = (x, y) => {
    g.fillStyle = n === 1 ? '#ff5c8d' : colors[(x + y) % colors.length];
    g.beginPath();
    g.arc(x * 64 + 64, y * 64 + 64, n === 1 ? 52 : 30, 0, Math.PI * 2);
    g.fill();
  };
  const layouts = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
  };
  layouts[n].forEach(([x, y]) => dot(x, y));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 空のグラデーションドーム用シェーダー素材
export function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3f8fe8) },
      midColor: { value: new THREE.Color(0x8fd0ff) },
      botColor: { value: new THREE.Color(0xfff2e0) },
    },
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = h > 0.15
          ? mix(midColor, topColor, smoothstep(0.15, 0.85, h))
          : mix(botColor, midColor, smoothstep(-0.12, 0.15, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// 海の素材:2トーン+ゆらゆら波紋(トゥーン水面)
export function seaMaterial() {
  const mat = new THREE.ShaderMaterial({
    transparent: false,
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x2f7ed8) },
      shallow: { value: new THREE.Color(0x64c6ee) },
      sparkleCol: { value: new THREE.Color(0xd8f4ff) },
    },
    vertexShader: /* glsl */`
      uniform float time;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vUv = uv;
        vec3 p = position;
        float w = sin(p.x * 0.35 + time * 1.2) * cos(p.y * 0.3 + time * 0.9);
        p.z += w * 0.35;
        vWave = w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float time;
      uniform vec3 deep;
      uniform vec3 shallow;
      uniform vec3 sparkleCol;
      varying vec2 vUv;
      varying float vWave;
      void main() {
        vec2 c = vUv - 0.5;
        float d = length(c) * 2.0;
        vec3 col = mix(shallow, deep, smoothstep(0.06, 0.5, d));
        // トゥーン調の波しま
        float stripe = sin(d * 90.0 - time * 1.6 + vWave * 3.0);
        col = mix(col, sparkleCol, step(0.93, stripe) * 0.55 * (1.0 - smoothstep(0.3, 0.7, d)));
        col += vWave * 0.03;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return mat;
}

// 星形の Shape(押し出しでスターの実体を作る)
export function starShape(outer = 1, inner = 0.45, points = 5) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

export function starGeometry(outer = 1, inner = 0.45, depth = 0.35) {
  const geo = new THREE.ExtrudeGeometry(starShape(outer, inner), {
    depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2,
  });
  geo.center();
  return geo;
}

// ハート形
export function heartGeometry(size = 1, depth = 0.3) {
  const s = new THREE.Shape();
  const k = size;
  s.moveTo(0, -0.6 * k);
  s.bezierCurveTo(0.9 * k, 0.1 * k, 0.55 * k, 0.75 * k, 0, 0.35 * k);
  s.bezierCurveTo(-0.55 * k, 0.75 * k, -0.9 * k, 0.1 * k, 0, -0.6 * k);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2,
  });
  geo.center();
  return geo;
}

// ぷにっと丸い影(キャラの足元)
export function blobShadow(radius = 0.7, opacity = 0.25) {
  const mat = new THREE.MeshBasicMaterial({
    map: glowTexture(), transparent: true, opacity, color: 0x1a2a44,
    depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}
