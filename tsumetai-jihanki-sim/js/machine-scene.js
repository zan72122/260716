/* ============================================================
   machine-scene.js — 自販機筐体のプロシージャルモデル
   キャビネット / ヒンジ扉 / サンプル窓 / ボタン / LED表示 /
   取出口+フラップ / 返却口 / 店員用小道具 / X線マテリアル切替
   ============================================================ */
import * as THREE from 'three';
import { mergeGeoms, mat4, canvasTexture, makeRng } from './lib3d.js';
import { CABINET, PRODUCTS, COLUMNS, PRICES, CHUTE, RACK } from './config.js';

export const SAMPLE_X = [-0.36, -0.18, 0.0, 0.18, 0.36];

/* ---- 共有マテリアル ---- */
const MAT = {};
function initMats() {
  MAT.body = new THREE.MeshStandardMaterial({ color: 0xeef3f6, roughness: 0.42, metalness: 0.15, vertexColors: true });
  MAT.doorFace = new THREE.MeshStandardMaterial({ color: 0xe8503a, roughness: 0.38, metalness: 0.1 });
  MAT.darkPlastic = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.62, metalness: 0.15 });
  MAT.innerPlastic = new THREE.MeshStandardMaterial({ color: 0x33393f, roughness: 0.7, metalness: 0.05 });
  MAT.steel = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.35, metalness: 0.75 });
  MAT.steelDark = new THREE.MeshStandardMaterial({ color: 0x6b747c, roughness: 0.45, metalness: 0.7 });
  MAT.glass = new THREE.MeshStandardMaterial({
    color: 0xcfe8f5, roughness: 0.08, metalness: 0.1,
    transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
  });
  MAT.lampOff = new THREE.MeshStandardMaterial({ color: 0x30363c, roughness: 0.5 });
  MAT.xray = new THREE.MeshStandardMaterial({
    color: 0x9fd4f0, roughness: 0.3, metalness: 0.2,
    transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
  });
}

/* ---- 商品メッシュ (缶/ペット) を生成。軸=Y。 ---- */
const labelTexCache = new Map();
export function buildProductMesh(p) {
  if (!labelTexCache.has(p.id)) {
    labelTexCache.set(p.id, canvasTexture(256, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, p.colors[0]);
      g.addColorStop(1, p.colors[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '900 34px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 5;
      ctx.strokeText(p.short, w / 2, h / 2 - 8);
      ctx.fillText(p.short, w / 2, h / 2 - 8);
      ctx.font = '700 15px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(p.label, w / 2, h / 2 + 26);
      ctx.font = '700 11px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(p.kind === 'pet' ? '500ml PET' : (p.r < 0.03 ? '190g 缶' : '350ml 缶'), w / 2, h - 16);
    }));
  }
  const tex = labelTexCache.get(p.id);
  const grp = new THREE.Group();
  if (p.kind === 'can') {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.985, p.r * 0.985, p.len * 0.82, 24),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.55 })
    );
    grp.add(body);
    const lid = new THREE.CylinderGeometry(p.r * 0.86, p.r * 0.985, p.len * 0.085, 24);
    const top = new THREE.Mesh(lid, MAT.steel);
    top.position.y = p.len * 0.45;
    const bot = new THREE.Mesh(lid.clone().applyMatrix4(mat4(0, 0, 0, Math.PI, 0, 0)), MAT.steel);
    bot.position.y = -p.len * 0.45;
    grp.add(top, bot);
  } else {
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.98, p.r * 0.96, p.len * 0.62, 20),
      new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.2, metalness: 0.05,
        transparent: true, opacity: 0.96,
      })
    );
    body.position.y = -p.len * 0.09;
    grp.add(body);
    const shoulder = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.42, p.r * 0.95, p.len * 0.2, 20),
      new THREE.MeshStandardMaterial({ color: 0xdfefff, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.5 })
    );
    shoulder.position.y = p.len * 0.32;
    grp.add(shoulder);
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.36, p.r * 0.36, p.len * 0.09, 14),
      new THREE.MeshStandardMaterial({ color: p.colors[0], roughness: 0.4 })
    );
    cap.position.y = p.len * 0.455;
    grp.add(cap);
    const bottom = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r * 0.96, p.r * 0.9, p.len * 0.1, 20),
      new THREE.MeshStandardMaterial({ color: 0xcfe4f2, roughness: 0.25, transparent: true, opacity: 0.7 })
    );
    bottom.position.y = -p.len * 0.45;
    grp.add(bottom);
  }
  return grp;
}

