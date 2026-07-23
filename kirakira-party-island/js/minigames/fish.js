// ミニゲーム「おさかな すくい」:いけを およぐ おさかなを タッチですくう。

import { MiniGameBase, THREE, toonMat, toonMatUnique } from './base.js';
import { audio } from '../audio.js';

const TAU = Math.PI * 2;
const FISH_COLORS = [0xff7f3c, 0xffffff, 0xff5c5c, 0xffb7d0];

export class FishGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.52, 0.48, 0.44, 0.5];
    this.buildSkyAndLight({ ground: 0x8fdf6a });
    this.addClouds(5, 10, 20);

    this.camera.position.set(0, 10, 8.5);
    this.camera.lookAt(0, 0, -0.5);

    // いけ
    const pond = new THREE.Mesh(new THREE.CircleGeometry(8.2, 40), toonMatUnique(0x4fb6e8, {
      emissive: 0x2a7ab8, emissiveIntensity: 0.15,
    }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = 0.05;
    this.scene.add(pond);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.35, 10, 44), toonMat(0xd8c090));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.1;
    this.scene.add(rim);

    // はすのは
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.5;
      const r = 5.2 + (i % 2) * 1.6;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(0.7, 12), toonMat(0x51b84a));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(Math.cos(a) * r, 0.09, Math.sin(a) * r);
      this.scene.add(pad);
    }

    // おさかなプール
    this.fishes = [];
    for (let i = 0; i < 7; i++) this._spawnFish(i);
  }

  _spawnFish(i) {
    const golden = Math.random() < 0.15;
    const color = golden ? 0xffd23e : FISH_COLORS[i % FISH_COLORS.length];
    const g = new THREE.Group();
    const mat = golden
      ? toonMatUnique(color, { emissive: 0xffaa00, emissiveIntensity: 0.45 })
      : toonMat(color);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.52, 14, 10), mat);
    body.scale.set(1, 0.7, 1.5);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 8), mat);
    tail.position.z = -0.95;
    tail.rotation.x = -Math.PI / 2;
    const eyeMat = toonMat(0x2c2438);
    [-0.22, 0.22].forEach((x) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
      eye.position.set(x, 0.14, 0.55);
      g.add(eye);
    });
    g.add(body, tail);
    g.userData = {
      golden, tail,
      cx: (Math.random() - 0.5) * 6, cz: (Math.random() - 0.5) * 5,
      r: 1.4 + Math.random() * 2.2,
      speed: (0.5 + Math.random() * 0.5) * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random() * TAU,
      state: 'swim', t: 0,
    };
    g.position.y = 0.32;
    this.scene.add(g);
    this.fishes.push(g);
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);
    const t = this.time;

    this.fishes.forEach((f) => {
      const u = f.userData;
      if (u.state === 'swim') {
        const a = t * u.speed + u.phase;
        const x = u.cx + Math.cos(a) * u.r;
        const z = u.cz + Math.sin(a) * u.r;
        // すすむ方向をむく
        f.lookAt(x + (x - f.position.x) * 2, 0.32, z + (z - f.position.z) * 2);
        f.position.set(x, 0.32 + Math.sin(t * 3 + u.phase) * 0.06, z);
        u.tail.rotation.y = Math.sin(t * 8 + u.phase) * 0.5;
      } else if (u.state === 'caught') {
        u.t += dt;
        const k = Math.min(1, u.t / 0.5);
        f.position.y = 0.32 + Math.sin(k * Math.PI) * 2.4;
        f.rotation.z += dt * 10;
        f.scale.setScalar(1 - k * 0.85);
        if (k >= 1) {
          u.state = 'hidden';
          f.visible = false;
          u.t = 0;
        }
      } else if (u.state === 'hidden') {
        u.t += dt;
        if (u.t > 0.9) {
          // べつのばしょから ふっかつ(見た目はそのまま)
          u.cx = (Math.random() - 0.5) * 6;
          u.cz = (Math.random() - 0.5) * 5;
          f.scale.setScalar(1);
          f.visible = true;
          u.state = 'swim';
        }
      }
    });
  }

  pointerDown(ndc, px) {
    const targets = this.fishes.filter((f) => f.visible && f.userData.state === 'swim');
    const hits = this.raycast(ndc, targets);
    if (!hits.length) return;
    let fish = hits[0].object;
    while (fish.parent && !this.fishes.includes(fish)) fish = fish.parent;
    const u = fish.userData;
    if (!u || u.state !== 'swim') return;
    u.state = 'caught';
    u.t = 0;
    audio.splash();
    audio.sparkle();
    this.fx.sparkleBurst(fish.position, u.golden ? 14 : 7, u.golden ? 0xffe066 : 0x9fd8ff, 1.5);
    this.fx.dustPuff(fish.position, 3);
    this.addPlayerPoint(u.golden ? 3 : 1);
    if (px) this.ctx.ui.emojiBurst(px.x, px.y, u.golden ? '🌟' : '🐟');
  }

  fitCamera(aspect) {
    if (aspect < 1) {
      this.camera.position.set(0, 13.5, 10.5);
      this.camera.lookAt(0, 0.3, -0.5);
    } else {
      this.camera.position.set(0, 10, 8.5);
      this.camera.lookAt(0, 0, -0.5);
    }
  }
}
