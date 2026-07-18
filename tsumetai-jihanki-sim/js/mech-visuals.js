/* ============================================================
   mech-visuals.js — 機構の3D表示と物理の同期
   ・コインメック: 物理コライダ (world.segs) から板を自動生成
     → 見た目と物理が絶対に乖離しない
   ・硬貨: 金種別 InstancedMesh (補間つき)
   ・釣銭チューブの計数スタック / 金庫の硬貨山 / 落下トランジェント
   ・ラック棚 / ベンドピン / 商品メッシュ
   ============================================================ */
import * as THREE from 'three';
import { segPlate, canvasTexture, makeRng, clamp, lerp, easeInOut } from './lib3d.js';
import { buildProductMesh } from './machine-scene.js';
import {
  COINS, DENOMS, CABINET, MECH, TUBES, TUBE_TOP, TUBE_BOTTOM, TUBE_CAP,
  COLUMNS, RACK,
} from './config.js';
import { LAYER_MECH, LAYER_MECH_BACK } from './coin-mech.js';

const COIN_SEG = 22;

/* 硬貨の面テクスチャ */
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

export class MechVisuals {
  constructor(machineScene, world, mech, rack) {
    this.ms = machineScene;
    this.world = world;
    this.mech = mech;
    this.rack = rack;
    this.rng = makeRng(31);
    this.products = new Map();       // body.id → {grp, xFrom, xTo, xT, tweening}
    this.flyouts = [];               // 取出しアニメーション
    this.transients = [];            // チューブ落下コイン
    this.sensorBlink = {};           // denom → 残り時間
    this.flipperT = {};              // denom → 0..1
    this.ejectorT = {};              // denom → アニメ残り
    this._buildCoinInstances();
    this._buildMechUnit();
    this._buildRackVisuals();
  }

