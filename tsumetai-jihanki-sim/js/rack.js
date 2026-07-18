/* ============================================================
   rack.js — サーペンタインラック / ベンドメック / シュート / フラップ
   THREE 非依存。コラムごとに独立した 2D 平面 (u=ワールドz, v=y)。

   ・互い違い傾斜棚を商品が転がり落ち、出口で縦列待機
   ・ベンドメック: 上下2ピン式。1サイクルで正確に1本だけ払出す
     (上ピンが2本目を保持 → 下ピン退避で1本目落下 → 復帰)
   ・落下した商品はシュートを滑り、バネ付きフラップを
     押し開けて取出口に「ガコンッ」と着地する
   ============================================================ */
import { Disc, Seg, Sensor, HingeFlap } from './physics.js';
import { COLUMNS, PRODUCTS, RACK, VEND, CHUTE, genShelves } from './config.js';

export class Rack {
  /**
   * emit イベント:
   * 'vendStart' {col} / 'productDrop' {col} / 'vendDone' {col}
   * 'productExit' {col, body} / 'productAtPort' {col, body}
   * 'soldOut' {col} / 'productSpawn' {col, body} / 'productRemove' {body}
   */
  constructor(world, emit, rng) {
    this.world = world;
    this.emit = emit;
    this.rng = rng ?? (() => 0.5);
    this.cols = COLUMNS.map((c, i) => ({
      index: i,
      conf: c,
      product: PRODUCTS[c.product],
      layer: `col${i}`,
      stock: [],          // 待機中の商品 body (未払出)
      vendT: -1,          // ベンドサイクル経過時間 (-1: 停止)
      pinLower: null,
      pinUpper: null,
      flap: null,
      shelves: null,
      spawnQueue: 0,      // 初期投入の残り
      spawnTimer: 0,
    }));
    for (const col of this.cols) this._buildColumn(col);
  }

  _buildColumn(col) {
    const W = this.world;
    const L = col.layer;
    const r = col.product.r;
    const isPet = col.product.kind === 'pet';
    const add = (a, b, o = {}) => W.addSeg(new Seg({
      layer: L, a, b, material: 'rack',
      friction: isPet ? 0.5 : 0.32,
      restitution: isPet ? 0.06 : 0.12,
      ...o,
    }));

    // ---- 互い違い棚 ----
    const gen = genShelves(r);
    col.shelves = gen.shelves;
    col.loadZ = gen.loadZ;
    for (const s of col.shelves) add(s.a, s.b);

    // ---- 前後の壁 ----
    add([RACK.zFront + 0.004, 1.80], [RACK.zFront + 0.004, RACK.exitY + 0.03], { material: 'rackwall' });
    add([RACK.zBack - 0.006, 1.82], [RACK.zBack - 0.006, 0.55], { material: 'rackwall' });

    // ---- ベンドメック (2ピン)。位置は最終進入棚の実ラインから計算 ----
    const fs = col.shelves[col.shelves.length - 1];
    const shelfYat = (z) => {
      const t = (z - fs.a[0]) / (fs.b[0] - fs.a[0]);
      return fs.a[1] + (fs.b[1] - fs.a[1]) * t;
    };
    const zP = RACK.exitZ + r - 0.004;            // 下ピン (1本目を棚上で保持)
    const zU = zP - 2 * r - 0.006;                // 上ピン (2本目を保持)
    col.pinLower = add([zP, shelfYat(zP) - 0.015], [zP, shelfYat(zP - r) + r * 0.9],
      { material: 'pin', restitution: 0.05 });
    col.pinUpper = add([zU, shelfYat(zU) - 0.01], [zU, shelfYat(zU - r) + r * 0.9],
      { material: 'pin', restitution: 0.05 });
    col.pinUpper.enabled = false;
    col.zPinLower = zP; col.zPinUpper = zU;
    col.shelfYat = shelfYat;

    // ---- 出口の落下レーン ----
    // 後壁の上端は棚ラインの下に収める (突き抜けると列が堰き止められる)
    const wallZ = RACK.exitZ - r - 0.015;
    add([wallZ, shelfYat(wallZ) - 0.004], [wallZ, 0.52], { material: 'rackwall' });
    add([zP + 0.048, RACK.exitY + 0.01], [zP + 0.048, 0.52], { material: 'rackwall' });

    // ---- シュート & 取出口 ----
    add(CHUTE.tray.a, CHUTE.tray.b, { material: 'chute', friction: 0.22 });
    add(CHUTE.portFloor.a, CHUTE.portFloor.b, { material: 'port', friction: 0.4, restitution: 0.08 });
    // 取出口の奥の壁 (トレイ終端から取出口床への段差)
    add([CHUTE.tray.b[0], CHUTE.tray.b[1]], [CHUTE.portFloor.a[0], CHUTE.portFloor.a[1]], { material: 'chute' });

    // ---- フラップ (バネ付きヒンジ) ----
    col.flap = W.addFlap(new HingeFlap({
      layer: L,
      pivot: CHUTE.flap.pivot,
      len: CHUTE.flap.len,
      inertia: CHUTE.flap.inertia,
      k: CHUTE.flap.k, c: CHUTE.flap.c,
      min: -0.02, max: CHUTE.flap.maxAngle,
      material: 'flap',
    }));

    // ---- センサー ----
    W.addSensor(new Sensor({
      layer: L,
      a: [RACK.exitZ - r - 0.02, 0.70], b: [zP + 0.05, 0.70],
      tag: `exit-${col.index}`,
      cb: (body) => this._onExit(col, body),
    }));
    W.addSensor(new Sensor({
      layer: L,
      a: [0.10, 0.415], b: [0.315, 0.415],
      tag: `port-${col.index}`,
      cb: (body) => this._onAtPort(col, body),
    }));
  }

