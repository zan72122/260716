/* ============================================================
   physics.js — 自販機専用 2D 平面物理エンジン (THREE 非依存)
   ・剛体: 円盤 (硬貨 / 缶・ペットの断面)
   ・静的コライダ: 線分 (レール / 棚 / 壁)。硬貨フィルタ対応
   ・キネマティック線分: ゲート / フリッパー / ベンドピン
   ・ヒンジ剛体: バネ付きフラップ (取出口の「ガコンッ」)
   ・センサー線分: 通過検知 → 状態機械を駆動
   ・固定ステップ + 逐次インパルス + スリープ + 接触イベント
   レイヤー: 同一 layer 同士のみ衝突 (メック面 / 各コラム面)
   ============================================================ */
import { PHYS } from './config.js';

let _nextId = 1;

export class Disc {
  constructor(opts) {
    this.id = _nextId++;
    this.layer = opts.layer;
    this.r = opts.r;
    this.m = opts.m ?? 0.005;
    this.invM = 1 / this.m;
    this.I = 0.5 * this.m * this.r * this.r;   // 円盤の慣性モーメント
    this.invI = 1 / this.I;
    this.x = opts.x; this.y = opts.y;
    this.px = opts.x; this.py = opts.y;        // 前ステップ位置 (描画補間用)
    this.angle = 0; this.pangle = 0;
    this.vx = opts.vx ?? 0; this.vy = opts.vy ?? 0;
    this.w = opts.w ?? 0;
    this.restitution = opts.restitution ?? 0.25;
    this.friction = opts.friction ?? 0.35;
    this.rollResist = opts.rollResist ?? 0.12; // 転がり抵抗 (角速度減衰)
    this.maxSpeed = opts.maxSpeed ?? (0.6 * this.r / PHYS.h);
    this.sleeping = false;
    this.sleepTimer = 0;
    this.canSleep = opts.canSleep ?? true;
    this.userData = opts.userData ?? {};
    this.dead = false;
  }
  wake() { this.sleeping = false; this.sleepTimer = 0; }
}

/* 静的 or キネマティック線分コライダ */
export class Seg {
  constructor(opts) {
    this.id = _nextId++;
    this.layer = opts.layer;
    this.ax = opts.a[0]; this.ay = opts.a[1];
    this.bx = opts.b[0]; this.by = opts.b[1];
    this.restitution = opts.restitution ?? 0.2;
    this.friction = opts.friction ?? 0.4;
    this.enabled = opts.enabled ?? true;
    this.filter = opts.filter ?? null;   // (body)=>bool 衝突するなら true
    this.vx = 0; this.vy = 0;            // 表面速度 (キネマティック用)
    this.material = opts.material ?? 'steel';
    this.tag = opts.tag ?? null;
  }
  set(a, b) { this.ax = a[0]; this.ay = a[1]; this.bx = b[0]; this.by = b[1]; }
}

/* バネ付きヒンジ線分 (フラップ)。angle=0 が閉。 */
export class HingeFlap {
  constructor(opts) {
    this.id = _nextId++;
    this.layer = opts.layer;
    this.px_ = opts.pivot[0]; this.py_ = opts.pivot[1];
    this.len = opts.len;
    this.restAngle = opts.restAngle ?? 0;   // 垂れ下がり角 (真下=0)
    this.angle = 0;                          // restAngle からの開き
    this.pangleH = 0;
    this.w = 0;
    this.I = opts.inertia ?? 0.004;
    this.invI = 1 / this.I;
    this.k = opts.k ?? 20;                   // バネ
    this.c = opts.c ?? 0.3;                  // 減衰
    this.min = opts.min ?? 0;
    this.max = opts.max ?? 1.0;
    this.restitution = 0.1;
    this.friction = 0.3;
    this.material = opts.material ?? 'flap';
    this.torque = 0;                          // 外部トルク (演出用)
    this.enabled = true;
  }
  /* 現在角の端点 (0 = 真下からrestAngle傾き, +angle で開く) */
  tip(angleOverride = null) {
    const a = (angleOverride ?? this.angle) + this.restAngle;
    // 真下方向から +a で回転 (開くと +u 側へ)
    return [this.px_ + Math.sin(a) * this.len, this.py_ - Math.cos(a) * this.len];
  }
}

