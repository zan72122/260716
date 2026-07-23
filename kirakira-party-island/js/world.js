// パーティーアイランドの3Dワールド。
// 48マス・4ゾーン(はまべ/ジャングル/かざん/ゆうえんち)の大きな島を
// トゥーン調で生成し、天気システムでラウンドごとに表情を変える。

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, TILE_TYPES, buildTileLayout, zoneOfTile } from './config.js';
import {
  toonMat, toonMatUnique, skyMaterial, seaMaterial,
  starGeometry, heartGeometry, glowTexture, lightningGeometry,
} from './gfx.js';
import { Rides } from './rides.js';

const { TILE_COUNT, BOARD_RADIUS } = CONFIG;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

// ゾーンの中心角度(はまべ→ジャングル→かざん→ゆうえんち)
const ZONE_CENTERS = [TAU * 0.125, TAU * 0.375, TAU * 0.625, TAU * 0.875];
// かざんの本体位置
const VOLCANO_A = ZONE_CENTERS[2];
const VOLCANO_R = 23.5;
const VOLCANO_X = Math.cos(VOLCANO_A) * VOLCANO_R;
const VOLCANO_Z = Math.sin(VOLCANO_A) * VOLCANO_R;

// 角度ごとのゾーンウェイト(なめらかに混ざる)
export function zoneWeights(a) {
  const w = [0, 0, 0, 0];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    let d = Math.abs(a - ZONE_CENTERS[i]);
    if (d > Math.PI) d = TAU - d;
    const v = Math.pow(Math.max(0, Math.cos(d * 0.95)), 2.2);
    w[i] = v; sum += v;
  }
  for (let i = 0; i < 4; i++) w[i] = sum > 0 ? w[i] / sum : 0.25;
  return w;
}

// 島の高さ関数。地形・タイル・木・キャラの接地すべてがこれを参照する。
export function islandHeight(x, z) {
  const r = Math.hypot(x, z);
  let a = Math.atan2(z, x);
  if (a < 0) a += TAU;

  let h = -2.6 + 6.4 * Math.pow(Math.max(0, 1 - r / 31), 1.05);
  h += 1.7 * Math.exp(-(r * r) / (6.5 * 6.5));                 // 中央の丘
  h += 0.45 * Math.sin(a * 7 + r * 0.8) * smoothstep(6, 26, r); // うねり

  // タイルが並ぶ帯はなだらかに
  const band = smoothstep(13.6, 15.2, r) * (1 - smoothstep(18.0, 19.6, r));
  h = lerp(h, 0.9, band * 0.92);

  // はまべゾーンの外側は遠浅の入り江(カメさんが泳ぐ)
  const w = zoneWeights(a);
  h -= 3.4 * w[0] * smoothstep(19.5, 25, r);

  // かざんの山とクレーター
  const dv = Math.hypot(x - VOLCANO_X, z - VOLCANO_Z);
  h += 7.2 * Math.exp(-(dv * dv) / (4.4 * 4.4));
  h -= 3.0 * Math.exp(-(dv * dv) / (1.7 * 1.7));

  return h;
}

export function volcanoTop() {
  return new THREE.Vector3(VOLCANO_X, islandHeight(VOLCANO_X, VOLCANO_Z), VOLCANO_Z);
}

export function tileAngle(i) {
  return (i / TILE_COUNT) * TAU;
}

