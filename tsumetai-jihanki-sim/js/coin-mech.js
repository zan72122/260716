/* ============================================================
   coin-mech.js — コインメック + 紙幣識別機 (実機準拠)
   経路:
   投入口 → 漏斗 → 返却ゲート → 傾斜選別レール (径ゲート)
     ├ 10/50円: 検銭 → (満杯なら金庫) → 釣銭チューブ
     └ 100/500円: 検銭 → 保留シャッター上に一時保留 (エスクロー)
          ├ 購入確定: シャッター開 → チューブ / 金庫
          └ 返却レバー: 返却振分 → 投入した現物がカップへ戻る
   紙幣 (千円): 搬送 → 判定 → 受理でスタッカーへ / 釣銭不足なら
   「お札中止」で受付停止 (実機の釣銭13枚ルール)
   THREE 非依存。
   ============================================================ */
import { Disc, Seg, Sensor } from './physics.js';
import {
  COINS, DENOMS, ESCROW_DENOMS, MECH, GATES, RAIL_END_X, CH500_CX,
  TUBES, TUBE_TOP, TUBE_BOTTOM, TUBE_INIT, TUBE_CAP, BILL, PRODUCTS,
} from './config.js';

export const LAYER_MECH = 'mech';
export const LAYER_MECH_BACK = 'mechBack';
export const LAYER_ESCROW_RET = 'mechEscrowRet';

export class CoinMech {
  /**
   * emit イベント (従来 + 追加):
   * 'accept' {denom, escrowed} / 'coinSpawn' / 'coinRemove' / 'tubeIn' /
   * 'divert' / 'cashIn' / 'payoutCoin' / 'payoutDone' / 'gate'
   * 'escrowCommit' {} / 'escrowReturn' {} (シャッター動作音向け)
   */
  constructor(world, emit) {
    this.world = world;
    this.emit = emit;
    this.tubes = { ...TUBE_INIT };
    this.cashBox = { 10: 0, 50: 0, 100: 0, 500: 0 };
    this.escrow = [];                 // 保留中 {denom, body}
    this.returning = false;
    this.payoutQueue = [];
    this.payoutTimer = 0;
    this.shutterTimer = 0;            // シャッター開放の残り時間
    this.returnSensorTimer = 0;
    this.stuckTimers = new Map();
    this._build();
  }

