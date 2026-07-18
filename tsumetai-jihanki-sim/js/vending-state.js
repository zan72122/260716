/* ============================================================
   vending-state.js — 自販機の頭脳 (状態機械)
   THREE 非依存。CoinMech(+BillValidator) と Rack を束ねる。
   36押ボタン → SELECTIONS → 30コラム の解決、
   credit / エスクロー確定・現物返却 / 釣銭 / 売切 / 釣銭切れ /
   お札中止 / 売上を管理。
   ============================================================ */
import { PRODUCTS, COLUMNS, SELECTIONS, WALLET_INIT, DENOMS } from './config.js';

export class VendingState {
  /**
   * emit イベント:
   * 'credit' {credit} / 'lamps' {} / 'vending' {col} / 'vendComplete' {col}
   * 'changeStart' {amount} / 'changeDone' {} / 'refund' {amount}
   * 'vendFailed' {col, amount} / 'walletChange' {} / 'sale' {sel, price}
   * 'doorState' {open} / 'billTaken' {} / 'billBack' {}
   */
  constructor(mech, rack, emit) {
    this.mech = mech;
    this.rack = rack;
    this.emit = emit;
    this.credit = 0;
    this.phase = 'idle';          // idle | vending | change
    this.pendingChange = 0;
    this.pendingCol = -1;
    this.wallet = { ...WALLET_INIT };
    this.sales = 0;
    this.salesSinceCollect = 0;
    this.doorOpen = false;
    this.operator = false;
    this.leverHeld = false;
  }

  /* ---------------- メック/ラックのイベント接続 ---------------- */
  onMechEvent(type, data) {
    if (type === 'accept') {
      this.credit += data.denom;
      this.emit('credit', { credit: this.credit });
      this.emit('lamps', {});
    } else if (type === 'billAccept') {
      this.credit += 1000;
      this.emit('credit', { credit: this.credit });
      this.emit('lamps', {});
    } else if (type === 'billRejected') {
      // 吐き出された札は財布に戻る
      this.wallet.bill++;
      this.emit('billBack', {});
      this.emit('walletChange', {});
    } else if (type === 'payoutDone') {
      if (this.phase === 'change') {
        this.phase = 'idle';
        this.emit('changeDone', {});
        this.emit('lamps', {});
      }
    }
  }

  onRackEvent(type, data) {
    if (type === 'vendDone') {
      if (this.phase === 'vending' && data.col === this.pendingCol) {
        this.emit('vendComplete', { col: data.col });
        if (this.pendingChange > 0) {
          const plan = this.mech.changePlan(this.pendingChange);
          this.phase = 'change';
          this.emit('changeStart', { amount: this.pendingChange });
          this.mech.payout(plan ?? {});
        } else {
          this.phase = 'idle';
        }
        this.pendingChange = 0;
        this.pendingCol = -1;
        this.emit('lamps', {});
      }
    } else if (type === 'soldOut') {
      this.emit('lamps', {});
    } else if (type === 'vendFail') {
      if (this.phase === 'vending' && data.col === this.pendingCol) {
        const price = PRODUCTS[COLUMNS[data.col].product].price;
        const amount = price + this.pendingChange;
        this.sales -= price;
        this.salesSinceCollect -= price;
        this.pendingChange = 0;
        this.pendingCol = -1;
        const plan = this.mech.changePlan(amount);
        this.phase = 'change';
        this.emit('vendFailed', { col: data.col, amount });
        this.mech.payout(plan ?? {});
        this.emit('lamps', {});
      }
    }
  }

  /* ---------------- 客の操作 ---------------- */

  canInsert(denom) {
    return !this.operator && this.wallet[denom] > 0;
  }

  insert(denom) {
    if (!this.canInsert(denom)) return false;
    this.wallet[denom]--;
    this.mech.insertCoin(denom);
    this.emit('walletChange', {});
    return true;
  }

  /** 千円札の挿入 */
  insertBill() {
    if (this.operator || this.wallet.bill <= 0) return false;
    if (!this.mech.bill.insert()) return false;
    this.wallet.bill--;
    this.emit('billTaken', {});
    this.emit('walletChange', {});
    return true;
  }

