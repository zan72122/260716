/* ============================================================
   camera.js — タッチオービット / ピンチズーム / モード別プリセット
   プリセット位置を基準に、ユーザーのドラッグでヨー/ピッチを
   オフセットし、ピンチで距離を変える。モード切替はトゥイーン。
   ============================================================ */
import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, easeInOut } from './lib3d.js';

/* モード別プリセット {target, dist, yaw, pitch, fov} (縦/横) */
const PRESETS = {
  customer: {
    portrait:  { target: [0.02, 0.96, 0.05], dist: 3.05, yaw: 0.10, pitch: 0.06, fov: 52 },
    landscape: { target: [0.0, 1.00, 0.05], dist: 2.35, yaw: 0.16, pitch: 0.05, fov: 46 },
  },
  xray: {
    portrait:  { target: [0.02, 0.95, 0.0], dist: 3.25, yaw: 0.35, pitch: 0.10, fov: 52 },
    landscape: { target: [0.0, 0.95, 0.0], dist: 2.6, yaw: 0.35, pitch: 0.08, fov: 46 },
  },
  operator: {
    // 左ヒンジの扉が開いても庫内が見えるよう、右寄りから覗く
    portrait:  { target: [-0.15, 0.98, 0.1], dist: 2.9, yaw: 0.62, pitch: 0.10, fov: 54 },
    landscape: { target: [-0.1, 1.0, 0.1], dist: 2.4, yaw: 0.62, pitch: 0.08, fov: 48 },
  },
  title: {
    portrait:  { target: [0.0, 1.0, 0.0], dist: 3.1, yaw: 0, pitch: 0.06, fov: 50 },
    landscape: { target: [0.0, 1.0, 0.0], dist: 2.5, yaw: 0, pitch: 0.05, fov: 46 },
  },
};

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'title';
    this.isPortrait = false;
    // ユーザー操作によるオフセット
    this.userYaw = 0;
    this.userPitch = 0;
    this.userZoom = 1;
    // 現在値 (トゥイーン)
    this.cur = { target: new THREE.Vector3(0, 1, 0), dist: 2.6, yaw: 0, pitch: 0.06, fov: 50 };
    this.tween = null;
    this.autoSpin = 0;   // タイトル画面の自動旋回
  }

  setMode(mode, instant = false) {
    if (this.mode === mode && !instant) return;
    this.mode = mode;
    const p = this._preset();
    if (instant) {
      this.cur.target.fromArray(p.target);
      this.cur.dist = p.dist; this.cur.yaw = p.yaw; this.cur.pitch = p.pitch; this.cur.fov = p.fov;
      this.tween = null;
    } else {
      this.tween = {
        t: 0, dur: 0.85,
        from: {
          target: this.cur.target.clone(),
          dist: this.cur.dist, yaw: this.cur.yaw, pitch: this.cur.pitch, fov: this.cur.fov,
        },
      };
      // モード切替でユーザーオフセットは徐々にリセット
      this.userYaw *= 0.3; this.userPitch *= 0.3;
    }
  }

  setOrientation(isPortrait) {
    if (this.isPortrait === isPortrait) return;
    this.isPortrait = isPortrait;
    this.setMode(this.mode, false);
    this.tween && (this.tween.dur = 0.5);
  }

  _preset() {
    return PRESETS[this.mode][this.isPortrait ? 'portrait' : 'landscape'];
  }

  /* ドラッグ (px 単位) */
  orbit(dx, dy) {
    this.userYaw = clamp(this.userYaw - dx * 0.005, -1.35, 1.35);
    this.userPitch = clamp(this.userPitch + dy * 0.004, -0.5, 0.62);
  }

  pinch(scale) {
    this.userZoom = clamp(this.userZoom / scale, 0.45, 1.9);
  }

  /* 開発検証用: プリセット追従を止めて任意の視点に固定 */
  lockPose(target, dist, yaw, pitch) {
    this.debugLock = true;
    this.cur.target.set(target[0], target[1], target[2]);
    this.cur.dist = dist;
    this.cur.yaw = yaw;
    this.cur.pitch = pitch;
    this.userYaw = 0; this.userPitch = 0; this.userZoom = 1;
    this.tween = null;
  }

  update(dtReal, time) {
    if (this.debugLock) {
      const t = this.cur.target;
      const dist = this.cur.dist;
      this.camera.position.set(
        t.x + Math.sin(this.cur.yaw) * Math.cos(this.cur.pitch) * dist,
        t.y + Math.sin(this.cur.pitch) * dist,
        t.z + Math.cos(this.cur.yaw) * Math.cos(this.cur.pitch) * dist
      );
      this.camera.lookAt(t);
      return;
    }
    const p = this._preset();
    if (this.tween) {
      this.tween.t += dtReal;
      const k = easeInOut(clamp(this.tween.t / this.tween.dur, 0, 1));
      const f = this.tween.from;
      this.cur.target.lerpVectors(f.target, new THREE.Vector3().fromArray(p.target), k);
      this.cur.dist = lerp(f.dist, p.dist, k);
      this.cur.yaw = lerp(f.yaw, p.yaw, k);
      this.cur.pitch = lerp(f.pitch, p.pitch, k);
      this.cur.fov = lerp(f.fov, p.fov, k);
      if (this.tween.t >= this.tween.dur) this.tween = null;
    } else {
      // プリセットへゆるく追従 (画面回転などのじわっとした補正)
      const k = 1 - Math.exp(-dtReal * 3);
      this.cur.target.lerp(new THREE.Vector3().fromArray(p.target), k);
      this.cur.dist = lerp(this.cur.dist, p.dist, k);
      this.cur.fov = lerp(this.cur.fov, p.fov, k);
      if (this.mode === 'title') {
        this.cur.yaw = p.yaw + Math.sin(time * 0.22) * 0.5;
        this.cur.pitch = p.pitch + Math.sin(time * 0.13) * 0.06;
      } else {
        this.cur.yaw = lerp(this.cur.yaw, p.yaw, k);
        this.cur.pitch = lerp(this.cur.pitch, p.pitch, k);
      }
    }
    const yaw = this.cur.yaw + (this.mode === 'title' ? 0 : this.userYaw);
    const pitch = clamp(this.cur.pitch + (this.mode === 'title' ? 0 : this.userPitch), -0.55, 0.9);
    const dist = this.cur.dist * (this.mode === 'title' ? 1 : this.userZoom);
    const t = this.cur.target;
    this.camera.position.set(
      t.x + Math.sin(yaw) * Math.cos(pitch) * dist,
      t.y + Math.sin(pitch) * dist,
      t.z + Math.cos(yaw) * Math.cos(pitch) * dist
    );
    if (this.camera.position.y < 0.15) this.camera.position.y = 0.15;
    this.camera.lookAt(t);
    if (Math.abs(this.camera.fov - this.cur.fov) > 0.1) {
      this.camera.fov = this.cur.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
