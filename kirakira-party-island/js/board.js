// すごろくボードゲームの進行(ターン制・サイコロ・マスイベント・優勝発表)。
// 進行は async/await で書き、アニメは Tweens で毎フレーム駆動する。

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { islandHeight } from './world.js';
import { diceFaceTexture, starGeometry, toonMat, toonMatUnique } from './gfx.js';
import { audio } from './audio.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Tweens {
  constructor() { this.list = []; }
  add(dur, onUpdate) {
    return new Promise((res) => this.list.push({ t: 0, dur, onUpdate, res }));
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.onUpdate(k);
      if (k >= 1) {
        this.list.splice(i, 1);
        tw.res();
      }
    }
  }
}

const easeOut = (k) => 1 - (1 - k) * (1 - k);
const easeInOut = (k) => k * k * (3 - 2 * k);

export class BoardGame {
  /**
   * ctx: { scene, world, chars, ui, fx, rig, runMinigame() }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.tweens = new Tweens();
    this.round = 1;
    this.running = false;
    this.diceMesh = this._buildDice();
    this.diceSpin = false;
    this._diceResolver = null;

    // プレイヤーのサイコロボタン
    ctx.ui.diceBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this._diceResolver) {
        const r = this._diceResolver;
        this._diceResolver = null;
        r();
      }
    });
  }

  _buildDice() {
    const mats = [];
    for (let n = 1; n <= 6; n++) {
      mats.push(new THREE.MeshBasicMaterial({ map: diceFaceTexture(n) }));
    }
    const die = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), mats);
    die.visible = false;
    this.ctx.scene.add(die);
    return die;
  }

  update(dt) {
    this.tweens.update(dt);
    if (this.diceSpin) {
      this.diceMesh.rotation.x += dt * 9;
      this.diceMesh.rotation.y += dt * 12.5;
      this.diceMesh.rotation.z += dt * 5.2;
    }
  }

  // ============ ゲーム全体の進行 ============
  async start() {
    const { ui, chars } = this.ctx;
    this.running = true;
    ui.showHud(true);
    ui.buildRoundPips(CONFIG.ROUNDS);
    ui.buildPlayerStrip(chars);
    audio.startBgm('board');

    await ui.showBanner('<span class="icon">🏝️</span>パーティー スタート!', 1800);

    for (this.round = 1; this.round <= CONFIG.ROUNDS; this.round++) {
      ui.setRound(this.round);
      audio.yay();
      await ui.showBanner(`<span class="icon">⭐</span>ラウンド ${this.round}`, 1400);

      for (let i = 0; i < chars.length; i++) {
        await this._takeTurn(chars[i]);
      }

      // 毎ラウンドの終わりにミニゲーム
      await this._minigamePhase();
      audio.startBgm('board');
    }

    await this._finale();
  }

  // ============ 1キャラのターン ============
  async _takeTurn(char) {
    const { ui, rig } = this.ctx;
    ui.setActivePlayer(char.def.id);
    rig.setFollow(char);
    await wait(700);

    // サイコロ登場
    const die = this.diceMesh;
    die.visible = true;
    this.diceSpin = true;
    audio.dice();
    const diePos = () => {
      die.position.copy(char.root.position).add(new THREE.Vector3(0, 2.6, 0));
    };
    diePos();
    const keepAbove = setInterval(diePos, 50);

    if (char.isPlayer) {
      ui.showDice(true);
      await this._waitPlayerTap();
      ui.showDice(false);
    } else {
      await wait(900 + Math.random() * 600);
    }
    clearInterval(keepAbove);

    // 出目を決めて面をカメラへ向ける
    const n = 1 + Math.floor(Math.random() * 6);
    this.diceSpin = false;
    audio.diceResult(n);
    this._orientDice(n);
    this.ctx.fx.sparkleBurst(die.position, 10, 0xfff6a8, 1.2);
    char.land();

    // 出目のぶんだけ大きく表示
    await this.ctx.ui.showBanner(`<span class="icon">${['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣'][n - 1]}</span>${n} だ!`, 950);
    die.visible = false;

    await this._moveCharacter(char, n);
    await this._tileEvent(char);
    await wait(350);
  }

  _waitPlayerTap() {
    return new Promise((res) => { this._diceResolver = res; });
  }

  // 出た目がカメラ側(+z)を向くように回す
  _orientDice(n) {
    const rots = {
      1: [0, -Math.PI / 2, 0],
      2: [0, Math.PI / 2, 0],
      3: [Math.PI / 2, 0, 0],
      4: [-Math.PI / 2, 0, 0],
      5: [0, 0, 0],
      6: [0, Math.PI, 0],
    };
    const [x, y, z] = rots[n];
    // 基本回転(出目を +z へ)→ ワールドYawでカメラの方角へ向ける
    const cam = this.ctx.rig.camera.position;
    const d = new THREE.Vector3().subVectors(cam, this.diceMesh.position);
    const yaw = Math.atan2(d.x, d.z);
    const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
    const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.diceMesh.quaternion.copy(yawQ).multiply(base);
  }

  // n マスぶんホップ移動
  async _moveCharacter(char, n) {
    const { world, fx } = this.ctx;
    char.setMode('hop');
    for (let s = 0; s < n; s++) {
      const next = (char.tileIndex + 1) % CONFIG.TILE_COUNT;
      const from = char.root.position.clone();
      const to = world.tiles[next].pos.clone().add(this._charOffset(char));
      char.faceTowards(to);
      audio.hop(s);
      await this.tweens.add(CONFIG.HOP_TIME, (k) => {
        const e = easeInOut(k);
        char.root.position.lerpVectors(from, to, e);
        char.setHopHeight(Math.sin(Math.PI * k) * 0.85);
      });
      char.setHopHeight(0);
      char.land();
      audio.landing();
      fx.dustPuff(char.root.position, 3);
      char.tileIndex = next;
    }
    char.setMode('idle');
  }

  // キャラごとの立ち位置オフセット(同じマスで重ならない)
  _charOffset(char) {
    const i = this.ctx.chars.indexOf(char);
    const a = (i / 4) * Math.PI * 2 + 0.6;
    return new THREE.Vector3(Math.cos(a) * 0.56, 0, Math.sin(a) * 0.56);
  }

  // ============ マスイベント ============
  async _tileEvent(char, allowWarp = true) {
    const { world, ui, fx } = this.ctx;
    const tile = world.tiles[char.tileIndex];
    const type = tile.type;
    const pos = char.root.position;

    if (type === 'STAR') {
      await this._starEvent(char, tile);
      return;
    }
    if (type === 'COIN' || (type === 'RAINBOW' && !allowWarp)) {
      char.coins += CONFIG.COIN_TILE_GAIN;
      for (let i = 0; i < 3; i++) audio.coin(i);
      fx.coinBurst(pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 5);
      fx.sparkleBurst(pos, 6, 0xffe066);
      char.setMode('cheer');
      ui.updatePlayer(char);
      await wait(900);
      char.setMode('idle');
      return;
    }
    if (type === 'HEART') {
      audio.yay();
      await ui.showBanner('<span class="icon">💗</span>みんなに コイン!', 1100);
      this.ctx.chars.forEach((c) => {
        c.coins += CONFIG.HEART_TILE_GAIN;
        c.setMode('cheer');
        fx.sparkleBurst(c.root.position, 5, 0xff9dbe);
        ui.updatePlayer(c);
      });
      for (let i = 0; i < 2; i++) audio.coin(i);
      await wait(1000);
      this.ctx.chars.forEach((c) => c.setMode('idle'));
      return;
    }
    if (type === 'RAINBOW') {
      audio.warp();
      await ui.showBanner('<span class="icon">🌈</span>にじの ワープ!', 1100);
      char.setMode('hop');
      // 4マスぶん虹色に光りながらぴょんぴょん進む
      for (let s = 0; s < 4; s++) {
        const next = (char.tileIndex + 1) % CONFIG.TILE_COUNT;
        const from = char.root.position.clone();
        const to = world.tiles[next].pos.clone().add(this._charOffset(char));
        char.faceTowards(to);
        audio.hop(s + 3);
        fx.sparkleBurst(char.root.position, 4, [0xff5c5c, 0xffe45c, 0x6fdd6f, 0x5cb8ff][s % 4]);
        await this.tweens.add(0.22, (k) => {
          char.root.position.lerpVectors(from, to, easeInOut(k));
          char.setHopHeight(Math.sin(Math.PI * k) * 1.0);
        });
        char.setHopHeight(0);
        char.tileIndex = next;
      }
      char.land();
      char.setMode('idle');
      fx.burstConfetti(char.root.position, 24, 2.5, 4);
      await this._tileEvent(char, false); // ワープ先のマスも発動(連続ワープはコイン扱い)
      return;
    }
    if (type === 'EVENT') {
      await ui.showBanner('<span class="icon">🎆</span>はなび だいすき!', 1000);
      // 島の上に花火
      for (let i = 0; i < 5; i++) {
        const p = new THREE.Vector3(
          (Math.random() - 0.5) * 16,
          9 + Math.random() * 5,
          (Math.random() - 0.5) * 16,
        );
        audio.firework(i);
        const col = [0xff5c8d, 0xffe45c, 0x6fdd6f, 0x5cb8ff, 0xc19bff][i];
        setTimeout(() => {
          fx.sparkleBurst(p, 14, col, 2.6);
          fx.burstConfetti(p, 20, 5, 1);
        }, i * 260);
      }
      this.ctx.chars.forEach((c) => c.setMode('cheer'));
      await wait(1700);
      this.ctx.chars.forEach((c) => c.setMode('idle'));
      return;
    }
  }

  async _starEvent(char, tile) {
    const { world, ui, fx, rig } = this.ctx;
    audio.starGet();
    char.stars += 1;
    char.setMode('cheer');
    ui.updatePlayer(char);

    // 大きな星がキャラの上でくるくる → ぽん!
    const star = new THREE.Mesh(
      starGeometry(0.9, 0.42, 0.3),
      toonMatUnique(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.7 }),
    );
    star.position.copy(char.root.position).add(new THREE.Vector3(0, 2.4, 0));
    this.ctx.scene.add(star);
    fx.sparkleBurst(star.position, 16, 0xffe066, 1.6);
    fx.burstConfetti(char.root.position, 50, 4, 6);
    await ui.showBanner(`<span class="icon">⭐</span>${char.def.name} スターゲット!`, 1700);
    await this.tweens.add(0.5, (k) => {
      star.rotation.y = k * 6;
      star.scale.setScalar(1 - easeOut(k) * 0.95);
      star.position.y = char.root.position.y + 2.4 - easeOut(k) * 1.4;
    });
    this.ctx.scene.remove(star);
    char.setMode('idle');

    // 星は別のマスへおひっこし
    const newTile = world.moveStar();
    rig.setLookAt(newTile.pos);
    audio.sparkle();
    await ui.showBanner('<span class="icon">🌟</span>つぎの ほしは あっち!', 1300);
    fx.sparkleBurst(newTile.pos.clone().add(new THREE.Vector3(0, 1, 0)), 10, 0xffe066, 1.5);
    await wait(500);
  }

  // ============ ミニゲームフェーズ ============
  async _minigamePhase() {
    const { ui, chars, fx, rig } = this.ctx;
    audio.stopBgm();
    audio.fanfare();
    await ui.showBanner('<span class="icon">🎮</span>ミニゲームの じかん!', 1700);

    const result = await this.ctx.runMinigame(); // [{charIndex, score}] 高得点順

    // ごほうびコイン
    rig.setOverview();
    const winner = chars[result[0].charIndex];
    result.forEach((r, place) => {
      const c = chars[r.charIndex];
      c.coins += place === 0 ? CONFIG.MINIGAME_WIN_COINS : 1;
      ui.updatePlayer(c);
    });
    audio.yay();
    winner.setMode('cheer');
    fx.burstConfetti(winner.root.position, 40, 3, 6);
    await ui.showBanner(
      `<span class="icon">${winner.def.emoji}</span>${winner.def.name} の かち!<span class="sub">🪙コイン ゲット!</span>`,
      1800,
    );
    winner.setMode('idle');
  }

  // ============ 優勝発表 ============
  async _finale() {
    const { ui, chars, fx, world, rig } = this.ctx;
    audio.stopBgm();
    ui.showDice(false);
    ui.setActivePlayer('');

    await ui.showBanner('<span class="icon">🏆</span>けっか はっぴょう!', 1800);

    // 順位:スター → コイン
    const order = [...chars].sort((a, b) => (b.stars - a.stars) || (b.coins - a.coins));
    const winner = order[0];

    // みんな中央のタワーへ集合
    rig.setFinale();
    await Promise.all(chars.map((c, i) => {
      const a = (i / chars.length) * Math.PI * 2 + Math.PI / 4;
      const rank = order.indexOf(c);
      const r = 5.4;
      const target = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      target.y = islandHeight(target.x, target.z) + 0.05; // 丘の斜面にちゃんと立つ
      const from = c.root.position.clone();
      c.setMode('hop');
      return this.tweens.add(1.1, (k) => {
        const e = easeInOut(k);
        c.root.position.lerpVectors(from, target, e);
        c.root.position.y = from.y + (target.y - from.y) * e;
        c.setHopHeight(Math.abs(Math.sin(k * Math.PI * 3)) * 0.7);
      }).then(() => {
        c.setHopHeight(0);
        c.setMode(rank === 0 ? 'dance' : 'cheer');
        c.faceTowards(new THREE.Vector3(Math.cos(a) * 30, 0, Math.sin(a) * 30));
      });
    }));

    // 優勝者に王冠
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.4, 8),
      toonMat(0xffd23e),
    );
    crown.position.y = 1.75;
    winner.inner.add(crown);

    audio.fanfare();
    const rainTimer = setInterval(() => {
      fx.rainConfetti(new THREE.Vector3(0, 4, 0), 9, 40, 8);
      audio.firework(0);
    }, 900);
    fx.burstConfetti(winner.root.position, 80, 5, 8);

    await ui.showBanner(
      `<span class="icon">${winner.def.emoji}👑</span>${winner.def.name} の ゆうしょう!` +
      `<span class="sub">⭐${winner.stars} 🪙${winner.coins}</span>`,
      3600,
    );
    await ui.showBanner(
      '<span class="icon">🎉</span>みんな よく がんばりました!',
      2600,
    );
    this.finaleCleanup = () => clearInterval(rainTimer);
    // ここで戻る。main 側が「タップでもういっかい」を出す
  }
}
