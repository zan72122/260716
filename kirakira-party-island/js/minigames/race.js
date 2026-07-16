// ミニゲーム「ぴょんぴょん レース」:タップれんだで ぴょんぴょん すすんで ゴール!

import { MiniGameBase, THREE, toonMat } from './base.js';
import { audio } from '../audio.js';

const GOAL_Z = 26;
const LANES = [-3.3, -1.1, 1.1, 3.3];

export class RaceGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.buildSkyAndLight({ ground: 0x83d95f });
    this.addClouds(6, 10, 20);

    // トラック(レーン)
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(11, GOAL_Z + 10),
      toonMat(0xa8e08a),
    );
    track.rotation.x = -Math.PI / 2;
    track.position.set(0, 0.02, GOAL_Z / 2);
    track.receiveShadow = true;
    this.scene.add(track);

    // レーンの白線
    for (let i = 0; i <= 4; i++) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, GOAL_Z + 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }),
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(-4.4 + i * 2.2, 0.04, GOAL_Z / 2);
      this.scene.add(line);
    }

    // ゴールゲート
    const gate = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.6, 10);
    [-5, 5].forEach((x) => {
      const pole = new THREE.Mesh(poleGeo, toonMat(0xff5c8d));
      pole.position.set(x, 1.8, 0);
      pole.castShadow = true;
      gate.add(pole);
    });
    const bannerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(10.6, 0.9, 0.2),
      toonMat(0xffd23e),
    );
    bannerMesh.position.y = 3.6;
    gate.add(bannerMesh);
    // チェッカー柄(はしってくる側から見えるように -z 向き)
    for (let i = 0; i < 8; i++) {
      const sq = new THREE.Mesh(
        new THREE.PlaneGeometry(0.55, 0.55),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffffff : 0x2c2438 }),
      );
      sq.position.set(-4.6 + i * 1.32, 3.6, -0.11);
      sq.rotation.y = Math.PI;
      gate.add(sq);
    }
    gate.position.z = GOAL_Z;
    this.scene.add(gate);

    // 旗をわきに
    for (let i = 0; i < 10; i++) {
      const flag = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.7, 6),
        toonMat([0xff5c8d, 0x4da3ff, 0xffc93e, 0x43c04e][i % 4]),
      );
      const side = i % 2 ? 6.4 : -6.4;
      flag.position.set(side, 0.7, 3 + (i >> 1) * 5);
      flag.rotation.z = Math.PI;
      this.scene.add(flag);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), toonMat(0x9c6b3f));
      stick.position.set(side, 0.55, 3 + (i >> 1) * 5);
      this.scene.add(stick);
    }

    // 4にんとも借りてきてレーンにならべる
    this.runners = ctx.chars.map((c, i) => {
      this.scene.add(c.root);
      c.root.position.set(LANES[i], 0.02, 0);
      c.root.rotation.set(0, 0, 0);
      c.targetYaw = 0; // +z(ゴール)をむく
      c.setMode('idle');
      return {
        char: c, z: 0, hopQueue: 0, hopping: false, hopT: 0, hopFrom: 0,
        finished: false, finishTime: Infinity, cpuT: 0.6 + Math.random() * 0.5,
      };
    });

    this.camBack = 7.5;
    this.camY = 6;
    this.camera.position.set(0, this.camY, -this.camBack);
    this.camera.lookAt(0, 1, 8);
    this.finishCount = 0;
  }

  _hop(r) {
    if (r.hopping || r.finished) {
      r.hopQueue = Math.min(2, r.hopQueue + 1);
      return;
    }
    r.hopping = true;
    r.hopT = 0;
    r.hopFrom = r.z;
    if (r.char === this.ctx.chars[this.ctx.playerIndex]) audio.hop(2);
  }

  update(dt) {
    this.time += dt;
    const player = this.runners[this.ctx.playerIndex];

    this.runners.forEach((r, i) => {
      // CPU は タイマーでぴょん
      if (i !== this.ctx.playerIndex && !r.finished) {
        r.cpuT -= dt;
        if (r.cpuT <= 0) {
          this._hop(r);
          r.cpuT = 0.5 + Math.random() * 0.55;
        }
      }
      // ホップの実行
      if (r.hopping) {
        r.hopT += dt;
        const k = Math.min(1, r.hopT / 0.24);
        r.z = r.hopFrom + k * 1.15;
        r.char.setHopHeight(Math.sin(Math.PI * k) * 0.55);
        if (k >= 1) {
          r.hopping = false;
          r.char.setHopHeight(0);
          r.char.land();
          this.fx.dustPuff(r.char.root.position, 2);
          if (r.hopQueue > 0) { r.hopQueue--; this._hop(r); }
        }
      }
      r.char.root.position.z = r.z;

      // ゴール!
      if (!r.finished && r.z >= GOAL_Z) {
        r.finished = true;
        r.finishTime = this.time;
        this.finishCount++;
        r.char.setMode('cheer');
        audio.yay();
        this.fx.burstConfetti(r.char.root.position, 30, 3, 5);
        if (i === this.ctx.playerIndex) {
          this.ctx.ui.setScore(this.finishCount); // 何位でゴールしたか
        }
      }
    });

    // カメラはプレイヤーを追いかける
    const pz = player.z;
    this.camera.position.y = this.camY;
    this.camera.position.z += ((pz - this.camBack) - this.camera.position.z) * Math.min(1, dt * 4);
    this.camera.lookAt(0, 1, pz + 6);

    if (this.finishCount >= 4) this.done = true;
  }

  pointerDown() {
    const player = this.runners[this.ctx.playerIndex];
    if (!player.finished) this._hop(player);
  }

  onFinish() {
    // スコア:はやくゴールしたほど高い。未ゴールは距離で。
    this.runners.forEach((r, i) => {
      this.scores[i] = r.finished ? Math.round(1000 - r.finishTime * 10) : Math.round(r.z);
    });
  }

  fitCamera(aspect) {
    // 縦画面は引き+広角で 4 レーンぜんぶ見えるように
    this.camera.fov = aspect < 1 ? 68 : 55;
    this.camBack = aspect < 1 ? 13.5 : 7.5;
    this.camY = aspect < 1 ? 8 : 6;
    this.camera.updateProjectionMatrix();
  }
}