  /* ============ 硬貨インスタンス ============ */
  _buildCoinInstances() {
    this.coinMeshes = {};
    const d = this.ms.doorContent;
    for (const denom of DENOMS) {
      const spec = COINS[denom];
      const geom = new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, COIN_SEG);
      geom.rotateX(Math.PI / 2);   // 軸をZへ (メック面に立てる)
      const face = coinFaceTex(denom);
      const side = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.32, metalness: 0.88 });
      const faceMat = new THREE.MeshStandardMaterial({
        map: face, color: 0xffffff, roughness: 0.28, metalness: 0.85,
      });
      const cap = 40;
      const im = new THREE.InstancedMesh(geom, [side, faceMat, faceMat], cap);
      im.count = 0;
      im.frustumCulled = false;
      d.add(im);
      this.coinMeshes[denom] = im;

      // チューブ内スタック (寝かせた硬貨)
      const flatGeom = new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, COIN_SEG);
      const stack = new THREE.InstancedMesh(flatGeom, [side, faceMat, faceMat], TUBE_CAP[denom]);
      stack.count = 0;
      stack.frustumCulled = false;
      d.add(stack);
      if (!this.stackMeshes) this.stackMeshes = {};
      this.stackMeshes[denom] = stack;
    }
    // 金庫の硬貨山 (混在なので金種別に4つ)
    this.cashMeshes = {};
    for (const denom of DENOMS) {
      const spec = COINS[denom];
      const geom = new THREE.CylinderGeometry(spec.d / 2, spec.d / 2, spec.thick, 14);
      const im = new THREE.InstancedMesh(
        geom,
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.4, metalness: 0.8 }),
        60
      );
      im.count = 0;
      im.frustumCulled = false;
      this.ms.doorContent.add(im);
      this.cashMeshes[denom] = im;
    }
  }

  /* ============ コインメックの部品 ============ */
  _buildMechUnit() {
    const d = this.ms.doorContent;
    const Z = CABINET.mechZ, ZB = CABINET.mechBackZ;
    const grp = new THREE.Group();
    d.add(grp);
    this.mechGroup = grp;

    // 背面プレート (選別スロットの溝が見える)
    const plateTex = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#5a6167';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#454b51';
      for (let i = 0; i < 6; i++) ctx.fillRect(20 + i * 84, 30, 4, h - 60);
      ctx.fillStyle = 'rgba(20,22,26,0.55)';
    });
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.62),
      new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.55 })
    );
    back.position.set(0.24, 0.79, Z - 0.017);
    grp.add(back);

    // ---- 物理コライダから板を生成 ----
    const matSteel = new THREE.MeshStandardMaterial({ color: 0xc4ccd3, roughness: 0.3, metalness: 0.8 });
    const matRail = new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.35, metalness: 0.75 });
    const matChannel = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.4, metalness: 0.6 });
    for (const s of this.world.segs) {
      if (s.layer === LAYER_MECH) {
        if (s.material === 'plastic' || s.material === 'gate') continue; // カップ/ゲートは別途
        if (s.tag && s.tag.startsWith('catch-')) continue;              // 捕捉ガイドは背面プレートの溝
        const isBridge = s.tag && s.tag.startsWith('bridge-');
        const geom = segPlate([s.ax, s.ay], [s.bx, s.by], isBridge ? 0.0035 : 0.005, isBridge ? 0.008 : 0.03, 'xy');
        const mesh = new THREE.Mesh(geom, isBridge ? matChannel : (s.material === 'rail' ? matRail : matSteel));
        mesh.position.z = isBridge ? Z - 0.012 : Z;
        grp.add(mesh);
      } else if (s.layer === LAYER_MECH_BACK) {
        const geom = segPlate([s.ax, s.ay], [s.bx, s.by], 0.005, 0.028, 'xy');
        const mesh = new THREE.Mesh(geom, matSteel);
        mesh.position.z = ZB;
        grp.add(mesh);
      }
    }

    // ---- 返却ゲート (アニメーション) ----
    this.gateMesh = new THREE.Mesh(
      new THREE.BoxGeometry(MECH.returnGate.len, 0.006, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 0.35, metalness: 0.6 })
    );
    this.gatePivotGrp = new THREE.Group();
    this.gatePivotGrp.position.set(MECH.returnGate.pivot[0], MECH.returnGate.pivot[1], Z);
    this.gateMesh.position.x = -MECH.returnGate.len / 2;
    const gateInner = new THREE.Group();
    gateInner.add(this.gateMesh);
    this.gatePivotGrp.add(gateInner);
    this.gateInner = gateInner;
    grp.add(this.gatePivotGrp);

    // ---- 検銭センサーコイル ----
    this.sensorMats = {};
    for (const denom of DENOMS) {
      const ch = this.mech.channels[denom];
      const mat = new THREE.MeshStandardMaterial({
        color: 0x226644, emissive: 0x33ff88, emissiveIntensity: 0.15, roughness: 0.4,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0035, 8, 18), mat);
      ring.position.set(ch.cx, MECH.sensorY, Z);
      grp.add(ring);
      this.sensorMats[denom] = mat;
    }

    // ---- 振分フリッパー ----
    this.flipperGrps = {};
    for (const denom of DENOMS) {
      const ch = this.mech.channels[denom];
      const fg = new THREE.Group();
      fg.position.set(ch.cx - ch.half, MECH.flipperY, Z);
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(ch.half * 2, 0.005, 0.026),
        new THREE.MeshStandardMaterial({ color: 0x3f8fd0, roughness: 0.4, metalness: 0.5 })
      );
      plate.position.x = ch.half;
      fg.add(plate);
      fg.rotation.z = -1.35;   // 通常はチャンネルに沿って垂れている
      grp.add(fg);
      this.flipperGrps[denom] = fg;
      this.flipperT[denom] = 0;
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
      grp.add(tube);
      // 口の金具
      const mouth = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.d / 2 + 0.007, spec.d / 2 + 0.005, 0.018, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x8a939b, roughness: 0.35, metalness: 0.75 })
      );
      mouth.position.set(cx, TUBE_TOP + 0.008, Z);
      grp.add(mouth);
      // エジェクタ
      const ej = new THREE.Mesh(
        new THREE.BoxGeometry(spec.d + 0.006, 0.012, 0.028),
        new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.45, metalness: 0.5 })
      );
      ej.position.set(cx, TUBE_BOTTOM - 0.012, Z);
      grp.add(ej);
      if (!this.ejectors) this.ejectors = {};
      this.ejectors[denom] = ej;
      this.ejectorT[denom] = 0;
    }

    // ---- 金庫 ----
    const cb = MECH.cashBox;
    const cashMat = new THREE.MeshStandardMaterial({
      color: 0x2a3138, roughness: 0.5, metalness: 0.45,
      transparent: true, opacity: 0.85,
    });
    const cash = new THREE.Mesh(
      new THREE.BoxGeometry(cb.x1 - cb.x0, cb.y1 - cb.y0, 0.1),
      cashMat
    );
    cash.position.set((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2, 0.25);
    grp.add(cash);
    this.cashBoxMesh = cash;
    const cashLabel = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#1a2026';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d0d8e0';
      ctx.font = '900 30px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('コイン金庫', w / 2, h / 2);
    });
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.07),
      new THREE.MeshStandardMaterial({ map: cashLabel, roughness: 0.5 })
    );
    cl.position.set((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2, 0.301);
    grp.add(cl);

    // ---- メックの筐体フレーム ----
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.66, 0.005),
      new THREE.MeshStandardMaterial({ color: 0x757e86, roughness: 0.4, metalness: 0.7 })
    );
    frame.position.set(0.24, 0.79, 0.302);
    frame.visible = false;   // 扉裏から見た蓋 (開扉時のみ意味がある) — 簡略化のため非表示
    grp.add(frame);
  }

  /* ============ ラックの棚・ピン ============ */
  _buildRackVisuals() {
    const g = new THREE.Group();
    this.ms.cabinet.add(g);
    const bounds = this.ms.columnBounds;
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0xaeb8c0, roughness: 0.42, metalness: 0.6 });
    const shelfMat2 = new THREE.MeshStandardMaterial({ color: 0x99a3ab, roughness: 0.42, metalness: 0.6 });
    this.pinMeshes = [];
    for (const col of this.rack.cols) {
      const width = bounds[col.index + 1] - bounds[col.index] - 0.014;
      const cx = COLUMNS[col.index].x;
      for (const s of col.shelves) {
        const geom = segPlate(s.a, s.b, 0.006, width, 'zy');
        const mesh = new THREE.Mesh(geom, col.index % 2 ? shelfMat2 : shelfMat);
        mesh.position.x = cx;
        g.add(mesh);
      }
      // ベンドピン (右側のソレノイドハウジングから出入りする)
      const mkPin = (seg) => {
        const grp = new THREE.Group();
        const pin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, width * 0.62, 10),
          new THREE.MeshStandardMaterial({ color: 0xd8352f, roughness: 0.3, metalness: 0.6 })
        );
        pin.rotation.z = Math.PI / 2;
        grp.add(pin);
        grp.position.set(cx, (seg.ay + seg.by) / 2, seg.ax);
        g.add(grp);
        // ハウジング (仕切り壁に固定)
        const housing = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.032, 0.05),
          new THREE.MeshStandardMaterial({ color: 0x37424c, roughness: 0.45, metalness: 0.5 })
        );
        housing.position.set(cx + width * 0.42, (seg.ay + seg.by) / 2, seg.ax);
        g.add(housing);
        return grp;
      };
      this.pinMeshes.push({
        col: col.index,
        lower: mkPin(col.pinLower),
        upper: mkPin(col.pinUpper),
        lowerT: 1, upperT: 0,
        width,
        cx,
      });
    }
  }

  /* ============ イベント ============ */
  onMechEvent(type, data) {
    if (type === 'accept') {
      this.sensorBlink[data.denom] = 0.5;
    } else if (type === 'tubeIn') {
      // チューブへ落ちるトランジェント (立ち→寝かせ)
      this.transients.push({ denom: data.denom, t: 0, dur: 0.20 });
    } else if (type === 'payoutCoin') {
      this.ejectorT[data.denom] = 0.22;
    } else if (type === 'divert') {
      this.flipperT[data.denom] = 1.2;
    }
  }

  onRackEvent(type, data) {
    if (type === 'productSpawn') {
      const p = data.body.userData.product;
      const inner = buildProductMesh(p);
      inner.rotation.z = Math.PI / 2;   // 軸をXへ (横倒し)
      const grp = new THREE.Group();
      grp.add(inner);
      this.ms.cabinet.add(grp);
      this.products.set(data.body.id, {
        grp, body: data.body,
        xFrom: COLUMNS[data.col].x,
        xTo: COLUMNS[data.col].portX,
        xT: 0, tweening: false,
        zJit: (this.rng() - 0.5) * 0.006,
      });
    } else if (type === 'productExit') {
      const e = this.products.get(data.body.id);
      if (e) e.tweening = true;
    } else if (type === 'productRemove') {
      const e = this.products.get(data.body.id);
      if (e) {
        this.products.delete(data.body.id);
        this.flyouts.push({ grp: e.grp, t: 0 });
      }
    }
  }

  /* ============ 毎フレーム同期 ============ */
  update(dtSim, dtReal, alpha, camera) {
    this._syncCoins(alpha);
    this._syncStacks();
    this._syncCash();
    this._syncProducts(dtSim, alpha);
    this._syncMechParts(dtSim, dtReal);
    this._syncPins(dtReal);
    this._syncFlap(alpha);
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
      if (i >= im.instanceMatrix.count) continue;
      const x = b.px + (b.x - b.px) * alpha;
      const y = b.py + (b.y - b.py) * alpha;
      const ang = b.pangle + (b.angle - b.pangle) * alpha;
      const z = b.layer === LAYER_MECH_BACK ? CABINET.mechBackZ : CABINET.mechZ;
      pos.set(x, y, z);
      quat.setFromAxisAngle(zAxis, ang);
      mat.compose(pos, quat, one);
      im.setMatrixAt(i, mat);
    }
    for (const denom of DENOMS) {
      const im = this.coinMeshes[denom];
      if (im.count !== counts[denom]) im.count = counts[denom];
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
        const z = 0.215 + rng() * 0.06;
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
    for (const e of this.products.values()) {
      const b = e.body;
      if (e.tweening && e.xT < 1) {
        e.xT = Math.min(1, e.xT + dtSim / 0.85);
      }
      const x = lerp(e.xFrom, e.xTo, easeInOut(e.xT)) + e.zJit;
      const y = b.py + (b.y - b.py) * alpha;
      const z = b.px + (b.x - b.px) * alpha;   // 物理u=ワールドz
      const ang = b.pangle + (b.angle - b.pangle) * alpha;
      e.grp.position.set(x, y, z);
      e.grp.rotation.x = ang;
    }
  }

  _syncMechParts(dtSim, dtReal) {
    // 返却ゲート角 (メッシュは -x 方向 = 角度π で作ってある)
    this.gatePivotGrp.rotation.z = this.mech.gateAngle - Math.PI;
    // センサー点滅
    for (const denom of DENOMS) {
      if (this.sensorBlink[denom] > 0) {
        this.sensorBlink[denom] -= dtReal;
        this.sensorMats[denom].emissiveIntensity = 1.6;
      } else {
        this.sensorMats[denom].emissiveIntensity = 0.15;
      }
      // フリッパー
      const target = this.flipperT[denom] > 0 ? -0.35 : -1.35;
      const fg = this.flipperGrps[denom];
      fg.rotation.z += (target - fg.rotation.z) * Math.min(1, dtReal * 14);
      if (this.flipperT[denom] > 0) this.flipperT[denom] -= dtSim;
      // エジェクタ
      const ej = this.ejectors[denom];
      if (this.ejectorT[denom] > 0) {
        this.ejectorT[denom] -= dtSim;
        const k = Math.sin((1 - this.ejectorT[denom] / 0.22) * Math.PI);
        ej.position.x = TUBES[denom].cx + k * 0.012;
      } else {
        ej.position.x = TUBES[denom].cx;
      }
    }
    // チューブ落下トランジェント
    for (const tr of this.transients) tr.t += dtSim;
    this.transients = this.transients.filter(tr => tr.t < tr.dur);
  }

  _syncPins(dtReal) {
    for (const pm of this.pinMeshes) {
      const col = this.rack.cols[pm.col];
      const lTarget = col.pinLower.enabled ? 1 : 0;
      const uTarget = col.pinUpper.enabled ? 1 : 0;
      pm.lowerT += (lTarget - pm.lowerT) * Math.min(1, dtReal * 16);
      pm.upperT += (uTarget - pm.upperT) * Math.min(1, dtReal * 16);
      // ソレノイドハウジングへ引き込まれる (スライド + 縮み)
      const apply = (grp, t) => {
        grp.position.x = pm.cx + (1 - t) * pm.width * 0.42;
        grp.scale.x = 0.12 + 0.88 * t;
      };
      apply(pm.lower, pm.lowerT);
      apply(pm.upper, pm.upperT);
    }
  }

  _syncFlap(alpha) {
    let maxAngle = 0;
    for (const f of this.world.flaps) {
      const a = f.pangleH + (f.angle - f.pangleH) * alpha;
      if (a > maxAngle) maxAngle = a;
    }
    this.ms.setFlapAngle(maxAngle);
  }

  _flyouts(dtReal, camera) {
    for (const f of this.flyouts) {
      f.t += dtReal;
      const k = easeInOut(Math.min(1, f.t / 0.55));
      // カメラ手前へ吸い込まれて消える
      const target = camera.position.clone().lerp(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.6).add(camera.position), 0.5);
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