export function tilePosition(i) {
  const a = tileAngle(i);
  const r = BOARD_RADIUS + Math.sin(i * 1.7) * 0.6;
  const x = Math.cos(a) * r;
  const z = Math.sin(a) * r;
  return new THREE.Vector3(x, islandHeight(x, z) + 0.16, z);
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
      new THREE.CylinderGeometry(0.98, 1.08, 0.14, 24),
      toonMat(0xfffdf4),
    );
    rim.receiveShadow = true;
    this.group.add(rim);

    // 色つきトップ(タイプで色が変わる)
    this.topMat = toonMatUnique(0xffffff);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(0.82, 0.87, 0.14, 24),
      this.topMat,
    );
    top.position.y = 0.08;
    top.receiveShadow = true;
    this.group.add(top);

    this.iconGroup = new THREE.Group();
    this.iconGroup.position.y = 0.18;
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
        new THREE.CylinderGeometry(0.32, 0.32, 0.08, 18),
        toonMat(0xffd23e),
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.32, 0.055, 8, 18),
        toonMat(0xffb300),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.04;
      this.iconGroup.add(ring);
    } else if (typeKey === 'HEART') {
      icon = new THREE.Mesh(heartGeometry(0.44, 0.13), toonMat(0xff5c8d));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.07;
    } else if (typeKey === 'RAINBOW') {
      const cols = [0xff5c5c, 0xffb03c, 0xffe45c, 0x6fdd6f, 0x5cb8ff];
      cols.forEach((c, k) => {
        const arc = new THREE.Mesh(
          new THREE.TorusGeometry(0.44 - k * 0.075, 0.038, 6, 14, Math.PI),
          toonMat(c),
        );
        arc.position.y = 0.05;
        this.iconGroup.add(arc);
      });
    } else if (typeKey === 'EVENT') {
      icon = new THREE.Mesh(starGeometry(0.26, 0.13, 0.08), toonMat(0xffffff));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.08;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.04, 6, 18),
        toonMat(0x2f9139),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.03;
      this.iconGroup.add(ring);
    } else if (typeKey === 'STAR') {
      icon = new THREE.Mesh(starGeometry(0.46, 0.22, 0.15), toonMatUnique(0xfff1b0, {
        emissive: 0xffcf4d, emissiveIntensity: 0.5,
      }));
      icon.rotation.x = -Math.PI / 2;
      icon.position.y = 0.1;
    } else if (typeKey === 'STORM') {
      // くろくも+いなずま
      const cloud = new THREE.Group();
      [[-0.16, 0, 0.15], [0.05, 0.06, 0.19], [0.22, 0, 0.13]].forEach(([x, y, r]) => {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), toonMat(0x555070));
        puff.position.set(x, 0.42 + y, 0);
        cloud.add(puff);
      });
      const bolt = new THREE.Mesh(lightningGeometry(0.42, 0.08), toonMatUnique(0xffe45c, {
        emissive: 0xffc93e, emissiveIntensity: 0.6,
      }));
      bolt.position.y = 0.18;
      cloud.add(bolt);
      this.iconGroup.add(cloud);
    } else if (typeKey === 'BOMB') {
      // まっくろばくだん
      icon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 12), toonMat(0x2a2733));
      icon.position.y = 0.3;
      const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), toonMat(0x8a8a8a));
      fuse.position.y = 0.66;
      fuse.rotation.z = 0.3;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 6), toonMatUnique(0xff9d3c, {
        emissive: 0xff6a00, emissiveIntensity: 0.8,
      }));
      flame.position.set(0.06, 0.8, 0);
      this.iconGroup.add(fuse, flame);
    } else if (typeKey === 'HOLE') {
      // まっくらな あな
      const hole = new THREE.Mesh(
        new THREE.CircleGeometry(0.5, 20),
        new THREE.MeshBasicMaterial({ color: 0x241a12 }),
      );
      hole.rotation.x = -Math.PI / 2;
      hole.position.y = 0.09;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.07, 8, 20), toonMat(0x6b4a26));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.07;
      this.iconGroup.add(hole, rim);
    } else if (typeKey === 'TURTLE') {
      // カメのこうら
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 14, 10, 0, TAU, 0, Math.PI / 2),
        toonMat(0x2f9e6e),
      );
      shell.position.y = 0.08;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 16), toonMat(0x8fe0b8));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.1;
      this.iconGroup.add(shell, rim);
    } else if (typeKey === 'ROPEWAY') {
      // ゴンドラ
      const cab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.3), toonMat(0xff6f9c));
      cab.position.y = 0.3;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.16, 4), toonMat(0xffffff));
      roof.position.y = 0.53;
      roof.rotation.y = Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 6), toonMat(0x8a8a8a));
      arm.position.y = 0.68;
      this.iconGroup.add(cab, roof, arm);
    } else if (typeKey === 'COASTER') {
      // レールのアーチ+トロッコ
      const rail = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 18, Math.PI), toonMat(0x9c6b3f));
      rail.position.y = 0.08;
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.24), toonMat(0xff5c5c));
      cart.position.set(0, 0.52, 0);
      this.iconGroup.add(rail, cart);
    }
    if (icon) {
      icon.castShadow = true;
      this.iconGroup.add(icon);
    }
  }

  update(t) {
    if (this.type === 'STAR') {
      // スターのマスはキラキラ浮かんで回る
      this.iconGroup.position.y = 0.5 + Math.sin(t * 2.4) * 0.1;
      this.iconGroup.rotation.y = t * 1.6;
      this.topMat.emissiveIntensity = 0.25 + Math.sin(t * 3) * 0.2;
    } else if (this.type === 'STORM') {
      this.iconGroup.position.y = 0.18 + Math.sin(t * 3 + this.index) * 0.03;
      this.topMat.emissiveIntensity = Math.max(0, Math.sin(t * 5 + this.index) - 0.85) * 2;
    } else if (this.type === 'COASTER' || this.type === 'ROPEWAY' || this.type === 'TURTLE') {
      this.iconGroup.rotation.y = Math.sin(t * 1.6 + this.index) * 0.4;
    } else {
      this.iconGroup.position.y = 0.18;
      this.iconGroup.rotation.y = 0;
    }
  }
}

