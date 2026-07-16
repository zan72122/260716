/* =========================================================
 * 砂と磁石のシミュレーション
 *
 * 粒の状態:
 *   0 SETTLED   … その場に寝ている(置かれた場所に残る)
 *   1 CAPTURED  … 磁石に捕まり、砂山スロットへばねで追従
 *   2 LOOSE     … 解放されて滑走中(減速して SETTLED へ)
 *   3 SMOOTHING … ならし波に押されて新しい場所へ移動中
 *
 * ポイント:
 *  - 捕獲はスロット方式: 粒ごとに砂山内の席(半径・角度)を持つ。
 *    捕獲順に外側の席が割り当てられるため、色が年輪状の
 *    マーブル模様になる。
 *  - ばね追従に粒ごとのゆらぎがあるため、磁石を動かすと
 *    尾を引き、速く動かすとちぎれて軌跡が残る。
 *  - 2磁石が近づくと、相手方向の席の粒ほど相手側へ
 *    引き伸ばされ、両側から橋が育つ。
 * ======================================================= */
"use strict";

var SETTLED = 0, CAPTURED = 1, LOOSE = 2, SMOOTHING = 3;

function Sim() {
  var MAXN = CONFIG.particle.maxCount;

  /* ---- 粒データ(構造体の代わりの並列配列) ---- */
  this.px = new Float32Array(MAXN);
  this.py = new Float32Array(MAXN);
  this.vx = new Float32Array(MAXN);
  this.vy = new Float32Array(MAXN);
  this.slotR = new Float32Array(MAXN);   // 砂山内の席(半径)
  this.slotA = new Float32Array(MAXN);   // 席の角度 / 寝ている時は向き
  this.kJit = new Float32Array(MAXN);    // ばね強さの個体差
  this.bridgeAff = new Float32Array(MAXN); // 橋への参加しやすさ
  this.standJit = new Float32Array(MAXN);  // 立ち上がりやすさの個体差
  this.flash = new Float32Array(MAXN);   // 光っている残り時間
  this.tx = new Float32Array(MAXN);      // ならし波の行き先
  this.ty = new Float32Array(MAXN);
  this.state = new Uint8Array(MAXN);
  this.mag = new Uint8Array(MAXN);       // 捕獲元の磁石番号
  this.colorIdx = new Uint8Array(MAXN);
  this.waved = new Uint8Array(MAXN);     // 今回のならし波を受けたか

  /* ---- 描画用(update で計算し render が読む) ---- */
  this.dirX = new Float32Array(MAXN);
  this.dirY = new Float32Array(MAXN);
  this.len = new Float32Array(MAXN);
  this.bright = new Uint8Array(MAXN);    // 0 くらい / 1 ふつう / 2 あかるい

  this.count = 0;
  this.W = 0; this.H = 0;
  this.trayL = 0; this.trayT = 0; this.trayR = 0; this.trayB = 0;

  /* ---- 磁石 ---- */
  this.magnets = [
    this._newMagnet(0),
    this._newMagnet(1),
  ];

  /* ---- ならし波 ---- */
  this.shakeActive = false;
  this.shakeT = 0;
  this.shakeMaxDist = 0;
  this.waveTick = 1; // waved[] と比較する世代カウンタ

  /* ---- 音・演出用の集計 ---- */
  this.capturedCount = 0;
  this.moundCount = [0, 0];
  this.avgCapSpeed = 0;   // 捕獲粒の平均速度(EMA)
  this.excited = false;   // 動きが大きかった後か(ふわっ音用)
  this.events = [];       // このフレームで起きたこと("merge" など)
}

Sim.prototype._newMagnet = function (i) {
  return {
    active: false,
    x: 0, y: 0,
    prevX: 0, prevY: 0,
    speedX: 0, speedY: 0, speed: 0,
    heading: 0,
    slotRot: 0, slotRotVel: 0,   // 砂山の渦回転
    cosR: 1, sinR: 0,
    moundR: CONFIG.magnet.moundBase,
    glideX: 0, glideY: 0, gliding: false,
    dragId: -1,                  // 掴んでいるポインタ
    dragT: 0,                    // 掴んでからの経過(持ち上げ演出)
    grabDX: 0, grabDY: 0,        // 掴んだ瞬間の指とのずれ
    style: i,
    wobble: 0,
  };
};