  /** セレクション (押ボタン 0..35) が押せる状態か */
  buttonEnabled(sel) {
    if (this.operator || this.phase !== 'idle') return false;
    const col = SELECTIONS[sel].column;
    if (this.rack.soldOut(col)) return false;
    const price = PRODUCTS[COLUMNS[col].product].price;
    if (this.credit < price) return false;
    return this.mech.changePlan(this.credit - price) !== null;
  }

  /** 押ボタン押下 (sel = 0..35) */
  pressButton(sel) {
    if (!this.buttonEnabled(sel)) return false;
    const col = SELECTIONS[sel].column;
    const price = PRODUCTS[COLUMNS[col].product].price;
    this.pendingChange = this.credit - price;
    this.pendingCol = col;
    this.credit = 0;
    this.phase = 'vending';
    this.sales += price;
    this.salesSinceCollect += price;
    this.mech.commitEscrow();          // 保留硬貨をチューブ/金庫へ
    this.rack.vend(col);
    this.emit('credit', { credit: 0 });
    this.emit('vending', { col });
    this.emit('sale', { sel, price });
    this.emit('lamps', {});
    return true;
  }

  /** 返却レバー: エスクロー現物返却 + 残額をチューブから払出し */
  pullLever() {
    this.leverHeld = true;
    const ev = this.mech.escrowValue();
    this.mech.setReturnLever(true);    // ゲート開 + エスクロー現物返却
    if (this.phase === 'idle' && this.credit > 0) {
      const rest = this.credit - ev;   // 保留分は現物で返るので差し引く
      this.credit = 0;
      this.emit('credit', { credit: 0 });
      this.emit('refund', { amount: ev + Math.max(0, rest) });
      if (rest > 0) {
        const plan = this.mech.changePlan(rest);
        if (plan) {
          this.phase = 'change';
          this.mech.payout(plan);
        }
        // 釣銭不足で払えないレアケースは実機同様あきらめる (creditは消える)
      }
      this.emit('lamps', {});
    }
  }

  releaseLever() {
    this.leverHeld = false;
    this.mech.setReturnLever(false);
  }

  scoopCup() {
    const got = this.mech.collectCup();
    for (const d of got) this.wallet[d]++;
    if (got.length > 0) this.emit('walletChange', {});
    return got;
  }

  takeProduct() {
    return this.rack.take();
  }

  /* ---------------- 店員の操作 ---------------- */

  setOperator(on) {
    this.operator = on;
    this.emit('lamps', {});
  }

  setDoor(open) {
    this.doorOpen = open;
    this.emit('doorState', { open });
  }

  /** 商品補充: 室(0-2) × 段(0=上,1=下) のトレーへ投入 */
  restock(chamber, stage) {
    if (!this.operator) return null;
    return this.rack.restock(chamber, stage);
  }

  refillTube(denom, count = 5) {
    if (!this.operator) return 0;
    const n = this.mech.refillTube(denom, count);
    if (n > 0) this.emit('lamps', {});
    return n;
  }

  /** 売上回収 (硬貨金庫 + 紙幣スタッカー) */
  collectCash() {
    if (!this.operator) return null;
    const got = this.mech.collectCash();
    const bills = this.mech.bill.collect();
    const total = DENOMS.reduce((s, d) => s + d * got[d], 0) + bills * 1000;
    this.salesSinceCollect = 0;
    return { coins: got, bills, total };
  }

  /* ---------------- 表示状態 ---------------- */

  changeShortage() {
    const minPrice = Math.min(...PRODUCTS.map(p => p.price));
    return this.mech.changeShortage(minPrice);
  }

  billStop() {
    return this.mech.bill.billStop;
  }

  lampState(sel) {
    const col = SELECTIONS[sel].column;
    if (this.rack.soldOut(col)) return 'soldout';
    if (this.buttonEnabled(sel)) return 'ready';
    return 'off';
  }

  selectionPrice(sel) {
    return PRODUCTS[COLUMNS[SELECTIONS[sel].column].product].price;
  }

  selectionProduct(sel) {
    return PRODUCTS[COLUMNS[SELECTIONS[sel].column].product];
  }

  walletTotal() {
    return DENOMS.reduce((s, d) => s + d * this.wallet[d], 0) + this.wallet.bill * 1000;
  }
}
