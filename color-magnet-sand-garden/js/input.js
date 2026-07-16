/* =========================================================
 * タッチ・ポインタ入力
 *  - 磁石の近くから引く → その磁石を直接ドラッグ
 *    (磁石は指より少し上に表示され、指で隠れない)
 *  - 遠くから引いても、いちばん近い磁石が指を追いかける
 *    (4歳児向けの許し: どこを触っても遊べる)
 *  - 何もない所を短くタップ → 2個目の磁石を置く /
 *    すでに2個あれば近い磁石がそこへ滑る
 *  - 2本指で2個の磁石を同時に動かせる(橋あそび)
 * ======================================================= */
"use strict";

function InputHandler(canvas, sim, renderer, onSound) {
  this.canvas = canvas;
  this.sim = sim;
  this.renderer = renderer;
  this.onSound = onSound;   // (name) => void

  /* pointerId → { magnet, startX, startY, startT, moved, chase } */
  this.pointers = {};

  var self = this;
  canvas.addEventListener("pointerdown", function (e) { self._down(e); });
  canvas.addEventListener("pointermove", function (e) { self._move(e); });
  canvas.addEventListener("pointerup", function (e) { self._up(e); });
  canvas.addEventListener("pointercancel", function (e) { self._cancel(e); });

  // iOS のスクロール・ダブルタップ拡大を止める
  document.addEventListener("touchmove", function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); });
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
}

InputHandler.prototype._pos = function (e) {
  var r = this.canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

InputHandler.prototype._down = function (e) {
  e.preventDefault();
  if (this.canvas.setPointerCapture) {
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }
  var p = this._pos(e);
  var info = {
    startX: p.x, startY: p.y, x: p.x, y: p.y,
    startT: performance.now() / 1000,
    moved: false,
    magnet: -1,
    chase: false,
  };

  var near = this.sim.nearestMagnet(p.x, p.y);
  if (near.index >= 0 && near.dist <= CONFIG.magnet.grabRadius) {
    info.magnet = near.index;
    this.sim.grabMagnet(near.index, e.pointerId, p.x, p.y);
    this.onSound("grab");
  }
  this.pointers[e.pointerId] = info;
};

InputHandler.prototype._move = function (e) {
  var info = this.pointers[e.pointerId];
  if (!info) return;
  e.preventDefault();
  var p = this._pos(e);
  info.x = p.x; info.y = p.y;

  var dx = p.x - info.startX, dy = p.y - info.startY;
  if (dx * dx + dy * dy > CONFIG.input.tapMaxMove * CONFIG.input.tapMaxMove) {
    info.moved = true;
  }

  if (info.magnet >= 0) {
    this.sim.dragMagnet(info.magnet, p.x, p.y);
  } else if (info.moved && !info.chase) {
    // 遠くから引いた → 近い磁石が指を追いかける(やさしい操作)
    var near = this.sim.nearestMagnet(p.x, p.y);
    if (near.index >= 0) {
      info.chase = true;
      info.magnet = near.index;
      var m = this.sim.magnets[near.index];
      // 直接掴まず、滑って向かわせる
      m.gliding = true;
      m.glideX = p.x; m.glideY = p.y - CONFIG.magnet.liftOffset * 0.5;
    }
  } else if (info.chase && info.magnet >= 0) {
    var mg = this.sim.magnets[info.magnet];
    mg.gliding = true;
    mg.glideX = p.x; mg.glideY = p.y - CONFIG.magnet.liftOffset * 0.5;
  }
};

InputHandler.prototype._up = function (e) {
  var info = this.pointers[e.pointerId];
  if (!info) return;
  e.preventDefault();
  var now = performance.now() / 1000;

  if (info.magnet >= 0 && !info.chase) {
    this.sim.releaseMagnet(info.magnet);
  }

  var isTap = !info.moved && (now - info.startT) <= CONFIG.input.tapMaxTime;
  if (isTap && info.magnet < 0) {
    // 枠の内側だけ有効
    var s = this.sim;
    if (info.x > s.trayL && info.x < s.trayR && info.y > s.trayT && info.y < s.trayB) {
      var result = s.tapAt(info.x, info.y);
      if (result === "place") this.onSound("pop");
      if (result === "go") {
        this.renderer.showRipple(info.x, info.y);
        this.onSound("pop");
      }
    }
  }
  delete this.pointers[e.pointerId];
};

InputHandler.prototype._cancel = function (e) {
  var info = this.pointers[e.pointerId];
  if (info && info.magnet >= 0 && !info.chase) {
    this.sim.releaseMagnet(info.magnet);
  }
  delete this.pointers[e.pointerId];
};
