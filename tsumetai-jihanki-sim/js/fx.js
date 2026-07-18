/* ============================================================
   fx.js — 冷気パーティクルと結露
   ・庫内の冷気もや (X線モードで見える) / 取出口の冷気パフ
   ・商品表面の結露シェル (水滴アルファテクスチャ)
   ============================================================ */
import * as THREE from 'three';
import { canvasTexture, makeRng } from './lib3d.js';

let dropletTex = null;
function getDropletTex() {
  if (dropletTex) return dropletTex;
  dropletTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const rng = makeRng(5);
    for (let i = 0; i < 240; i++) {
      const x = rng() * w, y = rng() * h;
      const r = 0.8 + rng() * rng() * 4.5;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.6, 'rgba(220,240,255,0.5)');
      g.addColorStop(1, 'rgba(200,230,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // 垂れた筋
    for (let i = 0; i < 10; i++) {
      const x = rng() * w;
      const y0 = rng() * h * 0.5;
      const len = 20 + rng() * 60;
      const g = ctx.createLinearGradient(x, y0, x, y0 + len);
      g.addColorStop(0, 'rgba(230,245,255,0)');
      g.addColorStop(0.7, 'rgba(230,245,255,0.4)');
      g.addColorStop(1, 'rgba(255,255,255,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 1, y0, 2.2, len);
    }
  });
  return dropletTex;
}

/* 商品グループに結露シェルを追加 (缶/ペット共通) */
export function addCondensation(grp, p) {
  const tex = getDropletTex();
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(p.r * 1.015, p.r * 1.015, p.len * 0.8, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0.55,
      alphaMap: tex,
      roughness: 0.12,
      metalness: 0.0,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  grp.add(shell);
  return shell;
}

/* 冷気パーティクル */
export class ColdFx {
  constructor(scene, max = 260) {
    this.max = max;
    this.scene = scene;
    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const spriteTex = canvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(230,245,255,0.7)');
      g.addColorStop(0.5, 'rgba(210,235,255,0.25)');
      g.addColorStop(1, 'rgba(200,230,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
    const mat = new THREE.PointsMaterial({
      size: 0.09,
      map: spriteTex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( diffuse, opacity * vAlpha );');
    };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    for (let i = 0; i < max; i++) {
      this.parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
    }
    this.cursor = 0;
    this.rng = makeRng(77);
    this.fogEnabled = false;
    this.fogTimer = 0;
  }

  emit(x, y, z, vx, vy, vz, life) {
    const p = this.parts[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = 0; p.maxLife = life;
  }

  /* 庫内の冷気もや (X線モード時) */
  setFog(on) { this.fogEnabled = on; }

  /* 取出口の冷気パフ */
  puff(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) {
      this.emit(
        x + (this.rng() - 0.5) * 0.12,
        y + (this.rng() - 0.5) * 0.05,
        z + this.rng() * 0.05,
        (this.rng() - 0.5) * 0.15,
        -0.03 - this.rng() * 0.06,
        0.10 + this.rng() * 0.16,
        0.9 + this.rng() * 0.5
      );
    }
  }

  update(dtSim) {
    if (this.fogEnabled) {
      this.fogTimer -= dtSim;
      if (this.fogTimer <= 0) {
        this.fogTimer = 0.06;
        // 庫内上部から沈む冷気
        this.emit(
          -0.4 + this.rng() * 0.8,
          1.0 + this.rng() * 0.7,
          -0.25 + this.rng() * 0.35,
          (this.rng() - 0.5) * 0.05,
          -0.05 - this.rng() * 0.05,
          (this.rng() - 0.5) * 0.04,
          1.6 + this.rng() * 1.2
        );
      }
    }
    let i = 0;
    for (const p of this.parts) {
      if (p.alive) {
        p.life += dtSim;
        if (p.life >= p.maxLife) p.alive = false;
        else {
          p.x += p.vx * dtSim;
          p.y += p.vy * dtSim;
          p.z += p.vz * dtSim;
          p.vy -= 0.02 * dtSim;   // 冷気は沈む
          const k = 1 - p.life / p.maxLife;
          this.positions[i * 3] = p.x;
          this.positions[i * 3 + 1] = p.y;
          this.positions[i * 3 + 2] = p.z;
          this.alphas[i] = Math.min(1, k * 1.6) * 0.8;
          i++;
        }
      }
    }
    this.points.geometry.setDrawRange(0, i);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
