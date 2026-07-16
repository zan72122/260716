/* ============================================================
   lib3d.js — 描画品質のための共通ヘルパー
   (ソフトトゥーン質感 / リムライト / ジオメトリ結合 / テクスチャ生成)
   ============================================================ */
import * as THREE from 'three';

/* ---- やわらかい段階のトゥーン用グラデーションマップ ---- */
let _gradTex = null;
export function softGradientMap() {
  if (_gradTex) return _gradTex;
  // 4段 + Linear補間 → セル調だが柔らかい、任天堂的トゥーンの階調
  const data = new Uint8Array([96, 150, 205, 255]);
  _gradTex = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  _gradTex.minFilter = THREE.LinearFilter;
  _gradTex.magFilter = THREE.LinearFilter;
  _gradTex.needsUpdate = true;
  return _gradTex;
}

/* ---- リムライト(輪郭のふわっとした光)を任意のマテリアルに注入 ---- */
export function addRim(mat, color = 0xffffff, strength = 0.28, power = 3.0) {
  const rimColor = new THREE.Color(color);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimStrength = { value: strength };
    shader.uniforms.uRimPower = { value: power };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;`)
      .replace('#include <opaque_fragment>', `
        {
          float rimDot = 1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition)));
          outgoingLight += uRimColor * pow(rimDot, uRimPower) * uRimStrength;
        }
        #include <opaque_fragment>`);
  };
  return mat;
}

/* ---- ソフトトゥーンマテリアル ---- */
export function toon(color, opts = {}) {
  const { rim, rimColor, rimStrength, ...rest } = opts;
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: softGradientMap(),
    ...rest,
  });
  if (rim !== false) {
    addRim(mat, rimColor ?? 0xdfefff, rimStrength ?? 0.22);
  }
  return mat;
}

export function hsl(h, s, l) {
  return new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace);
}

/* ---- 複数ジオメトリを1つに結合(頂点カラー付き・非インデックス) ----
   entries: [{ geom, matrix?, color }] */
export function mergeGeoms(entries) {
  const positions = [], normals = [], colors = [], uvs = [];
  const c = new THREE.Color();
  for (const e of entries) {
    let g = e.geom.index ? e.geom.toNonIndexed() : e.geom.clone();
    if (e.matrix) g.applyMatrix4(e.matrix);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const uv = g.attributes.uv;
    c.set(e.color ?? 0xffffff);
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      colors.push(c.r, c.g, c.b);
      if (uv) uvs.push(uv.getX(i), uv.getY(i)); else uvs.push(0, 0);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

/* ---- 行列生成の省略ヘルパー ---- */
export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sy = null, sz = null) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  m.compose(
    new THREE.Vector3(x, y, z),
    q,
    new THREE.Vector3(s, sy ?? s, sz ?? s)
  );
  return m;
}

/* ---- Canvas テクスチャ生成 ---- */
export function canvasTexture(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.anisotropy ?? 4;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  return tex;
}

/* ---- 星型の押し出しジオメトリ ---- */
export function starGeometry(outer = 1, inner = 0.45, depth = 0.32) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.09, bevelSegments: 2,
  });
  g.center();
  return g;
}

/* ---- 決定的な擬似乱数 (シードつき) ---- */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
