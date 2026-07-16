// ミニゲーム「ふうせん パンパン」:とんでくる風船をタッチで割る。

import { MiniGameBase, THREE, toonMat } from './base.js';
import { audio } from '../audio.js';

const COLORS = [0xff5c8d, 0xffc93e, 0x4da3ff, 0x43c04e, 0xb06ce0, 0xff9d3c];

export class BalloonGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.55, 0.5, 0.45, 0.52];
    this.buildSkyAndLight({ ground: 0x7ed957, groundY: -6 });
    this.addClouds(7, 2, 16);

    this.camera.position.set(0, 4, 15);
    this.camera.lookAt(0, 5, 0);

    // 遠くにお山
    [[-18, 0x66cc7a], [16, 0x5cbf70]].forEach(([x, c]) => {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(12, 20, 14), toonMat(c));
      hill.position.set(x, -10, -24);
      this.scene.add(hill);
    });

    this.balloons = [];
    this.spawnT = 0;
    this.fieldW = 6.5; // 画面に入る横はば(fitCamera で更新)
    // 最初から何個か浮かせておく
    for (let i = 0; i < 4; i++) this._spawn(Math.random() * 8);
  }

  _spawn(headStart = 0) {
    const golden = Math.random() < 0.14;
    const g = new THREE.Group();
    const color = golden ? 0xffd23e : COLORS[Math.floor(Math.random() * COLORS.length)];
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 14), toonMat(color));
    body.scale.y = 1.15;
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.24, 8), toonMat(color));
    knot.position.y = -1.28;
    knot.rotation.x = Math.PI;
    const stringGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 4);
    const string = new THREE.Mesh(stringGeo, toonMat(0xffffff));
    string.position.y = -2.2;
    g.add(body, knot, string);
    if (golden) {
      body.material = body.material.clone();
      body.material.emissive = new THREE.Color(0xffaa00);
      body.material.emissiveIntensity = 0.4;
    }
    g.position.set(
      (Math.random() - 0.5) * 2 * this.fieldW,
      -6 + headStart,
      (Math.random() - 0.5) * 4,
    );
    g.userData = {
      speed: 1.7 + Math.random() * 1.4,
      sway: Math.random() * Math.PI * 2,
      golden,
      body,
    };
    this.scene.add(g);
    this.balloons.push(g);
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);

    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.balloons.length < 9) {
      this._spawn();
      this.spawnT = 0.5 + Math.random() * 0.35;
    }

    for (let i = this.balloons.length - 1; i >= 0; i--) {
      const b = this.balloons[i];
      b.position.y += b.userData.speed * dt;
      b.position.x += Math.sin(this.time * 1.4 + b.userData.sway) * dt * 0.7;
      b.rotation.z = Math.sin(this.time * 1.8 + b.userData.sway) * 0.12;
      if (b.position.y > 12) {
        // 上に逃げたら下からまた出てくる
        b.position.y = -6;
        b.position.x = (Math.random() - 0.5) * 2 * this.fieldW;
      }
    }
  }

  pointerDown(ndc, px) {
    const hits = this.raycast(ndc, this.balloons);
    if (!hits.length) return;
    let g = hits[0].object;
    while (g.parent && !this.balloons.includes(g)) g = g.parent;
    const idx = this.balloons.indexOf(g);
    if (idx < 0) return;
    this.balloons.splice(idx, 1);
    this.scene.remove(g);
    audio.pop();
    const gold = g.userData.golden;
    this.fx.sparkleBurst(g.position, gold ? 16 : 8, gold ? 0xffe066 : 0xffffff, 1.6);
    this.fx.burstConfetti(g.position, gold ? 26 : 12, 3, 3);
    this.addPlayerPoint(gold ? 2 : 1);
    if (px) this.ctx.ui.emojiBurst(px.x, px.y, gold ? '🌟' : '💥');
  }

  fitCamera(aspect) {
    const z = aspect < 1 ? 19 : 15;
    this.camera.position.z = z;
    this.camera.lookAt(0, 5, 0);
    // 風船(z≈0面)が画面に収まる横はばを計算
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * z * aspect;
    this.fieldW = THREE.MathUtils.clamp(halfW * 0.78, 2.6, 7.5);
  }
}
