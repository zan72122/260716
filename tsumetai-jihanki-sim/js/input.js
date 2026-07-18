/* ============================================================
   input.js — タッチ/マウス入力の振り分け
   ・タップ (短時間・小移動) → レイキャストで3D部品を操作
   ・ドラッグ → カメラオービット
   ・ピンチ → ズーム
   3D部品は mesh.userData.tap = {type, ...} を登録して拾う。
   ============================================================ */
import * as THREE from 'three';

export class InputManager {
  constructor(el, camera, handlers) {
    this.el = el;
    this.camera = camera;
    this.handlers = handlers;   // {onTap(tapInfo|null), onOrbit(dx,dy), onPinch(scale)}
    this.enabled = false;
    this.targets = [];          // レイキャスト対象 (userData.tap を持つ Object3D)
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this._pinchDist = 0;

    el.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
    el.addEventListener('pointermove', (e) => this._move(e), { passive: false });
    el.addEventListener('pointerup', (e) => this._up(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this._cancel(e), { passive: false });
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }

  register(obj) {
    this.targets.push(obj);
  }

  _down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    try { this.el.setPointerCapture(e.pointerId); } catch (err) { /* 非対応環境 */ }
    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY,
      sx: e.clientX, sy: e.clientY,
      t: performance.now(),
      moved: false,
    });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this._pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 12) p.moved = true;
    if (this.pointers.size === 1 && p.moved) {
      this.handlers.onOrbit(dx, dy);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this._pinchDist > 0 && d > 0) {
        this.handlers.onPinch(d / this._pinchDist);
      }
      this._pinchDist = d;
    }
  }

  _up(e) {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (!p) return;
    const dt = performance.now() - p.t;
    if (!p.moved && dt < 400 && this.pointers.size === 0) {
      this._tap(p.sx, p.sy);
    }
    if (this.pointers.size < 2) this._pinchDist = 0;
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this._pinchDist = 0;
  }

  _tap(x, y) {
    const ndc = new THREE.Vector2(
      (x / window.innerWidth) * 2 - 1,
      -(y / window.innerHeight) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.targets, true);
    for (const h of hits) {
      // userData.tap を持つ祖先を探す
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.tap && o.visible !== false) {
          this.handlers.onTap(o.userData.tap, h.point);
          return;
        }
        o = o.parent;
      }
    }
    this.handlers.onTap(null, null);
  }
}
