// ================================================================
// トゥーンシェーディング素材 — Switch風のセルルック
// ・段階グラデーションマップ(3〜4段)で陰影をパキッとさせる
// ・リムライト(輪郭が淡く光る)を onBeforeCompile で注入
// ・インバーテッドハル方式のアウトライン(キャラの黒フチ)
// ================================================================

import * as THREE from 'three';

let _gradientMap = null;

/** 4段トゥーングラデーション(共有) */
export function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([90, 160, 220, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradientMap = tex;
  return tex;
}

/**
 * トゥーン素材。rim: リムライトの強さ(0で無し)、emissive: 自己発光色
 */
export function toonMat(color, { rim = 0.25, rimColor = 0xbfd4ff, emissive = 0x000000, emissiveIntensity = 1 } = {}) {
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    emissive,
    emissiveIntensity,
  });
  if (rim > 0) {
    const rc = new THREE.Color(rimColor);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: new THREE.Vector3(rc.r, rc.g, rc.b) };
      shader.uniforms.uRimPower = { value: rim };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRimPower;')
        .replace(
          '#include <opaque_fragment>',
          `float rimDot = 1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
           float rimAmt = smoothstep(0.55, 0.95, rimDot) * uRimPower;
           outgoingLight += uRimColor * rimAmt;
           #include <opaque_fragment>`
        );
    };
  }
  return mat;
}

/** つやつや発光素材(星・月など、ブルームに乗せる) */
export function glowMat(color, intensity = 0.9) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: gradientMap(),
    emissive: color,
    emissiveIntensity: intensity,
  });
}

const OUTLINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2b2350, side: THREE.BackSide });

/**
 * インバーテッドハル・アウトライン。
 * mesh のジオメトリを法線方向に膨らませた黒メッシュを子として追加。
 */
export function addOutline(mesh, thickness = 0.028) {
  const geo = mesh.geometry;
  const outline = new THREE.Mesh(geo, OUTLINE_MAT);
  outline.scale.setScalar(1 + thickness);
  outline.renderOrder = -1;
  outline.userData.noOutline = true; // 二重付与ガード
  mesh.add(outline);
  return outline;
}

/**
 * グループ内の全メッシュにアウトラインを付ける(目・口など小物は除外可)
 * ※ traverse 中に子を足すと追加分まで走査されるため、先に集めてから付ける
 */
export function outlineGroup(group, thickness = 0.028, exclude = new Set()) {
  const targets = [];
  group.traverse((o) => {
    if (o.isMesh && !exclude.has(o.name) && !o.userData.noOutline) targets.push(o);
  });
  for (const m of targets) addOutline(m, thickness);
}