export class MachineScene {
  constructor(scene) {
    initMats();
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.xrayList = [];              // {mesh, opaque}
    this.xrayOn = false;
    this.xrayEdges = [];
    this.buttons = [];               // {mesh, lampMat, soldMat, x}
    this.time = 0;
    this._buildEnvironment();
    this._buildCabinet();
    this._buildDoor();
    this._buildOperatorProps();
    this.setDoorAngle(0);
  }

  registerXray(mesh) {
    this.xrayList.push({ mesh, opaque: mesh.material });
  }

  setXray(on) {
    if (this.xrayOn === on) return;
    this.xrayOn = on;
    for (const e of this.xrayList) e.mesh.material = on ? MAT.xray : e.opaque;
    for (const l of this.xrayEdges) l.visible = on;
    MAT.xray.opacity = on ? 0.5 : 0.13;   // update() で 0.13 へフェード
  }

  /* ============ 環境 ============ */
  _buildEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 40),
      new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#8d9298';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(60,64,70,0.5)';
      ctx.lineWidth = 2;
      for (let y = 0; y <= h; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const y = 16 + Math.floor(i / 2) * 32 * 2;
      }
    }, { repeat: [6, 3] });
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 4),
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 })
    );
    wall.position.set(0, 2, -0.75);
    this.scene.add(wall);
  }

  /* ============ キャビネット (本体) ============ */
  _buildCabinet() {
    const C = CABINET;
    const g = new THREE.Group();
    this.cabinet = g;
    this.root.add(g);

    // ---- 外殻 (側面/天面/背面/底面) ----
    const t = 0.022;
    const shellGeom = mergeGeoms([
      { geom: new THREE.BoxGeometry(t, C.h - 0.04, C.d), matrix: mat4(-C.w / 2 + t / 2, C.h / 2, 0), color: 0xdfe7ec },
      { geom: new THREE.BoxGeometry(t, C.h - 0.04, C.d), matrix: mat4(C.w / 2 - t / 2, C.h / 2, 0), color: 0xdfe7ec },
      { geom: new THREE.BoxGeometry(C.w, t, C.d), matrix: mat4(0, C.h - t / 2, 0), color: 0xe8eef2 },
      { geom: new THREE.BoxGeometry(C.w, t, C.d - 0.05), matrix: mat4(0, 0.135, 0.025), color: 0xccd4da },
      { geom: new THREE.BoxGeometry(C.w, C.h - 0.04, t), matrix: mat4(0, C.h / 2, C.zBack + t / 2), color: 0xd5dde2 },
    ]);
    const shell = new THREE.Mesh(shellGeom, MAT.body);
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    this.registerXray(shell);
    this._addEdges(shell.geometry, g);

    // ---- ベース (黒い台座) ----
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(C.w - 0.06, 0.125, C.d - 0.06),
      MAT.darkPlastic
    );
    base.position.set(0, 0.062, 0);
    g.add(base);

    // ---- 庫内の断熱ライナー (X線で見える暗い内壁) ----
    const liner = new THREE.Mesh(
      new THREE.BoxGeometry(C.w - 0.07, C.h - 0.24, t),
      MAT.innerPlastic
    );
    liner.position.set(0, C.h / 2 + 0.04, C.zBack + 0.045);
    g.add(liner);

    // ---- 庫内灯 (扉を開けたときに中が見えるように) ----
    const cabinLight = new THREE.PointLight(0xdceefb, 0.35, 1.8);
    cabinLight.position.set(0, 1.3, 0.0);
    g.add(cabinLight);

    // ---- コラム仕切り板 ----
    const partitions = [];
    const bounds = [-0.455];
    for (let i = 0; i < COLUMNS.length - 1; i++) {
      bounds.push((COLUMNS[i].x + COLUMNS[i + 1].x) / 2 + 0.0);
    }
    bounds.push(0.455);
    this.columnBounds = bounds;
    for (let i = 1; i < bounds.length - 1; i++) {
      partitions.push({
        geom: new THREE.BoxGeometry(0.008, 1.06, RACK.zFront - RACK.zBack + 0.05),
        matrix: mat4(bounds[i], 1.24, (RACK.zFront + RACK.zBack) / 2),
        color: 0x9aa4ac,
      });
    }
    const partMesh = new THREE.Mesh(mergeGeoms(partitions), MAT.body);
    g.add(partMesh);

    // ---- シュートトレイ (全幅の傾斜板) ----
    const tr = CHUTE.tray;
    const trayLen = Math.hypot(tr.b[0] - tr.a[0], tr.b[1] - tr.a[1]);
    const trayAng = Math.atan2(tr.b[1] - tr.a[1], tr.b[0] - tr.a[0]);
    const tray = new THREE.Mesh(
      new THREE.BoxGeometry(C.w - 0.08, 0.008, trayLen),
      MAT.steelDark
    );
    tray.position.set(0, (tr.a[1] + tr.b[1]) / 2 - 0.004, (tr.a[0] + tr.b[0]) / 2);
    tray.rotation.x = trayAng;
    g.add(tray);

    // ---- 取出口ボックス ----
    const P = C.portX;
    const pf = CHUTE.portFloor;
    const portGrp = new THREE.Group();
    g.add(portGrp);
    const portFloor = new THREE.Mesh(
      new THREE.BoxGeometry(P[1] - P[0] + 0.06, 0.01, pf.b[0] - pf.a[0] + 0.04),
      MAT.innerPlastic
    );
    portFloor.position.set((P[0] + P[1]) / 2, (pf.a[1] + pf.b[1]) / 2 - 0.005, (pf.a[0] + pf.b[0]) / 2);
    portFloor.rotation.x = Math.atan2(pf.b[1] - pf.a[1], pf.b[0] - pf.a[0]);
    portGrp.add(portFloor);
    const portBack = new THREE.Mesh(
      new THREE.BoxGeometry(P[1] - P[0] + 0.06, 0.24, 0.01),
      MAT.innerPlastic
    );
    portBack.position.set((P[0] + P[1]) / 2, 0.48, pf.a[0] - 0.015);
    portGrp.add(portBack);
    for (const sx of [P[0] - 0.02, P[1] + 0.02]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.26, 0.24), MAT.innerPlastic);
      side.position.set(sx, 0.45, 0.2);
      portGrp.add(side);
    }

    // ---- フラップ (物理と同期して回る) ----
    const fl = CHUTE.flap;
    this.flapPivot = new THREE.Group();
    this.flapPivot.position.set((P[0] + P[1]) / 2, fl.pivot[1], fl.pivot[0]);
    g.add(this.flapPivot);
    const flapMesh = new THREE.Mesh(
      new THREE.BoxGeometry(P[1] - P[0] + 0.02, fl.len, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.5, metalness: 0.2 })
    );
    flapMesh.position.y = -fl.len / 2;
    const pushTex = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(255,255,255,0.0)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(230,240,248,0.85)';
      ctx.font = '900 26px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('お取り出し口', w / 2, h / 2);
    });
    const pushLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.1),
      new THREE.MeshStandardMaterial({ map: pushTex, transparent: true, roughness: 0.5 })
    );
    pushLabel.position.set(0, -fl.len / 2, 0.008);
    this.flapPivot.add(flapMesh, pushLabel);
  }

  _addEdges(geom, parent) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom, 30),
      new THREE.LineBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.35 })
    );
    edges.visible = false;
    parent.add(edges);
    this.xrayEdges.push(edges);
  }

  /* ============ 扉 ============ */
  _buildDoor() {
    const C = CABINET;
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(C.hingeX, 0, 0.33);
    this.root.add(this.doorPivot);
    this.doorContent = new THREE.Group();
    this.doorContent.position.set(-C.hingeX, 0, -0.33);
    this.doorPivot.add(this.doorContent);
    const d = this.doorContent;

    // ---- 扉パネル (開口部を避けたストリップ構成) ----
    const zP = 0.335, th = 0.024;
    const strips = [
      // 上帯
      { w: 1.0, h: 0.11, x: 0, y: 1.775 },
      // 窓の左右柱
      { w: 0.06, h: 0.50, x: -0.47, y: 1.47 },
      { w: 0.06, h: 0.50, x: 0.47, y: 1.47 },
      // ボタン帯
      { w: 1.0, h: 0.12, x: 0, y: 1.16 },
      // 中帯 (コイン/広告)
      { w: 1.0, h: 0.54, x: 0, y: 0.83 },
      // 取出口まわり
      { w: 0.06, h: 0.30, x: -0.47, y: 0.41 },
      { w: 0.24, h: 0.30, x: 0.18, y: 0.41 },
      { w: 0.06, h: 0.30, x: 0.47, y: 0.41 },
      // 下帯
      { w: 1.0, h: 0.20, x: 0, y: 0.16 },
    ];
    const doorGeom = mergeGeoms(strips.map(s => ({
      geom: new THREE.BoxGeometry(s.w, s.h, th),
      matrix: mat4(s.x, s.y, zP),
      color: 0xffffff,
    })));
    const doorMat = new THREE.MeshStandardMaterial({ color: 0xdd4a33, roughness: 0.4, metalness: 0.12 });
    const doorMesh = new THREE.Mesh(doorGeom, doorMat);
    doorMesh.castShadow = true;
    d.add(doorMesh);
    this.registerXray(doorMesh);
    this._addEdges(doorMesh.geometry, d);

    // ---- 天面サイン「つめたい ドリンク」 ----
    const signTex = canvasTexture(1024, 128, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, '#1861a8');
      g2.addColorStop(0.5, '#2b8fd8');
      g2.addColorStop(1, '#1861a8');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '900 72px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('つめた〜い ドリンク', w / 2, h / 2 + 4);
    });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.085),
      new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.55, roughness: 0.4 })
    );
    sign.position.set(0, 1.775, zP + th / 2 + 0.001);
    d.add(sign);

    // ---- サンプル展示窓 ----
    this._buildDisplayWindow(d, zP, th);

    // ---- ボタン列 ----
    this._buildButtons(d, zP, th);

    // ---- コイン操作部 / LED ----
    this._buildCoinPanel(d, zP, th);

    // ---- 広告パネル ----
    const adTex = canvasTexture(512, 448, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, '#0e3f70');
      g2.addColorStop(1, '#1b6fb4');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      // 氷のかけら
      const rng = makeRng(42);
      ctx.fillStyle = 'rgba(210,240,255,0.25)';
      for (let i = 0; i < 14; i++) {
        const x = rng() * w, y = rng() * h, r = 10 + rng() * 30;
        ctx.beginPath();
        ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.8, y + r * 0.6); ctx.lineTo(x - r * 0.8, y + r * 0.5);
        ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = '#eaf8ff';
      ctx.font = '900 84px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('キンキンに', w / 2, 150);
      ctx.fillText('つめたい!', w / 2, 250);
      ctx.font = '800 34px sans-serif';
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText('しくみも まるみえ', w / 2, 330);
      ctx.font = '700 24px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('COLD DRINK VENDOR', w / 2, 390);
    });
    const ad = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.4),
      new THREE.MeshStandardMaterial({ map: adTex, roughness: 0.45 })
    );
    ad.position.set(-0.2, 0.82, zP + th / 2 + 0.001);
    d.add(ad);
    this.registerXray(ad);

    // ---- 下帯の通気グリル ----
    const ventTex = canvasTexture(256, 64, (ctx, w, h) => {
      ctx.fillStyle = '#20242a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#0c0e12';
      for (let x = 8; x < w; x += 20) ctx.fillRect(x, 6, 10, h - 12);
    });
    const vent = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.1),
      new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.7 })
    );
    vent.position.set(-0.12, 0.155, zP + th / 2 + 0.001);
    d.add(vent);

    // ---- 鍵穴 (ハンドルロック) ----
    const lock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.03, 12),
      MAT.steelDark
    );
    lock.rotation.x = Math.PI / 2;
    lock.position.set(0.465, 0.86, zP + th / 2);
    d.add(lock);
    this.doorHandle = lock;
  }

  /* ---- サンプル展示窓 ---- */
  _buildDisplayWindow(d, zP, th) {
    // 展示ボックス (庫内側に張り出す)
    const box = new THREE.Group();
    d.add(box);
    const backTex = canvasTexture(64, 64, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, '#f4fbff');
      g2.addColorStop(1, '#cfe6f4');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    });
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.5),
      new THREE.MeshStandardMaterial({ map: backTex, emissive: 0xdff2ff, emissiveIntensity: 0.16, roughness: 0.6 })
    );
    back.position.set(0, 1.47, 0.205);
    box.add(back);
    this.registerXray(back);
    // 棚板
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.012, 0.13),
      new THREE.MeshStandardMaterial({ color: 0xdde8ee, roughness: 0.5 })
    );
    shelf.position.set(0, 1.285, 0.265);
    box.add(shelf);
    // サンプル商品
    this.sampleMeshes = [];
    for (let i = 0; i < COLUMNS.length; i++) {
      const p = PRODUCTS[COLUMNS[i].product];
      const m = buildProductMesh(p);
      m.scale.setScalar(0.86);
      m.position.set(SAMPLE_X[i], 1.291 + p.len * 0.43, 0.268);
      box.add(m);
      this.sampleMeshes.push(m);
    }
    // 「つめた〜い」帯
    const stripTex = canvasTexture(1024, 64, (ctx, w, h) => {
      ctx.fillStyle = '#0f5aa8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#dff2ff';
      ctx.font = '900 38px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 5; i++) {
        ctx.fillText('つめた〜い', (i + 0.5) * (w / 5), h / 2 + 2);
      }
    });
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.055),
      new THREE.MeshStandardMaterial({
        map: stripTex, emissive: 0xffffff, emissiveMap: stripTex, emissiveIntensity: 0.5, roughness: 0.4,
      })
    );
    strip.position.set(0, 1.252, 0.31);
    box.add(strip);
    this.coldStrip = strip;

    // 窓ガラス
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.5), MAT.glass);
    glass.position.set(0, 1.47, zP + th / 2 + 0.002);
    d.add(glass);
    this.windowGlass = glass;

    // 窓内の蛍光灯
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.84, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf0f8ff, emissiveIntensity: 0.9 })
    );
    tube.rotation.z = Math.PI / 2;
    tube.position.set(0, 1.685, 0.27);
    box.add(tube);
    const lamp = new THREE.PointLight(0xeaf6ff, 0.22, 1.0);
    lamp.position.set(0, 1.58, 0.28);
    box.add(lamp);
  }

  /* ---- 商品ボタン列 ---- */
  _buildButtons(d, zP, th) {
    const btnGeom = new THREE.BoxGeometry(0.115, 0.062, 0.018);
    for (let i = 0; i < COLUMNS.length; i++) {
      const price = PRICES[COLUMNS[i].product];
      const tex = canvasTexture(128, 72, (ctx, w, h) => {
        ctx.fillStyle = '#101418';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff';
        ctx.font = '900 34px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(`${price}円`, w / 2, h / 2);
      });
      const lampMat = new THREE.MeshStandardMaterial({
        map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.06, roughness: 0.3,
      });
      const btn = new THREE.Mesh(btnGeom, lampMat);
      btn.position.set(SAMPLE_X[i], 1.155, zP + th / 2 + 0.009);
      btn.userData.button = i;
      d.add(btn);
      // 売切ランプ
      const soldTex = canvasTexture(96, 40, (ctx, w, h) => {
        ctx.fillStyle = '#200608';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#ff3b30';
        ctx.font = '900 26px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('売切', w / 2, h / 2 + 1);
      });
      const soldMat = new THREE.MeshStandardMaterial({
        map: soldTex, emissive: 0xffffff, emissiveMap: soldTex, emissiveIntensity: 0.0, roughness: 0.4,
      });
      soldMat.color.set(0x2a1215);   // 消灯時はほぼ黒
      const sold = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.024), soldMat);
      sold.position.set(SAMPLE_X[i] + 0.033, 1.196, zP + th / 2 + 0.002);
      d.add(sold);
      lampMat.color.set(0x777777);   // 消灯時は減光
      this.buttons.push({ mesh: btn, lampMat, soldMat, index: i });
    }
  }

  /* ---- コイン操作部 (投入口/レバー/LED/返却口) ---- */
  _buildCoinPanel(d, zP, th) {
    // 操作部ベースプレート (X線では透けてメックが見える)
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.34, 0.012),
      MAT.steel
    );
    plate.position.set(0.31, 0.95, zP + th / 2 + 0.005);
    d.add(plate);
    this.registerXray(plate);

    // 投入口 (縦スロット)
    const slotFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.075, 0.022),
      MAT.steelDark
    );
    slotFrame.position.set(0.36, 1.02, zP + th / 2 + 0.014);
    d.add(slotFrame);
    const slotHole = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.05, 0.026),
      new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9 })
    );
    slotHole.position.set(0.36, 1.02, zP + th / 2 + 0.015);
    d.add(slotHole);
    this.coinSlot = slotFrame;

    // 硬貨返却レバー
    this.leverPivot = new THREE.Group();
    this.leverPivot.position.set(0.27, 1.045, zP + th / 2 + 0.012);
    d.add(this.leverPivot);
    const lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.075, 0.02),
      new THREE.MeshStandardMaterial({ color: 0xc8cdd2, roughness: 0.3, metalness: 0.6 })
    );
    lever.position.y = -0.03;
    this.leverPivot.add(lever);
    this.leverMesh = lever;

    // LED表示窓
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 256; this.ledCanvas.height = 80;
    this.ledTex = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTex.colorSpace = THREE.SRGBColorSpace;
    this.drawLED('0');
    const led = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19, 0.06),
      new THREE.MeshStandardMaterial({
        map: this.ledTex, emissive: 0xffffff, emissiveMap: this.ledTex, emissiveIntensity: 0.9, roughness: 0.3,
      })
    );
    led.position.set(0.30, 0.88, zP + th / 2 + 0.013);
    d.add(led);
    const ledBezel = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.075, 0.008), MAT.darkPlastic);
    ledBezel.position.set(0.30, 0.88, zP + th / 2 + 0.008);
    d.add(ledBezel);
    this.registerXray(ledBezel);

    // つり銭切れランプ
    const shortTex = canvasTexture(140, 36, (ctx, w, h) => {
      ctx.fillStyle = '#20100a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffb020';
      ctx.font = '900 20px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('つり銭切れ', w / 2, h / 2 + 1);
    });
    this.shortageMat = new THREE.MeshStandardMaterial({
      map: shortTex, color: 0x241812, emissive: 0xffffff, emissiveMap: shortTex, emissiveIntensity: 0.0, roughness: 0.4,
    });
    const short = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.026), this.shortageMat);
    short.position.set(0.30, 0.835, zP + th / 2 + 0.013);
    d.add(short);

    // 硬貨投入可否ステッカー
    const stickerTex = canvasTexture(160, 90, (ctx, w, h) => {
      ctx.fillStyle = '#f2f5f8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#333';
      ctx.font = '800 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('つかえるお金', w / 2, 24);
      ctx.font = '700 15px sans-serif';
      ctx.fillText('10・50・100・500円', w / 2, 48);
      ctx.fillStyle = '#a00';
      ctx.font = '700 13px sans-serif';
      ctx.fillText('おさつは つかえません', w / 2, 72);
    });
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.065),
      new THREE.MeshStandardMaterial({ map: stickerTex, roughness: 0.55 })
    );
    sticker.position.set(0.235, 0.95, zP + th / 2 + 0.012);
    d.add(sticker);
    this.registerXray(sticker);

    // 返却口 (カップ) — 扉開口部の奥のくぼみ
    const cupBox = new THREE.Group();
    d.add(cupBox);
    const cupMat = MAT.innerPlastic;
    const mk = (w, h, dep, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), cupMat);
      m.position.set(x, y, z);
      cupBox.add(m);
    };
    mk(0.14, 0.012, 0.1, 0.367, 0.436, 0.27);   // 底
    mk(0.012, 0.13, 0.1, 0.325 - 0.006, 0.50, 0.27); // 左
    mk(0.012, 0.13, 0.1, 0.408 + 0.006, 0.50, 0.27); // 右
    mk(0.14, 0.13, 0.01, 0.367, 0.50, 0.225);   // 奥
    // 返却口の枠
    const cupFrame = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.02, 0.03), MAT.darkPlastic);
    cupFrame.position.set(0.367, 0.575, zP);
    cupBox.add(cupFrame);
  }

  /* ---- LED描画 (7セグ風) ---- */
  drawLED(text) {
    const ctx = this.ledCanvas.getContext('2d');
    const w = this.ledCanvas.width, h = this.ledCanvas.height;
    ctx.fillStyle = '#180a05';
    ctx.fillRect(0, 0, w, h);
    // 消えセグメントの薄い残像
    ctx.font = '700 56px "DSEG7", ui-monospace, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,110,40,0.08)';
    ctx.fillText('8888', w - 14, h / 2 + 2);
    ctx.fillStyle = '#ff7a2a';
    ctx.shadowColor = '#ff7a2a';
    ctx.shadowBlur = 12;
    ctx.fillText(text, w - 14, h / 2 + 2);
    ctx.shadowBlur = 0;
    this.ledTex.needsUpdate = true;
  }

  /* ---- ランプ状態 ---- */
  setLamp(i, state) {
    const b = this.buttons[i];
    if (!b) return;
    b.state = state;
    b.lampMat.emissiveIntensity = state === 'ready' ? 0.9 : 0.06;
    b.lampMat.color.set(state === 'ready' ? 0xffffff : 0x777777);
    b.soldMat.emissiveIntensity = state === 'soldout' ? 1.0 : 0.0;
    b.soldMat.color.set(state === 'soldout' ? 0xffffff : 0x2a1215);
  }
  setShortage(on) {
    this.shortageMat.emissiveIntensity = on ? 1.0 : 0.0;
    this.shortageMat.color.set(on ? 0xffffff : 0x241812);
  }

  setDoorAngle(a) {
    this.doorPivot.rotation.y = -a;
  }
  setFlapAngle(a) {
    this.flapPivot.rotation.x = -a;   // 開くと外へ (+z)
  }
  setLever(pulled) {
    this.leverPivot.rotation.z = pulled ? -0.5 : 0;
  }

  /* ============ 店員用小道具 ============ */
  _buildOperatorProps() {
    this.opProps = new THREE.Group();
    this.opProps.visible = false;
    this.root.add(this.opProps);

    // 商品ケース (コンテナ)
    const crate = new THREE.Group();
    crate.position.set(-0.95, 0, 0.55);
    this.opProps.add(crate);
    const crateBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x3f6db5, roughness: 0.6 })
    );
    crateBox.position.y = 0.03;
    crate.add(crateBox);
    for (const [sx, sz] of [[-0.24, 0], [0.24, 0], [0, -0.16], [0, 0.16]]) {
      const wallH = 0.16;
      const wallM = new THREE.Mesh(
        new THREE.BoxGeometry(sx === 0 ? 0.5 : 0.02, wallH, sx === 0 ? 0.02 : 0.34),
        new THREE.MeshStandardMaterial({ color: 0x3f6db5, roughness: 0.6 })
      );
      wallM.position.set(sx, 0.06 + wallH / 2, sz);
      crate.add(wallM);
    }
    // ケースの中の商品 (見た目)
    const rng = makeRng(11);
    for (let i = 0; i < 8; i++) {
      const p = PRODUCTS[i % PRODUCTS.length];
      const m = buildProductMesh(p);
      m.rotation.z = Math.PI / 2;
      m.rotation.x = rng() * Math.PI;
      m.position.set(-0.18 + (i % 4) * 0.12, 0.1 + Math.floor(i / 4) * 0.07, -0.08 + rng() * 0.16);
      crate.add(m);
    }
    this.crate = crate;

    // 釣銭コインケース
    const coinCase = new THREE.Group();
    coinCase.position.set(-0.78, 0, 0.85);
    this.opProps.add(coinCase);
    const caseBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.07, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x87552f, roughness: 0.55 })
    );
    caseBox.position.y = 0.035;
    coinCase.add(caseBox);
    this.coinCase = coinCase;
  }

  setOperatorProps(on) {
    this.opProps.visible = on;
  }

  update(dt, time) {
    this.time = time;
    // X線マテリアルのフェード
    if (this.xrayOn && MAT.xray.opacity > 0.13) {
      MAT.xray.opacity = Math.max(0.13, MAT.xray.opacity - dt * 0.9);
    }
    // ready ランプのやわらかい点滅
    for (const b of this.buttons) {
      if (b.state === 'ready') {
        b.lampMat.emissiveIntensity = 0.75 + Math.sin(time * 5) * 0.25;
      }
    }
    // つめた〜い帯のゆらぎ
    if (this.coldStrip) {
      this.coldStrip.material.emissiveIntensity = 0.45 + Math.sin(time * 1.7) * 0.1;
    }
  }
}
