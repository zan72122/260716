// ================================================================
// おほしさま キャッチ — 流れ星がカゴに届く瞬間にタップ!
// 星は2拍かけて弧を描いて飛んでくる(見て分かる合図)。
// キャッチした星はねこの頭のまわりをくるくる回る。
// ================================================================

import * as THREE from 'three';
import { RhythmGame } from './common.js';
import { makeCat } from '../world/characters.js';
import { toonMat, glowMat, addOutline } from '../core/toon.js';
import { COLORS } from '../config.js';
import { SONG_CATCH, songMeasures } from '../audio/songs.js';

const INTRO_MEASURES = 2;
const FLIGHT_BEATS = 2;         // 星が飛んでくる拍数

export class CatchGame extends RhythmGame {
  song() { return SONG_CATCH; }

  camera() {
    return {
      pos: new THREE.Vector3(0, 3.2, 8.2),
      target: new THREE.Vector3(0, 1.9, 0.2),
    };
  }

  buildCues() {
    const cues = [];
    const M = songMeasures(SONG_CATCH);
    let i = 0;
    for (let m = INTRO_MEASURES; m < M - 1; m++) {
      cues.push({ beat: m * 4 + 0, side: i++ % 2 ? 1 : -1 });
      cues.push({ beat: m * 4 + 2, side: i++ % 2 ? 1 : -1 });
    }
    return cues;
  }

  buildGuides() {
    // 星が飛び出す瞬間の「ひゅん」+ 到着1拍前の「きらっ」
    const g = [];
    const { audio } = this.ctx;
    for (const c of this.buildCues()) {
      g.push({ beat: c.beat - FLIGHT_BEATS, fn: (t) => audio.cue(t, 1.5) });
      g.push({ beat: c.beat - 1, fn: (t) => audio.cue(t, 1.8) });
    }
    return g;
  }

