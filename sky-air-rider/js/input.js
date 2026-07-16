/* ============================================================
   input.js — 4歳児向けのやさしい入力
   ・画面の左右をさわる → その方向にまがる (アナログ)
   ・どこでも長おし → チャージ / はなすと ブースト
   ・キーボード: ←→ = まがる, スペース = チャージ
   こどもは複数の指で同時にさわるので、いちばん新しい指に
   ハンドルを持ちかえる (チャージは途切れさせない)。
   ============================================================ */
const GAME_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];

export class Input {
  constructor(el, onTouchStart) {
    this.el = el;
    this.enabled = false;    // タイトル中は無効 (ボタンのclickを妨げない)
    this.steer = 0;          // -1..1 (正 = 画面右へ)
    this.holding = false;
    this.holdTime = 0;
    this.releasedCharge = 0; // 離した瞬間のチャージ量 (mainが消費)
    this._pointerId = null;
    this._touchSteer = 0;
    this._keys = new Set();
    this._onTouchStart = onTouchStart;

    el.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
    el.addEventListener('pointermove', (e) => this._move(e), { passive: false });
    el.addEventListener('pointerup', (e) => this._up(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this._up(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if (GAME_KEYS.includes(e.code)) e.preventDefault(); // 画面スクロール等を防ぐ
      if (e.repeat || !this.enabled) return;
      this._keys.add(e.code);
      if (e.code === 'Space' && !this.holding) { this.holding = true; this.holdTime = 0; }
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'Space') this._release();
    });
    window.addEventListener('blur', () => {
      // タブ切替などでは ためた分を捨てる (復帰時の不意なブーストを防ぐ)
      this._keys.clear();
      this._pointerId = null;
      this.holding = false;
      this.holdTime = 0;
      this.releasedCharge = 0;
      this._touchSteer = 0;
    });
    // iOSのダブルタップズーム・ピンチ・長押しメニューを防止
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  _down(e) {
    if (!this.enabled) return; // タイトル中: ボタン操作を妨げない
    e.preventDefault();
    const transferring = this.holding && this._pointerId !== null;
    this._pointerId = e.pointerId; // つねに新しい指を採用
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境は無視 */ }
    if (!transferring) {
      this.holding = true;
      this.holdTime = 0;
    }
    this._updateSteer(e);
    if (this._onTouchStart) this._onTouchStart(e.clientX, e.clientY);
  }

  _move(e) {
    if (e.pointerId !== this._pointerId) return;
    this._updateSteer(e);
  }

  _up(e) {
    if (e.pointerId !== this._pointerId) return;
    this._pointerId = null;
    this._release();
  }

  _release() {
    if (!this.holding) return;
    this.holding = false;
    this.releasedCharge = this.holdTime;
    this.holdTime = 0;
    this._touchSteer = 0;
  }

  _updateSteer(e) {
    const w = window.innerWidth;
    // 画面中央からの横位置 → ハンドル (端で最大 / 正 = 右)
    const nx = (e.clientX / w) * 2 - 1;
    this._touchSteer = Math.max(-1, Math.min(1, nx * 1.5));
  }

  /** 毎フレーム呼ぶ。dt秒。 */
  update(dt) {
    let s = 0;
    if (this._pointerId !== null) s = this._touchSteer;
    if (this._keys.has('ArrowLeft') || this._keys.has('KeyA')) s -= 1;
    if (this._keys.has('ArrowRight') || this._keys.has('KeyD')) s += 1;
    s = Math.max(-1, Math.min(1, s));
    // なめらかに追従
    const k = 1 - Math.exp(-dt * 10);
    this.steer += (s - this.steer) * k;
    if (this.holding) this.holdTime += dt;
  }

  /** 離した瞬間のチャージ秒数を取り出す (1回だけ) */
  consumeRelease() {
    const c = this.releasedCharge;
    this.releasedCharge = 0;
    return c;
  }
}
