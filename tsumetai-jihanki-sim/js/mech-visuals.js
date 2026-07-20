/* ============================================================
   mech-visuals.js — 機構の3D表示と物理の同期 (実機準拠版)
   ・静的機構 (レール/チャンネル/棚/トレー) は物理コライダから
     自動生成して結合 → 見た目と物理が乖離しない & 低ドローコール
   ・硬貨/商品は InstancedMesh (補間つき)
   ・エスクローシャッター / 紙幣搬送 / ベンドピン30組 / 釣銭スタック
   ============================================================ */
import * as THREE from '../vendor/three.module.js';
import { segPlate, canvasTexture, makeRng, lerp, easeInOut, mat4, mergeGeoms } from './lib3d.js';
import { buildProductGeometry, productAtlasMat } from './machine-scene.js';
import {
  COINS, DENOMS, CABINET, MECH, TUBES, TUBE_TOP, TUBE_BOTTOM, TUBE_CAP,
  COLUMNS, CHAMBERS, PRODUCTS, BILL, ESCROW_DENOMS,
} from './config.js';
import { LAYER_MECH, LAYER_MECH_BACK, LAYER_ESCROW_RET } from './coin-mech.js';

const COIN_SEG = 22;

function coinFaceTex(denom) {
  const spec = COINS[denom];
  return canvasTexture(128, 128, (ctx, w, h) => {
    const c = '#' + spec.color.toString(16).padStart(6, '0');
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,25,10,0.55)';
    ctx.font = `900 ${denom >= 100 ? 44 : 52}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(denom), w / 2, h / 2);
    if (denom === 50) {
      ctx.fillStyle = '#101418';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/* 結露の水滴テクスチャは fx.js のものを使う (循環依存回避のため遅延) */
let dropletMat = null;
function getDropletMat() {
  if (!dropletMat) {
    const tex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const rng = makeRng(5);
      for (let i = 0; i < 220; i++) {
        const x = rng() * w, y = rng() * h;
        const r = 0.8 + rng() * rng() * 4.5;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.6, 'rgba(220,240,255,0.5)');
        g.addColorStop(1, 'rgba(200,230,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    dropletMat = new THREE.MeshStandardMaterial({
      color: 0xeaf6ff, transparent: true, opacity: 0.5, alphaMap: tex,
      roughness: 0.12, metalness: 0.0, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  return dropletMat;
}

export class MechVisuals {
  constructor(machineScene, world, mech, rack) {
    this.ms = machineScene;
    this.world = world;
    this.mech = mech;
    this.rack = rack;
    this.rng = makeRng(31);
    this.portTweens = new Map();     // body.id → {xT}
    this.flyouts = [];
    this.sensorBlink = {};
    this.ejectorT = {};
    this._buildCoinInstances();
    this._buildProductInstances();
    this._buildMechUnit();
    this._buildRackVisuals();
    this._buildBill();
  }

  /* ============ 硬貨 ============ */
  _buildCoinInstances() {
    this.coinMeshes = {};
    this.stackMeshes = {};
    this.cashMeshes = {};
    const d = this.ms.doorContent;
    for (const denom of DENOMS) {
      const spec = COINS[denom];
      const geom = new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, COIN_SEG);
      geom.rotateX(Math.PI / 2);
      const face = coinFaceTex(denom);
      const side = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.32, metalness: 0.88 });
      const faceMat = new THREE.MeshStandardMaterial({ map: face, roughness: 0.28, metalness: 0.85 });
      const im = new THREE.InstancedMesh(geom, [side, faceMat, faceMat], 40);
      im.count = 0;
      im.frustumCulled = false;
      d.add(im);
      this.coinMeshes[denom] = im;

      const flatGeom = new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, COIN_SEG);
      const stack = new THREE.InstancedMesh(flatGeom, [side, faceMat, faceMat], TUBE_CAP[denom]);
      stack.count = 0;
      stack.frustumCulled = false;
      d.add(stack);
      this.stackMeshes[denom] = stack;

      const cash = new THREE.InstancedMesh(
        new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, 14),
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.4, metalness: 0.8 }),
        60
      );
      cash.count = 0;
      cash.frustumCulled = false;
      d.add(cash);
      this.cashMeshes[denom] = cash;
    }
  }

  /* ============ 商品 (種別 InstancedMesh) ============ */
  _buildProductInstances() {
    this.productMeshes = [];
    const cap = 40;
    for (const p of PRODUCTS) {
      const geom = buildProductGeometry(p).clone();
      geom.rotateZ(Math.PI / 2);   // 軸をXへ (横倒し)
      const im = new THREE.InstancedMesh(geom, productAtlasMat(), cap);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = true;
      this.ms.cabinet.add(im);
      // 結露シェル
      const shellGeom = new THREE.CylinderGeometry(p.r * 1.017, p.r * 1.017, p.len * 0.72, 16, 1, true);
      shellGeom.rotateZ(Math.PI / 2);
      const shell = new THREE.InstancedMesh(shellGeom, getDropletMat(), cap);
      shell.count = 0;
      shell.frustumCulled = false;
      this.ms.cabinet.add(shell);
      this.productMeshes.push({ im, shell });
    }
  }

  /* ============ コインメック部品 ============ */
  _buildMechUnit() {
    const d = this.ms.doorContent;
    const Z = CABINET.mechZ, ZB = CABINET.mechBackZ;
    const grp = new THREE.Group();
    d.add(grp);
    this.mechGroup = grp;

    // メック筐体 (緑の樹脂ケース風 — 実機コインメックのイメージ)
    const caseTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#3f6a4a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let i = 0; i < 5; i++) ctx.fillRect(16 + i * 48, 16, 5, h - 32);
    });
    const mechBack = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.80),
      new THREE.MeshStandardMaterial({ map: caseTex, roughness: 0.55, metalness: 0.2 })
    );
    mechBack.position.set(0.455, 0.94, Z - 0.018);
    grp.add(mechBack);

    // ---- 静的コライダ → 板を結合 (メック/金庫/エスクロー返却の3層) ----
    const plates = [];
    for (const s of this.world.segs) {
      let z, color, thick = 0.005, depth = 0.03;
      if (s.layer === LAYER_MECH) {
        if (s.material === 'plastic' || s.material === 'gate' || s.material === 'shutter') continue;
        if (s.tag && s.tag.startsWith('catch-')) continue;
        const isBridge = s.tag && s.tag.startsWith('bridge-');
        z = isBridge ? Z - 0.012 : Z;
        color = s.material === 'rail' ? 0xd8b04a : 0xc4ccd3;
        if (isBridge) { color = 0x9aa4ad; thick = 0.0035; depth = 0.008; }
      } else if (s.layer === LAYER_MECH_BACK) {
        z = ZB; color = 0x8a939b;
      } else if (s.layer === LAYER_ESCROW_RET) {
        z = Z + 0.022; color = 0xb8c860; thick = 0.004; depth = 0.02;
      } else continue;
      const g = segPlate([s.ax, s.ay], [s.bx, s.by], thick, depth, 'xy');
      g.applyMatrix4(mat4(0, 0, z));
      plates.push({ geom: g, color });
    }
    const platesMesh = new THREE.Mesh(
      mergeGeoms(plates),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 })
    );
    grp.add(platesMesh);

    // ---- 返却ゲート ----
    this.gatePivotGrp = new THREE.Group();
    this.gatePivotGrp.position.set(MECH.returnGate.pivot[0], MECH.returnGate.pivot[1], Z);
    const gateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(MECH.returnGate.len, 0.006, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 0.35, metalness: 0.6 })
    );
    gateMesh.position.x = -MECH.returnGate.len / 2;
    this.gatePivotGrp.add(gateMesh);
    grp.add(this.gatePivotGrp);

    // ---- 検銭センサーコイル & エスクローシャッター & エジェクタ ----
    this.sensorMats = {};
    this.shutterMeshes = {};
    this.ejectors = {};
    for (const denom of DENOMS) {
      const ch = this.mech.channels[denom];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x226644, emissive: 0x33ff88, emissiveIntensity: 0.15, roughness: 0.4,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0035, 8, 18), mat);
      ring.position.set(ch.cx, MECH.sensorY, Z);
      grp.add(ring);
      this.sensorMats[denom] = mat;

      if (ESCROW_DENOMS.includes(denom)) {
        const sh = new THREE.Mesh(
          new THREE.BoxGeometry(ch.half * 2, 0.006, 0.03),
          new THREE.MeshStandardMaterial({ color: 0xd08030, roughness: 0.4, metalness: 0.5 })
        );
        sh.position.set(ch.cx, MECH.escrowY, Z);
        grp.add(sh);
        this.shutterMeshes[denom] = { mesh: sh, cx: ch.cx, t: 1 };
      }

      const spec = COINS[denom];
      const ej = new THREE.Mesh(
        new THREE.BoxGeometry(spec.d + 0.006, 0.012, 0.028),
        new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.45, metalness: 0.5 })
      );
      ej.position.set(TUBES[denom].cx, TUBE_BOTTOM - 0.012, Z);
      grp.add(ej);
      this.ejectors[denom] = ej;
      this.ejectorT[denom] = 0;
    }

    // ---- 釣銭チューブ ----
    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0xbfe0f0, roughness: 0.15, metalness: 0.05,
      transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    });
    for (const denom of DENOMS) {
      const spec = COINS[denom];
      const cx = TUBES[denom].cx;
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.d / 2 + 0.004, spec.d / 2 + 0.004, TUBE_TOP - TUBE_BOTTOM, 18, 1, true),
        tubeMat
      );
      tube.position.set(cx, (TUBE_TOP + TUBE_BOTTOM) / 2, Z);
      tube.userData.tap = { type: 'tube', denom };
      grp.add(tube);
      const mouth = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.d / 2 + 0.007, spec.d / 2 + 0.005, 0.018, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x8a939b, roughness: 0.35, metalness: 0.75 })
      );
      mouth.position.set(cx, TUBE_TOP + 0.008, Z);
      grp.add(mouth);
    }

    // ---- 金庫 ----
    const cb = MECH.cashBox;
    const cash = new THREE.Mesh(
      new THREE.BoxGeometry(cb.x1 - cb.x0, cb.y1 - cb.y0, 0.1),
      new THREE.MeshStandardMaterial({
        color: 0x2a3138, roughness: 0.5, metalness: 0.45, transparent: true, opacity: 0.85,
      })
    );
    cash.position.set((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2, 0.20);
    cash.userData.tap = { type: 'cash' };
    grp.add(cash);
    this.cashBoxMesh = cash;
    const cashLabel = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#1a2026';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d0d8e0';
      ctx.font = '900 26px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('コイン金庫', w / 2, h / 2);
    });
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.06),
      new THREE.MeshStandardMaterial({ map: cashLabel, roughness: 0.5 })
    );
    cl.position.set((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2, 0.253);
    grp.add(cl);
  }

  /* ============ 紙幣 (搬送ビジュアル + スタッカー) ============ */
  _buildBill() {
    const d = this.ms.doorContent;
    const billTex = canvasTexture(256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#dfe8dc';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#7a94b8';
      ctx.fillRect(10, 10, w - 20, h - 20);
      ctx.fillStyle = '#dfe8dc';
      ctx.beginPath();
      ctx.arc(w * 0.68, h / 2, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#31405a';
      ctx.font = '900 40px serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('千', w * 0.68, h / 2 + 2);
      ctx.font = '700 22px serif';
      ctx.fillText('1000', w * 0.25, h / 2);
    });
    this.billMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(BILL.size[1], BILL.size[0]),   // 縦向きで挿入
      new THREE.MeshStandardMaterial({ map: billTex, roughness: 0.7, side: THREE.DoubleSide })
    );
    this.billMesh.rotation.x = -Math.PI / 2 + 0.15;
    this.billMesh.visible = false;
    d.add(this.billMesh);
    // スタッカー (X線で見える札束)
    const st = BILL.stacker;
    const stackerBox = new THREE.Mesh(
      new THREE.BoxGeometry(st.x1 - st.x0, st.y1 - st.y0, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0x24303a, roughness: 0.5, metalness: 0.4, transparent: true, opacity: 0.85,
      })
    );
    stackerBox.position.set((st.x0 + st.x1) / 2, (st.y0 + st.y1) / 2, st.z);
    d.add(stackerBox);
    this.billStackMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(BILL.size[0] * 0.8, 0.0012, BILL.size[1] * 0.8),
      new THREE.MeshStandardMaterial({ color: 0xaebfd4, roughness: 0.7 }),
      40
    );
    this.billStackMesh.count = 0;
    this.billStackMesh.frustumCulled = false;
    d.add(this.billStackMesh);
  }

  /* ============ ラック (静的部分は室ごとに結合) ============ */
  _buildRackVisuals() {
    const bounds = this.ms.chamberBounds;
    this.pinData = [];
    const chamberGeoms = [[], [], []];
    for (const col of this.rack.cols) {
      const ch = col.conf.chamber;
      const width = bounds[ch + 1] - bounds[ch] - 0.03;
      for (const s of this.world.segs) {
        if (s.layer !== col.layer) continue;
        if (s.material === 'pin') continue;
        // 落下ガイドは薄く細く
        const isLane = s.tag == null && Math.abs(s.ax - s.bx) < 0.001 && s.ay > s.by;
        chamberGeoms[ch].push({
          geom: segPlate([s.ax, s.ay], [s.bx, s.by], 0.004, isLane ? 0.02 : width, 'zy')
            .applyMatrix4(mat4(COLUMNS[col.index].x, 0, 0)),
          color: col.conf.stage === 0 ? 0xaeb8c0 : 0x9aa3ab,
        });
      }
      // ベンドピン (動的)
      this.pinData.push({
        col,
        cx: COLUMNS[col.index].x,
        width,
        lowerT: 1, upperT: 0,
      });
    }
    // トレー
    for (const s of this.world.segs) {
      if (!s.layer.startsWith('tray')) continue;
      if (s.filter) continue;   // ゴーストブリッジは描かない (開口として見せる)
      const ch = Number(s.layer[4]);
      const width = bounds[ch + 1] - bounds[ch] - 0.03;
      chamberGeoms[ch].push({
        geom: segPlate([s.ax, s.ay], [s.bx, s.by], 0.004, width, 'zy')
          .applyMatrix4(mat4(CHAMBERS[ch].x, 0, 0)),
        color: 0xc2cad1,
      });
    }
    const rackMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.6 });
    for (let ch = 0; ch < 3; ch++) {
      if (chamberGeoms[ch].length === 0) continue;
      const mesh = new THREE.Mesh(mergeGeoms(chamberGeoms[ch]), rackMat);
      this.ms.cabinet.add(mesh);
    }
    // ピン (60本 instanced)
    this.pinMesh = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.008, 0.008, 1, 8).applyMatrix4(mat4(0, 0, 0, 0, 0, Math.PI / 2)),
      new THREE.MeshStandardMaterial({ color: 0xd8352f, roughness: 0.3, metalness: 0.6 }),
      60
    );
    this.pinMesh.frustumCulled = false;
    this.ms.cabinet.add(this.pinMesh);
  }

  /* ============ イベント ============ */
  onMechEvent(type, data) {
    if (type === 'accept') {
      this.sensorBlink[data.denom] = 0.5;
    } else if (type === 'payoutCoin') {
      this.ejectorT[data.denom] = 0.22;
    }
  }

  onRackEvent(type, data) {
    if (type === 'productExit') {
      this.portTweens.set(data.body.id, { xT: 0 });
    } else if (type === 'productRemove') {
      const b = data.body;
      const p = b.userData.product;
      // 取出しフライアウト (一時メッシュ)
      const mesh = new THREE.Mesh(buildProductGeometry(p), productAtlasMat());
      mesh.rotation.z = Math.PI / 2;
      const grp = new THREE.Group();
      grp.add(mesh);
      grp.position.set(this._renderX(b), b.y, b.x);
      grp.rotation.x = b.angle;
      this.ms.cabinet.add(grp);
      this.flyouts.push({ grp, t: 0 });
      this.portTweens.delete(b.id);
    }
  }

  _renderX(b) {
    const colIdx = b.userData.col;
    if (colIdx == null || colIdx < 0) {
      // トレー上: レイヤー名から室を割り出す
      const m = /^tray(\d)/.exec(b.layer);
      return m ? CHAMBERS[Number(m[1])].x : 0;
    }
    const conf = COLUMNS[colIdx];
    const tw = this.portTweens.get(b.id);
    if (!tw) return conf.x;
    return lerp(conf.x, conf.portX, easeInOut(tw.xT));
  }

  /* ============ 毎フレーム同期 ============ */
  update(dtSim, dtReal, alpha, camera) {
    this._syncCoins(alpha);
    this._syncStacks();
    this._syncCash();
    this._syncProducts(dtSim, alpha);
    this._syncMechParts(dtSim, dtReal);
    this._syncPins(dtReal);
    this._syncFlaps(alpha);
    this._syncBill();
    this._flyouts(dtReal, camera);
  }

  _syncCoins(alpha) {
    const counts = {};
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (const denom of DENOMS) counts[denom] = 0;
    for (const b of this.world.bodies) {
      if (b.userData.kind !== 'coin') continue;
      const denom = b.userData.denom;
      const im = this.coinMeshes[denom];
      const i = counts[denom]++;
      if (i >= 40) continue;
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      const ang = b.pangle + (b.angle - b.pangle) * alpha;
      const z = b.layer === LAYER_MECH_BACK ? CABINET.mechBackZ
        : b.layer === LAYER_ESCROW_RET ? CABINET.mechZ + 0.022 : CABINET.mechZ;
      pos.set(x, y, z);
      quat.setFromAxisAngle(zAxis, ang);
      mat.compose(pos, quat, one);
      im.setMatrixAt(i, mat);
    }
    for (const denom of DENOMS) {
      const im = this.coinMeshes[denom];
      im.count = counts[denom];
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _syncStacks() {
    const mat = new THREE.Matrix4();
    for (const denom of DENOMS) {
      const spec = COINS[denom];
      const im = this.stackMeshes[denom];
      const n = Math.min(this.mech.tubes[denom], TUBE_CAP[denom]);
      for (let i = 0; i < n; i++) {
        mat.makeRotationY(i * 1.7);
        mat.setPosition(TUBES[denom].cx, TUBE_BOTTOM + (i + 0.5) * spec.thick, CABINET.mechZ);
        im.setMatrixAt(i, mat);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _syncCash() {
    const cb = MECH.cashBox;
    const mat = new THREE.Matrix4();
    const rng = makeRng(97);
    for (const denom of DENOMS) {
      const im = this.cashMeshes[denom];
      const n = Math.min(this.mech.cashBox[denom], 60);
      for (let i = 0; i < n; i++) {
        const x = cb.x0 + 0.03 + rng() * (cb.x1 - cb.x0 - 0.06);
        const z = 0.165 + rng() * 0.06;
        const layer = Math.floor(i / 8);
        const e = new THREE.Euler(rng() * 0.3 - 0.15, rng() * Math.PI, rng() * 0.3 - 0.15);
        mat.makeRotationFromEuler(e);
        mat.setPosition(x, cb.y0 + 0.012 + layer * 0.006 + rng() * 0.004, z);
        im.setMatrixAt(i, mat);
      }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  _syncProducts(dtSim, alpha) {
    for (const tw of this.portTweens.values()) {
      if (tw.xT < 1) tw.xT = Math.min(1, tw.xT + dtSim / 0.8);
    }
    const counts = new Array(PRODUCTS.length).fill(0);
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const xAxis = new THREE.Vector3(1, 0, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (const b of this.world.bodies) {
      if (b.userData.kind !== 'product') continue;
      const pi = b.userData.product.atlas;
      const entry = this.productMeshes[pi];
      const i = counts[pi]++;
      if (i >= 40) continue;
      const y = b.py + (b.y - b.py) * alpha;
      const z = b.px + (b.x - b.px) * alpha;
      const ang = b.pangle + (b.angle - b.pangle) * alpha;
      pos.set(this._renderX(b), y, z);
      quat.setFromAxisAngle(xAxis, ang);
      mat.compose(pos, quat, one);
      entry.im.setMatrixAt(i, mat);
      entry.shell.setMatrixAt(i, mat);
    }
    for (let pi = 0; pi < PRODUCTS.length; pi++) {
      const e = this.productMeshes[pi];
      e.im.count = counts[pi];
      e.shell.count = counts[pi];
      e.im.instanceMatrix.needsUpdate = true;
      e.shell.instanceMatrix.needsUpdate = true;
    }
  }

  _syncMechParts(dtSim, dtReal) {
    this.gatePivotGrp.rotation.z = this.mech.gateAngle - Math.PI;
    for (const denom of DENOMS) {
      if (this.sensorBlink[denom] > 0) {
        this.sensorBlink[denom] -= dtReal;
        this.sensorMats[denom].emissiveIntensity = 1.6;
      } else {
        this.sensorMats[denom].emissiveIntensity = 0.15;
      }
      const ej = this.ejectors[denom];
      if (this.ejectorT[denom] > 0) {
        this.ejectorT[denom] -= dtSim;
        const k = Math.sin((1 - this.ejectorT[denom] / 0.22) * Math.PI);
        ej.position.x = TUBES[denom].cx + k * 0.012;
      } else {
        ej.position.x = TUBES[denom].cx;
      }
    }
    // エスクローシャッター (enabled 状態に追従してスライド)
    for (const denom of ESCROW_DENOMS) {
      const sm = this.shutterMeshes[denom];
      const ch = this.mech.channels[denom];
      const target = ch.shutter?.enabled ? 1 : 0;
      sm.t += (target - sm.t) * Math.min(1, dtReal * 16);
      sm.mesh.position.x = sm.cx + (1 - sm.t) * (ch.half * 2 + 0.008);
      sm.mesh.scale.x = 0.15 + 0.85 * sm.t;
    }
  }

  _syncPins(dtReal) {
    const mat = new THREE.Matrix4();
    let idx = 0;
    for (const pd of this.pinData) {
      const col = pd.col;
      const lT = col.pinLower.enabled ? 1 : 0;
      const uT = col.pinUpper.enabled ? 1 : 0;
      pd.lowerT += (lT - pd.lowerT) * Math.min(1, dtReal * 16);
      pd.upperT += (uT - pd.upperT) * Math.min(1, dtReal * 16);
      const place = (seg, t) => {
        const y = (seg.ay + seg.by) / 2;
        const len = pd.width * (0.12 + 0.7 * t);
        mat.makeScale(len, 1, 1);
        mat.setPosition(pd.cx + pd.width * 0.42 * (1 - t), y, seg.ax);
        this.pinMesh.setMatrixAt(idx++, mat);
      };
      place(col.pinLower, pd.lowerT);
      place(col.pinUpper, pd.upperT);
    }
    this.pinMesh.count = idx;
    this.pinMesh.instanceMatrix.needsUpdate = true;
  }

  _syncFlaps(alpha) {
    let inner = 0, outer = 0;
    for (const f of this.world.flaps) {
      const a = f.pangleH + (f.angle - f.pangleH) * alpha;
      if (f.material === 'innerflap') inner = Math.max(inner, a);
      else outer = Math.max(outer, a);
    }
    this.ms.setInnerFlapAngle(inner);
    this.ms.setFlapAngle(Math.max(outer, this.manualFlap ?? 0));
  }

  _syncBill() {
    const bill = this.mech.bill;
    const st = BILL.stacker;
    // 搬送中の札
    if (bill.state === 'feeding' || bill.state === 'validating' || bill.state === 'rejecting') {
      this.billMesh.visible = true;
      const depth = bill.state === 'validating' ? 1 : bill.progress;
      // 挿入: 手前 (z+) から札口へ吸い込まれる
      this.billMesh.position.set(
        BILL.slot.u,
        BILL.slot.v - 0.005,
        0.36 + (1 - depth) * 0.10 - 0.06
      );
    } else if (bill.state === 'stacking') {
      this.billMesh.visible = true;
      const k = bill.progress - 1;
      this.billMesh.position.set(
        BILL.slot.u,
        BILL.slot.v - 0.005 - k * (BILL.slot.v - (st.y0 + st.y1) / 2),
        0.30 - k * (0.30 - st.z)
      );
    } else {
      this.billMesh.visible = false;
    }
    // スタッカー枚数
    const mat = new THREE.Matrix4();
    const n = Math.min(bill.stacked, 40);
    for (let i = 0; i < n; i++) {
      mat.makeRotationY(Math.PI / 2);
      mat.setPosition((st.x0 + st.x1) / 2, st.y0 + 0.006 + i * 0.0016, st.z);
      this.billStackMesh.setMatrixAt(i, mat);
    }
    this.billStackMesh.count = n;
    this.billStackMesh.instanceMatrix.needsUpdate = true;
  }

  _flyouts(dtReal, camera) {
    for (const f of this.flyouts) {
      f.t += dtReal;
      const k = easeInOut(Math.min(1, f.t / 0.55));
      const target = camera.position.clone().lerp(
        camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.6).add(camera.position), 0.5);
      target.y -= 0.25;
      f.grp.position.lerp(target, k * 0.25);
      f.grp.scale.setScalar(1 - k * 0.9);
      if (f.t >= 0.55) {
        f.grp.parent?.remove(f.grp);
        f.done = true;
      }
    }
    this.flyouts = this.flyouts.filter(f => !f.done);
  }
}