  mount() {
    const g = this.group;

    // ---- ねこ ----
    this.cat = makeCat();
    this.cat.root.position.set(0, 0, 1.0);
    g.add(this.cat.root);
    this.critters.push(this.cat);

    // ---- カゴ ----
    const basket = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.38, 0.5, 18, 1, true),
      toonMat(0xd8a75c, { rim: 0.15 })
    );
    bowl.material.side = THREE.DoubleSide;
    bowl.castShadow = true;
    addOutline(bowl, 0.02);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), toonMat(0xc4913f, { rim: 0 }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -0.24;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 20), toonMat(0xc4913f, { rim: 0 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.25;
    basket.add(bowl, bottom, rim);
    // ねこの顔が隠れないよう、カゴは胸の前の低い位置に持つ
    basket.position.set(0, 0.78, 1.75);
    g.add(basket);
    this.basket = basket;
    this.basketBaseY = basket.position.y;

    // ---- キャッチポイントのガイドリング ----
    this.catchPoint = new THREE.Vector3(0, 1.08, 1.75);
    this.guideRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 8, 36),
      new THREE.MeshBasicMaterial({
        color: 0x9fe8ff, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.guideRing.position.copy(this.catchPoint);
    g.add(this.guideRing);

    // ---- 飛んでくる星のプール ----
    const shape = new THREE.Shape();
    const R = 0.4, r = 0.18;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) shape.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else shape.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const starGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.14, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2,
    });
    starGeo.center();
    this.starPool = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(starGeo, glowMat(COLORS.star, 0.85));
      m.visible = false;
      addOutline(m, 0.04);
      g.add(m);
      this.starPool.push(m);
    }

    // ---- キャッチ済みの星(頭のまわりを回る) ----
    this.orbitStars = [];
    const smallGeo = new THREE.OctahedronGeometry(0.12);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(smallGeo, glowMat(COLORS.star, 0.9));
      m.visible = false;
      g.add(m);
      this.orbitStars.push(m);
    }
  }

  reset() {
    this.caught = 0;
    for (const s of this.starPool) s.visible = false;
    for (const s of this.orbitStars) s.visible = false;
    // 各キューに星メッシュを割り当て(同時に飛ぶのは最大2個)
    this.cues.forEach((c, i) => {
      c.star = this.starPool[i % this.starPool.length];
      c.result = null;
    });
    setTimeout(() => this.ctx.ui.banner('ながれぼしを <b>キャッチ!</b>', 2600), 1900);
  }

  _flightPos(cue, u, out) {
    // 2次ベジェ: 空 → 高いところ → キャッチポイント
    const sx = cue.side * 6.5;
    const p0x = sx, p0y = 5.6, p0z = -2.5;
    const p1x = sx * 0.45, p1y = 4.6, p1z = 0.2;
    const p2 = this.catchPoint;
    const v = 1 - u;
    out.set(
      v * v * p0x + 2 * v * u * p1x + u * u * p2.x,
      v * v * p0y + 2 * v * u * p1y + u * u * p2.y,
      v * v * p0z + 2 * v * u * p1z + u * u * p2.z
    );
    return out;
  }

  onCueHit(cue, grade) {
    cue.result = 'hit';
    cue.star.visible = false;
    this.ctx.audio.sparkle();
    const wp = new THREE.Vector3();
    cue.star.getWorldPosition(wp);
    this.ctx.particles.burstSparks(wp, grade === 'perfect' ? 22 : 12, 2.0);
    this.ctx.particles.ring(wp, 0xffe066, 'z', 1);
    if (grade === 'perfect') {
      this.ctx.particles.burstConfetti(wp, 16, 2.2);
      this.cat.happy();
    }
    // 頭のまわりに星が増える
    if (this.caught < this.orbitStars.length) {
      this.orbitStars[this.caught].visible = true;
    }
    this.caught++;
    // カゴがぽよん
    this.basketBounce = 1;
  }

  onCueMiss(cue) {
    cue.result = 'miss';
    this.cat.oops();
  }

  onFreeTap() {
    // 空タップ: ねこが軽くカゴを振る
    this.basketBounce = Math.max(this.basketBounce || 0, 0.5);
  }

  tick(dt, beat) {
    const now = this.ctx.audio.now;

    // ---- 飛んでいる星の位置更新 ----
    const tmp = new THREE.Vector3();
    for (const c of this.cues) {
      const startT = c.time - FLIGHT_BEATS * this.spb;
      const u = (now - startT) / (FLIGHT_BEATS * this.spb);
      const star = c.star;
      if (c.result === 'hit') continue;
      if (u < 0 || u > 1.45) {
        if (star && c.result !== 'hit' && u > 1.45) star.visible = false;
        continue;
      }
      if (!star) continue;
      star.visible = true;
      if (u <= 1) {
        this._flightPos(c, u, tmp);
        star.position.copy(tmp);
        star.rotation.z += dt * 6;
        const sc = 0.8 + u * 0.4;
        star.scale.setScalar(sc);
        // 流れ星のキラキラ尾
        if (Math.random() < 0.35) {
          star.getWorldPosition(tmp);
          this.ctx.particles.burstSparks(tmp, 1, 0.3);
        }
      } else {
        // 取り逃し: そのまま落ちてフェード
        const k = (u - 1) / 0.45;
        star.position.y -= dt * (2 + k * 5);
        star.position.z += dt * 1.2;
        star.rotation.z += dt * 3;
        star.scale.setScalar(Math.max(0.01, 1.2 * (1 - k)));
      }
    }

    // ---- ガイドリング: 星が近いほど光る ----
    let near = 0;
    for (const c of this.cues) {
      if (c.judged || c.result) continue;
      const d = Math.abs(now - c.time);
      if (d < this.spb) near = Math.max(near, 1 - d / this.spb);
    }
    this.guideRing.material.opacity = 0.25 + near * 0.6;
    this.guideRing.scale.setScalar(1 + Math.sin(beat * Math.PI * 2) * 0.06 + near * 0.25);
    this.guideRing.rotation.y += dt * 1.5;

    // ---- カゴのぽよん ----
    this.basketBounce = Math.max(0, (this.basketBounce || 0) - dt * 3.5);
    const b = this.basketBounce;
    this.basket.scale.set(1 + b * 0.18, 1 - b * 0.22, 1 + b * 0.18);
    this.basket.position.y = this.basketBaseY - b * 0.08;

    // ---- キャッチ済みの星の軌道 ----
    const headY = 2.35;
    for (let i = 0; i < Math.min(this.caught, this.orbitStars.length); i++) {
      const s = this.orbitStars[i];
      const a = this.ctx.world.t * 1.4 + (i / this.orbitStars.length) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.85, headY + Math.sin(this.ctx.world.t * 2.4 + i) * 0.1, 1.0 + Math.sin(a) * 0.85);
      s.rotation.y += dt * 3;
    }

    // ねこはリズムでゆらゆら
    this.cat.root.rotation.z = Math.sin(beat * Math.PI) * 0.05;
  }
}
