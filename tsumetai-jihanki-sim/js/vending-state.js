/* ============================================================
   vending-state.js — 自販機の頭脳 (状態機械)
   THREE 非依存。CoinMech と Rack を束ね、
   credit / 販売シーケンス / 釣銭 / 売切 / 釣銭切れ / 売上 を管理。

   客モード:
     IDLE → (硬貨受理) CREDITED → (ボタン) VENDING → CHANGE_PAYOUT → IDLE
     返却レバー: いつでも credit 全額を払出し
   店員モード:
     扉開 → {商品補充 / 釣銭補充 / 売上回収} → 扉閉
   ============================================================ */
import { PRICES, PRODUCTS, COLUMNS, WALLET_INIT, DENOMS } from './config.js';

export class VendingState {
  /**
   * emit イベント (UI/音向け):
   * 'credit' {credit}          金額表示の更新
   * 'lamps' {}                 ボタンランプ/売切/釣銭切れの再評価
   * 'vending' {col}            販売開始
   * 'vendComplete' {col}       販売終了 (商品はシュートへ)
   * 'changeStart' {amount}     釣銭払出し開始
   * 'changeDone' {}
   * 'refund' {amount}
   * 'walletChange' {}
   * 'sale' {col, price}
   * 'doorState' {open}
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
    this.sales = 0;               // 累計売上 (円)
    this.salesSinceCollect = 0;
    this.doorOpen = false;
    this.operator = false;
    this.leverHeld = false;
  }

  /* ---------------- メックからのイベントを接続 ---------------- */
  onMechEvent(type, data) {
    if (type === 'accept') {
      this.credit += data.denom;
      this.emit('credit', { credit: this.credit });
      this.emit('lamps', {});
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
        // 釣銭の払出しへ
        if (this.pendingChange > 0) {
          const plan = this.mech.changePlan(this.pendingChange);
          this.phase = 'change';
          this.emit('changeStart', { amount: this.pendingChange });
          this.mech.payout(plan ?? {});   // plan が null になるのは理論上ない (押下時に検証済)
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
        // 販売検知できず → 実機同様に全額返金
        const price = PRICES[COLUMNS[data.col].product];
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

  /** 財布から硬貨を投入できるか */
  canInsert(denom) {
    return !this.operator && this.wallet[denom] > 0;
  }

  /** 硬貨投入 (財布から減らして物理へ) */
  insert(denom) {
    if (!this.canInsert(denom)) return false;
    this.wallet[denom]--;
    this.mech.insertCoin(denom);
    this.emit('walletChange', {});
    return true;
  }

  /** ボタンが押せる状態か */
  buttonEnabled(col) {
    if (this.operator || this.phase !== 'idle') return false;
    if (this.rack.soldOut(col)) return false;
    const price = PRICES[COLUMNS[col].product];
    if (this.credit < price) return false;
    // 釣銭が払えない取引は成立させない (実機と同じ)
    return this.mech.changePlan(this.credit - price) !== null;
  }

  /** 商品ボタン押下 */
  pressButton(col) {
    if (!this.buttonEnabled(col)) return false;
    const price = PRICES[COLUMNS[col].product];
    this.pendingChange = this.credit - price;
    this.pendingCol = col;
    this.credit = 0;
    this.phase = 'vending';
    this.sales += price;
    this.salesSinceCollect += price;
    this.rack.vend(col);
    this.emit('credit', { credit: 0 });
    this.emit('vending', { col });
    this.emit('sale', { col, price });
    this.emit('lamps', {});
    return true;
  }

  /** 返却レバー: 押下で credit を全額払出し + ゲート開放 */
  pullLever() {
    this.leverHeld = true;
    this.mech.setReturnLever(true);
    if (this.phase === 'idle' && this.credit > 0) {
      const amount = this.credit;
      const plan = this.mech.changePlan(amount);
      if (plan) {
        this.credit = 0;
        this.phase = 'change';
        this.emit('credit', { credit: 0 });
        this.emit('refund', { amount });
        this.mech.payout(plan);
        this.emit('lamps', {});
      }
      // 釣銭不足で返せない場合は credit を保持 (実機では起きにくいレアケース)
    }
  }

  releaseLever() {
    this.leverHeld = false;
    this.mech.setReturnLever(false);
  }

  /** 返却口をタップ → カップの硬貨を財布へ */
  scoopCup() {
    const got = this.mech.collectCup();
    for (const d of got) this.wallet[d]++;
    if (got.length > 0) this.emit('walletChange', {});
    return got;
  }

  /** 取出口をタップ → 商品を取る */
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

  /** 商品補充 */
  restock(col) {
    if (!this.operator) return -1;
    return this.rack.restock(col);
  }

  /** 釣銭補充 (財布からではなく業務用コインケースから) */
  refillTube(denom, count = 5) {
    if (!this.operator) return 0;
    const n = this.mech.refillTube(denom, count);
    if (n > 0) this.emit('lamps', {});
    return n;
  }

  /** 売上回収 */
  collectCash() {
    if (!this.operator) return null;
    const got = this.mech.collectCash();
    const total = DENOMS.reduce((s, d) => s + d * got[d], 0);
    this.salesSinceCollect = 0;
    return { coins: got, total };
  }

  /* ---------------- 表示状態 ---------------- */

  /** 釣銭切れランプ (最安商品を500円で買う釣銭が出せない) */
  changeShortage() {
    const minPrice = Math.min(...PRODUCTS.map(p => p.price));
    return this.mech.changeShortage(minPrice);
  }

  lampState(col) {
    if (this.rack.soldOut(col)) return 'soldout';
    if (this.buttonEnabled(col)) return 'ready';
    return 'off';
  }

  walletTotal() {
    return DENOMS.reduce((s, d) => s + d * this.wallet[d], 0);
  }
}
