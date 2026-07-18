/* ============================================================
   rack.js — 五重サーペンタインラック (実機準拠)
   3室 × 上下段 × 前後5コラム = 30コラム。
   各コラムは「ほぼ垂直の細かい蛇行チャンネル」で、出口ランプが
   ラック前面へ下り、段違いに並んだ2ピン式ベンドメカが1本ずつ払出す。
   上段の商品は前面落下レーンを通って共通シュートへ落ち、
   搬出扉(断熱フラップ)を押し開けて取出口に届く。
   補充はトップトレー: 転がって最初の空きコラムへ物理的に落ちる。
   THREE 非依存。
   ============================================================ */
import { Disc, Seg, Sensor, HingeFlap } from './physics.js';
import {
  COLUMNS, CHAMBERS, PRODUCTS, RACK, VEND, CHUTE, TRAY, genChannel,
} from './config.js';

export class Rack {
  /**
   * emit イベント:
   * 'vendStart' {col} / 'productDrop' {col} / 'vendDone' {col}
   * 'vendRetry' {col, retry} / 'vendFail' {col}
   * 'productExit' {col, body} / 'productAtPort' {col, body}
   * 'soldOut' {col} / 'productSpawn' {col, body} / 'productRemove' {body}
   * 'trayIn' {col, body}  (トレーからコラムに入った)
   */
  constructor(world, emit, rng) {
    this.world = world;
    this.emit = emit;
    this.rng = rng ?? (() => 0.5);
    this.cols = COLUMNS.map((conf, i) => ({
      index: i,
      conf,
      product: PRODUCTS[conf.product],
      layer: `col${i}`,
      chuteLayer: `chute${conf.chamber}`,
      stock: [],
      vendT: -1,
      vendDetected: false,
      vendRetries: 0,
      capacity: 0,
    }));
    this.trayBodies = { };            // trayKey → body[]
    this._buildChutes();
    for (const col of this.cols) this._buildColumn(col);
    this._buildTrays();
  }

  /* ---------------- 室ごとの共通シュート & フラップ ---------------- */
  _buildChutes() {
    const W = this.world;
    this.chuteFlaps = [];
    for (let ch = 0; ch < CHAMBERS.length; ch++) {
      const L = `chute${ch}`;
      const add = (a, b, o = {}) => W.addSeg(new Seg({
        layer: L, a, b, material: 'chute', friction: 0.22, restitution: 0.1, ...o,
      }));
      add(CHUTE.tray.a, CHUTE.tray.b);
      add(CHUTE.backWall.a, CHUTE.backWall.b, { material: 'rackwall' });
      add(CHUTE.portFloor.a, CHUTE.portFloor.b, { material: 'port', friction: 0.4, restitution: 0.08 });
      add([CHUTE.tray.b[0], CHUTE.tray.b[1]], [CHUTE.portFloor.a[0], CHUTE.portFloor.a[1]]);
      // 落下デフレクタ: 落下運動量を前方向へ変換して搬出扉へ叩き込む
      add(CHUTE.deflector.a, CHUTE.deflector.b, { material: 'chute', friction: 0.12, restitution: 0.15 });
      // 搬出扉 (庫内断熱フラップ。商品が押し開ける)
      const inner = W.addFlap(new HingeFlap({
        layer: L,
        pivot: CHUTE.innerFlap.pivot,
        len: CHUTE.innerFlap.len,
        restAngle: CHUTE.innerFlap.restAngle,
        inertia: CHUTE.innerFlap.inertia,
        k: CHUTE.innerFlap.k, c: CHUTE.innerFlap.c,
        min: -0.02, max: CHUTE.innerFlap.maxAngle,
        material: 'innerflap',
      }));
      // 外フラッパー (取出口扉)
      const outer = W.addFlap(new HingeFlap({
        layer: L,
        pivot: CHUTE.flap.pivot,
        len: CHUTE.flap.len,
        inertia: CHUTE.flap.inertia,
        k: CHUTE.flap.k, c: CHUTE.flap.c,
        min: -0.02, max: CHUTE.flap.maxAngle,
        material: 'flap',
      }));
      this.chuteFlaps.push({ inner, outer });
      // 取出口到達センサー (搬出扉のすぐ前を通過したら到達。縦線で確実に拾う)
      W.addSensor(new Sensor({
        layer: L,
        a: [0.248, 0.345], b: [0.248, 0.50],
        tag: `port-${ch}`,
        cb: (body) => this._onAtPort(body),
      }));
    }
  }

