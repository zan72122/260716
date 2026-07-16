// DOM 側の UI(HUD・バナー・タイマー・スコア表示)をまとめて管理する。
// 4歳児向けなので文字は最小限、アイコンと数字と音で伝える。

import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.hud = $('hud');
    this.roundPips = $('round-pips');
    this.playerStrip = $('player-strip');
    this.diceBtn = $('btn-dice');
    this.banner = $('banner');
    this.bannerInner = $('banner-inner');
    this.timerWrap = $('timer-wrap');
    this.timerBar = $('timer-bar');
    this.mgScore = $('mg-score');
    this.tapLayer = $('tap-layer');
    this.cards = new Map();
  }

  showHud(show = true) { this.hud.classList.toggle('hidden', !show); }

  buildRoundPips(rounds) {
    this.roundPips.innerHTML = '';
    for (let i = 0; i < rounds; i++) {
      const s = document.createElement('span');
      s.className = 'pip';
      s.textContent = '⭐';
      this.roundPips.appendChild(s);
    }
  }

  setRound(n) {
    [...this.roundPips.children].forEach((p, i) => p.classList.toggle('on', i < n));
  }

  buildPlayerStrip(chars) {
    this.playerStrip.innerHTML = '';
    this.cards.clear();
    chars.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'pcard' + (c.isPlayer ? ' me' : '');
      card.innerHTML = `
        <div class="face" style="background:${c.def.ui}">${c.def.emoji}</div>
        <div class="counts">
          <span class="stars">⭐0</span>
          <span class="coins">🪙0</span>
        </div>`;
      this.playerStrip.appendChild(card);
      this.cards.set(c.def.id, card);
    });
  }

  updatePlayer(c) {
    const card = this.cards.get(c.def.id);
    if (!card) return;
    card.querySelector('.stars').textContent = `⭐${c.stars}`;
    card.querySelector('.coins').textContent = `🪙${c.coins}`;
  }

  setActivePlayer(id) {
    this.cards.forEach((card, cid) => card.classList.toggle('active', cid === id));
  }

  showDice(show, face = '🎲') {
    this.diceBtn.classList.toggle('hidden', !show);
    this.diceBtn.querySelector('.dice-face').textContent = face;
  }

  // 大きな中央バナー。durationMs 後に自動で消える Promise を返す
  showBanner(html, durationMs = 1600) {
    this.bannerInner.innerHTML = html;
    this.banner.classList.remove('hidden', 'out');
    return new Promise((res) => {
      setTimeout(() => {
        this.banner.classList.add('out');
        setTimeout(() => {
          this.banner.classList.add('hidden');
          res();
        }, 300);
      }, durationMs);
    });
  }

  showTimer(show) { this.timerWrap.classList.toggle('hidden', !show); }
  setTimer(ratio) { this.timerBar.style.width = `${Math.max(0, ratio * 100)}%`; }

  showScore(show) {
    this.mgScore.classList.toggle('hidden', !show);
    if (show) this.mgScore.textContent = '0';
  }
  setScore(n) {
    this.mgScore.textContent = String(n);
    this.mgScore.classList.remove('pop');
    void this.mgScore.offsetWidth; // アニメ再トリガー
    this.mgScore.classList.add('pop');
  }

  showTapLayer(show) { this.tapLayer.classList.toggle('hidden', !show); }

  setMinigameMode(on) { this.hud.classList.toggle('mg-mode', on); }

  // 画面座標に絵文字をぽんっと出す
  emojiBurst(x, y, emoji = '✨') {
    const el = document.createElement('div');
    el.className = 'fx-emoji';
    el.textContent = emoji;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.getElementById('app').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}
