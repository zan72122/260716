// ================================================================
// もちつき ぺったん — 「ぽん・ぽん・ぺったん!」
// お手本うさぎが拍1・2で杵を振り、プレイヤーうさぎは拍3でタップ。
// 光るリングが縮んで「いま!」を教えてくれる。
// ================================================================

import * as THREE from 'three';
import { RhythmGame } from './common.js';
import { makeRabbit } from '../world/characters.js';
import { toonMat, glowMat, addOutline } from '../core/toon.js';
import { COLORS } from '../config.js';
import { SONG_MOCHI, songMeasures } from '../audio/songs.js';

const INTRO_MEASURES = 2;

export class MochiGame extends RhythmGame {
  song() { return SONG_MOCHI; }

  camera() {
    return {
      pos: new THREE.Vector3(0, 3.1, 7.8),
      target: new THREE.Vector3(0, 1.75, 0.4),
    };
  }

  buildCues() {
    // プレイヤーは各小節の3拍目(イントロ2小節は見てるだけ)
    const cues = [];
    const M = songMeasures(SONG_MOCHI);
    for (let m = INTRO_MEASURES; m < M - 1; m++) {
      cues.push({ beat: m * 4 + 2 });
    }
    return cues;
  }

  buildGuides() {
    // お手本の「ぽん・ぽん」音(全小節、拍1・2)
    const g = [];
    const M = songMeasures(SONG_MOCHI);
    const { audio } = this.ctx;
    for (let m = 0; m < M - 1; m++) {
      g.push({ beat: m * 4 + 0, fn: (t) => { audio.cue(t, 0.9); audio.pettan(t); } });
      g.push({ beat: m * 4 + 1, fn: (t) => { audio.cue(t, 1.05); audio.pettan(t); } });
    }
    return g;
  }

