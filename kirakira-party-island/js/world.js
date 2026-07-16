// パーティーアイランドの3Dワールド。
// トゥーン調の島・海・空・雲・木・虹・すごろくタイルをすべてコードで生成する。

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, TILE_TYPES, buildTileLayout } from './config.js';
import {
  toonMat, toonMatUnique, skyMaterial, seaMaterial,
  starGeometry, heartGeometry, glowTexture,
} from './gfx.js';

const { TILE_COUNT, BOARD_RADIUS } = CONFIG;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;

// 島の高さ関数。地形・タイル・木・キャラの接地すべてがこれを参照する。
export function islandHeight(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(z, x);
  let h = -2.4 + 5.4 * Math.pow(Math.max(0, 1 - r / 23.5), 1.0);
  h += 1.6 * Math.exp(-(r * r) / (5.2 * 5.2));            // 中央の丘
  h += 0.4 * Math.sin(a * 5 + r * 0.9) * smoothstep(4, 20, r); // ふちのうねり
  // タイルが並ぶ帯はなだらかに(すごろくが歩きやすい高さに固定)
  const band = smoothstep(10.4, 12.0, r) * (1 - smoothstep(14.6, 16.2, r));
  h = lerp(h, 0.85, band * 0.9);
  return h;
}

export function tileAngle(i) {
  return (i / TILE_COUNT) * Math.PI * 2;
}

export function tilePosition(i) {
  const a = tileAngle(i);
  const r = BOARD_RADIUS + Math.sin(i * 1.7) * 0.9;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return new THREE.Vector3(x, islandHeight(x, z) + 0.18, z);
}

// ============ タイル(すごろくマス) ============
class Tile {
  constructor(index, typeKey, world) {
    this.index = index;
    this.world = world;
    this.pos = tilePosition(index);
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);

    // 白いふち
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.42, 0.16, 28),
      toonMat(0xfffdf4),
    );
    rim.receiveShadow = true;
    this.group.add(rim);

    // 色つきトップ(タイプで色が変わる)
    this.topMat = toonMatUnique(0xffffff);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(1.08, 1.14, 0.16, 28),
      this.topMat,
    );
    top.position.y = 0.1;
    top.receiveShadow = true;
    this.group.add(top);

    this.iconGroup = new THREE.Group();
    this.iconGroup.position.y = 0.22;
    this.group.add(this.iconGroup);

    this.setType(typeKey);
  }

  setType(typeKey) {
    this.type = typeKey;
    const info = TILE_TYPES[typeKey];
    this.topMat.color.set(info.color);
    this.topMat.emissive.set(info.color);
    this.topMat.emissiveIntensity = 0;

    // アイコンを作り直す
    while (this.iconGroup.children.length) {
      this.iconGroup.remove(this.iconGroup.children[0]);
    }
    let icon = null;
    if (typeKey === 'COIN') {
      icon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20),
        toonMat(0xffd23e),
      );
      const hole = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.07, 8, 20),
        toonMat(0xffb300),
      );
      hole.rotation.x = Math.PI / 2;
      hole.position.y = 0.05;
      this.iconGroup.add(hole);
    } else if (typeKey === 'HEART') {
      icon = new THREE.Mesh(heartGeometry(0.55, 0.16), toonMat(0xff5c8d));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.08;
    } else if (typeKey === 'RAINBOW') {
      const cols = [0xff5c5c, 0xffb03c, 0xffe45c, 0x6fdd6f, 0x5cb8ff];
      cols.forEach((c, k) => {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(0.55 - k * 0.09, 0.045, 6, 16, Math.PI),
          toonMat(c),
        );
        arc.position.y = 0.06;
        this.iconGroup.add(arc);
      });
    } else if (typeKey === 'EVENT') {
      icon = new THREE.Mesh(starGeometry(0.34, 0.16, 0.1), toonMat(0xffffff));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.1;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.55, 0.05, 6, 20),
        toonMat(0x2f9139),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      this.iconGroup.add(ring);
    } else if (typeKey === 'STAR') {
      icon = new THREE.Mesh(starGeometry(0.55, 0.26, 0.18), toonMatUnique(0xfff1b0, {
        emissive: 0xffcf4d, emissiveIntensity: 0.5,
      }));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.12;
    }
    if (icon) {
      icon.castShadow = true;
      this.iconGroup.add(icon);
    }
  }

  update(t) {
    if (this.type === 'STAR') {
      // スターのマスはキラキラ浮かんで回る
      this.iconGroup.position.y = 0.55 + Math.sin(t * 2.4) * 0.12;
      this.iconGroup.rotation.y = t * 1.6;
      this.topMat.emissiveIntensity = 0.25 + Math.sin(t * 3) * 0.2;
    } else {
      this.iconGroup.position.y = 0.22;
      this.iconGroup.rotation.y = 0;
    }
  }
}

