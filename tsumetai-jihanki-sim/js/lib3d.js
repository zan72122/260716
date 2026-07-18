/* ============================================================
   lib3d.js — 描画ヘルパー (sky-air-rider から流用・改変)
   ジオメトリ結合 / Canvasテクスチャ / 行列 / 乱数
   ============================================================ */
import * as THREE from 'three';

/* ---- 複数ジオメトリを1つに結合 (頂点カラー付き・非インデックス) ----
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

/* ---- 決定的な擬似乱数 (シードつき) ---- */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---- 2D線分 → 薄い板ジオメトリ (機構部品の描画用) ----
   線分 (a→b) を法線方向 thickness、奥行き depth の板にする。
   plane='xy': (u,v)=(x,y) 板はz方向に depth。
   plane='zy': (u,v)=(z,y) 板はx方向に depth。 */
export function segPlate(a, b, thickness, depth, plane = 'xy') {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
  const g = new THREE.BoxGeometry(len, thickness, depth);
  if (plane === 'xy') {
    g.applyMatrix4(mat4(cx, cy, 0, 0, 0, ang));
  } else {
    // (u,v) = (z,y): まずXY平面で作って全体をY軸回転
    g.applyMatrix4(mat4(0, 0, 0, 0, 0, ang));
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    g.applyMatrix4(mat4(0, cy, cx));
  }
  return g;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
