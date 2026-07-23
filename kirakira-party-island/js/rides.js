// のりもの&大イベントのメッシュ群:カメさん・ロープウェイ・コースター・
// 地下どうくつ・ボス「タコのタコすけ」。アニメの進行は board.js が駆動する。

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { toonMat, toonMatUnique, glowTexture } from './gfx.js';

const TAU = Math.PI * 2;

export class Rides {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this._buildTurtle();
    this._buildRopeway();
    this._buildCoaster();
    this._buildCave();
    this._buildOctopus();
    this.turtleBusy = false;
    this.coasterRiding = false;
  }

  // ---------- 🐢 カメさん(はまべの入り江) ----------
  _buildTurtle() {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12, 0, TAU, 0, Math.PI / 2),
      toonMat(0x2f9e6e),
    );
    shell.scale.set(1, 0.72, 1.15);
    shell.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.16, 8, 20), toonMat(0x8fe0b8));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    // こうらの模様
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.18, 8), toonMat(0x27825b));
      spot.position.set(Math.cos(a) * 0.55, 0.62, Math.sin(a) * 0.55);
      spot.rotation.x = -Math.PI / 2;
      g.add(spot);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), toonMat(0x6fcf9a));
    head.position.set(0, 0.35, 1.5);
    head.castShadow = true;
    const eyeGeo = new THREE.SphereGeometry(0.09, 8, 8);
    const eyeMat = toonMat(0x2c2438);
    [-0.2, 0.2].forEach((x) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 0.55, 1.85);
      g.add(eye);
    });
    const flipGeo = new THREE.SphereGeometry(0.42, 10, 8);
    this.turtleFlippers = [];
    [[-1.05, 0.75], [1.05, 0.75], [-0.95, -0.9], [0.95, -0.9]].forEach(([x, z]) => {
      const f = new THREE.Mesh(flipGeo, toonMat(0x6fcf9a));
      f.scale.set(1.1, 0.3, 0.6);
      f.position.set(x, 0.12, z);
      g.add(f);
      this.turtleFlippers.push(f);
    });
    g.add(shell, rim, head);

    // 入り江(はまべゾーンのそと側)にぷかぷか
    const a = TAU * 0.125;
    this.turtleHome = new THREE.Vector3(Math.cos(a) * 24.5, 0.1, Math.sin(a) * 24.5);
    g.position.copy(this.turtleHome);
    g.lookAt(this.turtleHome.x * 1.5, 0, this.turtleHome.z * 1.5);
    this.scene.add(g);
    this.turtle = g;
  }

  // カメの遊覧ルート(タイルfrom→toを、海側の弧でむすぶ)
  turtleCurve(fromTile, toTile) {
    const pts = [];
    const a0 = (fromTile / CONFIG.TILE_COUNT) * TAU;
    const a1 = (toTile / CONFIG.TILE_COUNT) * TAU;
    for (let i = 0; i <= 8; i++) {
      const k = i / 8;
      const a = a0 + (a1 - a0) * k;
      const r = 24.5 + Math.sin(k * Math.PI) * 1.5;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
    }
    return new THREE.CatmullRomCurve3(pts);
  }

  // ---------- 🚠 ロープウェイ(ジャングル⇔かざん) ----------
  _buildRopeway() {
    const aA = (18 / CONFIG.TILE_COUNT) * TAU;
    const aB = (32 / CONFIG.TILE_COUNT) * TAU;
    const rA = 14.6, rB = 14.6;
    const ax = Math.cos(aA) * rA, az = Math.sin(aA) * rA;
    const bx = Math.cos(aB) * rB, bz = Math.sin(aB) * rB;
    const ay = this._hgt(ax, az), by = this._hgt(bx, bz);

    const towerMat = toonMat(0xd35454);
    const buildTower = (x, y, z) => {
      const tw = new THREE.Group();
      tw.position.set(x, y, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 5.4, 10), towerMat);
      pole.position.y = 2.7;
      pole.castShadow = true;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.22, 0.22), towerMat);
      arm.position.y = 5.3;
      tw.add(pole, arm);
      this.scene.add(tw);
      return tw;
    };
    this.ropewayA = buildTower(ax, ay, az);
    this.ropewayB = buildTower(bx, by, bz);

    const pA = new THREE.Vector3(ax, ay + 5.3, az);
    const pB = new THREE.Vector3(bx, by + 5.3, bz);
    const mid = new THREE.Vector3(0, Math.max(pA.y, pB.y) + 6.5, 0);
    this.ropewayCurve = new THREE.QuadraticBezierCurve3(pA, mid, pB);

    // ケーブル
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(this.ropewayCurve, 40, 0.05, 6, false),
      toonMat(0x555555),
    );
    this.scene.add(cable);

    // ゴンドラ
    const gon = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 1.0), toonMat(0xff6f9c));
    cab.position.y = -1.4;
    cab.castShadow = true;
    const winGeo = new THREE.BoxGeometry(1.34, 0.4, 1.04);
    const win = new THREE.Mesh(winGeo, toonMat(0xbfe8ff));
    win.position.y = -1.25;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.5, 4), toonMat(0xffffff));
    roof.position.y = -0.75;
    roof.rotation.y = Math.PI / 4;
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), toonMat(0x555555));
    hook.position.y = -0.3;
    gon.add(cab, win, roof, hook);
    gon.position.copy(this.ropewayCurve.getPoint(0));
    this.scene.add(gon);
    this.gondola = gon;
    this.gondolaT = 0; // 0=A駅, 1=B駅
  }

  _hgt(x, z) {
    // world.js の islandHeight は循環importを避けて world 側から注入される
    return this.world.heightFn(x, z);
  }

  // ---------- 🎢 コースター(島を一周) ----------
  _buildCoaster() {
    const pts = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const r = 21.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const ground = this._hgt(x, z);
      // アップダウン(ゆうえんち近くで大きく)
      let dPark = Math.abs(a - TAU * 0.875);
      if (dPark > Math.PI) dPark = TAU - dPark;
      const thrill = 1 + Math.max(0, 1 - dPark / 1.2) * 1.6;
      let y = Math.max(ground, 0) + 2.2 + (Math.sin(a * 3) * 0.9 + Math.sin(a * 5 + 1) * 0.5) * thrill;
      y = Math.max(y, Math.max(ground, 0) + 1.4);
      pts.push(new THREE.Vector3(x, y, z));
    }
    this.coasterCurve = new THREE.CatmullRomCurve3(pts, true);

    // レール(チューブ)+まくらぎ+支柱
    const rail = new THREE.Mesh(
      new THREE.TubeGeometry(this.coasterCurve, 220, 0.13, 7, true),
      toonMat(0xff8fb5),
    );
    this.scene.add(rail);
    const tieGeo = new THREE.BoxGeometry(1.0, 0.08, 0.3);
    const tieMat = toonMat(0x9c6b3f);
    for (let i = 0; i < 60; i++) {
      const t = i / 60;
      const p = this.coasterCurve.getPoint(t);
      const tan = this.coasterCurve.getTangent(t);
      const tie = new THREE.Mesh(tieGeo, tieMat);
      tie.position.copy(p).y -= 0.12;
      tie.lookAt(p.clone().add(tan));
      this.scene.add(tie);
    }
    const poleMat = toonMat(0xfff4f8);
    for (let i = 0; i < 24; i++) {
      const t = i / 24;
      const p = this.coasterCurve.getPoint(t);
      const gy = Math.max(this._hgt(p.x, p.z), 0);
      const hgt = p.y - gy;
      if (hgt < 0.6) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, hgt, 6), poleMat);
      pole.position.set(p.x, gy + hgt / 2 - 0.1, p.z);
      this.scene.add(pole);
    }

    // トレイン(2両×2せき)
    const train = new THREE.Group();
    this.coasterSeats = [];
    const cartCols = [0xff5c5c, 0x4da3ff];
    for (let c = 0; c < 2; c++) {
      const cart = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.55, 1.9), toonMat(cartCols[c]));
      body.castShadow = true;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.56, 10, 8), toonMat(cartCols[c]));
      nose.scale.set(1, 0.55, 0.6);
      nose.position.set(0, 0.05, 1.0);
      cart.add(body, nose);
      cart.position.z = -c * 2.3;
      for (let s = 0; s < 2; s++) {
        const seat = new THREE.Object3D();
        seat.position.set(0, 0.45, 0.45 - s * 0.95);
        cart.add(seat);
        this.coasterSeats.push(seat);
      }
      train.add(cart);
    }
    this.coasterStationT = (42 / CONFIG.TILE_COUNT + 0.25 / CONFIG.TILE_COUNT) % 1;
    const sp = this.coasterCurve.getPoint(this.coasterStationT);
    train.position.copy(sp);
    this.scene.add(train);
    this.coasterTrain = train;

    // せんろの上のコイン
    this.trackCoins = [];
    const coinGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14);
    for (let i = 0; i < 28; i++) {
      const t = (i / 28 + this.coasterStationT + 0.04) % 1;
      const p = this.coasterCurve.getPoint(t);
      const coin = new THREE.Mesh(coinGeo, toonMatUnique(0xffd23e, { emissive: 0xffaa00, emissiveIntensity: 0.25 }));
      coin.rotation.x = Math.PI / 2;
      coin.position.copy(p).y += 0.9;
      coin.userData = { t, taken: false };
      this.scene.add(coin);
      this.trackCoins.push(coin);
    }
  }

  // ---------- 🕳️ 地下どうくつ ----------
  _buildCave() {
    const g = new THREE.Group();
    g.position.set(0, -28, 0);

    // くらい岩のドーム
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(16, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x201830, side: THREE.BackSide, fog: false }),
    );
    g.add(shell);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 32), toonMat(0x4a3a52));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);

    // ひかる水晶
    const crysCols = [0x7fe8ff, 0xc19bff, 0xff9dd6];
    this.crystalMats = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + 0.3;
      const r = 5.5 + (i % 3) * 2.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const cluster = new THREE.Group();
      for (let k = 0; k < 2 + (i % 2); k++) {
        const mat = toonMatUnique(crysCols[(i + k) % 3], {
          emissive: crysCols[(i + k) % 3], emissiveIntensity: 0.55,
        });
        this.crystalMats.push(mat);
        const cry = new THREE.Mesh(new THREE.ConeGeometry(0.3 + Math.random() * 0.25, 1.0 + Math.random() * 1.6, 5), mat);
        cry.position.set(x + (k - 0.5) * 0.6, 0.5, z + (k % 2) * 0.5);
        cry.rotation.z = (Math.random() - 0.5) * 0.35;
        cluster.add(cry);
      }
      g.add(cluster);
    }

    // ほのかなあかり
    const light1 = new THREE.PointLight(0x9fd8ff, 60, 40, 1.6);
    light1.position.set(0, 6, 0);
    const light2 = new THREE.PointLight(0xff9dd6, 30, 30, 1.6);
    light2.position.set(6, 3, -4);
    g.add(light1, light2);

    // 5マスのちかみち
    this.caveTiles = [];
    const path = [[-7, 3.5], [-3.8, 4.6], [-0.5, 3.4], [2.6, 1.8], [5.4, 0]];
    path.forEach(([x, z]) => {
      const tile = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.18, 20), toonMatUnique(0x8f7fb8, {
        emissive: 0x6a5a9a, emissiveIntensity: 0.25,
      }));
      tile.position.set(x, 0.09, z);
      g.add(tile);
      this.caveTiles.push(new THREE.Vector3(x, 0.18, z));
    });

    // たからのま:コインのはしら+たからばこ
    const coinGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 14);
    [[7.6, -1.6, 5], [8.8, 0.4, 4], [7.0, 1.6, 3]].forEach(([x, z, n]) => {
      for (let k = 0; k < n; k++) {
        const coin = new THREE.Mesh(coinGeo, toonMatUnique(0xffd23e, { emissive: 0xffaa00, emissiveIntensity: 0.3 }));
        coin.position.set(x, 0.1 + k * 0.12, z);
        g.add(coin);
      }
    });
    const chest = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.8), toonMat(0x9c6b3f));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.2, 10, 1, false, 0, Math.PI), toonMat(0xb0803f));
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.36;
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.72, 0.16), toonMat(0xffd23e));
    chest.add(box, lid, band);
    chest.position.set(9.2, 0.36, 2.6);
    chest.rotation.y = -0.8;
    g.add(chest);
    this.caveTreasurePos = new THREE.Vector3(7.8, 0.2, 0.4);

    // かんけつせん(でぐち)
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.1, 18), toonMatUnique(0x6fd0ff, {
      emissive: 0x3aa0e8, emissiveIntensity: 0.4,
    }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(5.4, 0.05, -3.4);
    g.add(pool);
    this.caveGeyserPos = new THREE.Vector3(5.4, 0.1, -3.4);
    this.geyserColumn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.9, 1, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.75 }),
    );
    this.geyserColumn.visible = false;
    g.add(this.geyserColumn);

    // ホタルのひかり
    this.fireflies = [];
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xbfffcf, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sp.scale.setScalar(0.5);
      sp.userData = { phase: Math.random() * TAU, r: 3 + Math.random() * 8 };
      g.add(sp);
      this.fireflies.push(sp);
    }

    this.scene.add(g);
    this.cave = g;
    this.caveEntry = new THREE.Vector3(-7, 0.18, 3.5); // ローカル
  }

  caveWorldPos(local) {
    return local.clone().add(this.cave.position);
  }

  // ---------- 🐙 タコのタコすけ ----------
  _buildOctopus() {
    const g = new THREE.Group();
    const bodyMat = toonMat(0xff8a78);
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 16), bodyMat);
    head.scale.set(1, 1.12, 1);
    head.position.y = 3.4;
    head.castShadow = true;
    g.add(head);
    // おめめとほっぺとくち
    [-1.1, 1.1].forEach((x) => {
      const white = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), toonMat(0xffffff));
      white.position.set(x, 4.0, 2.6);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), toonMat(0x2c2438));
      pupil.position.set(x, 4.0, 3.12);
      const blushM = new THREE.Mesh(new THREE.CircleGeometry(0.42, 10), new THREE.MeshBasicMaterial({
        color: 0xff5c5c, transparent: true, opacity: 0.6,
      }));
      blushM.position.set(x * 1.8, 3.2, 2.72);
      blushM.lookAt(x * 4, 3.2, 9);
      g.add(white, pupil, blushM);
    });
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 6, 14, Math.PI), toonMat(0x8a3040));
    mouth.position.set(0, 3.1, 3.05);
    mouth.rotation.z = Math.PI;
    g.add(mouth);
    // あたまのバンダナ(パーティーかざり)
    const bandana = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.32, 8, 22), toonMat(0xffd23e));
    bandana.rotation.x = Math.PI / 2.4;
    bandana.position.y = 5.6;
    g.add(bandana);

    // あし(ゆらゆら)
    this.tentacles = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const tGroup = new THREE.Group();
      tGroup.position.set(Math.cos(a) * 2.0, 1.4, Math.sin(a) * 2.0);
      const segs = 4;
      for (let s = 0; s < segs; s++) {
        const r = 0.75 - s * 0.16;
        const seg = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), bodyMat);
        seg.position.set(Math.cos(a) * s * 0.9, -0.4 - s * 0.28 + s * s * 0.09, Math.sin(a) * s * 0.9);
        seg.castShadow = true;
        tGroup.add(seg);
      }
      tGroup.userData = { phase: i * 1.1, angle: a };
      g.add(tGroup);
      this.tentacles.push(tGroup);
    }

    // うみのそこにかくれている
    const a = -0.35;
    g.position.set(Math.cos(a) * 40, -13, Math.sin(a) * 40);
    g.lookAt(0, -13, 0);
    this.scene.add(g);
    this.octopus = g;
    this.octopusHomeY = -13;
    this.octopusUpY = 0.6;
    this.octopusActive = false;
  }

  // ---------- 毎フレーム(アイドル挙動) ----------
  update(dt, t) {
    // カメ:ぷかぷか+ヒレぱたぱた
    if (!this.turtleBusy) {
      this.turtle.position.y = 0.1 + Math.sin(t * 1.3) * 0.08;
    }
    this.turtleFlippers.forEach((f, i) => {
      f.rotation.x = Math.sin(t * 2.2 + i) * 0.3;
    });

    // ゴンドラ:とまっていてもゆらゆら
    this.gondola.rotation.z = Math.sin(t * 1.1) * 0.05;

    // コースターのコイン:くるくる
    this.trackCoins.forEach((c, i) => {
      if (!c.userData.taken) c.rotation.z = t * 2 + i;
    });

    // どうくつの水晶とホタル
    this.crystalMats.forEach((m, i) => {
      m.emissiveIntensity = 0.45 + Math.sin(t * 1.8 + i) * 0.2;
    });
    this.fireflies.forEach((sp) => {
      const u = sp.userData;
      sp.position.set(
        Math.cos(t * 0.4 + u.phase) * u.r,
        2 + Math.sin(t * 0.9 + u.phase) * 1.4,
        Math.sin(t * 0.5 + u.phase * 1.3) * u.r,
      );
      sp.material.opacity = 0.5 + Math.sin(t * 3 + u.phase) * 0.4;
    });

    // タコすけ:出ているあいだはゆらゆら
    if (this.octopusActive) {
      this.octopus.position.y += Math.sin(t * 1.6) * 0.004;
      this.tentacles.forEach((tg) => {
        tg.rotation.x = Math.sin(t * 2 + tg.userData.phase) * 0.16;
        tg.rotation.z = Math.cos(t * 1.7 + tg.userData.phase) * 0.16;
      });
    }
  }

  // コースターのコインを元に戻す(ライド終了後)
  resetTrackCoins() {
    this.trackCoins.forEach((c) => {
      c.userData.taken = false;
      c.visible = true;
    });
  }
}
