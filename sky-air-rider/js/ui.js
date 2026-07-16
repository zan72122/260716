/* ============================================================
   ui.js — HUD・タイトル・メッセージ演出
   ============================================================ */
export class UI {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.hud = this.$('hud');
    this.title = this.$('title-screen');
    this.starCount = this.$('star-count');
    this.lapCount = this.$('lap-count');
    this.chargeBar = this.$('charge-bar');
    this.chargeFill = this.$('charge-fill');
    this.chargeLabel = this.$('charge-label');
    this.toast = this.$('toast');
    this.bigMsg = this.$('big-msg');
    this.muteBtn = this.$('mute-btn');
    this._labelTimer = 0;
  }

  showGame() {
    this.title.classList.add('fade-out');
    this.hud.classList.remove('hidden');
  }

  setStars(n) {
    this.starCount.textContent = n;
    const chip = this.starCount.parentElement;
    chip.classList.remove('pop');
    void chip.offsetWidth;
    chip.classList.add('pop');
  }
  setLap(n) { this.lapCount.textContent = n; }

  setCharge(c) {
    this.chargeFill.style.width = `${Math.round(c * 100)}%`;
    this.chargeBar.classList.toggle('full', c >= 0.999);
    if (c > 0.05) {
      this.chargeLabel.textContent = c >= 0.999 ? 'はなして!' : 'ためてる…';
    } else {
      this.chargeLabel.textContent = 'ながおしで ためる!';
    }
  }

  /** ちいさなほめことば */
  pop(text) {
    this.toast.textContent = text;
    this.toast.classList.remove('pop');
    void this.toast.offsetWidth; // アニメ再始動
    this.toast.classList.add('pop');
  }

  /** おおきなメッセージ (1しゅう!など) */
  big(text) {
    this.bigMsg.textContent = text;
    this.bigMsg.classList.remove('hidden', 'show');
    void this.bigMsg.offsetWidth;
    this.bigMsg.classList.add('show');
  }

  setMuted(m) {
    this.muteBtn.textContent = m ? '🔇' : '🔊';
  }
}