/* ================= 初期化・リサイズ ================= */

Sim.prototype.setup = function (w, h, count) {
  this.W = w; this.H = h;
  this._updateTray();
  this.count = Math.min(count, CONFIG.particle.maxCount);

  for (var i = 0; i < this.count; i++) this._initParticle(i, true);

  // 磁石1: 画面下の中央に置く
  var m = this.magnets[0];
  m.active = true;
  m.x = w * 0.5;
  m.y = h * 0.78;
  m.prevX = m.x; m.prevY = m.y;
  this.magnets[1].active = false;

  this.capturedCount = 0;
  this.moundCount = [0, 0];
};

Sim.prototype._updateTray = function () {
  var mgn = Math.max(14, Math.min(this.W, this.H) * 0.035);
  this.trayL = mgn; this.trayT = mgn;
  this.trayR = this.W - mgn; this.trayB = this.H - mgn;
};

/* 粒を初期化。banded=true なら斜めの色帯(手入れされた庭の初期模様) */
Sim.prototype._initParticle = function (i, banded) {
  var u = Math.random(), v = Math.random();
  this.px[i] = this.trayL + u * (this.trayR - this.trayL);
  this.py[i] = this.trayT + v * (this.trayB - this.trayT);
  this.vx[i] = 0; this.vy[i] = 0;
  this.state[i] = SETTLED;
  this.slotA[i] = Math.random() * 6.2832;
  this.kJit[i] = 0.7 + Math.random() * 0.6;
  this.bridgeAff[i] = Math.random();
  this.standJit[i] = 0.65 + Math.random() * 1.6;
  this.flash[i] = 0;
  this.waved[i] = 0;

  var nColors = THEMES[0].sand.length;
  if (banded) {
    // 斜めの帯 + 2割の混ぜ込みで、最初からマーブルの気配を出す
    var band = Math.floor(((u + v) * 0.5) * nColors * 1.7) % nColors;
    this.colorIdx[i] = (Math.random() < 0.2)
      ? Math.floor(Math.random() * nColors)
      : band;
  } else {
    this.colorIdx[i] = Math.floor(Math.random() * nColors);
  }
};

Sim.prototype.resize = function (w, h) {
  if (this.W === 0 || this.H === 0) { this.setup(w, h, this.count || CONFIG.particle.baseCount); return; }
  var sx = w / this.W, sy = h / this.H;
  for (var i = 0; i < this.count; i++) {
    this.px[i] *= sx; this.py[i] *= sy;
    this.tx[i] *= sx; this.ty[i] *= sy;
  }
  for (var m = 0; m < 2; m++) {
    var mg = this.magnets[m];
    mg.x *= sx; mg.y *= sy;
    mg.prevX = mg.x; mg.prevY = mg.y;
    mg.glideX *= sx; mg.glideY *= sy;
  }
  this.W = w; this.H = h;
  this._updateTray();
};

/* 性能に合わせて粒数を変える */
Sim.prototype.setCount = function (n) {
  n = Math.max(CONFIG.particle.minCount, Math.min(CONFIG.particle.maxCount, Math.floor(n)));
  if (n < this.count) {
    for (var i = n; i < this.count; i++) {
      if (this.state[i] === CAPTURED) this.moundCount[this.mag[i]]--;
    }
  } else {
    for (var j = this.count; j < n; j++) this._initParticle(j, false);
  }
  this.count = n;
};

/* ================= 磁石の操作(input.js から呼ばれる) ================= */

/* 指の位置 fx,fy で磁石 mi を掴む */
Sim.prototype.grabMagnet = function (mi, pointerId, fx, fy) {
  var m = this.magnets[mi];
  m.dragId = pointerId;
  m.dragT = 0;
  m.gliding = false;
  m.grabDX = m.x - fx;
  m.grabDY = m.y - fy;
};

/* ドラッグ中: 指より少し上に磁石を出す(指隠れ防止)。
   掴んだ瞬間のずれから持ち上げ位置へなめらかに移行する */
