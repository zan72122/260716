/* ============================================================
   coin-mech.js — コインメック (硬貨選別・釣銭・金庫) のロジック
   THREE 非依存。物理ワールドにコライダ/センサーを構築し、
   硬貨の投入から選別・振分・払出しまでを実機の流れで再現する。

   経路 (実機モチーフ):
   投入口 → 漏斗 → 返却ゲート → 傾斜選別レール
     ├ 径ゲートA (50円が落下) ─ 検銭センサー ─ フリッパー ┬ 釣銭チューブ
     ├ 径ゲートB (100円)                                    └ 金庫 (満杯時)
     ├ 径ゲートC (10円)
     └ レール終端 (500円)
   返却ゲート開 → 返却レーン直落 → 返却口カップ
   払出し: チューブ底のエジェクタ → 払出しシュート → カップ
   ============================================================ */
import { Disc, Seg, Sensor } from './physics.js';
import {
  COINS, DENOMS, MECH, GATES, GATE_HALF, RAIL_END_X, CH500_CX,
  TUBES, TUBE_TOP, TUBE_BOTTOM, TUBE_INIT, TUBE_CAP,
} from './config.js';

export const LAYER_MECH = 'mech';
export const LAYER_MECH_BACK = 'mechBack';

export class CoinMech {
  /**
   * @param world 物理ワールド
   * @param emit  (type, data) イベント通知
   *   'accept' {denom}           検銭確定 (credit加算はここ)
   *   'coinSpawn' {body}         硬貨剛体の発生 (投入/払出)
   *   'coinRemove' {body}        硬貨剛体の消滅
   *   'tubeIn' {denom, body}     チューブ収納 (計数化)
   *   'divert' {denom, body}     金庫行きへ振分 (背面層へ)
   *   'cashIn' {denom, body}     金庫着地
   *   'payoutCoin' {denom}       エジェクタ作動
   *   'payoutDone' {}            払出し完了
   *   'gate' {returning}         返却ゲート切替
   */
  constructor(world, emit) {
    this.world = world;
    this.emit = emit;
    this.tubes = { ...TUBE_INIT };          // 金種→枚数 (計数管理)
    this.cashBox = { 10: 0, 50: 0, 100: 0, 500: 0 };
    this.returning = false;                  // 返却レバー状態
    this.payoutQueue = [];                   // 払出し待ち金種
    this.payoutTimer = 0;
    this.stuckTimers = new Map();            // 詰まり監視
    this._build();
  }