/* センサー線分: 剛体中心の通過を検知 */
export class Sensor {
  constructor(opts) {
    this.id = _nextId++;
    this.layer = opts.layer;
    this.ax = opts.a[0]; this.ay = opts.a[1];
    this.bx = opts.b[0]; this.by = opts.b[1];
    this.tag = opts.tag;
    this.cb = opts.cb;
    this.fired = new Set();
    this.enabled = true;
  }
  side(x, y) {
    return (this.bx - this.ax) * (y - this.ay) - (this.by - this.ay) * (x - this.ax);
  }
  within(x, y) {
    const dx = this.bx - this.ax, dy = this.by - this.ay;
    const t = ((x - this.ax) * dx + (y - this.ay) * dy) / (dx * dx + dy * dy);
    return t >= 0 && t <= 1;
  }
}

export class World {
  constructor() {
    this.bodies = [];
    this.segs = [];
    this.flaps = [];
    this.sensors = [];
    this.onContact = null;   // (info)=>{}  info: {body, other, jn, x, y, material}
    this.time = 0;
    this._contacts = [];
  }

  addBody(b) { this.bodies.push(b); return b; }
  addSeg(s) { this.segs.push(s); this._segsDirty = true; return s; }
  addFlap(f) { this.flaps.push(f); this._segsDirty = true; return f; }
  addSensor(s) { this.sensors.push(s); return s; }
  removeBody(b) {
    b.dead = true;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    for (const s of this.sensors) s.fired.delete(b.id);
  }

  /* 範囲内の剛体を起こす (ゲート/ピン切替時) */
  wakeArea(layer, x0, y0, x1, y1) {
    for (const b of this.bodies) {
      if (b.layer !== layer) continue;
      if (b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1) b.wake();
    }
  }
  wakeLayer(layer) {
    for (const b of this.bodies) if (b.layer === layer) b.wake();
  }

