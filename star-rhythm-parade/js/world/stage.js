// ================================================================
// ワールド — 星空の丘に浮かぶ木のステージ
// ・グラデーション空ドーム(カスタムシェーダ)
// ・またたく星(Pointsシェーダ)・月・ふわふわ雲
// ・チェッカー模様の丘・木製ステージ・観客の星さんたち
// すべてのミニゲームで共有し、ゲームは小道具だけ載せ替える。
// ================================================================

import * as THREE from 'three';
import { toonMat, glowMat } from '../core/toon.js';
import { COLORS } from '../config.js';

/** 年輪+板目のプロシージャル木目(外部画像なし) */
function makeWoodTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const cx = S / 2, cy = S / 2;

  c.fillStyle = '#ffc078';
  c.fillRect(0, 0, S, S);

  // 年輪
  for (let r = 14; r < S * 0.75; r += 13 + Math.sin(r * 0.6) * 4) {
    c.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.05; a += 0.08) {
      const wob = Math.sin(a * 5 + r * 0.35) * 2.2 + Math.sin(a * 11 + r) * 1.1;
      const rr = r + wob;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = `rgba(190, 120, 55, ${0.16 + (r % 3) * 0.05})`;
    c.lineWidth = 2.5 + (r % 5) * 0.6;
    c.stroke();
  }

  // 放射状の板の継ぎ目
  c.strokeStyle = 'rgba(160, 95, 40, 0.28)';
  c.lineWidth = 3;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.15;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * 22, cy + Math.sin(a) * 22);
    c.lineTo(cx + Math.cos(a) * S, cy + Math.sin(a) * S);
    c.stroke();
  }

  // 細かい木目ノイズ
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * S * 0.7;
    c.fillStyle = `rgba(${170 + Math.random() * 60}, ${100 + Math.random() * 40}, 50, 0.08)`;
    c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + Math.random() * 5, 1.5);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.t = 0;
    this.beatPulse = 0;   // 拍に合わせて 1 → 0 に減衰
    this.clouds = [];
    this.audience = [];

    this._sky();
    this._stars();
    this._moon();
    this._ground();
    this._stage();
    this._clouds();
    this._audience();
    this._lights();
  }

  /* ---------- 空 ---------- */
  _sky() {
    const geo = new THREE.SphereGeometry(120, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(COLORS.nightTop) },
        bottom: { value: new THREE.Color(COLORS.nightBottom) },
        horizon: { value: new THREE.Color(COLORS.horizon) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          vec3 c = mix(bottom, top, smoothstep(-0.1, 0.65, h));
          // 地平線にほんのり夕焼けピンク
          float glow = exp(-abs(h - 0.02) * 9.0) * 0.55;
          c = mix(c, horizon, glow);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.root.add(new THREE.Mesh(geo, mat));
  }

  /* ---------- またたく星 ---------- */
  _stars() {
    const N = 320;
    const pos = new Float32Array(N * 3);
    const phase = new Float32Array(N);
    const size = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // 上半球にランダム配置
      const a = Math.random() * Math.PI * 2;
      const y = 0.12 + Math.random() * 0.85;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      pos[i * 3] = Math.cos(a) * r * 105;
      pos[i * 3 + 1] = y * 105;
      pos[i * 3 + 2] = Math.sin(a) * r * 105;
      phase[i] = Math.random() * Math.PI * 2;
      size[i] = 1.4 + Math.random() * 2.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: `
        attribute float aPhase; attribute float aSize;
        uniform float uTime; uniform float uPulse;
        varying float vTw;
        void main() {
          vTw = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float ps = aSize * (1.0 + uPulse * 0.7) * (vTw * 0.5 + 0.6);
          gl_PointSize = ps * (140.0 / -mv.z) * 2.2;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vTw;
        void main() {
          vec2 uv = gl_PointCoord - 0.5;
          float d = length(uv);
          float a = smoothstep(0.5, 0.05, d) * vTw;
          // 十字のきらめき
          float cross = max(0.0, 1.0 - abs(uv.x) * 14.0) + max(0.0, 1.0 - abs(uv.y) * 14.0);
          a += cross * 0.25 * vTw * smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(1.0, 0.96, 0.82, a);
        }`,
    });
    this.root.add(new THREE.Points(geo, this.starMat));
  }

  /* ---------- 月 ---------- */
  _moon() {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(4.6, 32, 24),
      glowMat(COLORS.moon, 0.75)
    );
    moon.position.set(-26, 26, -55);
    this.root.add(moon);
    // 月のまわりのハロー
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(6.4, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0xfff3c4, transparent: true, opacity: 0.14,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    halo.position.copy(moon.position);
    this.root.add(halo);
  }

  /* ---------- 丘と地面 ---------- */
  _ground() {
    // メインの地面(ゆるい起伏 + 市松の色分け)
    const seg = 56;
    const geo = new THREE.PlaneGeometry(150, 150, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const posAttr = geo.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const c1 = new THREE.Color(COLORS.ground);
    const c2 = new THREE.Color(COLORS.groundDark);
    const tmp = new THREE.Color();
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      const d = Math.hypot(x, z);
      // 遠くほど盛り上がる丘 + さざ波
      let y = Math.max(0, d - 14) * 0.09
        + Math.sin(x * 0.18) * Math.cos(z * 0.16) * 0.9 * Math.min(1, d / 20);
      if (d < 13) y = 0; // ステージ周辺は平ら
      posAttr.setY(i, y);
      const check = (Math.floor((x + 300) / 4.2) + Math.floor((z + 300) / 4.2)) % 2;
      tmp.copy(check ? c1 : c2);
      // 遠景は空色に溶かす
      const fade = THREE.MathUtils.clamp((d - 30) / 50, 0, 0.75);
      tmp.lerp(new THREE.Color(COLORS.nightBottom), fade);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.root.add(ground);

    // 遠くのやま(まるいドーム・空に溶けるシルエット)
    const mtnMatA = toonMat(0x453a8c, { rim: 0.18, rimColor: 0xff9fb8 });
    const mtnMatB = toonMat(0x372c74, { rim: 0.12, rimColor: 0xff9fb8 });
    const domes = [
      [-46, -78, 24, 0.62, mtnMatA],
      [-8, -88, 34, 0.5, mtnMatB],
      [38, -80, 26, 0.58, mtnMatA],
      [72, -62, 18, 0.55, mtnMatB],
      [-78, -58, 17, 0.6, mtnMatB],
    ];
    for (const [x, z, s, h, mat] of domes) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      m.scale.y = h;
      m.position.set(x, 1.5, z);
      this.root.add(m);
    }
  }

  /* ---------- 木のステージ ---------- */
  _stage() {
    const g = new THREE.Group();

    // 円形の舞台(年輪風の木目テクスチャ)
    const woodMat = toonMat(0xffffff, { rim: 0.12, rimColor: 0xffd9a0 });
    woodMat.map = makeWoodTexture();
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(6.4, 6.8, 0.7, 40),
      woodMat
    );
    top.position.y = 0.35;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // 縁どり
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.45, 0.16, 10, 48),
      toonMat(COLORS.stageWoodDark, { rim: 0 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.72;
    g.add(rim);

    // 豆電球の飾り(発光・ブルームが乗る)
    this.bulbs = [];
    const bulbGeo = new THREE.SphereGeometry(0.12, 10, 8);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? 0xffe066 : i % 3 === 1 ? 0xff8fb1 : 0x7ce8c4,
      });
      const b = new THREE.Mesh(bulbGeo, mat);
      b.position.set(Math.cos(a) * 6.45, 0.9, Math.sin(a) * 6.45);
      g.add(b);
      this.bulbs.push({ mesh: b, phase: i * 0.7, base: mat.color.clone() });
    }

    // 支柱(舞台下)
    const legMat = toonMat(COLORS.stageWoodDark, { rim: 0 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8), legMat);
      leg.position.set(Math.cos(a) * 5.6, 0, Math.sin(a) * 5.6);
      g.add(leg);
    }

    this.root.add(g);
    this.stageGroup = g;

    // ゲームごとの小道具はここにぶら下げる
    this.props = new THREE.Group();
    this.props.position.y = 0.7; // 舞台の上面
    this.root.add(this.props);
  }

  /* ---------- 雲 ---------- */
  _clouds() {
    const mat = toonMat(0xf4ecff, { rim: 0.3, rimColor: 0xcdbaff });
    const mkCloud = (x, y, z, s) => {
      const c = new THREE.Group();
      const lobes = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < lobes; i++) {
        const r = s * (0.55 + Math.random() * 0.5);
        const b = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
        b.position.set((i - lobes / 2) * s * 0.7, (Math.random() - 0.5) * s * 0.3, (Math.random() - 0.5) * s * 0.4);
        b.scale.y = 0.72;
        c.add(b);
      }
      c.position.set(x, y, z);
      this.root.add(c);
      this.clouds.push({ g: c, speed: 0.14 + Math.random() * 0.25, baseY: y, phase: Math.random() * 6 });
      return c;
    };
    mkCloud(-22, 12, -34, 2.6);
    mkCloud(18, 16, -40, 3.2);
    mkCloud(34, 10, -26, 2.0);
    mkCloud(-36, 18, -46, 3.6);
    mkCloud(6, 20, -52, 2.8);
  }

  /* ---------- 観客の星さんたち ---------- */
  _audience() {
    const starShape = new THREE.Shape();
    const R = 0.34, r = 0.15;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      if (i === 0) starShape.moveTo(x, y); else starShape.lineTo(x, y);
    }
    const starGeo = new THREE.ExtrudeGeometry(starShape, {
      depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
    });
    starGeo.center();

    const eyeGeo = new THREE.SphereGeometry(0.035, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2b2350 });
    const cheekGeo = new THREE.CircleGeometry(0.035, 8);
    const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9db6 });

    const palette = [0xffe066, 0xffc94d, 0xfff0a0, 0xffb84d];
    for (let i = 0; i < 26; i++) {
      const a = Math.PI * (0.15 + Math.random() * 0.7) + (i % 2 ? 0 : Math.PI); // 左右の土手
      const dist = 8.6 + Math.random() * 5;
      const mat = glowMat(palette[i % palette.length], 0.35);
      const s = new THREE.Mesh(starGeo, mat);
      const scale = 0.7 + Math.random() * 0.6;
      s.scale.setScalar(scale);
      s.position.set(Math.cos(a) * dist, 0.45 * scale, Math.sin(a) * dist * 0.85 + 1.5);
      s.rotation.y = Math.atan2(-s.position.x, -(s.position.z - 2)); // ステージを向く
      s.castShadow = true;
      // 顔
      const face = new THREE.Group();
      const e1 = new THREE.Mesh(eyeGeo, eyeMat); e1.position.set(-0.08, 0.04, 0.14);
      const e2 = new THREE.Mesh(eyeGeo, eyeMat); e2.position.set(0.08, 0.04, 0.14);
      const c1 = new THREE.Mesh(cheekGeo, cheekMat); c1.position.set(-0.13, -0.03, 0.135);
      const c2 = new THREE.Mesh(cheekGeo, cheekMat); c2.position.set(0.13, -0.03, 0.135);
      face.add(e1, e2, c1, c2);
      s.add(face);
      this.root.add(s);
      this.audience.push({ mesh: s, baseY: s.position.y, phase: Math.random() * Math.PI * 2, scale });
    }
  }

  /* ---------- ライト ---------- */
  _lights() {
    const hemi = new THREE.HemisphereLight(0x9d8fff, 0x3a2a6e, 0.85);
    this.root.add(hemi);

    const key = new THREE.DirectionalLight(0xfff2dc, 1.9);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    key.shadow.camera.near = 2;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.002;
    key.shadow.radius = 4;
    this.root.add(key);
    this.keyLight = key;

    // 月あかりの逆光(青)
    const back = new THREE.DirectionalLight(0x7fa8ff, 0.55);
    back.position.set(-8, 10, -10);
    this.root.add(back);

    // ステージを照らす暖色スポット
    const spot = new THREE.SpotLight(0xffd9a0, 55, 30, Math.PI / 5, 0.55, 1.6);
    spot.position.set(0, 12, 4);
    spot.target.position.set(0, 0.7, 0);
    this.root.add(spot, spot.target);
  }

  /** 拍のタイミングで呼ぶと世界全体が「ぽよん」と弾む */
  onBeat(strength = 1) {
    this.beatPulse = Math.min(1.2, strength);
  }

  update(dt) {
    this.t += dt;
    this.beatPulse = Math.max(0, this.beatPulse - dt * 3.2);
    this.starMat.uniforms.uTime.value = this.t;
    this.starMat.uniforms.uPulse.value = this.beatPulse;

    // 雲はゆっくり流れる
    for (const c of this.clouds) {
      c.g.position.x += c.speed * dt;
      if (c.g.position.x > 55) c.g.position.x = -55;
      c.g.position.y = c.baseY + Math.sin(this.t * 0.4 + c.phase) * 0.4;
    }

    // 豆電球は順番にチカチカ
    for (const b of this.bulbs) {
      const tw = 0.65 + 0.35 * Math.sin(this.t * 3 + b.phase);
      b.mesh.material.color.copy(b.base).multiplyScalar(tw + this.beatPulse * 0.5);
    }

    // 観客は拍でジャンプ
    for (const a of this.audience) {
      const hop = Math.max(0, Math.sin(this.t * 4.6 + a.phase)) * 0.12;
      a.mesh.position.y = a.baseY + hop + this.beatPulse * 0.28 * a.scale;
      a.mesh.rotation.z = Math.sin(this.t * 2.2 + a.phase) * 0.08;
      const squash = 1 + this.beatPulse * 0.12;
      a.mesh.scale.set(a.scale * (2 - squash), a.scale * squash, a.scale);
    }
  }
}
