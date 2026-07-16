// ================================================================
// three.js セットアップ — レンダラー・カメラ・ポストプロセス
// Switch風の絵作り: ACESトーンマッピング + 軽いブルーム + MSAA +
// ソフトシャドウ。iPhone/iPad で 60fps を保てる範囲に調整。
// ================================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,          // MSAAはComposerのレンダーターゲット側で行う
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 220);
    this.camera.position.set(0, 3.2, 9.5);
    this.camera.lookAt(0, 1.2, 0);

    // ---- composer (MSAA x4 render target) ----
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new UnrealBloomPass(size.clone(), 0.38, 0.7, 0.82);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    // カメラ揺れ・ズームの基準値(ゲーム側が書き換える)
    this.camBase = new THREE.Vector3(0, 3.2, 9.5);
    this.camTarget = new THREE.Vector3(0, 1.2, 0);
    this.camShake = 0;

    this._resize = this._resize.bind(this);
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', () => setTimeout(this._resize, 250));
    this._resize();
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);

    this.camera.aspect = w / h;
    // 縦画面ではFOVを広げてステージ全体が入るようにする
    const portrait = h > w;
    this.camera.fov = portrait ? 62 : 46;
    this.camera.updateProjectionMatrix();
    this.portrait = portrait;
  }

  /** ゲームごとのカメラ配置(縦横で自動補正) */
  setCamera(pos, target) {
    this.camBase.copy(pos);
    this.camTarget.copy(target);
  }

  /** 毎フレーム: ゆるい呼吸 + シェイク減衰 */
  updateCamera(t, dt) {
    const bobY = Math.sin(t * 0.9) * 0.05;
    const bobX = Math.sin(t * 0.53) * 0.04;
    let px = this.camBase.x + bobX;
    let py = this.camBase.y + bobY;
    let pz = this.camBase.z;
    // 縦画面はカメラを引いて上から少し見下ろす
    if (this.portrait) {
      pz *= 1.12;
      py += 0.45;
    }
    if (this.camShake > 0.001) {
      px += (Math.random() - 0.5) * this.camShake;
      py += (Math.random() - 0.5) * this.camShake;
      this.camShake *= Math.pow(0.0009, dt); // 素早く減衰
    }
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(this.camTarget);
  }

  shake(amount = 0.12) { this.camShake = Math.max(this.camShake, amount); }

  render() { this.composer.render(); }
}