  /* ---------------- 商品スポーン ---------------- */
  _spawnProduct(col, initial = false) {
    const p = col.product;
    const body = new Disc({
      layer: col.layer,
      x: col.loadZ + (this.rng() - 0.5) * 0.01,
      y: RACK.loadY,
      r: p.r,
      m: p.kind === 'pet' ? 0.56 : (p.r < 0.03 ? 0.21 : 0.39),
      vx: (col.loadZ > 0 ? -1 : 1) * (0.18 + this.rng() * 0.1),
      vy: -0.1,
      w: (this.rng() - 0.5) * 3,
      restitution: p.kind === 'pet' ? 0.06 : 0.14,
      friction: p.kind === 'pet' ? 0.5 : 0.3,
      rollResist: p.kind === 'pet' ? 0.7 : 0.10,
      userData: { kind: 'product', product: p, col: col.index },
    });
    this.world.addBody(body);
    col.stock.push(body);
    this.emit('productSpawn', { col: col.index, body, initial });
    return body;
  }

  /** 初期在庫を投入予約 (settle シミュレーションと併用) */
  preload(stockCounts) {
    this.cols.forEach((col, i) => {
      col.spawnQueue = Math.min(stockCounts[i] ?? col.conf.capacity, col.conf.capacity);
      col.spawnTimer = 0.05 + i * 0.11;   // コラムごとに時間差
    });
  }

  /** 店員: 1本補充 (在庫数を返す。満杯なら -1) */
  restock(colIndex) {
    const col = this.cols[colIndex];
    if (col.stock.length + col.spawnQueue >= col.conf.capacity) return -1;
    this._spawnProduct(col);
    return col.stock.length;
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
    const col = this.cols[colIndex];
    return col.stock.length === 0 && col.spawnQueue === 0;
  }

  stockCount(colIndex) {
    const col = this.cols[colIndex];
    return col.stock.length + col.spawnQueue;
  }

  /* ---------------- 取出口 ---------------- */
  portBodies() {
    return this.world.bodies.filter(b => b.userData.kind === 'product' && b.userData.atPort);
  }

  /** 取出口の商品を取る → body リストを返す (演出は呼び側) */
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
      // 初期投入 (時間差で1本ずつ)
      if (col.spawnQueue > 0) {
        col.spawnTimer -= dt;
        if (col.spawnTimer <= 0) {
          col.spawnQueue--;
          col.spawnTimer = 0.55;
          this._spawnProduct(col, true);
        }
      }
      // ベンドサイクル
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
      if (crossed(C.lowerIn)) {
        col.pinLower.enabled = true;
      }
      if (crossed(C.upperOut)) {
        col.pinUpper.enabled = false;
        // 列全体を起こして前進させる
        this.world.wakeLayer(col.layer);
      }
      if (t1 >= C.done) {
        if (!col.vendDetected && col.vendRetries < 2) {
          // 販売検知センサーが反応しない (商品がピンまで届いていない):
          // 実機同様にもう1サイクル回してリトライ
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
    this.world.wakeArea(col.layer, RACK.zBack, RACK.exitY - 0.15, RACK.zFront, RACK.exitY + 0.35);
  }

  _onExit(col, body) {
    const i = col.stock.indexOf(body);
    if (i >= 0) col.stock.splice(i, 1);
    body.userData.inChute = true;
    col.vendDetected = true;    // 販売検知センサー
    this.emit('productExit', { col: col.index, body });
  }

  _onAtPort(col, body) {
    body.userData.atPort = true;
    this.emit('productAtPort', { col: col.index, body });
  }
}
