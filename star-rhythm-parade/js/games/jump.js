// ================================================================
// みんなで ジャンプ — うさぎ→ねこ→ほしさん→きみ(くま)の順番ジャンプ!
// 拍1・2・3で仲間が順に跳ぶ「ウェーブ」が視覚の合図。拍4できみの番。
// ================================================================

import * as THREE from 'three';
import { RhythmGame } from './common.js';
import { makeRabbit, makeCat, makeStarBuddy, makeBear } from '../world/characters.js';
import { toonMat } from '../core/toon.js';
import { SONG_JUMP, songMeasures } from '../audio/songs.js';

const INTRO_MEASURES = 2;
const JUMP_DUR = 0.55;   // ジャンプの長さ(拍)
const JUMP_H = 1.1;

export class JumpGame extends RhythmGame {
  song() { return SONG_JUMP; }

  camera() {
    return {
      pos: new THREE.Vector3(0, 3.0, 9.0),
      target: new THREE.Vector3(0, 1.6, 0),
    };
  }

  buildCues() {
    // プレイヤー(くま)は各小節の4拍目
    const cues = [];
    const M = songMeasures(SONG_JUMP);
    for (let m = INTRO_MEASURES; m < M - 1; m++) {
      cues.push({ beat: m * 4 + 3 });
    }
    return cues;
  }

  buildGuides() {
    // 仲間のジャンプ音(音程が上がっていく → 「つぎは きみ!」)
    const g = [];
    const M = songMeasures(SONG_JUMP);
    const { audio } = this.ctx;
    const pitches = [1.0, 1.12, 1.26];
    for (let m = 0; m < M - 1; m++) {
      for (let b = 0; b < 3; b++) {
        g.push({ beat: m * 4 + b, fn: (t) => { audio.cue(t, pitches[b]); audio.boing(t); } });
      }
    }
    return g;
  }

  mount() {
    const g = this.group;

    // 仲間たち(左から順にジャンプ)
    this.friends = [
      makeRabbit({ scale: 0.9 }),
      makeCat({ scale: 0.9 }),
      makeStarBuddy({ scale: 0.95 }),
    ];
    const xs = [-2.7, -0.9, 0.9];
    this.friends.forEach((f, i) => {
      f.root.position.set(xs[i], 0, 0.6);
      g.add(f.root);
      this.critters.push(f);
    });

    // プレイヤー(くま・スカーフつき)
    this.bear = makeBear();
    this.bear.root.position.set(2.7, 0, 0.6);
    const scarf = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.09, 8, 18),
      toonMat(0xff5c5c, { rim: 0.1 })
    );
    scarf.position.y = 1.04;
    scarf.rotation.x = Math.PI / 2;
    this.bear.root.add(scarf);
    g.add(this.bear.root);
    this.critters.push(this.bear);

    // 足元のスポットマーク(自分の位置がわかる)
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffe066, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(2.7, 0.03, 0.6);
    g.add(mark);
    this.mark = mark;

    this.playerJumpT = -1;
  }

  reset() {
    this.playerJumpT = -1;
    setTimeout(() => this.ctx.ui.banner('じゅんばんに <b>ジャンプ!</b>', 2600), 1900);
  }

  onCueHit(cue, grade) {
    this.playerJumpT = 0;
    this.ctx.audio.boing();
    const p = this.bear.root.position.clone();
    p.y += 1;
    p.applyMatrix4(this.group.matrixWorld);
    if (grade === 'perfect') {
      this.ctx.particles.burstConfetti(p, 26, 3.0);
      this.ctx.particles.ring(p, 0xffe066, 'z', 1.2);
      this.ctx.r3d.shake(0.08);
      this.bear.happy();
      for (const f of this.friends) f.happy();
      this.ctx.audio.cheer();
    } else {
      this.ctx.particles.burstSparks(p, 10, 1.6);
    }
  }

  onCueMiss(cue, wasTap) {
    this.bear.oops();
    if (wasTap) this.playerJumpT = 0; // 遅れてもジャンプはする(楽しい優先)
  }

  onFreeTap() {
    // リズム外のタップでも小さくぴょこっ(応答性の楽しさ)
    if (this.playerJumpT < 0) this.playerJumpT = JUMP_DUR * this.spb * 0.5;
  }

  tick(dt, beat) {
    // ---- 仲間のウェーブジャンプ(小節の拍0,1,2) ----
    const m = Math.floor(beat / 4);
    for (let i = 0; i < 3; i++) {
      const f = this.friends[i];
      let y = 0;
      // 直近の自分の拍(今の小節 or 前の小節)
      for (const mm of [m, m - 1]) {
        const jb = mm * 4 + i;
        const u = (beat - jb) / JUMP_DUR;
        if (u >= 0 && u <= 1) y = Math.max(y, JUMP_H * 4 * u * (1 - u));
      }
      f.root.position.y = y;
      // 踏切と着地のスカッシュ
      const sq = y > 0.02 ? 1.06 : 1 - Math.max(0, 0.1 - y) * 0.5;
      f.setSquash(sq);
    }

    // ---- プレイヤーのジャンプ(タップ駆動) ----
    if (this.playerJumpT >= 0) {
      this.playerJumpT += dt;
      const u = this.playerJumpT / (JUMP_DUR * this.spb);
      if (u >= 1) {
        this.playerJumpT = -1;
        this.bear.root.position.y = 0;
        this.bear.setSquash(1);
      } else {
        this.bear.root.position.y = JUMP_H * 1.15 * 4 * u * (1 - u);
        this.bear.setSquash(u < 0.15 ? 0.85 : 1.08);
      }
    } else {
      // 自分の番が近いと足元マークが光る
      this.bear.root.position.y = 0;
    }

    // 足元マーク: 自分の拍が近いほど明るく
    const now = this.ctx.audio.now;
    let near = 0;
    for (const c of this.cues) {
      if (c.judged) continue;
      const d = c.time - now;
      if (d > -0.2 && d < this.spb * 1.2) near = Math.max(near, 1 - Math.abs(d) / (this.spb * 1.2));
    }
    this.mark.material.opacity = 0.3 + near * 0.6;
    this.mark.scale.setScalar(1 + near * 0.25 + Math.sin(beat * Math.PI * 2) * 0.04);
  }
}