// ============ 天気プリセット ============
const WEATHERS = {
  sunny: {
    top: 0x3f8fe8, mid: 0x8fd0ff, bot: 0xfff2e0, fog: 0xa8d8ff,
    sun: 1.9, sunCol: 0xfff2d8, hemi: 0.85, cloud: 0xffffff, rain: false, rainbow: 0.35,
  },
  cloudy: {
    top: 0x5d7ba8, mid: 0xa3b8d0, bot: 0xe8ecf0, fog: 0xb8c4d4,
    sun: 1.15, sunCol: 0xe8e8e0, hemi: 0.7, cloud: 0xd5dae4, rain: false, rainbow: 0,
  },
  squall: {
    top: 0x3a4a6b, mid: 0x64789b, bot: 0xb8c2d4, fog: 0x8fa0b8,
    sun: 0.6, sunCol: 0xccccdd, hemi: 0.6, cloud: 0x939db2, rain: true, rainbow: 0,
  },
  rainbowy: {
    top: 0x4f9bea, mid: 0x9fd8ff, bot: 0xffeef2, fog: 0xbfe0ff,
    sun: 1.8, sunCol: 0xfff2d8, hemi: 0.9, cloud: 0xffffff, rain: false, rainbow: 1,
  },
  sunset: {
    top: 0x5a4a9e, mid: 0xff9d6e, bot: 0xffd9a0, fog: 0xe8b090,
    sun: 1.6, sunCol: 0xffb070, hemi: 0.75, cloud: 0xffd8c0, rain: false, rainbow: 0,
  },
};

// ============ ワールド全体 ============
export class World {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.heightFn = islandHeight; // rides.js が循環importせず使えるように

    this._buildLights();
    this._buildSky();
    this._buildSea();
    this._buildIsland();
    this._buildTiles();
    this._buildCenterTower();
    this._buildDecorations();
    this._buildZoneDecorations();
    this._buildRain();

    // のりもの・どうくつ・ボス・コースターのメッシュ群
    this.rides = new Rides(scene, this);