Sim.prototype.dragMagnet = function (mi, fx, fy) {
  var m = this.magnets[mi];
  var t = Math.min(1, m.dragT / CONFIG.magnet.liftTime);
  var e = t * t * (3 - 2 * t);
  var ox = m.grabDX * (1 - e);
  var oy = m.grabDY * (1 - e) - CONFIG.magnet.liftOffset * e;
  m.x = fx + ox;
  m.y = fy + oy;
  this._clampMagnet(m);
};

Sim.prototype.releaseMagnet = function (mi) {
  this.magnets[mi].dragId = -1;
};

/* タップ: 2個目を置く、または近い磁石の行き先を示す */
Sim.prototype.tapAt = function (x, y) {
  var m2 = this.magnets[1];
  if (!m2.active) {
    m2.active = true;
    m2.x = x; m2.y = y;
    m2.prevX = x; m2.prevY = y;
    m2.slotRot = 0; m2.slotRotVel = 0;
    m2.gliding = false;
    m2.wobble = 1;
    this.moundCount[1] = 0;
    this.events.push("place");
    return "place";
  }
  // どちらか近い方が滑っていく
  var m0 = this.magnets[0];
  var d0 = (m0.x - x) * (m0.x - x) + (m0.y - y) * (m0.y - y);
  var d1 = (m2.x - x) * (m2.x - x) + (m2.y - y) * (m2.y - y);
  var m = (d0 <= d1) ? m0 : m2;
  if (m.dragId !== -1) m = (m === m0) ? m2 : m0;   // ドラッグ中の磁石は選ばない
  if (m.dragId !== -1) return null;
  m.gliding = true;
  m.glideX = x; m.glideY = y;
  this.events.push("go");
  return "go";
};

