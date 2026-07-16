// ================================================================
// UI — HTMLオーバーレイの画面遷移・フィードバック表示・記録の保存
// ================================================================

import { RESULT_TEXT } from './config.js';

const STORE_KEY = 'srp-best-stars';

export class UI {
  constructor() {
    this.screens = {
      boot: document.getElementById('screen-boot'),
      menu: document.getElementById('screen-menu'),
      game: document.getElementById('screen-game'),
      result: document.getElementById('screen-result'),
    };
    this.cueBanner = document.getElementById('cue-banner');
    this.feedbackEl = document.getElementById('feedback');
    this.hudStars = document.getElementById('hud-stars');
    this.tapHint = document.getElementById('tap-hint');
    this.flashEl = document.getElementById('flash');
    this.menuStars = document.getElementById('menu-stars');
    this._bannerTimer = 0;

    try {
      this.best = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    } catch { this.best = {}; }
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) {
      el.classList.toggle('show', k === name);
    }
    if (name === 'menu') this._renderMenuStars();
  }

  /* ---- 大きな合図テキスト ---- */
  banner(html, dur = 2000) {
    clearTimeout(this._bannerTimer);
    this.cueBanner.innerHTML = html;
    this.cueBanner.classList.add('show');
    this._bannerTimer = setTimeout(() => this.cueBanner.classList.remove('show'), dur);
  }

  /* ---- タップ判定のフィードバック ---- */
  feedback(text, cls) {
    const el = this.feedbackEl;
    el.textContent = text;
    el.className = 'feedback';
    void el.offsetWidth; // アニメーション再スタート
    el.classList.add('pop', cls);
  }

  flash() {
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }

  setHudStars(n) {
    const show = Math.min(n, 24);
    this.hudStars.textContent = '★'.repeat(show) + (n > show ? '+' : '');
  }

  showTapHint(on) {
    this.tapHint.classList.toggle('show', on);
  }

  /* ---- リザルト ---- */
  showResult(gameKey, result, { onAgain, onMenu, audio }) {
    const { stars } = result;
    const txt = RESULT_TEXT[stars];
    document.getElementById('result-title').textContent = txt.title;
    document.getElementById('result-msg').textContent = txt.msg;

    // ベスト更新
    if ((this.best[gameKey] || 0) < stars) {
      this.best[gameKey] = stars;
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.best)); } catch {}
    }

    const starEls = [...document.querySelectorAll('#result-stars .rstar')];
    starEls.forEach((el) => { el.className = 'rstar'; });
    this.show('result');

    // 星がひとつずつ「ぽん・ぽん・ぽん」と出る
    starEls.forEach((el, i) => {
      setTimeout(() => {
        if (i < stars) {
          el.classList.add('on', 'bounce');
          audio?.sparkle();
        } else {
          el.classList.add('dim');
        }
      }, 500 + i * 450);
    });

    document.getElementById('btn-again').onclick = onAgain;
    document.getElementById('btn-menu').onclick = onMenu;
  }

  _renderMenuStars() {
    const total = (this.best.mochi || 0) + (this.best.catch || 0) + (this.best.jump || 0);
    this.menuStars.textContent = total > 0 ? '★'.repeat(total) : '';
  }
}
