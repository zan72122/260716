/* =========================================================
 * 描画
 *  - 粒: 色×明るさ(3段階)ごとに1本のパスへまとめて線描画。
 *    粒単位の色は混ぜず保持 → マーブル模様。
 *  - 盤面(木枠の砂庭)はオフスクリーンに事前描画。
 *  - 磁石はかわいいU字磁石スプライト(事前描画)+光の輪。
 * ======================================================= */
"use strict";

function Renderer(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext("2d");
  this.dpr = 1;
  this.W = 0; this.H = 0;

  this.themeIdx = 0;
  this.colors = [];        // [colorIdx][bright] → CSS色文字列

  this.trayCanvas = document.createElement("canvas");
  this.glowCanvas = null;
  this.magnetSprites = [];
  this.time = 0;

  // 粒バッチ(色6 × 明るさ3)
  var buckets = 6 * 3;
  this.batchXY = [];
  this.batchN = new Int32Array(buckets);
  for (var b = 0; b < buckets; b++) {
    this.batchXY.push(new Float32Array(CONFIG.particle.maxCount * 4));
  }

  this.ripple = null;      // { x, y, t } タップ先のしるし
  this.touchPulses = [];   // 触った瞬間の白リング
  this.glowLevel = 1;      // 磁石の光(磁場オフでゼロへ)
}

/* ---------- 色ユーティリティ ---------- */
function hexToRgb(hex) {
  var h = hex.replace("#", "");
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function mixColor(a, b, t) {
  var ca = hexToRgb(a), cb = hexToRgb(b);
  var r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  var g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  var bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return "rgb(" + r + "," + g + "," + bl + ")";
}

Renderer.prototype.setTheme = function (idx) {
  this.themeIdx = idx % THEMES.length;
  var th = THEMES[this.themeIdx];
  this.colors = [];
  for (var c = 0; c < th.sand.length; c++) {
    this.colors.push([
      mixColor(th.sand[c], th.tray, 0.42),   // 0: くらい(寝ている粒)
      th.sand[c],                            // 1: ふつう
      mixColor(th.sand[c], "#ffffff", 0.30), // 2: あかるい(強い場・光り)
    ]);
  }
  if (this.W > 0) this._drawTray();
};

Renderer.prototype.resize = function (w, h, dpr) {
  this.W = w; this.H = h;
  this.dpr = Math.min(2, dpr || 1);
  this.canvas.width = Math.round(w * this.dpr);
  this.canvas.height = Math.round(h * this.dpr);
  this.canvas.style.width = w + "px";
  this.canvas.style.height = h + "px";
  this._drawTray();
  this._makeGlow();
  this._makeMagnetSprites();
};

/* ---------- 盤面(木枠 + 砂床) ---------- */
Renderer.prototype._drawTray = function () {
  var th = THEMES[this.themeIdx];
  var c = this.trayCanvas;
  c.width = this.canvas.width;
  c.height = this.canvas.height;
  var g = c.getContext("2d");
  g.scale(this.dpr, this.dpr);

  g.fillStyle = th.bg;
  g.fillRect(0, 0, this.W, this.H);

  var mgn = Math.max(14, Math.min(this.W, this.H) * 0.035);
  var r = 26;

  // 木枠(外側)
  var frame = g.createLinearGradient(0, 0, this.W, this.H);
  frame.addColorStop(0, th.frame[0]);
  frame.addColorStop(1, th.frame[1]);
  g.fillStyle = frame;
  roundRect(g, mgn * 0.28, mgn * 0.28, this.W - mgn * 0.56, this.H - mgn * 0.56, r + 8);
  g.fill();

  // 砂床
  g.fillStyle = th.tray;
  roundRect(g, mgn, mgn, this.W - mgn * 2, this.H - mgn * 2, r);
  g.fill();

  // 内側のやわらかい影
  g.save();
  roundRect(g, mgn, mgn, this.W - mgn * 2, this.H - mgn * 2, r);
  g.clip();
  var vig = g.createRadialGradient(
    this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.3,
    this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.72
  );
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.30)");
  g.fillStyle = vig;
  g.fillRect(0, 0, this.W, this.H);

  // 砂床の微細なざらつき
  g.globalAlpha = 0.05;
  for (var i = 0; i < 500; i++) {
    var x = mgn + Math.random() * (this.W - mgn * 2);
    var y = mgn + Math.random() * (this.H - mgn * 2);
    g.fillStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
    g.fillRect(x, y, 1.4, 1.4);
  }
  g.restore();
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------- 磁石の光(場のヒント) ---------- */
Renderer.prototype._makeGlow = function () {
  var size = 256;
  this.glowCanvas = document.createElement("canvas");
  this.glowCanvas.width = size;
  this.glowCanvas.height = size;
  var g = this.glowCanvas.getContext("2d");
  var grad = g.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.16)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
};