  /* ---------------- コライダ構築 ---------------- */
  _build() {
    const W = this.world;
    const L = LAYER_MECH;
    const add = (a, b, o = {}) => W.addSeg(new Seg({ layer: L, a, b, material: 'steel', ...o }));

    for (const [a, b] of MECH.entryFunnel) add(a, b);

    // 返却ゲート
    this.gateSeg = add([0, 0], [0, 0], { material: 'gate' });
    this.gateAngle = GATE_ACCEPT;
    this.gateTarget = GATE_ACCEPT;
    this._updateGateSeg();

    // ---- 選別レール (径ゲートで分割) ----
    const railY = MECH.railY;
    const cuts = [];
    let xs = MECH.RAIL_X0;
    for (const g of GATES) {
      const gapHalf = g.passD / 2 + 0.003;
      cuts.push([xs, g.cx + gapHalf]);
      W.addSeg(new Seg({
        layer: L,
        a: [g.cx + gapHalf, railY(g.cx + gapHalf)],
        b: [g.cx - gapHalf, railY(g.cx - gapHalf)],
        material: 'rail', friction: 0.28,
        filter: (body) => body.userData.coin && body.userData.coin.d >= g.passD,
        tag: `bridge-${g.denom}`,
      }));
      // 捕捉ガイド (落ちる硬貨のみに作用する高い左壁)
      const gx = g.cx - COINS[g.denom].d / 2 - 0.0042;
      W.addSeg(new Seg({
        layer: L,
        a: [gx, railY(gx) + 0.028], b: [gx, MECH.sensorY],
        material: 'channel', restitution: 0.1,
        filter: (body) => body.userData.coin && body.userData.coin.d < g.passD,
        tag: `catch-${g.denom}`,
      }));
      xs = g.cx - gapHalf;
    }
    cuts.push([xs, RAIL_END_X]);
    for (const [x0, x1] of cuts) {
      add([x0, railY(x0)], [x1, railY(x1)], { material: 'rail', friction: 0.28 });
    }
    // 天井ガイド
    add([MECH.RAIL_X0 - 0.009, railY(MECH.RAIL_X0 - 0.009) + 0.033],
        [CH500_CX - 0.014, railY(RAIL_END_X) + 0.031],
        { material: 'rail', restitution: 0.05 });

    // ---- 金種チャンネル ----
    this.channels = {};
    const chDef = [
      ...GATES.map(g => ({ denom: g.denom, cx: g.cx })),
      { denom: 500, cx: CH500_CX },
    ];
    for (const { denom, cx } of chDef) {
      const half = COINS[denom].d / 2 + 0.0042;
      const topY = railY(cx) - 0.006;
      add([cx - half, topY], [cx - half, MECH.tubeMouthY + 0.002], { material: 'channel', restitution: 0.12 });
      add([cx + half, topY], [cx + half, MECH.tubeMouthY + 0.002], { material: 'channel', restitution: 0.12 });
      this.channels[denom] = { cx, half };

      // 検銭センサー
      W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.sensorY], b: [cx + half, MECH.sensorY],
        tag: `accept-${denom}`,
        cb: (body) => this._onAccept(denom, body),
      }));

      // エスクロー (100/500のみ): 保留シャッター + 返却振分センサー
      if (ESCROW_DENOMS.includes(denom)) {
        const shutter = add(
          [cx - half + 0.001, MECH.escrowY], [cx + half - 0.001, MECH.escrowY],
          { material: 'shutter', friction: 0.5, restitution: 0.05 }
        );
        this.channels[denom].shutter = shutter;
        const retSensor = W.addSensor(new Sensor({
          layer: L,
          a: [cx - half, MECH.escrowReturnY], b: [cx + half, MECH.escrowReturnY],
          tag: `escrowret-${denom}`,
          cb: (body) => this._onEscrowReturn(denom, body),
        }));
        retSensor.enabled = false;
        this.channels[denom].retSensor = retSensor;
      }

      // 金庫振分センサー (チューブ満杯時のみ有効化)
      const divertSensor = W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.flipperY], b: [cx + half, MECH.flipperY],
        tag: `divert-${denom}`,
        cb: (body) => this._onDivert(denom, body),
      }));
      divertSensor.enabled = false;
      this.channels[denom].divertSensor = divertSensor;

      // チューブ入口センサー
      W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.tubeMouthY], b: [cx + half, MECH.tubeMouthY],
        tag: `tube-${denom}`,
        cb: (body) => this._onTubeIn(denom, body),
      }));
    }
    // 500円チャンネル誘導壁
    add([CH500_CX - COINS[500].d / 2 - 0.0042, railY(RAIL_END_X) + 0.042],
        [CH500_CX - COINS[500].d / 2 - 0.0042, railY(RAIL_END_X) - 0.01],
        { material: 'channel' });

    // ---- 返却レーン (ゲート開時の素通り) ----
    const [lx, rx] = MECH.returnLaneX;
    add([lx, 1.212], [lx, 1.15], { material: 'steel' });
    add([rx, 1.31], [rx, MECH.cup.top], { material: 'steel' });

    // ---- 返却口カップ ----
    const cup = MECH.cup;
    add([cup.left, cup.floor + 0.046], [cup.left, cup.floor], { material: 'plastic', restitution: 0.15 });
    add([cup.left, cup.floor], [cup.right, cup.floor], { material: 'plastic', restitution: 0.15, friction: 0.5 });
    add([cup.right, cup.floor], [cup.right, cup.top], { material: 'plastic', restitution: 0.15 });

    // ---- 払出しシュート ----
    const pc = MECH.payoutChute;
    add(pc.a, pc.b, { material: 'steel', friction: 0.2 });
    add(pc.b, [cup.left, cup.floor + 0.046], { material: 'steel', friction: 0.2 });

    // ---- エスクロー返却シュート (専用層) ----
    const ec = MECH.escrowChute;
    W.addSeg(new Seg({ layer: LAYER_ESCROW_RET, a: ec.a, b: ec.b, material: 'steel', friction: 0.2 }));
    // 落とし込み壁: シュート終端との隙間は硬貨径より広く取る
    W.addSeg(new Seg({
      layer: LAYER_ESCROW_RET,
      a: [MECH.cup.right, ec.b[1] + 0.07], b: [MECH.cup.right, 0.535],
      material: 'steel', restitution: 0.1,
    }));
    W.addSensor(new Sensor({
      layer: LAYER_ESCROW_RET,
      a: [MECH.escrowCupSensor.u - 0.045, MECH.escrowCupSensor.v],
      b: [MECH.escrowCupSensor.u + 0.055, MECH.escrowCupSensor.v],
      tag: 'escrow-to-cup',
      cb: (body) => { body.layer = LAYER_MECH; body.wake(); },
    }));

    // ---- 金庫経路 (背面層) ----
    const cc = MECH.cashChute;
    const addB = (a, b, o = {}) => W.addSeg(new Seg({ layer: LAYER_MECH_BACK, a, b, material: 'steel', ...o }));
    addB(cc.a, cc.b, { friction: 0.2 });
    addB([cc.b[0] + 0.023, cc.b[1] + 0.03], [cc.b[0] + 0.023, 0.30], { restitution: 0.1 });
    addB([cc.a[0] - 0.012, cc.a[1] + 0.02], [cc.a[0] - 0.012, 0.30], { restitution: 0.1 });
    W.addSensor(new Sensor({
      layer: LAYER_MECH_BACK,
      a: [cc.a[0] - 0.012, MECH.cashMouth.v],
      b: [cc.b[0] + 0.023, MECH.cashMouth.v],
      tag: 'cash-in',
      cb: (body) => this._onCashIn(body),
    }));

    // ---- 紙幣識別機 ----
    this.bill = new BillValidator(this);
  }

  _updateGateSeg() {
    const [px, py] = MECH.returnGate.pivot;
    const len = MECH.returnGate.len;
    this.gateSeg.set(
      [px, py],
      [px + Math.cos(this.gateAngle) * len, py + Math.sin(this.gateAngle) * len]
    );
  }

  /* ---------------- 操作 ---------------- */

  insertCoin(denom) {
    const spec = COINS[denom];
    const body = new Disc({
      layer: LAYER_MECH,
      x: MECH.spawn.u + (denom % 7 - 3) * 0.0004,
      y: MECH.spawn.v,
      r: spec.d / 2,
      m: spec.mass,
      vy: -0.25,
      restitution: 0.32,
      friction: 0.30,
      rollResist: 0.35,
      userData: { coin: spec, denom, kind: 'coin' },
    });
    this.world.addBody(body);
    this.emit('coinSpawn', { body });
    return body;
  }

  setReturnLever(pressed) {
    if (this.returning === pressed) return;
    this.returning = pressed;
    this.gateTarget = pressed ? GATE_RETURN : GATE_ACCEPT;
    this.emit('gate', { returning: pressed });
    this.world.wakeArea(LAYER_MECH, 0.42, 1.14, 0.58, 1.40);
    if (pressed && this.escrow.length > 0) this.returnEscrow();
  }

  /** エスクロー中の合計額 */
  escrowValue() {
    return this.escrow.reduce((s, e) => s + e.denom, 0);
  }

  /** 購入確定: 保留硬貨をチューブ/金庫へ落とす */
  commitEscrow() {
    if (this.escrow.length === 0) return;
    for (const denom of ESCROW_DENOMS) {
      const ch = this.channels[denom];
      ch.divertSensor.enabled = this.tubes[denom] >= TUBE_CAP[denom];
    }
    this._openShutters(0.7);
    this.emit('escrowCommit', {});
  }

  /** 返却レバー: 保留硬貨の現物を返却口へ */
  returnEscrow() {
    for (const denom of ESCROW_DENOMS) {
      const ch = this.channels[denom];
      ch.retSensor.enabled = true;
      ch.divertSensor.enabled = false;
    }
    this.returnSensorTimer = 1.4;
    this._openShutters(0.7);
    this.emit('escrowReturn', {});
  }

  _openShutters(dur) {
    for (const denom of ESCROW_DENOMS) {
      const ch = this.channels[denom];
      if (ch.shutter) ch.shutter.enabled = false;
      this.world.wakeArea(LAYER_MECH, ch.cx - 0.03, MECH.escrowY - 0.02, ch.cx + 0.03, MECH.escrowY + 0.1);
    }
    this.shutterTimer = dur;
  }

  changePlan(amount) {
    if (amount === 0) return {};
    const plan = {};
    let rest = amount;
    for (const d of [500, 100, 50, 10]) {
      const need = Math.min(Math.floor(rest / d), this.tubes[d]);
      if (need > 0) { plan[d] = need; rest -= need * d; }
    }
    return rest === 0 ? plan : null;
  }

  payout(plan) {
    for (const d of [500, 100, 50, 10]) {
      for (let i = 0; i < (plan[d] ?? 0); i++) this.payoutQueue.push(d);
    }
    if (this.payoutQueue.length > 0 && this.payoutTimer <= 0) {
      this.payoutTimer = 0.06;
    }
  }

  get payoutBusy() { return this.payoutQueue.length > 0 || this.escrow.length > 0; }

  collectCup() {
    const cup = MECH.cup;
    const got = [];
    for (const b of [...this.world.bodies]) {
      if (b.layer !== LAYER_MECH || b.userData.kind !== 'coin') continue;
      if (b.x > cup.left - 0.002 && b.x < cup.right + 0.002 &&
          b.y < cup.top && b.y > cup.floor - 0.01) {
        got.push(b.userData.denom);
        this.world.removeBody(b);
        this.emit('coinRemove', { body: b });
      }
    }
    return got;
  }

  cupCount() {
    const cup = MECH.cup;
    let n = 0;
    for (const b of this.world.bodies) {
      if (b.layer !== LAYER_MECH || b.userData.kind !== 'coin') continue;
      if (b.x > cup.left - 0.002 && b.x < cup.right + 0.002 && b.y < cup.top) n++;
    }
    return n;
  }

  refillTube(denom, count) {
    const space = TUBE_CAP[denom] - this.tubes[denom];
    const n = Math.max(0, Math.min(count, space));
    this.tubes[denom] += n;
    return n;
  }

  collectCash() {
    const got = { ...this.cashBox };
    this.cashBox = { 10: 0, 50: 0, 100: 0, 500: 0 };
    return got;
  }

  cashTotal() {
    return DENOMS.reduce((s, d) => s + d * this.cashBox[d], 0);
  }

  changeShortage(minPrice) {
    return this.changePlan(500 - minPrice) === null;
  }

  /* ---------------- 内部イベント ---------------- */

  _onAccept(denom, body) {
    if (body.userData.paidOut) return;
    const escrowed = ESCROW_DENOMS.includes(denom);
    if (escrowed) {
      this.escrow.push({ denom, body });
      body.userData.escrowed = true;
    } else {
      this.channels[denom].divertSensor.enabled = this.tubes[denom] >= TUBE_CAP[denom];
    }
    this.emit('accept', { denom, body, escrowed });
  }

  _onEscrowReturn(denom, body) {
    body.layer = LAYER_ESCROW_RET;
    body.wake();
    this._removeFromEscrow(body);
    this.emit('escrowRefund', { denom, body });
  }

  _onDivert(denom, body) {
    body.layer = LAYER_MECH_BACK;
    body.vx -= 0.03;
    body.wake();
    this._removeFromEscrow(body);
    this.emit('divert', { denom, body });
  }

  _onTubeIn(denom, body) {
    this.world.removeBody(body);
    this.tubes[denom]++;
    this._removeFromEscrow(body);
    this.emit('tubeIn', { denom, body });
    this.emit('coinRemove', { body });
  }

  _onCashIn(body) {
    const denom = body.userData.denom;
    this.world.removeBody(body);
    this.cashBox[denom]++;
    this.emit('cashIn', { denom, body });
    this.emit('coinRemove', { body });
  }

  _removeFromEscrow(body) {
    const i = this.escrow.findIndex(e => e.body === body);
    if (i >= 0) this.escrow.splice(i, 1);
  }

  /* ---------------- 毎シムフレーム ---------------- */
  tick(dt) {
    // ゲート
    const target = this.gateTarget;
    if (this.gateAngle !== target) {
      const k = Math.min(1, dt / 0.09);
      this.gateAngle += (target - this.gateAngle) * k;
      if (Math.abs(this.gateAngle - target) < 0.01) this.gateAngle = target;
      this._updateGateSeg();
    }

    // 保留シャッター
    if (this.shutterTimer > 0) {
      this.shutterTimer -= dt;
      if (this.shutterTimer <= 0) {
        for (const denom of ESCROW_DENOMS) {
          const ch = this.channels[denom];
          if (ch.shutter) ch.shutter.enabled = true;
        }
      }
    }
    if (this.returnSensorTimer > 0) {
      this.returnSensorTimer -= dt;
      if (this.returnSensorTimer <= 0) {
        for (const denom of ESCROW_DENOMS) {
          this.channels[denom].retSensor.enabled = false;
        }
      }
    }

    // 払出しエジェクタ
    if (this.payoutQueue.length > 0) {
      this.payoutTimer -= dt;
      if (this.payoutTimer <= 0) {
        const denom = this.payoutQueue.shift();
        this.payoutTimer = MECH.payoutInterval;
        if (this.tubes[denom] > 0) {
          this.tubes[denom]--;
          const spec = COINS[denom];
          const body = new Disc({
            layer: LAYER_MECH,
            x: TUBES[denom].cx + 0.006,
            y: TUBE_BOTTOM - 0.008,
            r: spec.d / 2,
            m: spec.mass,
            vx: 0.32, vy: -0.05,
            restitution: 0.3,
            friction: 0.3,
            rollResist: 0.35,
            userData: { coin: spec, denom, kind: 'coin', paidOut: true },
          });
          this.world.addBody(body);
          this.emit('coinSpawn', { body });
          this.emit('payoutCoin', { denom });
        }
        if (this.payoutQueue.length === 0) this.emit('payoutDone', {});
      }
    }

    // 紙幣
    this.bill.tick(dt);

    // 詰まり監視
    for (const b of this.world.bodies) {
      if (b.userData.kind !== 'coin' || b.layer !== LAYER_MECH) continue;
      const inCup = b.x > MECH.cup.left - 0.01 && b.y < MECH.cup.top;
      const inEscrow = b.userData.escrowed && this.escrow.some(e => e.body === b);
      if (!inCup && !inEscrow && b.sleeping) {
        const t = (this.stuckTimers.get(b.id) ?? 0) + dt;
        this.stuckTimers.set(b.id, t);
        if (t > 2.0) {
          b.wake();
          b.vx += (b.id % 2 === 0 ? 1 : -1) * 0.04;
          b.vy += 0.02;
          this.stuckTimers.set(b.id, 0);
        }
      } else {
        this.stuckTimers.delete(b.id);
      }
    }
  }
}