  mount() {
    const g = this.group;

    // ---- うす ----
    const usu = new THREE.Group();
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.62, 0.72, 22),
      toonMat(COLORS.usu, { rim: 0.12, rimColor: 0xffc9a0 })
    );
    bowl.position.y = 0.36;
    bowl.castShadow = true; bowl.receiveShadow = true;
    addOutline(bowl, 0.02);
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(0.74, 0.045, 8, 26),
      toonMat(0x6b4226, { rim: 0 })
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.55;
    usu.add(bowl, band);

    // ---- おもち ----
    this.mochi = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 22, 16),
      toonMat(COLORS.mochi, { rim: 0.4, rimColor: 0xfff0d0 })
    );
    this.mochi.scale.set(1.15, 0.62, 1.15);
    this.mochi.position.y = 0.78;
    this.mochi.castShadow = true;
    addOutline(this.mochi, 0.025);
    usu.add(this.mochi);
    usu.position.set(0, 0, 0.5);
    g.add(usu);

    // ---- うさぎ2羽 ----
    this.npc = makeRabbit();
    this.npc.root.position.set(-1.85, 0, 0.5);
    this.npc.root.rotation.y = Math.PI / 2 - 0.4;
    g.add(this.npc.root);

    this.player = makeRabbit();
    this.player.root.position.set(1.85, 0, 0.5);
    this.player.root.rotation.y = -Math.PI / 2 + 0.4;
    // プレイヤーの目印: 赤いスカーフ
    const scarf = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.09, 8, 18),
      toonMat(0xff5c5c, { rim: 0.1 })
    );
    scarf.position.y = 1.0;
    scarf.rotation.x = Math.PI / 2;
    scarf.scale.y = 1.15;
    this.player.root.add(scarf);
    g.add(this.player.root);
    this.critters.push(this.npc, this.player);

    // ---- 杵(きね)×2: ピボット回転で振り下ろす ----
    this.npcMallet = this._makeMallet(-1);
    this.npcMallet.pivot.position.set(-1.35, 1.15, 0.5);
    g.add(this.npcMallet.pivot);

    this.playerMallet = this._makeMallet(1);
    this.playerMallet.pivot.position.set(1.35, 1.15, 0.5);
    g.add(this.playerMallet.pivot);

    // ---- タイミングリング(縮んで「いま!」) ----
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffe066, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(0, 1.15, 0.5);
    g.add(this.ring);

    // 湯気
    this.steam = [];
    const steamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false,
    });
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), steamMat);
      s.position.set((i - 1) * 0.2, 1.2, 0.5);
      g.add(s);
      this.steam.push({ mesh: s, phase: i * 2.1 });
    }
  }

  _makeMallet(side) {
    // side: -1=左(お手本) +1=右(プレイヤー)
    const pivot = new THREE.Group();
    const arm = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 1.05, 10),
      toonMat(COLORS.kine, { rim: 0.1 })
    );
    handle.position.y = 0.5;
    handle.castShadow = true;
    addOutline(handle, 0.03);
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.19, 0.5, 14),
      toonMat(0xf0e0c8, { rim: 0.15 })
    );
    head.rotation.x = Math.PI / 2;
    head.position.y = 1.05;
    head.castShadow = true;
    addOutline(head, 0.025);
    arm.add(handle, head);
    pivot.add(arm);
    // 角度: rest=まっすぐ上、hit=もちへ振り下ろし
    const rest = side * 0.25;
    const raised = side * -0.55;   // 振りかぶり(外側へ)
    const hit = side * 1.9;        // もちへ(内側へ)
    pivot.rotation.z = rest;
    return { pivot, rest, raised, hit, anim: 0 };
  }

  reset() {
    this.squash = 0;
    this.playerSwing = -1; // >=0 の間はスラム再生中
    setTimeout(() => this.ctx.ui.banner('ぽん・ぽん・<b>ぺったん!</b>', 2600), 1900);
  }

  onBeat(bi) {
    const inMeasure = bi % 4;
    // お手本うさぎの「ぽん・ぽん」でおもちがむにゅっ
    if (inMeasure === 0 || inMeasure === 1) {
      this.squash = Math.min(1, this.squash + 0.55);
    }
  }

  onCueHit(cue, grade) {
    this.playerSwing = 0;
    this.squash = grade === 'perfect' ? 1.4 : 1.0;
    this.ctx.audio.pettan();
    const p = this._mochiWorldPos();
    this.ctx.particles.burstSparks(p, grade === 'perfect' ? 20 : 10, 1.8);
    if (grade === 'perfect') {
      this.ctx.particles.ring(p, 0xffe066, 'y', 1.2);
      this.ctx.particles.burstConfetti(p, 22, 2.6);
      this.ctx.r3d.shake(0.09);
      this.player.happy();
      this.npc.happy();
    }
  }

  onCueMiss(cue, wasTap) {
    this.player.oops();
    if (wasTap) this.playerSwing = 0; // 空振りでも振る(かわいい)
  }

  onFreeTap() {
    this.playerSwing = 0;
  }

  _mochiWorldPos() {
    const v = new THREE.Vector3();
    this.mochi.getWorldPosition(v);
    return v;
  }

  tick(dt, beat) {
    const spb = this.spb;

    // ---- おもち: むにゅ+ぷるぷる ----
    this.squash = Math.max(0, this.squash - dt * 4.5);
    const jiggle = Math.sin(beat * Math.PI * 2) * 0.03;
    const s = this.squash;
    this.mochi.scale.set(1.15 * (1 + s * 0.3), 0.62 * (1 - s * 0.42) + jiggle * 0.2, 1.15 * (1 + s * 0.3));
    this.mochi.position.y = 0.78 - s * 0.1;

    // ---- お手本うさぎの杵(拍1・2で自動) ----
    const inM = ((beat % 4) + 4) % 4;
    this.npcMallet.pivot.rotation.z = this._npcMalletAngle(this.npcMallet, inM);
    // お手本うさぎのからだ(振りに合わせて前傾)
    const lean = Math.max(0, Math.cos(inM * Math.PI)) * 0.1;
    this.npc.root.rotation.x = lean * 0.3;

    // ---- プレイヤーの杵 ----
    const pm = this.playerMallet;
    if (this.playerSwing >= 0) {
      // タップ→スラム→もどる(0.35秒)
      this.playerSwing += dt;
      const u = this.playerSwing / 0.35;
      if (u >= 1) {
        this.playerSwing = -1;
        pm.pivot.rotation.z = pm.rest;
      } else if (u < 0.3) {
        pm.pivot.rotation.z = THREE.MathUtils.lerp(pm.raised, pm.hit, easeIn(u / 0.3));
      } else {
        pm.pivot.rotation.z = THREE.MathUtils.lerp(pm.hit, pm.rest, easeOut((u - 0.3) / 0.7));
      }
    } else {
      // 次のキューに向けて自動で振りかぶる(予備動作=合図)
      const next = this.cues.find((c) => !c.judged && c.time > this.ctx.audio.now - 0.1);
      let target = pm.rest;
      let ringK = 0;
      if (next) {
        const u = (next.time - this.ctx.audio.now) / (spb * 1.5); // 1.5拍前から
        if (u < 1 && u > 0) {
          target = THREE.MathUtils.lerp(pm.raised, pm.rest, easeOut(u));
          ringK = 1 - u;
        }
      }
      pm.pivot.rotation.z += (target - pm.pivot.rotation.z) * Math.min(1, dt * 14);

      // タイミングリング: 縮む
      if (ringK > 0) {
        this.ring.material.opacity = 0.7 * ringK;
        const rs = THREE.MathUtils.lerp(2.4, 0.75, easeIn(ringK));
        this.ring.scale.setScalar(rs);
      } else {
        this.ring.material.opacity = Math.max(0, this.ring.material.opacity - dt * 4);
      }
    }

    // 湯気
    for (const st of this.steam) {
      const k = ((this.ctx.world.t * 0.5 + st.phase) % 2) / 2;
      st.mesh.position.y = 1.1 + k * 0.9;
      st.mesh.material.opacity = 0.22 * Math.sin(k * Math.PI);
      st.mesh.scale.setScalar(0.7 + k * 0.9);
    }
  }

  _npcMalletAngle(m, inM) {
    // 拍0と拍1に叩く。拍の直前0.45で振りかぶり→叩く
    // inM: 小節内の拍位置(0..4)
    const hits = [0, 1];
    let angle = m.rest;
    for (const h of hits) {
      let d = inM - h; // 叩いた後の経過拍
      if (d > 3.5) d -= 4; // 小節またぎ(次の小節の拍0への振りかぶり)
      if (d >= -0.45 && d < 0) {
        // 振りかぶり→振り下ろし
        const u = 1 + d / 0.45; // 0→1
        angle = u < 0.6
          ? THREE.MathUtils.lerp(m.rest, m.raised, easeOut(u / 0.6))
          : THREE.MathUtils.lerp(m.raised, m.hit, easeIn((u - 0.6) / 0.4));
      } else if (d >= 0 && d < 0.4) {
        angle = THREE.MathUtils.lerp(m.hit, m.rest, easeOut(d / 0.4));
      }
    }
    return angle;
  }
}

function easeIn(x) { return x * x; }
function easeOut(x) { return 1 - (1 - x) * (1 - x); }