  step(h) {
    this.time += h;
    const g = PHYS.gravity;
    // ---- 積分 (速度) ----
    for (const b of this.bodies) {
      if (b.sleeping) continue;
      b.px = b.x; b.py = b.y; b.pangle = b.angle;
      b.vy -= g * h;
      const drag = 1 - PHYS.airDrag * h;
      b.vx *= drag; b.vy *= drag;
      b.w *= 1 - b.rollResist * h;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > b.maxSpeed) { const k = b.maxSpeed / sp; b.vx *= k; b.vy *= k; }
    }
    // ---- フラップ積分 ----
    for (const f of this.flaps) {
      f.pangleH = f.angle;
      const tau = -f.k * f.angle - f.c * f.w + f.torque;
      f.w += tau * f.invI * h;
      f.angle += f.w * h;
      if (f.angle < f.min) { f.angle = f.min; if (f.w < 0) f.w = -f.w * 0.1; }
      if (f.angle > f.max) { f.angle = f.max; if (f.w > 0) f.w = -f.w * 0.15; }
      f.torque = 0;
    }
    // ---- 接触検出 (レイヤー別バケツで探索を限定) ----
    const contacts = this._contacts;
    contacts.length = 0;
    const bodies = this.bodies;
    // 静的コライダのレイヤー索引はキャッシュ (追加時に無効化)
    if (!this._segsByLayer || this._segsDirty) {
      this._segsByLayer = new Map();
      for (const s of this.segs) {
        let arr = this._segsByLayer.get(s.layer);
        if (!arr) this._segsByLayer.set(s.layer, arr = []);
        arr.push(s);
      }
      this._flapsByLayer = new Map();
      for (const f of this.flaps) {
        let arr = this._flapsByLayer.get(f.layer);
        if (!arr) this._flapsByLayer.set(f.layer, arr = []);
        arr.push(f);
      }
      this._segsDirty = false;
    }
    // 剛体のレイヤーバケツ (毎ステップ構築: レイヤーは動的に変わる)
    const buckets = this._buckets ?? (this._buckets = new Map());
    for (const arr of buckets.values()) arr.length = 0;
    for (const b of bodies) {
      let arr = buckets.get(b.layer);
      if (!arr) buckets.set(b.layer, arr = []);
      arr.push(b);
    }
    for (const b of bodies) {
      if (!b.sleeping) {
        // 対 線分
        const segs = this._segsByLayer.get(b.layer);
        if (segs) for (const s of segs) {
          if (!s.enabled) continue;
          if (s.filter && !s.filter(b)) continue;
          const c = discSeg(b, s.ax, s.ay, s.bx, s.by);
          if (c) contacts.push({ b, s, nx: c.nx, ny: c.ny, pen: c.pen, cx: c.cx, cy: c.cy, jn: 0, jt: 0, flap: null, b2: null });
        }
        // 対 フラップ
        const flaps = this._flapsByLayer.get(b.layer);
        if (flaps) for (const f of flaps) {
          if (!f.enabled) continue;
          const tip = f.tip();
          const c = discSeg(b, f.px_, f.py_, tip[0], tip[1]);
          if (c) contacts.push({ b, s: f, nx: c.nx, ny: c.ny, pen: c.pen, cx: c.cx, cy: c.cy, jn: 0, jt: 0, flap: f, b2: null });
        }
      }
    }
    // 対 剛体 (同一レイヤー内のみ)
    for (const group of buckets.values()) {
      for (let i = 0; i < group.length; i++) {
        const b = group[i];
        for (let j = i + 1; j < group.length; j++) {
          const oj = group[j];
          if (b.sleeping && oj.sleeping) continue;
        // A = 起きている側, B = 相手
        let A = b, B = oj;
        if (A.sleeping) { A = oj; B = b; }
        const dx = B.x - A.x, dy = B.y - A.y;
        const rr = A.r + B.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 === 0) continue;
        const d = Math.sqrt(d2);
        // 法線は B → A 向き (「A から離れる」規約)
        const nx = -dx / d, ny = -dy / d;
        let staticOther = false;
        if (B.sleeping) {
          // 静かな接触ならスリープを保ち、相手を静的物体として扱う
          // (覚醒の連鎖伝播で山や列が永遠に眠れなくなるのを防ぐ)
          const appr = A.vx * nx + A.vy * ny;
          if (appr < -0.06) B.wake();
          else staticOther = true;
        }
        contacts.push({
          b: A, s: null, b2: B, nx, ny, pen: rr - d, staticOther,
          cx: A.x - nx * A.r, cy: A.y - ny * A.r, jn: 0, jt: 0, flap: null,
        });
        }
      }
    }
    // ---- 逐次インパルス ----
    for (let iter = 0; iter < PHYS.solverIters; iter++) {
      for (const c of contacts) solveContact(c, iter === 0);
    }
    // ---- 位置積分 & 補正 ----
    for (const b of this.bodies) {
      if (b.sleeping) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.angle += b.w * h;
    }
    for (const c of contacts) correctPosition(c);
    // ---- スリープ判定 ----
    for (const b of this.bodies) {
      if (b.sleeping || !b.canSleep) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp < PHYS.sleepVel && Math.abs(b.w) < PHYS.sleepAngVel) {
        b.sleepTimer += h;
        if (b.sleepTimer > PHYS.sleepTime) {
          b.sleeping = true; b.vx = 0; b.vy = 0; b.w = 0;
          b.px = b.x; b.py = b.y; b.pangle = b.angle;
        }
      } else {
        b.sleepTimer = 0;
      }
    }
    // ---- 接触イベント (音・演出) ----
    if (this.onContact) {
      for (const c of contacts) {
        if (c.jn > 0.0008) {
          this.onContact({
            body: c.b, other: c.b2 ?? c.s, jn: c.jn,
            x: c.cx, y: c.cy,
            material: c.b2 ? 'coin2' : (c.s.material ?? 'steel'),
          });
        }
      }
    }
    // ---- センサー ----
    for (const sen of this.sensors) {
      if (!sen.enabled) continue;
      for (const b of this.bodies) {
        if (b.layer !== sen.layer || b.sleeping || sen.fired.has(b.id)) continue;
        const s0 = sen.side(b.px, b.py), s1 = sen.side(b.x, b.y);
        if (s0 !== 0 && s1 !== 0 && (s0 > 0) !== (s1 > 0) && sen.within(b.x, b.y)) {
          sen.fired.add(b.id);
          sen.cb(b, sen);
        }
      }
    }
  }
}

/* ---- 円盤 vs 線分 接触 ---- */
function discSeg(b, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = b.x - ax, apy = b.y - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const cx = ax + abx * t, cy = ay + aby * t;
  const dx = b.x - cx, dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= b.r * b.r || d2 === 0) return null;
  const d = Math.sqrt(d2);
  return { nx: dx / d, ny: dy / d, pen: b.r - d, cx, cy };
}