  /* ---------------- コラム ---------------- */
  _buildColumn(col) {
    const W = this.world;
    const L = col.layer;
    const r = col.product.r;
    const isPet = col.product.kind === 'pet';
    const gen = genChannel(r, col.conf.slot, col.conf.stage);
    col.gen = gen;
    const add = (a, b, o = {}) => W.addSeg(new Seg({
      layer: L, a, b, material: 'rack',
      friction: isPet ? 0.45 : 0.3,
      restitution: isPet ? 0.06 : 0.12,
      ...o,
    }));
    for (const s of gen.segs) {
      add(s.a, s.b, s.kind === 'bump' ? { material: 'rack', restitution: 0.18 } : {});
    }

    // ---- ベンドメック (2ピン)。位置は出口ランプの実ラインから計算 ----
    const fs = gen.ramp;
    const shelfYat = (z) => {
      const t = (z - fs.a[0]) / (fs.b[0] - fs.a[0]);
      return fs.a[1] + (fs.b[1] - fs.a[1]) * t;
    };
    const zP = gen.rampEndZ - 0.006;
    const zU = zP - 2 * r - 0.006;
    col.pinLower = add([zP, shelfYat(zP) - 0.015], [zP, shelfYat(zP - r) + r * 0.9],
      { material: 'pin', restitution: 0.05 });
    col.pinUpper = add([zU, shelfYat(zU) - 0.01], [zU, shelfYat(zU - r) + r * 0.9],
      { material: 'pin', restitution: 0.05 });
    col.pinUpper.enabled = false;
    col.zPinLower = zP; col.zPinUpper = zU;
    col.shelfYat = shelfYat;

    // 収容力: 垂直部 + ランプ部
    const vertLen = gen.top - gen.ramp.a[1];
    const rampLen = Math.hypot(fs.b[0] - fs.a[0], fs.b[1] - fs.a[1]);
    col.capacity = Math.max(3, Math.floor(vertLen / (1.98 * r)) + Math.floor(rampLen / (2 * r)) - 1);

    // ---- センサー ----
    // 販売検知 (出口直後)
    W.addSensor(new Sensor({
      layer: L,
      a: [gen.rampEndZ - 0.01, gen.yExit - 0.055], b: [RACK.laneZ[1] + 0.01, gen.yExit - 0.055],
      tag: `exit-${col.index}`,
      cb: (body) => this._onExit(col, body),
    }));
    // シュート層への移管 (落下レーンの下端)
    W.addSensor(new Sensor({
      layer: L,
      a: [0.02, 0.585], b: [RACK.laneZ[1] + 0.02, 0.585],
      tag: `tochute-${col.index}`,
      cb: (body) => {
        body.layer = col.chuteLayer;
        body.wake();
      },
    }));
  }

  /* ---------------- トップトレー (補充) ---------------- */
  _buildTrays() {
    const W = this.world;
    for (let ch = 0; ch < CHAMBERS.length; ch++) {
      for (let stage = 0; stage < 2; stage++) {
        const L = `tray${ch}${stage}`;
        const yF = stage === 0 ? TRAY.upperY : TRAY.lowerY;
        const yB = yF - TRAY.tilt;
        const trayYat = (z) => yF + (z - TRAY.frontZ) * (yB - yF) / (TRAY.backZ - TRAY.frontZ);
        const cols = this.cols.filter(c => c.conf.chamber === ch && c.conf.stage === stage);
        // 前から奥へ: 開口(コラム口)ごとに実体トレーを分割
        const openings = cols
          .map(c => ({ col: c, z0: c.gen.mouthZ - c.gen.half - 0.004, z1: c.gen.mouthZ + c.gen.half + 0.004 }))
          .sort((a, b) => b.z0 - a.z0);   // 前(z大)から
        let zCur = TRAY.frontZ;
        const add = (a, b, o = {}) => W.addSeg(new Seg({
          layer: L, a, b, material: 'chute', friction: 0.25, restitution: 0.1, ...o,
        }));
        for (const op of openings) {
          add([zCur, trayYat(zCur)], [op.z1, trayYat(op.z1)]);
          // 開口: コラムが満杯のときだけ閉じるゴーストブリッジ
          const colRef = op.col;
          W.addSeg(new Seg({
            layer: L,
            a: [op.z1, trayYat(op.z1)], b: [op.z0, trayYat(op.z0)],
            material: 'chute', friction: 0.25,
            filter: () => this.stockCount(colRef.index) >= colRef.capacity,
            tag: `traybridge-${colRef.index}`,
          }));
          // 開口下のセンサー: コラムに商品を割り当てる
          W.addSensor(new Sensor({
            layer: L,
            a: [op.z0 - 0.005, trayYat(op.z0) - 0.055], b: [op.z1 + 0.005, trayYat(op.z0) - 0.055],
            tag: `trayin-${colRef.index}`,
            cb: (body) => this._onTrayIn(colRef, body),
          }));
          zCur = op.z0;
        }
        add([zCur, trayYat(zCur)], [TRAY.backZ, yB]);
        // 端の止め壁
        add([TRAY.backZ, yB + 0.10], [TRAY.backZ, yB - 0.01], { material: 'rackwall' });
        add([TRAY.frontZ + 0.012, yF + 0.10], [TRAY.frontZ + 0.012, yF - 0.01], { material: 'rackwall' });
      }
    }
  }