  /* ---------------- コライダ構築 ---------------- */
  _build() {
    const W = this.world;
    const L = LAYER_MECH;
    const add = (a, b, o = {}) => W.addSeg(new Seg({ layer: L, a, b, material: 'steel', ...o }));

    // 投入漏斗
    for (const [a, b] of MECH.entryFunnel) add(a, b, { material: 'steel' });

    // 返却ゲート (キネマティック)。角度は tick() で補間
    this.gateSeg = add([0, 0], [0, 0], { material: 'gate' });
    this.gateAngle = GATE_ACCEPT;
    this.gateTarget = GATE_ACCEPT;
    this._updateGateSeg();

    // ---- 選別レール (径ゲートで分割) ----
    const railY = MECH.railY;
    const cuts = [];       // レールを [x0,x1] 実体区間に分割
    let xs = MECH.RAIL_X0;
    for (const g of GATES) {
      const gapHalf = g.passD / 2 + 0.003;    // 物理開口 (捕捉を確実にするため広め)
      cuts.push([xs, g.cx + gapHalf]);
      // ゲート開口: 通過径以上の硬貨だけを支える背面支持リブ (実機の傾斜プレート相当)
      W.addSeg(new Seg({
        layer: L,
        a: [g.cx + gapHalf, railY(g.cx + gapHalf)],
        b: [g.cx - gapHalf, railY(g.cx - gapHalf)],
        material: 'rail', friction: 0.28,
        filter: (body) => body.userData.coin && body.userData.coin.d >= g.passD,
        tag: `bridge-${g.denom}`,
      }));
      // 捕捉ガイド: 落ちるべき硬貨だけに作用する高い左壁
      // (ゲート角で跳ねて下流へ逃げるのを防ぐ。実機の背面プレートの溝に相当)
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
    // レール上の天井ガイド (跳ねすぎ防止・実機の上部レール)
    // 右端はゲートより左に置き、ゲートから転がり込む硬貨と干渉させない
    add([MECH.RAIL_X0 - 0.009, railY(MECH.RAIL_X0 - 0.009) + 0.033],
        [CH500_CX - 0.014, railY(RAIL_END_X) + 0.031],
        { material: 'rail', restitution: 0.05 });

    // ---- 金種チャンネル (ゲート下の垂直ガイド) ----
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

      // 検銭センサー: ここを通過した硬貨が「受理」される
      W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.sensorY], b: [cx + half, MECH.sensorY],
        tag: `accept-${denom}`,
        cb: (body) => this._onAccept(denom, body),
      }));

      // 振分センサー: フリッパーが金庫側のとき、硬貨を背面層へ移す
      const divertSensor = W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.flipperY], b: [cx + half, MECH.flipperY],
        tag: `divert-${denom}`,
        cb: (body) => this._onDivert(denom, body),
      }));
      divertSensor.enabled = false;
      this.channels[denom].divertSensor = divertSensor;

      // チューブ入口センサー: 通過で剛体→計数化
      W.addSensor(new Sensor({
        layer: L,
        a: [cx - half, MECH.tubeMouthY], b: [cx + half, MECH.tubeMouthY],
        tag: `tube-${denom}`,
        cb: (body) => this._onTubeIn(denom, body),
      }));
    }
    // 500円チャンネルへの誘導 (レール終端の跳ね止め壁・高め)
    add([CH500_CX - COINS[500].d / 2 - 0.0042, railY(RAIL_END_X) + 0.042],
        [CH500_CX - COINS[500].d / 2 - 0.0042, railY(RAIL_END_X) - 0.01],
        { material: 'channel' });

    // ---- 返却レーン ----
    const [lx, rx] = MECH.returnLaneX;
    add([lx, 0.925], [lx, 0.86], { material: 'steel' });   // 左壁 (レール始端の背)
    add([rx, 1.02], [rx, MECH.cup.top], { material: 'steel' }); // 右壁 (カップまで)

    // ---- 返却口カップ ----
    const cup = MECH.cup;
    add([cup.left, cup.floor + 0.046], [cup.left, cup.floor], { material: 'plastic', restitution: 0.15 });
    add([cup.left, cup.floor], [cup.right, cup.floor], { material: 'plastic', restitution: 0.15, friction: 0.5 });
    add([cup.right, cup.floor], [cup.right, cup.top], { material: 'plastic', restitution: 0.15 });

    // ---- 払出しシュート (終端はカップ左壁上端へ滑らかに接続) ----
    const pc = MECH.payoutChute;
    add(pc.a, pc.b, { material: 'steel', friction: 0.2 });
    add(pc.b, [cup.left, cup.floor + 0.046], { material: 'steel', friction: 0.2 });

    // ---- 金庫経路 (背面層) ----
    const LB = LAYER_MECH_BACK;
    const cc = MECH.cashChute;
    const addB = (a, b, o = {}) => W.addSeg(new Seg({ layer: LB, a, b, material: 'steel', ...o }));
    addB(cc.a, cc.b, { friction: 0.2 });
    // 金庫の投入口まわりの封じ込め (シュートから飛び出しても必ず口へ落ちる)
    addB([cc.b[0] + 0.023, cc.b[1] + 0.03], [cc.b[0] + 0.023, 0.34], { restitution: 0.1 });
    addB([cc.a[0] - 0.012, cc.a[1] + 0.02], [cc.a[0] - 0.012, 0.34], { restitution: 0.1 });
    W.addSensor(new Sensor({
      layer: LB,
      a: [cc.a[0] - 0.012, MECH.cashMouth.v],
      b: [cc.b[0] + 0.023, MECH.cashMouth.v],
      tag: 'cash-in',
      cb: (body) => this._onCashIn(body),
    }));
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

  /** 硬貨を投入 (財布から) */
  insertCoin(denom) {
    const spec = COINS[denom];
    const body = new Disc({
      layer: LAYER_MECH,
      x: MECH.spawn.u + (denom % 7 - 3) * 0.0004,  // 決定的な微オフセット
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

  /** 返却レバー */
  setReturnLever(pressed) {
    if (this.returning === pressed) return;
    this.returning = pressed;
    this.gateTarget = pressed ? GATE_RETURN : GATE_ACCEPT;
    this.emit('gate', { returning: pressed });
    // ゲート付近の硬貨を起こす
    this.world.wakeArea(LAYER_MECH, 0.28, 0.85, 0.45, 1.10);
  }

  /** 釣銭計算 (貪欲法)。払える場合は {denom:枚数}, 不可なら null */
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

  /** 払出しを開始 (plan: {denom:枚数}) */
  payout(plan) {
    for (const d of [500, 100, 50, 10]) {
      for (let i = 0; i < (plan[d] ?? 0); i++) this.payoutQueue.push(d);
    }
    if (this.payoutQueue.length > 0 && this.payoutTimer <= 0) {
      this.payoutTimer = 0.06;
    }
  }

  get payoutBusy() { return this.payoutQueue.length > 0; }

  /** カップ内で静止している硬貨を回収 → 金種リストを返す (財布へ) */
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

  /** カップ内の硬貨枚数 (UI 表示用) */
  cupCount() {
    const cup = MECH.cup;
    let n = 0;
    for (const b of this.world.bodies) {
      if (b.layer !== LAYER_MECH || b.userData.kind !== 'coin') continue;
      if (b.x > cup.left - 0.002 && b.x < cup.right + 0.002 && b.y < cup.top) n++;
    }
    return n;
  }

  /** 店員: チューブへ釣銭補充 (即時計数、演出は呼び側) */
  refillTube(denom, count) {
    const space = TUBE_CAP[denom] - this.tubes[denom];
    const n = Math.max(0, Math.min(count, space));
    this.tubes[denom] += n;
    return n;
  }

  /** 店員: 金庫回収 → {denom:枚数} を返して空にする */
  collectCash() {
    const got = { ...this.cashBox };
    this.cashBox = { 10: 0, 50: 0, 100: 0, 500: 0 };
    return got;
  }

  cashTotal() {
    return DENOMS.reduce((s, d) => s + d * this.cashBox[d], 0);
  }

  /** 釣銭切れ警告: 最悪ケース (最安商品を500円硬貨で購入) が払えない */
  changeShortage(minPrice) {
    return this.changePlan(500 - minPrice) === null;
  }

  /* ---------------- 内部イベント ---------------- */

  _onAccept(denom, body) {
    if (body.userData.paidOut) return;      // 払出し硬貨は再受理しない (経路上ありえないが保険)
    // チューブ満杯ならこの硬貨は金庫へ振分
    const full = this.tubes[denom] >= TUBE_CAP[denom];
    this.channels[denom].divertSensor.enabled = full;
    this.emit('accept', { denom, body });
  }

  _onDivert(denom, body) {
    body.layer = LAYER_MECH_BACK;
    body.vx -= 0.03;
    body.wake();
    this.emit('divert', { denom, body });
  }

  _onTubeIn(denom, body) {
    this.world.removeBody(body);
    this.tubes[denom]++;
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

  /* ---------------- 毎シムフレーム ---------------- */
  tick(dt) {
    // 返却ゲートの動き
    const target = this.gateTarget;
    if (this.gateAngle !== target) {
      const k = Math.min(1, dt / 0.09);
      this.gateAngle += (target - this.gateAngle) * k;
      if (Math.abs(this.gateAngle - target) < 0.01) this.gateAngle = target;
      this._updateGateSeg();
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

    // 詰まり監視: メック内で妙な場所に長く留まる硬貨を微振動で救う
    for (const b of this.world.bodies) {
      if (b.userData.kind !== 'coin' || b.layer === LAYER_MECH_BACK) continue;
      const inCup = b.x > MECH.cup.left - 0.01 && b.y < MECH.cup.top;
      if (!inCup && b.sleeping) {
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

/* 返却ゲートの角度 (ピボットから見た向き) */
const GATE_ACCEPT = Math.atan2(0.928 - 0.958, 0.342 - 0.402);  // 下り左 → レールへ
const GATE_RETURN = Math.atan2(0.885 - 0.958, 0.372 - 0.402);  // 急な下り右 → 返却レーンへ