/* ---- 接触の解決 (法線 + 摩擦 + 転がり) ---- */
function solveContact(c, first) {
  const b = c.b;
  const nx = c.nx, ny = c.ny;
  // 接触点の相対速度
  const rbx = c.cx - b.x, rby = c.cy - b.y;
  let vbx = b.vx - b.w * rby, vby = b.vy + b.w * rbx;
  let vox = 0, voy = 0, invM2 = 0, invI2 = 0, rox = 0, roy = 0, o = null, flap = null;
  if (c.b2 && !c.staticOther) {
    o = c.b2;
    rox = c.cx - o.x; roy = c.cy - o.y;
    vox = o.vx - o.w * roy; voy = o.vy + o.w * rox;
    invM2 = o.invM; invI2 = o.invI;
  } else if (c.b2) {
    // 相手はスリープ中: 静的物体として扱う (速度0・無限質量)
  } else if (c.flap) {
    flap = c.flap;
    // ピボット回りの回転速度
    const rfx = c.cx - flap.px_, rfy = c.cy - flap.py_;
    vox = -flap.w * rfy; voy = flap.w * rfx;
  } else {
    vox = c.s.vx; voy = c.s.vy;
  }
  const rvx = vbx - vox, rvy = vby - voy;
  const vn = rvx * nx + rvy * ny;
  const e = first && vn < -0.15 ? Math.min(b.restitution, (c.b2 ?? c.s).restitution ?? 0.2) : 0;
  // 有効質量 (法線)
  const rbn = rbx * ny - rby * nx;
  let kn = b.invM + b.invI * rbn * rbn;
  if (o) { const ron = rox * ny - roy * nx; kn += invM2 + invI2 * ron * ron; }
  if (flap) {
    const rfx = c.cx - flap.px_, rfy = c.cy - flap.py_;
    const rfn = rfx * ny - rfy * nx;
    kn += flap.invI * rfn * rfn;
  }
  let jn = -(1 + e) * vn / kn;
  const jn0 = c.jn;
  c.jn = Math.max(0, jn0 + jn);
  jn = c.jn - jn0;
  b.vx += nx * jn * b.invM;
  b.vy += ny * jn * b.invM;
  b.w += (rbx * ny - rby * nx) * jn * b.invI;
  if (o) {
    o.vx -= nx * jn * invM2;
    o.vy -= ny * jn * invM2;
    o.w -= (rox * ny - roy * nx) * jn * invI2;
  }
  if (flap) {
    const rfx = c.cx - flap.px_, rfy = c.cy - flap.py_;
    flap.w -= (rfx * ny - rfy * nx) * jn * flap.invI;
  }
  // ---- 摩擦 (接線) ----
  const tx = -ny, ty = nx;
  // 再計算した相対速度
  vbx = b.vx - b.w * rby; vby = b.vy + b.w * rbx;
  if (o) { vox = o.vx - o.w * roy; voy = o.vy + o.w * rox; }
  else if (flap) {
    const rfx = c.cx - flap.px_, rfy = c.cy - flap.py_;
    vox = -flap.w * rfy; voy = flap.w * rfx;
  }
  const vt = (vbx - vox) * tx + (vby - voy) * ty;
  const rbt = rbx * ty - rby * tx;
  let kt = b.invM + b.invI * rbt * rbt;
  if (o) { const rot = rox * ty - roy * tx; kt += invM2 + invI2 * rot * rot; }
  let jt = -vt / kt;
  // 剛体同士は低摩擦 (缶同士は滑る。列の逆回転ロックを防ぐ)
  const mu = c.b2
    ? Math.min(b.friction, c.b2.friction) * 0.3
    : Math.sqrt(b.friction * (c.s.friction ?? 0.4));
  const maxJt = mu * c.jn;
  const jt0 = c.jt;
  c.jt = Math.max(-maxJt, Math.min(maxJt, jt0 + jt));
  jt = c.jt - jt0;
  b.vx += tx * jt * b.invM;
  b.vy += ty * jt * b.invM;
  b.w += (rbx * ty - rby * tx) * jt * b.invI;
  if (o) {
    o.vx -= tx * jt * invM2;
    o.vy -= ty * jt * invM2;
    o.w -= (rox * ty - roy * tx) * jt * invI2;
  }
}

/* ---- 位置補正 (めり込み解消) ---- */
function correctPosition(c) {
  const pen = c.pen - PHYS.slop;
  if (pen <= 0) return;
  const k = PHYS.posCorrect * pen;
  const b = c.b;
  if (c.b2 && !c.staticOther) {
    // n は o → b 向き: b を +n へ、o を -n へ離す
    const o = c.b2;
    const tot = b.invM + o.invM;
    b.x += c.nx * k * (b.invM / tot);
    b.y += c.ny * k * (b.invM / tot);
    o.x -= c.nx * k * (o.invM / tot);
    o.y -= c.ny * k * (o.invM / tot);
  } else {
    b.x += c.nx * k;
    b.y += c.ny * k;
  }
}