Sim.prototype.nearestMagnet = function (x, y) {
  var best = -1, bestD = Infinity;
  for (var i = 0; i < 2; i++) {
    var m = this.magnets[i];
    if (!m.active || m.dragId !== -1) continue;
    var d = Math.hypot(m.x - x, m.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { index: best, dist: bestD };
};

Sim.prototype._clampMagnet = function (m) {
  var pad = 8;
  if (m.x < this.trayL + pad) m.x = this.trayL + pad;
  if (m.x > this.trayR - pad) m.x = this.trayR - pad;
  if (m.y < this.trayT + pad) m.y = this.trayT + pad;
  if (m.y > this.trayB - pad) m.y = this.trayB - pad;
};

/* ================= ならし(シェイク) ================= */

Sim.prototype.startShake = function () {
  if (this.shakeActive) return false;
  this.shakeActive = true;
  this.shakeT = 0;
  this.shakeMaxDist = Math.min(this.W, this.H) * 0.5 + 4;
  this.waveTick = (this.waveTick % 250) + 1;   // 新しい波の世代
  this.events.push("shake");
  return true;
};

/* ================= メイン更新 ================= */

Sim.prototype.update = function (dt) {
  var C = CONFIG;
  this.events.length = 0;

  /* ---- 磁石 ---- */
  for (var mi = 0; mi < 2; mi++) {
    var m = this.magnets[mi];
    if (!m.active) continue;

    if (m.dragId !== -1) m.dragT += dt;

    if (m.gliding) {
      var gdx = m.glideX - m.x, gdy = m.glideY - m.y;
      var gd = Math.hypot(gdx, gdy);
      var step = C.magnet.glideSpeed * dt;
      if (gd <= step + 1) {
        m.x = m.glideX; m.y = m.glideY;
        m.gliding = false;
      } else {
        m.x += gdx / gd * step;
        m.y += gdy / gd * step;
      }
      this._clampMagnet(m);
    }

    // 速度と向き
    m.speedX = (m.x - m.prevX) / dt;
    m.speedY = (m.y - m.prevY) / dt;
    m.speed = Math.hypot(m.speedX, m.speedY);
    if (m.speed > 30) {
      var h = Math.atan2(m.speedY, m.speedX);
      var dh = h - m.heading;
      while (dh > Math.PI) dh -= 6.2832;
      while (dh < -Math.PI) dh += 6.2832;
      m.heading = h;
      // 向きの変化(円運動)が砂山の渦回転になる
      m.slotRotVel += dh * C.magnet.swirlGain;
    }
    m.slotRotVel *= Math.exp(-C.magnet.swirlDecay * dt);
    m.slotRot += m.slotRotVel * dt;
    m.cosR = Math.cos(m.slotRot);
    m.sinR = Math.sin(m.slotRot);
    m.moundR = C.magnet.moundBase + C.magnet.moundGrain * Math.sqrt(this.moundCount[mi]);
    m.wobble = Math.max(0, m.wobble - dt * 2.5);
    m.prevX = m.x; m.prevY = m.y;
  }

  /* ---- 合体(磁石を重ねると1個に戻る) ---- */
  var m0 = this.magnets[0], m1 = this.magnets[1];
  if (m0.active && m1.active) {
    var mdx = m0.x - m1.x, mdy = m0.y - m1.y;
    if (Math.hypot(mdx, mdy) < C.magnet.mergeDist && !(m0.dragId !== -1 && m1.dragId !== -1)) {
      this._mergeMagnets();
    }
  }

  /* ---- 橋の係数 ---- */
  var bridgeB = 0, abX = 0, abY = 0, mDist = 0;
  if (m0.active && m1.active) {
    var bdx = m1.x - m0.x, bdy = m1.y - m0.y;
    mDist = Math.hypot(bdx, bdy);
    if (mDist > 1) {
      var range = C.bridge.range + m0.moundR + m1.moundR;
      var raw = 1 - mDist / range;
      if (raw > 0) {
        raw = Math.pow(raw, 0.8);
        bridgeB = raw * raw * (3 - 2 * raw);
        abX = bdx / mDist; abY = bdy / mDist;
      }
    }
  }

  /* ---- ならし波の前線 ---- */
  var waveFront = -1;
  if (this.shakeActive) {
    this.shakeT += dt;
    waveFront = (this.shakeT / C.shake.waveTime) * this.shakeMaxDist;
    if (this.shakeT > C.shake.waveTime + 0.4) this.shakeActive = false;
  }

  /* ---- 粒 ---- */
  var fieldR = C.magnet.fieldRadius;
  var minLen = C.particle.minLen, maxLen = C.particle.maxLen;
  var bt1 = C.field.brightThreshold1, bt2 = C.field.brightThreshold2;
  var capSpeedSum = 0, capN = 0;

  for (var i = 0; i < this.count; i++) {
    var st = this.state[i];
    var x = this.px[i], y = this.py[i];

    /* -- ならし波が通過したら SMOOTHING へ -- */
    if (waveFront >= 0 && this.waved[i] !== this.waveTick) {
      var edgeD = Math.min(x - this.trayL, this.trayR - x, y - this.trayT, this.trayB - y);
      if (edgeD < 0) edgeD = 0;
      if (waveFront >= edgeD) {
        this.waved[i] = this.waveTick;
        if (st === CAPTURED) this.moundCount[this.mag[i]]--;
        st = SMOOTHING;
        this.state[i] = SMOOTHING;
        this.tx[i] = this.trayL + Math.random() * (this.trayR - this.trayL);
        this.ty[i] = this.trayT + Math.random() * (this.trayB - this.trayT);
        this.flash[i] = C.shake.flashTime;
        this.vx[i] += (Math.random() - 0.5) * 160;
        this.vy[i] += (Math.random() - 0.5) * 160;
      }
    }

    if (this.flash[i] > 0) this.flash[i] -= dt;

    /* ================= 状態ごとの更新 ================= */
    if (st === SETTLED || st === LOOSE) {

      /* 場の強さ(触る前のヒントにも使う) */
      var sBest = 0, sbx = 0, sby = 0, sSum = 0, capM = -1;
      for (var k = 0; k < 2; k++) {
        var mg = this.magnets[k];
        if (!mg.active) continue;
        var ddx = mg.x - x, ddy = mg.y - y;
        var dd = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dd < fieldR && dd > 0.001) {
          var s = 1 - dd / fieldR; s = s * s;
          sSum += s;
          if (s > sBest) { sBest = s; sbx = ddx / dd; sby = ddy / dd; capM = k; }
        }
      }

      /* 捕獲判定(場が強いほど早く捕まる → 遅れて集まる見え方) */
      if (capM >= 0 && !this.shakeActive) {
        var p = 1 - Math.exp(-C.magnet.captureRate * sBest * dt);
        if (Math.random() < p) {
          this._capture(i, capM);
          st = CAPTURED;
        }
      }

      if (st === LOOSE) {
        /* 滑走 → 減速して定着 */
        var f = Math.exp(-C.particle.restFriction * dt);
        this.vx[i] *= f; this.vy[i] *= f;
        x += this.vx[i] * dt; y += this.vy[i] * dt;
        var sp2 = Math.hypot(this.vx[i], this.vy[i]);
        if (sp2 < C.particle.restSpeed) {
          this.state[i] = SETTLED;
          if (sp2 > 0.5) this.slotA[i] = Math.atan2(this.vy[i], this.vx[i]);
          this.vx[i] = 0; this.vy[i] = 0;
        }
        this.dirX[i] = sp2 > 1 ? this.vx[i] / sp2 : Math.cos(this.slotA[i]);
        this.dirY[i] = sp2 > 1 ? this.vy[i] / sp2 : Math.sin(this.slotA[i]);
        this.len[i] = Math.min(maxLen, minLen + sp2 * 0.02 + sSum * 4);
        this.bright[i] = 1;
      } else if (st === SETTLED) {
        /* 寝ている粒。近くに磁石があれば「立ち上がって」向きを示す */
        var stand = sSum * this.standJit[i];
        if (stand > CONFIG.field.standThreshold) {
          this.dirX[i] = sbx; this.dirY[i] = sby;
          this.len[i] = minLen + Math.min(1, stand) * (maxLen - minLen) * 0.8;
          this.bright[i] = stand > bt2 ? 2 : (stand > bt1 ? 1 : 0);
        } else {
          this.dirX[i] = Math.cos(this.slotA[i]);
          this.dirY[i] = Math.sin(this.slotA[i]);
          this.len[i] = minLen;
          this.bright[i] = 0;
        }
      }
    }

    if (st === CAPTURED) {
      var mgc = this.magnets[this.mag[i]];
      if (!mgc.active) { this.state[i] = LOOSE; st = LOOSE; }
      else {
        /* 席の位置(渦回転込み) */
        var a = this.slotA[i];
        var ca = Math.cos(a), sa = Math.sin(a);
        var lx = this.slotR[i] * (ca * mgc.cosR - sa * mgc.sinR);
        var ly = this.slotR[i] * (ca * mgc.sinR + sa * mgc.cosR);
        var txp = mgc.x + lx, typ = mgc.y + ly;

        /* 橋: 相手方向の席の粒は相手側へ引き伸ばされる */
        if (bridgeB > 0 && this.bridgeAff[i] > 0.12) {
          var toX = (this.mag[i] === 0) ? abX : -abX;
          var toY = (this.mag[i] === 0) ? abY : -abY;
          var slotLen = this.slotR[i] > 0.5 ? this.slotR[i] : 0.5;
          var align = (lx * toX + ly * toY) / slotLen;
          if (align > 0) {
            var cone = align * align * align;   // coneSharpness=3
            var edgeBias = 0.35 + 0.65 * Math.min(1, this.slotR[i] / (mgc.moundR + 1));
            var stretch = bridgeB * cone * this.bridgeAff[i] * edgeBias * mDist * C.bridge.reach;
            txp += toX * stretch;
            typ += toY * stretch;
            if (stretch > mDist * 0.22) this.flash[i] = Math.max(this.flash[i], 0.05);
          }
        }

        var ex = txp - x, ey = typ - y;
        var er = ex * ex + ey * ey;

        /* 磁石が速く逃げると尾がちぎれて、粒はその場に残る */
        if (er > C.magnet.releaseDist * C.magnet.releaseDist) {
          this.state[i] = LOOSE;
          this.moundCount[this.mag[i]]--;
        } else {
          var kk = C.magnet.springK * this.kJit[i];
          this.vx[i] += (ex * kk - this.vx[i] * C.magnet.springDamp) * dt;
          this.vy[i] += (ey * kk - this.vy[i] * C.magnet.springDamp) * dt;
          x += this.vx[i] * dt;
          y += this.vy[i] * dt;

          var spc = Math.hypot(this.vx[i], this.vy[i]);
          capSpeedSum += spc; capN++;

          /* 向き: 速く動く時は進行方向、落ち着くと磁石方向(力線) */
          var rdx = mgc.x - x, rdy = mgc.y - y;
          var rd = Math.sqrt(rdx * rdx + rdy * rdy) + 0.001;
          if (spc > 60) {
            this.dirX[i] = this.vx[i] / spc; this.dirY[i] = this.vy[i] / spc;
          } else {
            this.dirX[i] = rdx / rd; this.dirY[i] = rdy / rd;
          }
          /* 休んでいる山の粒は短く=色の年輪が見える。
             動いている粒ほど長く明るく → 力の流れが見える */
          var sNear = Math.max(0, 1 - rd / (fieldR * 1.2));
          this.len[i] = Math.min(maxLen, minLen + sNear * 1.6 + spc * 0.028);
          this.bright[i] = (this.flash[i] > 0 || spc > 150) ? 2 : 1;
        }
      }
    }

    if (st === SMOOTHING) {
      /* ならし波: 新しい場所へふわっと移動して平らに */
      var sx2 = this.tx[i] - x, sy2 = this.ty[i] - y;
      this.vx[i] += (sx2 * C.shake.settleK - this.vx[i] * C.shake.settleDamp) * dt;
      this.vy[i] += (sy2 * C.shake.settleK - this.vy[i] * C.shake.settleDamp) * dt;
      x += this.vx[i] * dt;
      y += this.vy[i] * dt;
      var sp3 = Math.hypot(this.vx[i], this.vy[i]);
      if (sx2 * sx2 + sy2 * sy2 < 16 && sp3 < 24) {
        this.state[i] = SETTLED;
        this.slotA[i] = Math.random() * 6.2832;
        this.vx[i] = 0; this.vy[i] = 0;
      }
      this.dirX[i] = sp3 > 1 ? this.vx[i] / sp3 : 1;
      this.dirY[i] = sp3 > 1 ? this.vy[i] / sp3 : 0;
      this.len[i] = Math.min(maxLen, minLen + sp3 * 0.015);
      this.bright[i] = this.flash[i] > 0 ? 2 : 1;
    }

    /* ---- 庭の枠の内側に閉じ込める ---- */
    if (x < this.trayL) { x = this.trayL; this.vx[i] = Math.abs(this.vx[i]) * 0.3; }
    else if (x > this.trayR) { x = this.trayR; this.vx[i] = -Math.abs(this.vx[i]) * 0.3; }
    if (y < this.trayT) { y = this.trayT; this.vy[i] = Math.abs(this.vy[i]) * 0.3; }
    else if (y > this.trayB) { y = this.trayB; this.vy[i] = -Math.abs(this.vy[i]) * 0.3; }

    this.px[i] = x; this.py[i] = y;
  }

  /* ---- 集計(音用) ---- */
  this.capturedCount = this.moundCount[0] + (this.magnets[1].active ? this.moundCount[1] : 0);
  var avgNow = capN > 0 ? capSpeedSum / capN : 0;
  this.avgCapSpeed += (avgNow - this.avgCapSpeed) * Math.min(1, dt * 5);
  if (this.avgCapSpeed > 95) this.excited = true;
  if (this.excited && this.avgCapSpeed < 24 && capN > 40) {
    this.excited = false;
    this.events.push("settled");
  }
};

Sim.prototype._capture = function (i, mi) {
  this.state[i] = CAPTURED;
  this.mag[i] = mi;
  var n = this.moundCount[mi];
  this.moundCount[mi] = n + 1;
  // 捕獲順に外側の席へ → 色の年輪(マーブル)ができる
  this.slotR[i] = CONFIG.magnet.moundGrain * Math.sqrt(n) * (0.82 + Math.random() * 0.36)
                + Math.random() * 2.5;
  this.slotA[i] = Math.random() * 6.2832;
  this.flash[i] = Math.max(this.flash[i], 0.18);
};

Sim.prototype._mergeMagnets = function () {
  var m0 = this.magnets[0], m1 = this.magnets[1];
  // 2個目の粒は1個目に乗り換える(席は新しく外周へ)
  for (var i = 0; i < this.count; i++) {
    if (this.state[i] === CAPTURED && this.mag[i] === 1) {
      this.moundCount[1]--;
      this._capture(i, 0);
    }
  }
  m1.active = false;
  m1.dragId = -1;
  m0.wobble = 1;
  this.moundCount[1] = 0;
  this.events.push("merge");
};