  _onTrayIn(col, body) {
    body.layer = col.layer;
    body.wake();
    const key = `tray${col.conf.chamber}${col.conf.stage}`;
    const arr = this.trayBodies[key];
    if (arr) {
      const i = arr.indexOf(body);
      if (i >= 0) arr.splice(i, 1);
    }
    col.stock.push(body);
    body.userData.col = col.index;
    this.emit('trayIn', { col: col.index, body });
  }

  /* ---------------- 商品スポーン ---------------- */
  _makeBody(col, x, y, opts = {}) {
    const p = col.product;
    const body = new Disc({
      layer: opts.layer ?? col.layer,
      x, y,
      r: p.r,
      m: p.kind === 'pet' ? 0.56 : (p.r < 0.03 ? 0.21 : 0.39),
      vx: opts.vx ?? 0, vy: opts.vy ?? 0,
      w: opts.w ?? 0,
      restitution: p.kind === 'pet' ? 0.06 : 0.14,
      friction: p.kind === 'pet' ? 0.5 : 0.3,
      rollResist: p.kind === 'pet' ? 0.7 : 0.10,
      userData: { kind: 'product', product: p, col: col.index },
    });
    this.world.addBody(body);
    this.emit('productSpawn', { col: col.index, body });
    return body;
  }

  /** 初期在庫を直接配置 (出口ランプ→垂直チャンネルに沿って積む)。settle 約2秒で安定 */
  preloadDirect(counts) {
    for (const col of this.cols) {
      const n = Math.min(counts?.[col.index] ?? (col.capacity - 1), col.capacity);
      const r = col.product.r;
      const gen = col.gen;
      const ramp = gen.ramp;
      const rampDir = [ramp.a[0] - ramp.b[0], ramp.a[1] - ramp.b[1]];
      const rampLen = Math.hypot(rampDir[0], rampDir[1]);
      rampDir[0] /= rampLen; rampDir[1] /= rampLen;
      // 1本目: 下ピンに接する位置
      let px = col.zPinLower - r;
      let py = col.shelfYat(px) + r + 0.001;
      let placed = 0;
      // ランプ上
      while (placed < n) {
        this.world.addBody(this._makeStocked(col, px, py));
        placed++;
        const nx = px + rampDir[0] * (2 * r + 0.002);
        if (nx > ramp.a[0] - 0.002) {
          px = nx; py = col.shelfYat(px) + r + 0.001;
        } else break;
      }
      // 垂直チャンネル内 (交互オフセット)
      let y = ramp.a[1] + 2 * r;
      let side = 1;
      while (placed < n && y < gen.top - r) {
        const z = gen.mouthZ + side * (gen.half - r) * 0.55;
        this.world.addBody(this._makeStocked(col, z, y));
        placed++;
        y += 1.98 * r;
        side = -side;
      }
    }
  }

  _makeStocked(col, x, y) {
    const p = col.product;
    const body = new Disc({
      layer: col.layer, x, y,
      r: p.r,
      m: p.kind === 'pet' ? 0.56 : (p.r < 0.03 ? 0.21 : 0.39),
      restitution: p.kind === 'pet' ? 0.06 : 0.14,
      friction: p.kind === 'pet' ? 0.5 : 0.3,
      rollResist: p.kind === 'pet' ? 0.7 : 0.10,
      userData: { kind: 'product', product: p, col: col.index },
    });
    col.stock.push(body);
    this.emit('productSpawn', { col: col.index, body });
    return body;
  }