/* ---------- U字磁石スプライト(おきている顔 / ねむり顔) ---------- */
Renderer.prototype._makeMagnetSprites = function () {
  this.magnetSprites = [];
  for (var s = 0; s < MAGNET_STYLES.length; s++) {
    this.magnetSprites.push({
      awake: this._drawMagnetSprite(MAGNET_STYLES[s], false),
      asleep: this._drawMagnetSprite(MAGNET_STYLES[s], true),
    });
  }
};

Renderer.prototype._drawMagnetSprite = function (st, asleep) {
  var scale = 2;
  var w = 96, h = 100;
  var c = document.createElement("canvas");
  c.width = w * scale; c.height = h * scale;
  var g = c.getContext("2d");
  g.scale(scale, scale);
  g.translate(w / 2, h / 2);

  // 磁力オフ中はくすんだ色になる
  var body = asleep ? mixColor(st.body, "#777788", 0.45) : st.body;
  var edge = asleep ? mixColor(st.edge, "#555566", 0.45) : st.edge;

  g.lineJoin = "round";
  /* U字磁石(開口部が下=砂へ向く)。
     アーチ中心 cy、外径 oR、内径 iR、脚の下端 legB */
  var cy = -6, oR = 33, iR = 13, legB = 36, tipH = 14;
  g.beginPath();
  g.moveTo(-oR, cy);
  g.arc(0, cy, oR, Math.PI, Math.PI * 2, false); // 外側アーチ(上半分)
  g.lineTo(oR, legB);
  g.lineTo(iR, legB);
  g.lineTo(iR, cy);
  g.arc(0, cy, iR, 0, Math.PI, true);            // 内側アーチ(戻り)
  g.lineTo(-iR, legB);
  g.lineTo(-oR, legB);
  g.closePath();
  g.fillStyle = body;
  g.strokeStyle = edge;
  g.lineWidth = 4;
  g.fill();
  g.stroke();

  // 先端(白)— 砂に触れる側
  g.fillStyle = asleep ? "#c9ccd8" : "#f5f7fb";
  g.beginPath(); g.rect(-oR, legB - tipH, oR - iR, tipH); g.fill(); g.stroke();
  g.beginPath(); g.rect(iR, legB - tipH, oR - iR, tipH); g.fill(); g.stroke();

  // つやのハイライト
  g.globalAlpha = asleep ? 0.18 : 0.35;
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(-17, -20, 6, 12, -0.5, 0, 6.2832);
  g.fill();
  g.globalAlpha = 1;

  // 顔(4歳向けの親しみ)。眠り顔は目を閉じる
  g.strokeStyle = "#3a2020";
  g.fillStyle = "#3a2020";
  g.lineWidth = 2.4;
  g.lineCap = "round";
  if (asleep) {
    g.beginPath(); g.arc(-9, cy - 16, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.beginPath(); g.arc(9, cy - 16, 3.4, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    g.beginPath(); g.arc(0, cy - 10, 3, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  } else {
    g.beginPath(); g.arc(-9, cy - 15, 3.2, 0, 6.2832); g.fill();
    g.beginPath(); g.arc(9, cy - 15, 3.2, 0, 6.2832); g.fill();
    g.beginPath();
    g.arc(0, cy - 12, 6, 0.2 * Math.PI, 0.8 * Math.PI);
    g.stroke();
  }
  return c;
};

/* ---------- 毎フレーム ---------- */
Renderer.prototype.draw = function (sim, dt) {
  this.time += dt;
  var ctx = this.ctx;
  var dpr = this.dpr;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(this.trayCanvas, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /* --- 磁石の下の光(場の強さのヒント)。磁場オフ中はすっと消える --- */
  var glowTarget = sim.fieldOff > 0 ? 0 : 1;
  this.glowLevel += (glowTarget - this.glowLevel) * Math.min(1, dt * 7);
  if (this.glowLevel > 0.02) {
    ctx.globalCompositeOperation = "lighter";
    for (var mi = 0; mi < 2; mi++) {
      var m = sim.magnets[mi];
      if (!m.active || m.dropT > 0) continue;
      var pulse = 1 + Math.sin(this.time * 2.2 + mi * 2) * 0.05;
      var rad = (m.dragId !== -1 || m.gliding)
        ? m.effR * 1.05
        : m.effR * 0.72;
      rad *= pulse;
      ctx.globalAlpha = ((m.dragId !== -1 || m.gliding) ? 0.5 : 0.3) * this.glowLevel;
      ctx.drawImage(this.glowCanvas, m.x - rad, m.y - rad, rad * 2, rad * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* --- 粒 --- */
  var nC = this.colors.length;
  var nB = nC * 3;
  for (var b = 0; b < nB; b++) this.batchN[b] = 0;

  var n = sim.count;
  var px = sim.px, py = sim.py, dirX = sim.dirX, dirY = sim.dirY;
  var len = sim.len, bright = sim.bright, colorIdx = sim.colorIdx;
  for (var i = 0; i < n; i++) {
    var half = len[i] * 0.5;
    var bkt = colorIdx[i] * 3 + bright[i];
    var arr = this.batchXY[bkt];
    var j = this.batchN[bkt] * 4;
    arr[j] = px[i] - dirX[i] * half;
    arr[j + 1] = py[i] - dirY[i] * half;
    arr[j + 2] = px[i] + dirX[i] * half;
    arr[j + 3] = py[i] + dirY[i] * half;
    this.batchN[bkt]++;
  }

  ctx.lineWidth = CONFIG.particle.lineWidth;
  ctx.lineCap = "round";
  for (var c = 0; c < nC; c++) {
    for (var br = 0; br < 3; br++) {
      var bkt2 = c * 3 + br;
      var cnt = this.batchN[bkt2];
      if (cnt === 0) continue;
      var a2 = this.batchXY[bkt2];
      ctx.strokeStyle = this.colors[c][br];
      ctx.beginPath();
      for (var k = 0; k < cnt; k++) {
        var o = k * 4;
        ctx.moveTo(a2[o], a2[o + 1]);
        ctx.lineTo(a2[o + 2], a2[o + 3]);
      }
      ctx.stroke();
    }
  }

  /* --- 触った瞬間の白リング(タッチ即応) --- */
  for (var tp = this.touchPulses.length - 1; tp >= 0; tp--) {
    var pl = this.touchPulses[tp];
    pl.t += dt;
    if (pl.t > 0.35) { this.touchPulses.splice(tp, 1); continue; }
    ctx.globalAlpha = 0.55 * (1 - pl.t / 0.35);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(pl.x, pl.y, 16 + pl.t * 240, 0, 6.2832);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* --- タップ先のしるし(波紋) --- */
  if (this.ripple) {
    this.ripple.t += dt;
    var rt = this.ripple.t % 0.9;
    var rr = 10 + rt * 46;
    ctx.globalAlpha = Math.max(0, 0.7 - rt * 0.8);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(this.ripple.x, this.ripple.y, rr, 0, 6.2832);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 磁石が到着したら消す
    var gone = true;
    for (var mi2 = 0; mi2 < 2; mi2++) {
      if (sim.magnets[mi2].active && sim.magnets[mi2].gliding) gone = false;
    }
    if (gone || this.ripple.t > 6) this.ripple = null;
  }

  /* --- ならし波(色の波が端から走る) --- */
  if (sim.shakeActive) {
    var front = (sim.shakeT / CONFIG.shake.waveTime) * sim.shakeMaxDist;
    var th = THEMES[this.themeIdx];
    ctx.save();
    ctx.lineWidth = 5;
    for (var w = 0; w < 3; w++) {
      var inset = front - w * 14;
      if (inset < 0 || inset > sim.shakeMaxDist) continue;
      ctx.globalAlpha = 0.35 - w * 0.09;
      ctx.strokeStyle = th.sand[(w * 2) % th.sand.length];
      roundRect(ctx,
        sim.trayL + inset - 6, sim.trayT + inset - 6,
        Math.max(4, (sim.trayR - sim.trayL) - inset * 2 + 12),
        Math.max(4, (sim.trayB - sim.trayT) - inset * 2 + 12),
        22);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* --- 磁石本体 --- */
  for (var mi3 = 0; mi3 < 2; mi3++) {
    var m3 = sim.magnets[mi3];
    if (!m3.active) continue;
    // 磁場オフ中は眠り顔、落下中は空から降ってくる
    var spr = (sim.fieldOff > 0)
      ? this.magnetSprites[m3.style].asleep
      : this.magnetSprites[m3.style].awake;
    var sw = 96, sh = 100;
    var grabbed = m3.dragId !== -1;
    var sc = grabbed ? 1.12 : 1;
    if (m3.wobble > 0) sc += Math.sin(m3.wobble * 18) * 0.09 * m3.wobble;
    var tilt = Math.max(-0.3, Math.min(0.3, m3.speedX * 0.00045));
    var dropping = m3.dropT > 0;
    var dropOff = 0, shadowShrink = 1;
    if (dropping) {
      var q = 1 - m3.dropT / CONFIG.magnet.dropTime;    // 0→1
      dropOff = CONFIG.magnet.dropHeight * (1 - q * q); // 重力風に加速して落ちる
      shadowShrink = Math.max(0.4, 1 - dropOff / 300);
    }
    var bob = (grabbed || dropping) ? 0 : Math.sin(this.time * 1.8 + mi3 * 3) * 2.5;

    ctx.save();
    ctx.translate(m3.x, m3.y + bob);
    // やわらかい影(落下中は地面に残り、高いほど小さく薄く)
    ctx.globalAlpha = 0.25 * shadowShrink;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(0, sh * 0.46, sw * 0.34 * shadowShrink, 9 * shadowShrink, 0, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.rotate(tilt);
    ctx.scale(sc, sc);
    ctx.drawImage(spr, -sw / 2, -sh / 2 - dropOff / sc, sw, sh);
    ctx.restore();
  }
};

Renderer.prototype.showRipple = function (x, y) {
  this.ripple = { x: x, y: y, t: 0 };
};

Renderer.prototype.showTouchPulse = function (x, y) {
  if (this.touchPulses.length >= 6) this.touchPulses.shift();
  this.touchPulses.push({ x: x, y: y, t: 0 });
};

/* リサイズ時: 演出用の座標も盤面に合わせて追従させる */
Renderer.prototype.remap = function (map) {
  if (this.ripple) {
    this.ripple.x = map.ox + this.ripple.x * map.sx;
    this.ripple.y = map.oy + this.ripple.y * map.sy;
  }
  for (var i = 0; i < this.touchPulses.length; i++) {
    var p = this.touchPulses[i];
    p.x = map.ox + p.x * map.sx;
    p.y = map.oy + p.y * map.sy;
  }
};
