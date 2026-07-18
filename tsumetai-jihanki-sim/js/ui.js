/* ============================================================
   ui.js — DOM HUD (財布 / クレジット / モード / 時間操作 / トースト)
   ============================================================ */
import { DENOMS } from './config.js';

export class UI {
  constructor(handlers) {
    this.h = handlers;   // {onInsert, onTimeScale, onXray, onOperator, onMute}
    this.hud = document.getElementById('hud');
    this.creditVal = document.getElementById('credit-val');
    this.toastEl = document.getElementById('toast');
    this.walletTotal = document.getElementById('wallet-total');
    this.opPanel = document.getElementById('op-panel');
    this.opHint = document.getElementById('op-hint');
    this.opSales = document.getElementById('op-sales');
    this.xrayBtn = document.getElementById('xray-btn');
    this.opBtn = document.getElementById('op-btn');
    this.muteBtn = document.getElementById('mute-btn');
    this.gameEl = document.getElementById('game');

    this.coinChips = {};
    for (const chip of document.querySelectorAll('.coin-chip')) {
      const denom = chip.dataset.denom === 'bill' ? 'bill' : Number(chip.dataset.denom);
      this.coinChips[denom] = chip;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.onInsert(denom);
      });
      chip.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    for (const btn of document.querySelectorAll('#time-ctrl button')) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.h.onTimeScale(Number(btn.dataset.scale));
      });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    const hookBtn = (el, fn) => {
      el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    };
    hookBtn(this.xrayBtn, () => this.h.onXray());
    hookBtn(this.opBtn, () => this.h.onOperator());
    hookBtn(this.muteBtn, () => this.h.onMute());
  }

  showGame() {
    document.getElementById('title-screen').classList.add('fade-out');
    this.hud.classList.remove('hidden');
  }

  setCredit(v) {
    this.creditVal.textContent = String(v);
  }

  setWallet(wallet, canInsert) {
    let total = 0;
    for (const denom of DENOMS) {
      const chip = this.coinChips[denom];
      chip.querySelector('.coin-count').textContent = wallet[denom];
      chip.disabled = !canInsert(denom);
      total += denom * wallet[denom];
    }
    const billChip = this.coinChips.bill;
    if (billChip) {
      billChip.querySelector('.coin-count').textContent = wallet.bill;
      billChip.disabled = !canInsert('bill');
      total += wallet.bill * 1000;
    }
    this.walletTotal.textContent = `${total}円`;
  }

  flashCoin(denom) {
    const chip = this.coinChips[denom];
    chip.classList.remove('flash');
    void chip.offsetWidth;
    chip.classList.add('flash');
  }

  setTimeScale(s) {
    for (const btn of document.querySelectorAll('#time-ctrl button')) {
      btn.classList.toggle('active', Number(btn.dataset.scale) === s);
    }
    this.gameEl.classList.toggle('slowmo', s > 0 && s < 1);
  }

  setXray(on) { this.xrayBtn.classList.toggle('active', on); }
  setOperator(on) {
    this.opBtn.classList.toggle('active', on);
    this.opPanel.classList.toggle('hidden', !on);
  }
  setMuted(m) { this.muteBtn.textContent = m ? '🔇' : '🔊'; }

  setOpHint(text) { this.opHint.textContent = text; }
  setOpSales(text) { this.opSales.textContent = text; }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('pop');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('pop');
  }
}