/* ============================================================
   紙幣識別機 (千円札) — キネマティック搬送 + 実機の受入ルール
   ============================================================ */
export class BillValidator {
  constructor(mech) {
    this.mech = mech;
    this.state = 'idle';     // idle | feeding | validating | stacking | rejecting
    this.t = 0;
    this.stacked = 0;        // スタッカー内の枚数
    this.progress = 0;       // 0..1 挿入深さ (ビジュアル用)
  }

  /** お札中止か? (実機: 釣銭13枚相当が確保できなければ受付停止) */
  get billStop() {
    const plan = this.mech.changePlan(1000);
    if (!plan) return true;
    const coins = Object.values(plan).reduce((s, n) => s + n, 0);
    return coins > BILL.minChangeCoins;
  }

  get busy() { return this.state !== 'idle'; }

  /** 挿入を試みる。false = 受付不可 (お札中止/搬送中) */
  insert() {
    if (this.busy) return false;
    this.state = 'feeding';
    this.t = 0;
    this.progress = 0;
    this.willAccept = !this.billStop;
    this.mech.emit('billFeed', {});
    return true;
  }

  tick(dt) {
    if (this.state === 'idle') return;
    this.t += dt;
    if (this.state === 'feeding') {
      this.progress = Math.min(1, this.t / BILL.insertTime);
      if (this.t >= BILL.insertTime) {
        this.state = 'validating';
        this.t = 0;
      }
    } else if (this.state === 'validating') {
      if (this.t >= BILL.validateTime) {
        if (this.willAccept) {
          this.state = 'stacking';
          this.t = 0;
          this.mech.emit('billAccept', {});
        } else {
          this.state = 'rejecting';
          this.t = 0;
          this.mech.emit('billReject', {});
        }
      }
    } else if (this.state === 'stacking') {
      this.progress = 1 + Math.min(1, this.t / 0.5);   // 1..2 = スタッカーへ引き込み
      if (this.t >= 0.5) {
        this.stacked++;
        this.state = 'idle';
        this.progress = 0;
        this.mech.emit('billStacked', { stacked: this.stacked });
      }
    } else if (this.state === 'rejecting') {
      this.progress = Math.max(0, 1 - this.t / BILL.rejectTime);
      if (this.t >= BILL.rejectTime) {
        this.state = 'idle';
        this.mech.emit('billRejected', {});
      }
    }
  }

  /** 店員: スタッカー回収 */
  collect() {
    const n = this.stacked;
    this.stacked = 0;
    return n;
  }
}

/* 返却ゲートの角度 (ピボット相対) */
const GATE_ACCEPT = Math.atan2(-0.030, -0.060);
const GATE_RETURN = Math.atan2(-0.073, -0.030);