    this.weatherName = 'sunny';
    this.weatherTarget = WEATHERS.sunny;
  }

  // ---------- 天気 ----------
  setWeather(name) {
    this.weatherName = name;
    this.weatherTarget = WEATHERS[name] || WEATHERS.sunny;
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x7fb56a, 0.85);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
    sun.position.set(24, 38, 16);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -36;
    sun.shadow.camera.right = 36;
    sun.shadow.camera.top = 36;
    sun.shadow.camera.bottom = -36;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 110;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);
    this.sunLight = sun;
  }

  _buildSky() {
    this.skyMat = skyMaterial();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 18), this.skyMat);
    this.scene.add(dome);

    // 太陽のグロー
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xfff3b8, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.sunSprite.position.set(110, 150, 50);
    this.sunSprite.scale.setScalar(85);
    this.scene.add(this.sunSprite);

    this.scene.fog = new THREE.Fog(0xa8d8ff, 120, 300);
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
    [29.5, 31.4].forEach((r, i) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + 0.6, 80),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: i === 0 ? 0.5 : 0.28,
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
    const size = 66, seg = 132;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tmp = new THREE.Color();
    const mix = new THREE.Color();

    // ゾーンごとのパレット(低い場所, 高い場所)
    const PALETTES = [
      [new THREE.Color(0xf7e3a8), new THREE.Color(0x9be07a)], // はまべ
      [new THREE.Color(0x58b34a), new THREE.Color(0x2f8f3f)], // ジャングル
      [new THREE.Color(0x9a8878), new THREE.Color(0x5d5148)], // かざん
      [new THREE.Color(0x9fe88a), new THREE.Color(0x6fd07a)], // ゆうえんち
    ];
    const sand = new THREE.Color(0xf7e3a8);
    const lava = new THREE.Color(0xd96a3a);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = islandHeight(x, z);
      pos.setY(i, h);
      let a = Math.atan2(z, x);
      if (a < 0) a += TAU;
      const w = zoneWeights(a);
      const hk = smoothstep(0.6, 3.4, h);
      mix.setRGB(0, 0, 0);
      for (let zi = 0; zi < 4; zi++) {
        tmp.copy(PALETTES[zi][0]).lerp(PALETTES[zi][1], hk);
        mix.r += tmp.r * w[zi]; mix.g += tmp.g * w[zi]; mix.b += tmp.b * w[zi];
      }
      // みぎわは砂浜に(かざんゾーンはそのまま岩)
      if (h < 0.45) mix.lerp(sand, (1 - w[2]) * (1 - smoothstep(0.2, 0.45, h)) * 0.9);
      // かざんの火口ちかくは あつそうな色
      const dv = Math.hypot(x - VOLCANO_X, z - VOLCANO_Z);
      mix.lerp(lava, Math.max(0, 1 - dv / 3.2) * 0.55);
      // 色ゆらぎ
      const n = Math.sin(x * 1.7 + z * 2.3) * Math.sin(x * 0.9 - z * 1.1) * 0.04;
      mix.offsetHSL(0, 0, n);
      colors[i * 3] = mix.r; colors[i * 3 + 1] = mix.g; colors[i * 3 + 2] = mix.b;
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
    this.starTileIndex = 8;
    this.tiles[this.starTileIndex].setType('STAR');
    this.tiles.forEach((t) => this.scene.add(t.group));
  }

  // スターが取られたら、はなれたコインマスへおひっこし
  moveStar() {
    const layout = buildTileLayout(TILE_COUNT);
    const old = this.tiles[this.starTileIndex];
    old.setType(layout[old.index]);
    const candidates = [];
    for (let i = 0; i < TILE_COUNT; i++) {
      if (layout[i] !== 'COIN') continue;
      let d = Math.abs(i - this.starTileIndex);
      d = Math.min(d, TILE_COUNT - d);
      if (d >= 8) candidates.push(i);
    }
    const next = candidates[Math.floor(Math.random() * candidates.length)] ?? 8;
    this.starTileIndex = next;
    this.tiles[next].setType('STAR');
    return this.tiles[next];
  }

  _buildCenterTower() {
    // 島の中心に立つ「おほしさまタワー」
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

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
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

  _addTree(x, z, kind = 'green', scale = 1) {
    const g = new THREE.Group();
    const y = islandHeight(x, z);
    if (y < 0.5) return;
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
      : kind === 'deep'
        ? [0x2f8f3f, 0x3da34c, 0x27803a]
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
    g.scale.setScalar((0.8 + Math.random() * 0.7) * scale);
    g.rotation.y = Math.random() * TAU;
    this.scene.add(g);
  }

  _addPalm(x, z) {
    const y = islandHeight(x, z);
    if (y < 0.4) return;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // ちょっと曲がった幹
    let px = 0, py = 0;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.14 - i * 0.015, 0.17 - i * 0.015, 0.7, 8), toonMat(0xb08a56));
      px += i * 0.07;
      py += 0.62;
      seg.position.set(px, py, 0);
      seg.rotation.z = -0.12 * i;
      seg.castShadow = true;
      g.add(seg);
    }
    // はっぱ
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6), toonMat(0x3fae4e));
      leaf.scale.set(1.5, 0.16, 0.5);
      leaf.position.set(px + Math.cos(a) * 0.75, py + 0.4, Math.sin(a) * 0.75);
      leaf.rotation.y = -a;
      leaf.rotation.z = 0.35;
      leaf.castShadow = true;
      g.add(leaf);
    }
    // ココナッツ
    for (let i = 0; i < 3; i++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), toonMat(0x7a5a34));
      nut.position.set(px + (i - 1) * 0.2, py + 0.15, 0.15);
      g.add(nut);
    }
    g.rotation.y = Math.random() * TAU;
    this.scene.add(g);
  }

  _buildDecorations() {
    // お花(タイル帯とゾーン装飾を避けて散らす)
    const flowerGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const flowers = new THREE.InstancedMesh(flowerGeo, toonMat(0xffffff), 170);
    const dummy = new THREE.Object3D();
    const fCols = [0xff8fb5, 0xffe45c, 0xffffff, 0xc19bff, 0xff9d5c];
    let placed = 0;
    let guard = 0;
    while (placed < 170 && guard++ < 1400) {
      const a = Math.random() * TAU;
      const r = 5 + Math.random() * 21;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      if (y < 0.55) continue;
      const rr = Math.hypot(x, z);
      if (rr > 14.2 && rr < 19.0) continue; // タイルの帯は避ける
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

    // 虹のアーチ(あめあがりに大きくなる)
    this.rainbowGroup = new THREE.Group();
    const rCols = [0xff5c5c, 0xffb03c, 0xffe45c, 0x6fdd6f, 0x5cb8ff, 0xb06ce0];
    rCols.forEach((c, i) => {
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(11 - i * 0.55, 0.3, 8, 40, Math.PI),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.82, fog: false }),
      );
      this.rainbowGroup.add(arc);
    });
    this.rainbowGroup.position.set(-34, 2, -26);
    this.rainbowGroup.rotation.y = Math.PI / 3.4;
    this.scene.add(this.rainbowGroup);

    // ふわふわ気球(遠景)
    this.balloons = [];
    const bCols = [0xff5c8d, 0xffc93e, 0x4da3ff, 0x43c04e];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Group();
      const env = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 14), toonMat(bCols[i]));
      env.scale.y = 1.15;
      const stripe = new THREE.Mesh(new THREE.SphereGeometry(1.62, 16, 14, 0, TAU, 1.1, 0.5), toonMat(0xfff8dc));
      stripe.scale.y = 1.15;
      const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.5, 8), toonMat(0xb0803f));
      basket.position.y = -2.35;
      b.add(env, stripe, basket);
      const a = (i / 4) * TAU + 0.8;
      b.position.set(Math.cos(a) * 46, 12 + i * 3, Math.sin(a) * 46);
      b.userData = { baseY: b.position.y, phase: i * 1.7, speed: 0.12 + i * 0.03, angle: a, radius: 46 };
      this.scene.add(b);
      this.balloons.push(b);
    }

    // 雲(天気で色が変わるよう専用マテリアル)
    this.cloudMat = toonMatUnique(0xffffff);
    this.clouds = [];
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(1.6 + Math.random() * 1.8, 12, 10),
          this.cloudMat,
        );
        puff.position.set(k * 2.0 - n, Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
        puff.scale.y = 0.62;
        cloud.add(puff);
      }
      const a = (i / 10) * TAU;
      const r = 58 + Math.random() * 50;
      cloud.position.set(Math.cos(a) * r, 18 + Math.random() * 16, Math.sin(a) * r);
      cloud.userData = { angle: a, radius: r, speed: 0.008 + Math.random() * 0.012, y: cloud.position.y };
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }

    // ちょうちょ
    this.butterflies = [];
    for (let i = 0; i < 6; i++) {
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
        cx: (Math.random() - 0.5) * 24, cz: (Math.random() - 0.5) * 24,
        r: 2.5 + Math.random() * 4, h: 2.2 + Math.random() * 2, speed: 0.4 + Math.random() * 0.4,
      };
      this.scene.add(fly);
      this.butterflies.push(fly);
    }
  }

  // ゾーンごとの見どころ
  _buildZoneDecorations() {
    // 🏖️ はまべ:ヤシのき・パラソル・かいがら・ビーチボール
    const beachA = ZONE_CENTERS[0];
    for (let i = 0; i < 4; i++) {
      const a = beachA + (i - 1.5) * 0.22;
      const r = 11 + (i % 2) * 2;
      this._addPalm(Math.cos(a) * r, Math.sin(a) * r);
    }
    {
      const a = beachA - 0.28, r = 21.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = Math.max(islandHeight(x, z), 0.2);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8), toonMat(0xffffff));
      pole.position.set(x, y + 1.1, z);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.6, 10), toonMat(0xff6f9c));
      shade.position.set(x, y + 2.2, z);
      this.scene.add(pole, shade);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), toonMat(0xff5c5c));
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.46, 12, 10, 0, TAU, 0, 0.8), toonMat(0xffffff));
      ball.position.set(x + 1.6, y + 0.45, z + 0.6);
      cap.position.copy(ball.position);
      this.scene.add(ball, cap);
    }
    for (let i = 0; i < 6; i++) {
      const a = beachA + (Math.random() - 0.5) * 0.7;
      const r = 20 + Math.random() * 3;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      if (y < 0.15) continue;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), toonMat(0xfff0e0));
      shell.scale.set(1.2, 0.5, 1);
      shell.position.set(x, y + 0.06, z);
      this.scene.add(shell);
    }

    // 🌴 ジャングル:みっしりした木・おおきな葉っぱ・いせき
    const jungleA = ZONE_CENTERS[1];
    for (let i = 0; i < 9; i++) {
      const a = jungleA + (Math.random() - 0.5) * 1.0;
      const r = 8 + Math.random() * 4.5;
      this._addTree(Math.cos(a) * r, Math.sin(a) * r, i % 3 === 2 ? 'green' : 'deep', 1.25);
    }
    for (let i = 0; i < 4; i++) {
      const a = jungleA + (Math.random() - 0.5) * 0.9;
      const r = 20.5 + Math.random() * 3;
      this._addTree(Math.cos(a) * r, Math.sin(a) * r, 'deep', 1.1);
    }
    {
      const a = jungleA + 0.3, r = 22.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      if (y > 0.3) {
        [[0, 0.5, 1.3], [0, 1.3, 0.9], [0.1, 1.9, 0.55]].forEach(([ox, oy, s]) => {
          const stone = new THREE.Mesh(new THREE.BoxGeometry(s, 0.7, s), toonMat(0x9aa88f));
          stone.position.set(x + ox, y + oy, z);
          stone.rotation.y = oy;
          stone.castShadow = true;
          this.scene.add(stone);
        });
      }
    }

    // 🌋 かざん:よこの岩・ようがん・けむり
    const vTop = volcanoTop();
    this.lavaMat = toonMatUnique(0xff8a3c, { emissive: 0xff5a00, emissiveIntensity: 0.9 });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(1.35, 20), this.lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.set(vTop.x, vTop.y + 0.15, vTop.z);
    this.scene.add(lava);
    this.lavaPos = lava.position.clone();
    for (let i = 0; i < 7; i++) {
      const a = ZONE_CENTERS[2] + (Math.random() - 0.5) * 0.9;
      const r = 12 + Math.random() * 8;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      if (y < 0.5) continue;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(0.5 + Math.random() * 0.5, 1 + Math.random() * 1.4, 6), toonMat(0x6b5f55));
      rock.position.set(x, y + 0.3, z);
      rock.rotation.y = Math.random() * TAU;
      rock.castShadow = true;
      this.scene.add(rock);
    }
    // けむり(ループするスプライト)
    this.smokes = [];
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xdcd6d0, transparent: true, opacity: 0.32, depthWrite: false,
      }));
      sp.userData = { phase: i / 3 };
      this.scene.add(sp);
      this.smokes.push(sp);
    }
    // 火の粉
    this.embers = [];
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffa03c, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      sp.userData = { phase: Math.random() };
      sp.scale.setScalar(0.5);
      this.scene.add(sp);
      this.embers.push(sp);
    }

    // 🎡 ゆうえんち:かんらんしゃ・テント
    const parkA = ZONE_CENTERS[3];
    {
      const a = parkA, r = 24;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = Math.max(islandHeight(x, z), 0.4);
      this.ferris = new THREE.Group();
      this.ferris.position.set(x, y, z);
      this.ferris.lookAt(0, y, 0);
      const wheel = new THREE.Group();
      wheel.position.y = 5.2;
      const ringM = new THREE.Mesh(new THREE.TorusGeometry(4.2, 0.14, 8, 36), toonMat(0xff8fb5));
      wheel.add(ringM);
      const cabCols = [0xff5c5c, 0xffb03c, 0xffe45c, 0x6fdd6f, 0x5cb8ff, 0xb06ce0, 0xff8fb5, 0x4fd0c0];
      this.ferrisCabins = [];
      for (let i = 0; i < 8; i++) {
        const a2 = (i / 8) * TAU;
        const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), toonMat(0xffffff));
        spoke.position.set(Math.cos(a2) * 2.1, Math.sin(a2) * 2.1, 0);
        spoke.rotation.z = a2 + Math.PI / 2;
        wheel.add(spoke);
      }
      this.ferrisWheel = wheel;
      this.ferris.add(wheel);
      // ゴンドラは回らないホルダーに置き、絶対角度で位置だけ回す
      const cabinHolder = new THREE.Group();
      cabinHolder.position.y = 5.2;
      for (let i = 0; i < 8; i++) {
        const cab = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), toonMat(cabCols[i]));
        cab.userData = { angle: (i / 8) * TAU };
        cabinHolder.add(cab);
        this.ferrisCabins.push(cab);
      }
      this.ferris.add(cabinHolder);
      // あし
      [-1, 1].forEach((s) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 5.6, 8), toonMat(0xffffff));
        leg.position.set(s * 1.3, 2.6, 0);
        leg.rotation.z = s * 0.24;
        this.ferris.add(leg);
      });
      this.scene.add(this.ferris);
    }
    for (let i = 0; i < 2; i++) {
      const a = parkA + (i === 0 ? -0.32 : 0.34);
      const r = 12.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = islandHeight(x, z);
      const tent = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.7, 10), toonMat(i === 0 ? 0xff6f9c : 0x5cb8ff));
      tent.position.set(x, y + 0.85, z);
      tent.castShadow = true;
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), toonMat(0xffffff));
      flagPole.position.set(x, y + 2.0, z);
      this.scene.add(tent, flagPole);
    }
  }

  _buildRain() {
    // スコールの雨(インスタンスの細長い棒)
    const geo = new THREE.BoxGeometry(0.035, 0.8, 0.035);
    const mat = new THREE.MeshBasicMaterial({ color: 0xbdd8f5, transparent: true, opacity: 0.55 });
    this.rain = new THREE.InstancedMesh(geo, mat, 240);
    this.rain.frustumCulled = false;
    this.rainDrops = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 240; i++) {
      const a = Math.random() * TAU;
      const r = Math.sqrt(Math.random()) * 34;
      this.rainDrops.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r,
        y: Math.random() * 22, speed: 16 + Math.random() * 6,
      });
      dummy.position.set(0, -999, 0);
      dummy.updateMatrix();
      this.rain.setMatrixAt(i, dummy.matrix);
    }
    this.rain.visible = false;
    this.scene.add(this.rain);
    this._rainDummy = dummy;
  }

  _updateWeather(dt) {
    const t = this.weatherTarget;
    const k = Math.min(1, dt * 1.2);
    const u = this.skyMat.uniforms;
    u.topColor.value.lerp(new THREE.Color(t.top), k);
    u.midColor.value.lerp(new THREE.Color(t.mid), k);
    u.botColor.value.lerp(new THREE.Color(t.bot), k);
    this.scene.fog.color.lerp(new THREE.Color(t.fog), k);
    this.sunLight.intensity += (t.sun - this.sunLight.intensity) * k;
    this.sunLight.color.lerp(new THREE.Color(t.sunCol), k);
    this.hemi.intensity += (t.hemi - this.hemi.intensity) * k;
    this.cloudMat.color.lerp(new THREE.Color(t.cloud), k);

    // 虹はあめあがりに大きく・くっきり
    const rbTarget = t.rainbow;
    this.rainbowGroup.children.forEach((arc) => {
      arc.material.opacity += (rbTarget * 0.85 - arc.material.opacity) * k;
    });
    const s = 1 + (rbTarget > 0.5 ? 0.55 : 0);
    this.rainbowGroup.scale.lerp(new THREE.Vector3(s, s, s), k);

    // 雨
    this.rain.visible = !!t.rain;
    if (t.rain) {
      for (let i = 0; i < this.rainDrops.length; i++) {
        const d = this.rainDrops[i];
        d.y -= d.speed * dt;
        if (d.y < 0) d.y = 20 + Math.random() * 4;
        this._rainDummy.position.set(d.x, d.y, d.z);
        this._rainDummy.updateMatrix();
        this.rain.setMatrixAt(i, this._rainDummy.matrix);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.seaMat.uniforms.time.value = t;

    this.tiles.forEach((tile) => tile.update(t));
    this._updateWeather(dt);
    this.rides.update(dt, t);

    // 中央タワーの星
    this.bigStar.rotation.y = t * 0.8;
    this.bigStar.position.y = 6.6 + Math.sin(t * 1.4) * 0.18;

    // 波リング
    this.foamRings.forEach((r, i) => {
      const s = 1 + Math.sin(t * 1.4 + i * 1.5) * 0.012;
      r.scale.setScalar(s);
      r.material.opacity = (i === 0 ? 0.5 : 0.28) * (0.75 + Math.sin(t * 1.4 + i) * 0.25);
    });

    // 気球
    this.balloons.forEach((b) => {
      const u = b.userData;
      u.angle += u.speed * dt * 0.2;
      b.position.x = Math.cos(u.angle) * u.radius;
      b.position.z = Math.sin(u.angle) * u.radius;
      b.position.y = u.baseY + Math.sin(t * 0.7 + u.phase) * 1.2;
    });

    // 雲
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

    // かざんのけむりと火の粉
    this.smokes.forEach((sp) => {
      const p = (t * 0.12 + sp.userData.phase) % 1;
      sp.position.set(this.lavaPos.x + Math.sin(p * 9) * 0.6, this.lavaPos.y + p * 6, this.lavaPos.z);
      sp.scale.setScalar(1.2 + p * 3.2);
      sp.material.opacity = 0.3 * (1 - p);
    });
    this.embers.forEach((sp) => {
      const p = (t * 0.5 + sp.userData.phase) % 1;
      sp.position.set(
        this.lavaPos.x + Math.sin(p * 20 + sp.userData.phase * 9) * 1.2,
        this.lavaPos.y + p * 3.4,
        this.lavaPos.z + Math.cos(p * 16) * 1.2,
      );
      sp.material.opacity = (1 - p) * 0.9;
    });
    this.lavaMat.emissiveIntensity = 0.8 + Math.sin(t * 3.3) * 0.25;

    // かんらんしゃ
    if (this.ferrisWheel) {
      this.ferrisWheel.rotation.z = t * 0.24;
      this.ferrisCabins.forEach((cab) => {
        const a = cab.userData.angle + t * 0.24;
        cab.position.set(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 0);
      });
    }
  }
}
