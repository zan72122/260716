// ミニゲームの進行係:選択 → 説明 → カウントダウン → プレイ → 結果。
// アクティブ中は main.js がこのマネージャのシーンを描画する。

import { CONFIG, MINIGAMES, FORCED_MINIGAME } from '../config.js';
import { audio } from '../audio.js';
import { BalloonGame } from './balloon.js';
import { FruitsGame } from './fruits.js';
import { RaceGame } from './race.js';
import { StarsGame } from './stars.js';
import { FishGame } from './fish.js';
import { CakeGame } from './cake.js';
import { CartGame } from './cart.js';
import { VolcanoGame } from './volcano.js';

const GAME_CLASSES = {
  balloon: BalloonGame,
  fruits: FruitsGame,
  race: RaceGame,
  stars: StarsGame,
  fish: FishGame,
  cake: CakeGame,
  cart: CartGame,
  volcano: VolcanoGame,
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class MinigameManager {
  /**
   * ctx: { chars, playerIndex, ui, boardScene }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.active = null;   // 実行中のゲーム(main が描画対象を切り替える)
    this.running = false;
    this.timeLeft = 0;
    this._finishResolver = null;
    this.queue = shuffle(MINIGAMES.map((m) => m.id));
  }

  _nextGameId() {
    if (FORCED_MINIGAME && GAME_CLASSES[FORCED_MINIGAME]) return FORCED_MINIGAME;
    if (!this.queue.length) this.queue = shuffle(MINIGAMES.map((m) => m.id));
    return this.queue.shift();
  }

  _saveChars() {
    this._saved = this.ctx.chars.map((c) => ({
      char: c,
      pos: c.root.position.clone(),
      yaw: c.inner.rotation.y,
    }));
  }

  _restoreChars() {
    this._saved.forEach(({ char, pos, yaw }) => {
      this.ctx.boardScene.add(char.root); // 別シーンにいた子は自動で戻る
      char.root.position.copy(pos);
      char.root.rotation.set(0, 0, 0);
      char.inner.rotation.y = yaw;
      char.targetYaw = yaw;
      char.setHopHeight(0);
      char.setMode('idle');
    });
  }

  async run() {
    const { ui, chars, playerIndex } = this.ctx;
    const id = this._nextGameId();
    const def = MINIGAMES.find((m) => m.id === id);

    audio.startBgm('minigame');
    await ui.showBanner(
      `<span class="icon">${def.icon}</span>${def.name}<span class="sub">${def.desc}</span>`,
      2300,
    );

    this._saveChars();
    const game = new GAME_CLASSES[id]({ chars, playerIndex: this.ctx.playerIndex, ui });
    this.active = game;
    this.running = false;
    this.resize(window.innerWidth / Math.max(1, window.innerHeight));

    // カウントダウン
    for (let n = 3; n >= 1; n--) {
      audio.countTick(n);
      await ui.showBanner(`<span class="icon">${['1️⃣', '2️⃣', '3️⃣'][n - 1]}</span>`, 620);
    }
    audio.countTick(0);
    ui.showBanner('<span class="icon">🚀</span>スタート!', 700);

    // プレイ開始
    ui.setMinigameMode(true);
    ui.showTimer(true);
    ui.showScore(true);
    ui.showTapLayer(true);
    this.timeLeft = CONFIG.MINIGAME_TIME;
    this.running = true;

    await new Promise((res) => { this._finishResolver = res; });

    // おしまい
    this.running = false;
    ui.setMinigameMode(false);
    ui.showTimer(false);
    ui.showTapLayer(false);
    audio.stopBgm();
    audio.yay();
    await ui.showBanner('<span class="icon">🎊</span>おしまーい!', 1400);
    ui.showScore(false);

    game.onFinish();

    // 順位づけ(同点はプレイヤーに甘く)
    const result = chars.map((c, i) => ({ charIndex: i, score: game.scores[i] }))
      .sort((a, b) => (b.score - a.score) ||
        (a.charIndex === playerIndex ? -1 : b.charIndex === playerIndex ? 1 : 0));

    // みんなのスコア発表
    const medals = ['🥇', '🥈', '🥉', '🎀'];
    const rows = result.map((r, i) => {
      const c = chars[r.charIndex];
      return `<span class="sub">${medals[i]} ${c.def.emoji} ${c.def.name} … ${r.score}</span>`;
    }).join('');
    await ui.showBanner(`<span class="icon">📣</span>けっか!${rows}`, 2600);

    // あとかたづけ(キャラを島へ返してからシーンを破棄する)
    this._restoreChars();
    this.active = null;
    game.dispose();

    return result;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.active;
    g.fx.update(dt);
    if (!this.running) return;
    g.update(dt);
    this.timeLeft -= dt;
    this.ctx.ui.setTimer(this.timeLeft / CONFIG.MINIGAME_TIME);
    if ((this.timeLeft <= 0 || g.done) && this._finishResolver) {
      const r = this._finishResolver;
      this._finishResolver = null;
      r();
    }
  }

  pointerDown(ndc, px) {
    if (this.running && this.active) this.active.pointerDown(ndc, px);
  }

  pointerMove(ndc, px) {
    if (this.running && this.active) this.active.pointerMove(ndc, px);
  }

  resize(aspect) {
    if (!this.active) return;
    this.active.camera.aspect = aspect;
    this.active.camera.updateProjectionMatrix();
    this.active.fitCamera(aspect);
  }
}