// ============ ワールド全体 ============
export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.animated = [];   // update で動かすもの

    this._buildLights();
    this._buildSky();
    this._buildSea();
    this._buildIsland();
    this._buildTiles();
    this._buildCenterTower();
    this._buildDecorations();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7fb56a, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sunLight = sun;
  }

  _buildSky() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(220, 32, 18), skyMaterial());
    this.scene.add(dome);

    // 太陽のグロー
    const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff3b8, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sunSpr.position.set(90, 120, 40);
    sunSpr.scale.setScalar(70);
    this.scene.add(sunSpr);

    this.scene.fog = new THREE.Fog(0xa8d8ff, 90, 230);
  }

  _buildSea() {
    this.seaMat = seaMaterial();
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(CONFIG.SEA_SIZE, CONFIG.SEA_SIZE, 56, 56),
      this.seaMat,
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    this.scene.add(sea);

    // 島まわりの白い波リング
    this.foamRings = [];
    [21.8, 23.4].forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.55, 72),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: i === 0 ? 0.55 : 0.3,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06 + i * 0.02;
      this.scene.add(ring);
      this.foamRings.push(ring);
    });
  }

  _buildIsland() {
    const size = 50, seg = 110;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xf7e3a8);
    const cGrass = new THREE.Color(0x7ed957);
    const cGrass2 = new THREE.Color(0x5cc244);
    const cHill = new THREE.Color(0x4aa53c);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = islandHeight(x, z);
      pos.setY(i, h);
      // 高さで塗り分け(砂浜→草→丘)
      if (h < 0.42) tmp.copy(cSand);
      else if (h < 0.6) tmp.copy(cSand).lerp(cGrass, (h - 0.42) / 0.18);
      else if (h < 2.2) tmp.copy(cGrass).lerp(cGrass2, (h - 0.6) / 1.6);
      else tmp.copy(cGrass2).lerp(cHill, Math.min(1, (h - 2.2) / 1.6));
      // ちょっとした色ゆらぎで自然に
      const n = Math.sin(x * 1.7 + z * 2.3) * Math.sin(x * 0.9 - z * 1.1) * 0.045;
      tmp.offsetHSL(0, 0, n);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const island = new THREE.Mesh(geo, toonMatUnique(0xffffff, { vertexColors: true }));
    island.receiveShadow = true;
    this.scene.add(island);
  }

  _buildTiles() {
    const layout = buildTileLayout(TILE_COUNT);
    this.tiles = layout.map((typeKey, i) => new Tile(i, typeKey, this));
    // スターの初期位置(プレイヤーのスタートから少し先)
    this.starTileIndex = 8;
    this.tiles[this.starTileIndex].setType('STAR');
    this.tiles.forEach((t) => this.scene.add(t.group));
  }

  // スターが取られたら別の場所に移動する
  moveStar() {
    const old = this.tiles[this.starTileIndex];
    old.setType(buildTileLayout(TILE_COUNT)[old.index]);
    let next = this.starTileIndex;
    while (Math.abs(next - this.starTileIndex) < 6) {
      next = Math.floor(Math.random() * TILE_COUNT);
    }
    this.starTileIndex = next;
    this.tiles[next].setType('STAR');
    return this.tiles[next];
  }

  _buildCenterTower() {
    // 島の中心に立つ「おほしさまタワー」(メリーゴーランド風)
    const g = new THREE.Group();
    const baseY = islandHeight(0, 0);
    g.position.set(0, baseY, 0);

    const steps = [2.6, 2.0, 1.4];
    steps.forEach((r, i) => {
      const step = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r + 0.25, 0.36, 26),
        toonMat(i % 2 === 0 ? 0xffe9f0 : 0xfff8dc),
      );
      step.position.y = 0.18 + i * 0.36;
      step.receiveShadow = true;
      step.castShadow = true;
      g.add(step);
    });

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 4.4, 12),
      toonMat(0xff9dbe),
    );
    pole.position.y = 1.1 + 2.2;
    pole.castShadow = true;
    g.add(pole);

    // ストライプ屋根
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 1.2, 12),
      toonMat(0xff6f9c),
    );
    roof.position.y = 5.0;
    roof.castShadow = true;
    g.add(roof);

    this.bigStar = new THREE.Mesh(
      starGeometry(1.15, 0.55, 0.4),
      toonMatUnique(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.45 }),
    );
    this.bigStar.position.y = 6.6;
    this.bigStar.castShadow = true;
    g.add(this.bigStar);

    // まわりに小さい旗
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.16, 0.5, 6),
        toonMat([0xff5c8d, 0x4da3ff, 0xffc93e, 0x43c04e, 0xb06ce0, 0xff9d3c][i]),
      );
      flag.position.set(Math.cos(a) * 2.0, 4.35, Math.sin(a) * 2.0);
      flag.rotation.z = Math.PI;
      g.add(flag);
    }

    this.scene.add(g);
    this.tower = g;
  }

  _addTree(x, z, kind = 'green') {
    const g = new THREE.Group();
    const y = islandHeight(x, z);
    if (y < 0.5) return; // 海の中には生やさない
    g.position.set(x, y, z);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, 1.1, 8),
      toonMat(0x9c6b3f),
    );
    trunk.position.y = 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    const cols = kind === 'pink'
      ? [0xffb7d0, 0xffa2c2, 0xffcadd]
      : [0x51b84a, 0x66cc55, 0x459e3f];
    const blobs = [
      [0, 1.5, 0, 0.75], [0.45, 1.25, 0.15, 0.5], [-0.4, 1.3, -0.1, 0.55],
    ];
    blobs.forEach(([bx, by, bz, r], i) => {
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), toonMat(cols[i % cols.length]));
      blob.position.set(bx, by, bz);
      blob.castShadow = true;
      g.add(blob);
    });
    const scale = 0.8 + Math.random() * 0.7;
    g.scale.setScalar(scale);
    g.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(g);
  }

  _buildDecorations() {
    // 木(タイルの内側と外側に散らす)
    const treeSpots = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      treeSpots.push([Math.cos(a) * (6.5 + Math.random() * 2), Math.sin(a) * (6.5 + Math.random() * 2)]);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.1;
      treeSpots.push([Math.cos(a) * (17 + Math.random() * 2.4), Math.sin(a) * (17 + Math.random() * 2.4)]);
    }
    treeSpots.forEach(([x, z], i) => this._addTree(x, z, i % 4 === 3 ? 'pink' : 'green'));

    // お花(インスタンスで軽く大量に)
    const flowerGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const flowers = new THREE.InstancedMesh(flowerGeo, toonMat(0xffffff), 140);
    const dummy = new THREE.Object3D();
    const fCols = [0xff8fb5, 0xffe45c, 0xffffff, 0xc19bff, 0xff9d5c];
    let placed = 0;
    let guard = 0;
    while (placed < 140 && guard++ < 900) {
      const a = Math.random() * Math.PI * 2;
      const r = 4 + Math.random() * 16;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      if (y < 0.55) continue;
      const rr = Math.hypot(x, z);
      if (rr > 11.4 && rr < 15.4) continue; // タイルの帯は避ける
      dummy.position.set(x, y + 0.06, z);
      dummy.scale.setScalar(0.7 + Math.random() * 0.9);
      dummy.updateMatrix();
      flowers.setMatrixAt(placed, dummy.matrix);
      flowers.setColorAt(placed, new THREE.Color(fCols[placed % fCols.length]));
      placed++;
    }
    flowers.count = placed;
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    this.scene.add(flowers);

    // 虹のアーチ
    const rainbow = new THREE.Group();
    const rCols = [0xff5c5c, 0xffb03c, 0xffe45c, 0x6fdd6f, 0x5cb8ff, 0xb06ce0];
    rCols.forEach((c, i) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(9 - i * 0.5, 0.28, 8, 40, Math.PI),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.82, fog: false }),
      );
      rainbow.add(arc);
    });
    rainbow.position.set(-26, 2, -20);
    rainbow.rotation.y = Math.PI / 3.4;
    this.scene.add(rainbow);

    // ふわふわ気球(遠景)
    this.balloons = [];
    const bCols = [0xff5c8d, 0xffc93e, 0x4da3ff, 0x43c04e];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 14), toonMat(bCols[i]));
      env.scale.y = 1.15;
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.62, 16, 14, 0, Math.PI * 2, 1.1, 0.5), toonMat(0xfff8dc));
      stripe.scale.y = 1.15;
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.5, 8), toonMat(0xb0803f));
      basket.position.y = -2.35;
      b.add(env, stripe, basket);
      const a = (i / 4) * Math.PI * 2 + 0.8;
      b.position.set(Math.cos(a) * 34, 10 + i * 3, Math.sin(a) * 34);
      b.userData = { baseY: b.position.y, phase: i * 1.7, speed: 0.12 + i * 0.03, angle: a, radius: 34 };
      this.scene.add(b);
      this.balloons.push(b);
    }

    // 雲
    this.clouds = [];
    for (let i = 0; i < 9; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(1.6 + Math.random() * 1.6, 12, 10),
          toonMat(0xffffff),
        );
        puff.position.set(k * 2.0 - n, Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
        puff.scale.y = 0.62;
        cloud.add(puff);
      }
      const a = (i / 9) * Math.PI * 2;
      const r = 46 + Math.random() * 40;
      cloud.position.set(Math.cos(a) * r, 16 + Math.random() * 14, Math.sin(a) * r);
      cloud.userData = { angle: a, radius: r, speed: 0.008 + Math.random() * 0.012, y: cloud.position.y };
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }

    // ちょうちょ
    this.butterflies = [];
    for (let i = 0; i < 5; i++) {
      const fly = new THREE.Group();
      const wingGeo = new THREE.CircleGeometry(0.22, 10);
      const wMat = toonMat([0xffc93e, 0xff8fb5, 0x9bd4ff][i % 3], { side: THREE.DoubleSide });
      const w1 = new THREE.Mesh(wingGeo, wMat);
      const w2 = new THREE.Mesh(wingGeo, wMat);
      w1.position.x = -0.14; w2.position.x = 0.14;
      const wl = new THREE.Group(); wl.add(w1);
      const wr = new THREE.Group(); wr.add(w2);
      fly.add(wl, wr);
      fly.userData = {
        wl, wr, phase: i * 2.2,
        cx: (Math.random() - 0.5) * 18, cz: (Math.random() - 0.5) * 18,
        r: 2.5 + Math.random() * 3, h: 2.2 + Math.random() * 2, speed: 0.4 + Math.random() * 0.4,
      };
      this.scene.add(fly);
      this.butterflies.push(fly);
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.seaMat.uniforms.time.value = t;

    this.tiles.forEach((tile) => tile.update(t));

    // 中央タワーの星
    this.bigStar.rotation.y = t * 0.8;
    this.bigStar.position.y = 6.6 + Math.sin(t * 1.4) * 0.18;

    // 波リングのふくらみ
    this.foamRings.forEach((r, i) => {
      const s = 1 + Math.sin(t * 1.4 + i * 1.5) * 0.012;
      r.scale.setScalar(s);
      r.material.opacity = (i === 0 ? 0.55 : 0.3) * (0.75 + Math.sin(t * 1.4 + i) * 0.25);
    });

    // 気球
    this.balloons.forEach((b) => {
      const u = b.userData;
      u.angle += u.speed * dt * 0.2;
      b.position.x = Math.cos(u.angle) * u.radius;
      b.position.z = Math.sin(u.angle) * u.radius;
      b.position.y = u.baseY + Math.sin(t * 0.7 + u.phase) * 1.2;
    });

    // 雲はゆっくり流れる
    this.clouds.forEach((c) => {
      const u = c.userData;
      u.angle += u.speed * dt;
      c.position.x = Math.cos(u.angle) * u.radius;
      c.position.z = Math.sin(u.angle) * u.radius;
    });

    // ちょうちょ
    this.butterflies.forEach((f) => {
      const u = f.userData;
      const a = t * u.speed + u.phase;
      const x = u.cx + Math.cos(a) * u.r;
      const z = u.cz + Math.sin(a * 1.3) * u.r;
      const y = Math.max(islandHeight(x, z), 0.4) + u.h + Math.sin(t * 2 + u.phase) * 0.4;
      f.position.set(x, y, z);
      f.rotation.y = -a;
      const flap = Math.sin(t * 14 + u.phase) * 0.9;
      u.wl.rotation.y = flap;
      u.wr.rotation.y = -flap;
    });
  }
}