  /** 店員: 補充。トレーに商品を1本投げ込む → 転がって空きコラムへ落ちる */
  restock(chamber, stage) {
    const cols = this.cols.filter(c => c.conf.chamber === chamber && c.conf.stage === stage);
    if (!cols.some(c => this.stockCount(c.index) < c.capacity)) return null;
    const key = `tray${chamber}${stage}`;
    this.trayBodies[key] = (this.trayBodies[key] ?? []).filter(b => !b.dead);
    if (this.trayBodies[key].length >= 2) return null;   // トレー渋滞
    // このトレーで一番空いているコラムの商品種を補充 (実運用と同じ)
    const target = cols.reduce((a, b) =>
      (this.stockCount(a.index) / a.capacity <= this.stockCount(b.index) / b.capacity) ? a : b);
    const p = target.product;
    const yF = stage === 0 ? TRAY.upperY : TRAY.lowerY;
    const body = new Disc({
      layer: key,
      x: TRAY.frontZ - 0.02, y: yF + 0.05,
      r: p.r,
      m: p.kind === 'pet' ? 0.56 : (p.r < 0.03 ? 0.21 : 0.39),
      vx: -0.35 - this.rng() * 0.1, vy: -0.05,
      w: (this.rng() - 0.5) * 2,
      restitution: p.kind === 'pet' ? 0.06 : 0.14,
      friction: p.kind === 'pet' ? 0.5 : 0.3,
      rollResist: p.kind === 'pet' ? 0.7 : 0.10,
      userData: { kind: 'product', product: p, col: -1, onTray: true },
    });
    this.world.addBody(body);
    this.trayBodies[key].push(body);
    this.emit('productSpawn', { col: -1, body });
    return { product: p, chamber, stage };
  }

  /* ---------------- 販売 ---------------- */
  canVend(colIndex) {
    const col = this.cols[colIndex];
    return col.stock.length > 0 && col.vendT < 0;
  }

  vend(colIndex) {
    const col = this.cols[colIndex];
    if (!this.canVend(colIndex)) return false;
    col.vendT = 0;
    col.vendDetected = false;
    col.vendRetries = 0;
    this.emit('vendStart', { col: colIndex });
    return true;
  }

  get busy() { return this.cols.some(c => c.vendT >= 0); }

  soldOut(colIndex) {
    return this.stockCount(colIndex) === 0;
  }

  stockCount(colIndex) {
    return this.cols[colIndex].stock.length;
  }

  /* ---------------- 取出口 ---------------- */
  portBodies() {
    return this.world.bodies.filter(b => b.userData.kind === 'product' && b.userData.atPort);
  }

  take() {
    const got = this.portBodies();
    for (const b of got) {
      this.world.removeBody(b);
      this.emit('productRemove', { body: b });
    }
    return got;
  }

  /* ---------------- 毎シムフレーム ---------------- */
  tick(dt) {
    for (const col of this.cols) {
      if (col.vendT < 0) continue;
      const t0 = col.vendT;
      col.vendT += dt;
      const t1 = col.vendT;
      const C = VEND.cycle;
      const crossed = (m) => t0 < m && t1 >= m;
      if (crossed(C.upperIn)) {
        col.pinUpper.enabled = true;
        this._wakeExit(col);
      }
      if (crossed(C.lowerOut)) {
        col.pinLower.enabled = false;
        this._wakeExit(col);
        this.emit('productDrop', { col: col.index });
      }
      if (crossed(C.lowerIn)) col.pinLower.enabled = true;
      if (crossed(C.upperOut)) {
        col.pinUpper.enabled = false;
        this.world.wakeLayer(col.layer);
      }
      if (t1 >= C.done) {
        if (!col.vendDetected && col.vendRetries < 2) {
          col.vendRetries++;
          col.vendT = 0;
          this.emit('vendRetry', { col: col.index, retry: col.vendRetries });
        } else if (!col.vendDetected) {
          col.vendT = -1;
          this.emit('vendFail', { col: col.index });
        } else {
          col.vendT = -1;
          this.emit('vendDone', { col: col.index });
          if (col.stock.length === 0) this.emit('soldOut', { col: col.index });
        }
      }
    }
  }

  _wakeExit(col) {
    const g = col.gen;
    this.world.wakeArea(col.layer, g.ramp.a[0] - 0.05, g.yExit - 0.12, RACK.laneZ[1], g.ramp.a[1] + 0.3);
  }

  _onExit(col, body) {
    const i = col.stock.indexOf(body);
    if (i >= 0) col.stock.splice(i, 1);
    body.userData.inChute = true;
    col.vendDetected = true;
    this.emit('productExit', { col: col.index, body });
  }

  _onAtPort(body) {
    body.userData.atPort = true;
    this.emit('productAtPort', { col: body.userData.col, body });
  }
}
