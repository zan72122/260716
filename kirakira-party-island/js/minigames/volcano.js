// ミニゲーム「ドッカン かざん」:ふんかで とんでくる いわを よけて、ほうせきを キャッチ!

import { MiniGameBase, THREE, toonMat, toonMatUnique } from './base.js';
import { glowTexture } from '../gfx.js';
import { audio } from '../audio.js';

const GEM_COLORS = [0x7fe8ff, 0xff9dd6, 0xffe066, 0xc19bff];

export class VolcanoGame extends MiniGameBase {
  constructor(ctx) {
    super(ctx);
    this.cpuRates = [0.5, 0.46, 0.42, 0.48];
    this.buildSkyAndLight({ ground: 0xc9a06a, fog: 0xe8c0a0 });
    this.addClouds(4, 12, 22);

    // かざん(はいけい)
    const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 8, 22), toonMat(0x8a6a55));
    cone.position.set(0, 4, -14);
    cone.castShadow = true;
    this.scene.add(cone);
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 1, 16), toonMatUnique(0xff8a3c, {
      emissive: 0xff5a00, emissiveIntensity: 0.9,
    }));
    crater.position.set(0, 8.1, -14);
    this.scene.add(crater);
    this.craterMat = crater.material;
    // けむり
    this.smokes = [];
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0x9a9a9a, transparent: true, opacity: 0.5, depthWrite: false,
      }));
      sp.userData = { phase: i / 3 };
      this.scene.add(sp);
      this.smokes.push(sp);
    }

    // プレイヤーキャラ+かご(フルーツキャッチとおなじそうさ)
    this.player = ctx.chars[ctx.playerIndex];
    this.scene.add(this.player.root);
    this.player.root.position.set(0, 0, 2.5);
    this.player.root.rotation.set(0, 0, 0);
    this.player.targetYaw = 0;
    this.player.setMode('idle');

    this.basket = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.65, 0.7, 14, 1, true), toonMat(0xc08a4a));
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.66, 14), toonMat(0x9c6b3f));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -0.32;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.09, 8, 18), toonMat(0xa9743c));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.35;
    this.basket.add(wall, bottom, rim);
    this.basket.position.set(0, 1.15, 3.6);
    this.scene.add(this.basket);

    // めまいのほし(いわに あたったとき)
    this.dizzyStars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        toonMatUnique(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.6 }),
      );
      s.userData = { angle: (i / 3) * Math.PI * 2 };
      this.dizzyStars.add(s);
    }
    this.dizzyStars.visible = false;
    this.scene.add(this.dizzyStars);
    this.dizzy = 0;

    this.targetX = 0;
    this.items = [];
    this.spawnT = 0.5;
    this.eruptT = 3;
    this.fieldW = 4.5;
  }

  _spawnItem(isRock) {
    const g = new THREE.Group();
    if (isRock) {
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 0), toonMat(0x7a6a5e));
      rock.castShadow = true;
      g.add(rock);
    } else {
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.42, 0),
        toonMatUnique(GEM_COLORS[Math.floor(Math.random() * GEM_COLORS.length)], {
          emissive: 0xffffff, emissiveIntensity: 0.2,
        }),
      );
      gem.castShadow = true;
      g.add(gem);
    }
    g.position.set((Math.random() - 0.5) * 2 * this.fieldW, 8.5 + Math.random() * 2, 3.6);
    g.userData = { rock: isRock, speed: 2.8 + Math.random() * 1.8, spin: (Math.random() - 0.5) * 6 };
    this.scene.add(g);
    this.items.push(g);
  }

  update(dt) {
    this.time += dt;
    this.tickCpu(dt);
    const t = this.time;

    // ふんか!(ゴゴゴ…ドッカン)
    this.eruptT -= dt;
    if (this.eruptT <= 0) {
      this.eruptT = 4 + Math.random() * 2;
      audio.rumble();
      this.fx.sparkleBurst(new THREE.Vector3(0, 8.6, -14), 16, 0xff8a3c, 3);
      for (let i = 0; i < 2; i++) this._spawnItem(true);
    }
    this.craterMat.emissiveIntensity = 0.8 + Math.sin(t * 4) * 0.3;
    this.smokes.forEach((sp) => {
      const p = (t * 0.15 + sp.userData.phase) % 1;
      sp.position.set(Math.sin(p * 8) * 0.8, 8.6 + p * 5, -14);
      sp.scale.setScalar(1.5 + p * 3.5);
      sp.material.opacity = 0.45 * (1 - p);
    });

    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.items.length < 7) {
      this._spawnItem(Math.random() < 0.3);
      this.spawnT = 0.5 + Math.random() * 0.4;
    }

    // めまい中は うごけない
    if (this.dizzy > 0) {
      this.dizzy -= dt;
      this.dizzyStars.visible = true;
      this.dizzyStars.position.copy(this.player.root.position).add(new THREE.Vector3(0, 1.6, 0));
      this.dizzyStars.children.forEach((s) => {
        s.userData.angle += dt * 6;
        s.position.set(Math.cos(s.userData.angle) * 0.5, 0, Math.sin(s.userData.angle) * 0.5);
      });
      if (this.dizzy <= 0) this.dizzyStars.visible = false;
    } else {
      const k = Math.min(1, dt * 9);
      this.basket.position.x += (this.targetX - this.basket.position.x) * k;
      this.player.root.position.x = this.basket.position.x;
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.position.y -= it.userData.speed * dt;
      it.rotation.z += it.userData.spin * dt;
      it.rotation.x += it.userData.spin * 0.6 * dt;

      if (it.position.y < 1.7 && it.position.y > 0.8 &&
          Math.abs(it.position.x - this.basket.position.x) < 1.0) {
        if (it.userData.rock) {
          if (this.dizzy <= 0) {
            // ごつん!ちょっとのあいだ めがまわる(スコアはへらない)
            this.dizzy = 1.2;
            audio.boing();
            audio.thunder();
            this.player.land();
            this.fx.dustPuff(this.basket.position, 5);
          }
        } else {
          audio.coin(0);
          this.fx.sparkleBurst(this.basket.position, 8, 0x9fe8ff, 1.3);
          this.addPlayerPoint(1);
          this.player.land();
        }
        this.scene.remove(it);
        this.items.splice(i, 1);
        continue;
      }
      if (it.position.y < 0.3) {
        this.fx.dustPuff(it.position, 2);
        this.scene.remove(it);
        this.items.splice(i, 1);
      }
    }
  }

  _pointerToX(ndc) {
    return THREE.MathUtils.clamp(ndc.x, -1, 1) * (this.fieldW + 0.4);
  }

  pointerDown(ndc) { this.targetX = this._pointerToX(ndc); }
  pointerMove(ndc) { this.targetX = this._pointerToX(ndc); }

  fitCamera(aspect) {
    const z = aspect < 1 ? 14.5 : 11;
    this.camera.position.set(0, 5.2, z);
    this.camera.lookAt(0, 3.2, 0);
    const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (z - 3.6) * aspect;
    this.fieldW = THREE.MathUtils.clamp(halfW * 0.8, 2.0, 5.0);
  }
}
