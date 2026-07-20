/* ============================================================
   machine-scene.js — 筐体モデル (富士電機 FR30A6R40TK 準拠)
   白ベース汎用オペレーター機:
   ・前面上部 2/3 = サンプル展示室 (3段×12本・各サンプル直下に押ボタン)
   ・右縦帯 = 金銭部 (7セグ金額表示/硬貨投入口/札口/回転式返却レバー/
     ICリーダー/つり銭切れ・お札中止ランプ)
   ・下部 = 横長取出口 (フラッパー) + 右下の蓋付きつり銭口
   ・黒い蹴込み+機械室ルーバー・グレー側面・統一/住所ステッカー
   ============================================================ */
import * as THREE from '../vendor/three.module.js';
import { mergeGeoms, mat4, canvasTexture, makeRng, segPlate } from './lib3d.js';
import {
  CABINET, PRODUCTS, COLUMNS, SELECTIONS, CHAMBERS, FASCIA, CHUTE, BILL, RACK,
} from './config.js';

/* ---- 共有マテリアル ---- */
export const MAT = {};
function initMats() {
  MAT.doorWhite = new THREE.MeshStandardMaterial({ color: 0xf2f4f5, roughness: 0.42, metalness: 0.1 });
  MAT.sideGray = new THREE.MeshStandardMaterial({ color: 0xb7bec4, roughness: 0.5, metalness: 0.25, vertexColors: true });
  MAT.darkPlastic = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.62, metalness: 0.15 });
  MAT.innerPlastic = new THREE.MeshStandardMaterial({ color: 0x33393f, roughness: 0.7, metalness: 0.05 });
  MAT.steel = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.35, metalness: 0.75 });
  MAT.steelDark = new THREE.MeshStandardMaterial({ color: 0x6b747c, roughness: 0.45, metalness: 0.7 });
  MAT.glass = new THREE.MeshStandardMaterial({
    color: 0xd8ecf6, roughness: 0.06, metalness: 0.1,
    transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  });
  MAT.stage = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.55, metalness: 0.2 });
  MAT.xray = new THREE.MeshStandardMaterial({
    color: 0x9fd4f0, roughness: 0.3, metalness: 0.2,
    transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
  });
}

/* ============================================================
   商品ラベルのテクスチャアトラス (10行 + 右端に金属/樹脂パッチ)
   ============================================================ */
let atlasTex = null;
export function productAtlas() {
  if (atlasTex) return atlasTex;
  atlasTex = canvasTexture(512, 1280, (ctx, w, h) => {
    const rowH = 128;
    for (const p of PRODUCTS) {
      const y = p.atlas * rowH;
      const g = ctx.createLinearGradient(0, y, 0, y + rowH);
      g.addColorStop(0, p.colors[0]);
      g.addColorStop(1, p.colors[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, y, 384, rowH);
      ctx.fillStyle = 'rgba(255,255,255,0.93)';
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 5;
      ctx.font = '900 40px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeText(p.short, 192, y + 52);
      ctx.fillText(p.short, 192, y + 52);
      ctx.font = '700 17px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(p.kind === 'pet' ? '500ml' : (p.r < 0.03 ? '185g' : '350ml'), 192, y + 92);
      // 右端パッチ: 缶蓋メタル / PET樹脂
      ctx.fillStyle = p.kind === 'pet' ? '#dfeef8' : '#c3cad1';
      ctx.fillRect(384, y, 64, rowH);
      ctx.fillStyle = '#' + p.colors[0].slice(1);
      ctx.fillStyle = p.colors[0];
      ctx.fillRect(448, y, 64, rowH);
    }
  });
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  return atlasTex;
}

let atlasMat = null;
export function productAtlasMat(transparent = false) {
  if (!atlasMat) {
    atlasMat = new THREE.MeshStandardMaterial({
      map: productAtlas(), roughness: 0.3, metalness: 0.35,
    });
  }
  return atlasMat;
}

/* UV をアトラスの行・領域へ割り当て */
function remapUV(geom, p, region) {
  // region: 'label' (x 0..0.75) | 'lid' (0.75..0.875) | 'cap' (0.875..1)
  const uv = geom.attributes.uv;
  const y0 = 1 - (p.atlas + 1) / 10, y1 = 1 - p.atlas / 10;
  const xr = region === 'label' ? [0.02, 0.73] : region === 'lid' ? [0.765, 0.86] : [0.89, 0.985];
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i,
      xr[0] + uv.getX(i) * (xr[1] - xr[0]),
      y0 + 0.02 + uv.getY(i) * (y1 - y0 - 0.04));
  }
  return geom;
}

/* 商品1本のジオメトリ (単一アトラスマテリアル用に結合)。軸=Y */
const prodGeomCache = new Map();
export function buildProductGeometry(p) {
  if (prodGeomCache.has(p.id)) return prodGeomCache.get(p.id);
  const parts = [];
  if (p.kind === 'can') {
    parts.push({ geom: remapUV(new THREE.CylinderGeometry(p.r * 0.985, p.r * 0.985, p.len * 0.8, 22), p, 'label') });
    parts.push({
      geom: remapUV(new THREE.CylinderGeometry(p.r * 0.86, p.r * 0.985, p.len * 0.1, 22), p, 'lid'),
      matrix: mat4(0, p.len * 0.45, 0),
    });
    parts.push({
      geom: remapUV(new THREE.CylinderGeometry(p.r * 0.985, p.r * 0.86, p.len * 0.1, 22), p, 'lid'),
      matrix: mat4(0, -p.len * 0.45, 0),
    });
  } else {
    parts.push({ geom: remapUV(new THREE.CylinderGeometry(p.r * 0.98, p.r * 0.96, p.len * 0.58, 20), p, 'label'), matrix: mat4(0, -p.len * 0.06, 0) });
    parts.push({
      geom: remapUV(new THREE.CylinderGeometry(p.r * 0.42, p.r * 0.95, p.len * 0.2, 20), p, 'lid'),
      matrix: mat4(0, p.len * 0.32, 0),
    });
    parts.push({
      geom: remapUV(new THREE.CylinderGeometry(p.r * 0.34, p.r * 0.34, p.len * 0.1, 14), p, 'cap'),
      matrix: mat4(0, p.len * 0.45, 0),
    });
    parts.push({
      geom: remapUV(new THREE.CylinderGeometry(p.r * 0.96, p.r * 0.9, p.len * 0.12, 20), p, 'lid'),
      matrix: mat4(0, -p.len * 0.41, 0),
    });
  }
  const g = mergeGeoms(parts);
  prodGeomCache.set(p.id, g);
  return g;
}

export class MachineScene {
  constructor(scene) {
    initMats();
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.xrayList = [];
    this.xrayOn = false;
    this.xrayEdges = [];
    this.buttons = [];               // 36個 {mesh, lampMat, index}
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
    MAT.xray.opacity = on ? 0.5 : 0.13;
  }

  /* ============ 環境 ============ */
  _buildEnvironment() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4.5, 40),
      new THREE.MeshStandardMaterial({ color: 0x676c72, roughness: 0.92 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const wallTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#969aa0';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(70,74,80,0.45)';
      ctx.lineWidth = 2;
      for (let y = 0; y <= h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }, { repeat: [6, 3] });
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(8.5, 4),
      new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 })
    );
    wall.position.set(0, 2, -0.78);
    this.scene.add(wall);
    // リサイクルボックス (機体の脇の常連)
    const rb = new THREE.Group();
    rb.position.set(0.95, 0, 0.15);
    const rbTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#e8862a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '900 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('あきかん', w / 2, 58);
      ctx.fillText('あきびん', w / 2, 96);
    });
    const rbBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.17, 0.62, 16),
      new THREE.MeshStandardMaterial({ map: rbTex, roughness: 0.5 })
    );
    rbBody.position.y = 0.31;
    rbBody.castShadow = true;
    const rbTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.19, 0.06, 16),
      MAT.darkPlastic
    );
    rbTop.position.y = 0.65;
    rb.add(rbBody, rbTop);
    this.scene.add(rb);
  }

  /* ============ キャビネット ============ */
  _buildCabinet() {
    const C = CABINET;
    const g = new THREE.Group();
    this.cabinet = g;
    this.root.add(g);
    const t = 0.022;
    const hw = C.w / 2;

    // 外殻 (側面/天面/背面/底面) — グレー鋼板
    const shellGeom = mergeGeoms([
      { geom: new THREE.BoxGeometry(t, C.h - 0.03, C.d), matrix: mat4(-hw + t / 2, C.h / 2, 0), color: 0xc4cbd1 },
      { geom: new THREE.BoxGeometry(t, C.h - 0.03, C.d), matrix: mat4(hw - t / 2, C.h / 2, 0), color: 0xc4cbd1 },
      { geom: new THREE.BoxGeometry(C.w, t, C.d + 0.012), matrix: mat4(0, C.h - t / 2, 0.006), color: 0xd2d8dd },
      { geom: new THREE.BoxGeometry(C.w, t, C.d - 0.05), matrix: mat4(0, 0.132, 0.02), color: 0xb6bdc3 },
      { geom: new THREE.BoxGeometry(C.w, C.h - 0.03, t), matrix: mat4(0, C.h / 2, C.zBack + t / 2), color: 0xc0c7cd },
    ]);
    const shell = new THREE.Mesh(shellGeom, MAT.sideGray);
    shell.castShadow = true;
    shell.receiveShadow = true;
    g.add(shell);
    this.registerXray(shell);
    this._addEdges(shell.geometry, g);

    // アジャスター脚 4本
    const feet = [];
    for (const [fx, fz] of [[-hw + 0.08, 0.28], [hw - 0.08, 0.28], [-hw + 0.08, -0.28], [hw - 0.08, -0.28]]) {
      feet.push({ geom: new THREE.CylinderGeometry(0.025, 0.035, 0.06, 10), matrix: mat4(fx, 0.03, fz), color: 0x2c2f33 });
    }
    g.add(new THREE.Mesh(mergeGeoms(feet), MAT.darkPlastic));

    // 機械室 (最下部): 圧縮機 + 凝縮器ファン (X線/開扉で見える)
    const machineRoom = new THREE.Group();
    g.add(machineRoom);
    const comp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x2f3a44, roughness: 0.4, metalness: 0.6 })
    );
    comp.position.set(-0.25, 0.20, -0.05);
    const fan = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16),
      MAT.steelDark
    );
    fan.rotation.x = Math.PI / 2;
    fan.position.set(0.2, 0.21, -0.05);
    machineRoom.add(comp, fan);
    this.compressorMesh = comp;

    // 庫内断熱ライナー + 庫内灯
    const liner = new THREE.Mesh(
      new THREE.BoxGeometry(C.w - 0.07, C.h - 0.5, t),
      MAT.innerPlastic
    );
    liner.position.set(0, C.h / 2 + 0.1, C.zBack + 0.04);
    g.add(liner);
    const cabinLight = new THREE.PointLight(0xdceefb, 0.35, 1.9);
    cabinLight.position.set(0, 1.3, 0.0);
    g.add(cabinLight);

    // 室仕切り板 (3室)
    const parts = [];
    const bounds = [-C.w / 2 + 0.05];
    for (let i = 0; i < CHAMBERS.length - 1; i++) {
      bounds.push((CHAMBERS[i].x + CHAMBERS[i + 1].x) / 2);
    }
    bounds.push(C.w / 2 - 0.05);
    this.chamberBounds = bounds;
    for (let i = 1; i < bounds.length - 1; i++) {
      parts.push({
        geom: new THREE.BoxGeometry(0.012, 1.35, RACK.laneZ[1] - RACK.zSlots[0] + 0.12),
        matrix: mat4(bounds[i], 1.12, (RACK.zSlots[0] + RACK.laneZ[1]) / 2),
        color: 0xd8dee2,
      });
    }
    const partMesh = new THREE.Mesh(mergeGeoms(parts), MAT.sideGray);
    g.add(partMesh);

    // ---- シュート & 取出口 (全幅) ----
    const P = C.portX;
    const mkPlate = (line, width, mat, thick = 0.008) => {
      const len = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
      const ang = Math.atan2(line.b[1] - line.a[1], line.b[0] - line.a[0]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(width, thick, len), mat);
      m.position.set(0, (line.a[1] + line.b[1]) / 2, (line.a[0] + line.b[0]) / 2);
      m.rotation.x = ang;
      return m;
    };
    const tray = mkPlate(CHUTE.tray, C.w - 0.1, MAT.steelDark);
    g.add(tray);
    const defl = mkPlate(CHUTE.deflector, C.w - 0.12, MAT.steelDark, 0.006);
    g.add(defl);
    const portFloor = mkPlate(CHUTE.portFloor, P[1] - P[0] + 0.08, MAT.innerPlastic, 0.01);
    portFloor.position.x = (P[0] + P[1]) / 2;
    g.add(portFloor);
    // 取出口ボックスの側壁・奥壁
    const portGrp = new THREE.Group();
    g.add(portGrp);
    for (const sx of [P[0] - 0.03, P[1] + 0.03]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.27, 0.2), MAT.innerPlastic);
      side.position.set(sx, 0.46, 0.24);
      portGrp.add(side);
    }

    // ---- 搬出扉 (フラップ視覚) ----
    this.innerFlapPivot = new THREE.Group();
    this.innerFlapPivot.position.set((P[0] + P[1]) / 2, CHUTE.innerFlap.pivot[1], CHUTE.innerFlap.pivot[0]);
    g.add(this.innerFlapPivot);
    const innerFlapMesh = new THREE.Mesh(
      new THREE.BoxGeometry(P[1] - P[0] + 0.04, CHUTE.innerFlap.len, 0.008),
      new THREE.MeshStandardMaterial({ color: 0x49525a, roughness: 0.55, metalness: 0.1 })
    );
    innerFlapMesh.position.y = -CHUTE.innerFlap.len / 2;
    this.innerFlapPivot.add(innerFlapMesh);

    // ---- 外フラッパー (お取り出し口) ----
    this.flapPivot = new THREE.Group();
    this.flapPivot.position.set((P[0] + P[1]) / 2, CHUTE.flap.pivot[1], CHUTE.flap.pivot[0]);
    g.add(this.flapPivot);
    const flapTex = canvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#31373d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8eef4';
      ctx.font = '900 44px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('お 取 り 出 し 口', w / 2, h / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 4;
      ctx.strokeRect(10, 10, w - 20, h - 20);
    });
    const flapMesh = new THREE.Mesh(
      new THREE.BoxGeometry(P[1] - P[0] + 0.02, CHUTE.flap.len, 0.014),
      [MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic,
        new THREE.MeshStandardMaterial({ map: flapTex, roughness: 0.5 }), MAT.darkPlastic]
    );
    flapMesh.position.y = -CHUTE.flap.len / 2;
    this.flapPivot.add(flapMesh);
    // 取出口の照明
    const portLamp = new THREE.PointLight(0xfff2df, 0.25, 0.6);
    portLamp.position.set((P[0] + P[1]) / 2, 0.5, 0.25);
    g.add(portLamp);
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

  /* ============ 扉 (前面) ============ */
  _buildDoor() {
    const C = CABINET;
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(C.hingeX, 0, 0.33);
    this.root.add(this.doorPivot);
    this.doorContent = new THREE.Group();
    this.doorContent.position.set(-C.hingeX, 0, -0.33);
    this.doorPivot.add(this.doorContent);
    const d = this.doorContent;
    const W = FASCIA.window;
    const M = FASCIA.moneyStrip;
    const hw = C.w / 2;
    const zP = 0.345, th = 0.026;

    // ---- 扉パネル (白)。開口部 = 展示室窓 / 取出口 / つり銭口 ----
    const strips = [
      { w: C.w, h: C.h - W.y1, x: 0, y: (C.h + W.y1) / 2 },                       // 上帯
      { w: W.x0 + hw, h: W.y1 - W.y0, x: (W.x0 - hw) / 2, y: (W.y0 + W.y1) / 2 }, // 窓左柱
      { w: hw - W.x1, h: W.y1 - W.y0, x: (W.x1 + hw) / 2, y: (W.y0 + W.y1) / 2 }, // 窓右柱+金銭帯
      { w: C.w, h: W.y0 - 0.585, x: 0, y: (W.y0 + 0.585) / 2 },                   // 窓下帯
      // 取出口まわり (港: portX -0.50..0.20, y 0.30..0.585)
      { w: C.portX[0] + hw - 0.02, h: 0.285, x: (C.portX[0] - hw) / 2 - 0.01, y: 0.4425 },
      { w: 0.228, h: 0.285, x: 0.32, y: 0.4425 },                                  // 取出口とつり銭口の間
      { w: hw - 0.568, h: 0.285, x: (0.568 + hw) / 2, y: 0.4425 },                 // つり銭口の右
      { w: 0.14, h: 0.055, x: 0.501, y: 0.5575 },                                  // つり銭口の上
      { w: 0.14, h: 0.114, x: 0.501, y: 0.357 },                                   // つり銭口の下
      { w: C.w, h: 0.16, x: 0, y: 0.22 },                                          // 下帯
    ];
    const doorGeom = mergeGeoms(strips.map(s => ({
      geom: new THREE.BoxGeometry(Math.max(s.w, 0.001), Math.max(s.h, 0.001), th),
      matrix: mat4(s.x, s.y, zP),
      color: 0xffffff,
    })));
    const doorMesh = new THREE.Mesh(doorGeom, MAT.doorWhite);
    doorMesh.castShadow = true;
    d.add(doorMesh);
    this.registerXray(doorMesh);
    this._addEdges(doorMesh.geometry, d);
    this.doorMesh = doorMesh;

    // ---- 天面の看板帯 ----
    const signTex = canvasTexture(1024, 96, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, '#1861a8');
      g2.addColorStop(0.5, '#2b8fd8');
      g2.addColorStop(1, '#1861a8');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '900 54px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('つめた〜い ドリンク', w / 2, h / 2 + 3);
    });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(C.w - 0.16, 0.062),
      new THREE.MeshStandardMaterial({
        map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.45, roughness: 0.4,
      })
    );
    sign.position.set(0, 1.783, zP + th / 2 + 0.002);
    d.add(sign);

    // ---- 黒い蹴込み + 機械室ルーバー ----
    const ventTex = canvasTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#191c20';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#070809';
      for (let x = 10; x < w; x += 24) ctx.fillRect(x, 8, 13, h - 16);
    });
    const kick = new THREE.Mesh(
      new THREE.BoxGeometry(C.w, 0.13, th + 0.002),
      [MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic,
        new THREE.MeshStandardMaterial({ map: ventTex, roughness: 0.7 }), MAT.darkPlastic]
    );
    kick.position.set(0, 0.075, zP);
    d.add(kick);

    // ---- 展示室 ----
    this._buildDisplayWindow(d, zP, th);

    // ---- 金銭部 ----
    this._buildMoneyStrip(d, zP, th);

    // ---- つり銭口 (蓋付きカップ) ----
    this._buildCoinCup(d, zP, th);

    // ---- ステッカー類 ----
    this._buildStickers(d, zP, th);

    // ---- T字ハンドル ----
    const handleBase = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.02), MAT.steelDark);
    handleBase.position.set(hw - 0.035, 0.90, zP + th / 2 + 0.008);
    d.add(handleBase);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10),
      MAT.steel
    );
    handle.position.set(hw - 0.035, 0.90, zP + th / 2 + 0.024);
    d.add(handle);
    this.doorHandle = handle;
  }

  /* ---- サンプル展示室 (3段×12) ---- */
  _buildDisplayWindow(d, zP, th) {
    const W = FASCIA.window;
    const box = new THREE.Group();
    d.add(box);
    const cw = W.x1 - W.x0, cx = (W.x0 + W.x1) / 2;

    // 背面パネル (アルミ調)
    const backTex = canvasTexture(64, 64, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, '#eef4f8');
      g2.addColorStop(1, '#c8d4dc');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    });
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(cw, W.y1 - W.y0),
      new THREE.MeshStandardMaterial({ map: backTex, emissive: 0xeaf4fc, emissiveIntensity: 0.12, roughness: 0.6 })
    );
    back.position.set(cx, (W.y0 + W.y1) / 2, 0.245);
    box.add(back);
    this.registerXray(back);

    // 3段ステージ + サンプル + ボタン
    const stageGeoms = [];
    const sampleGeoms = [];
    const rng = makeRng(23);
    for (let row = 0; row < 3; row++) {
      const R = FASCIA.rows[row];
      // ステージ (手前下がり)
      stageGeoms.push({
        geom: new THREE.BoxGeometry(cw - 0.015, 0.012, 0.125),
        matrix: mat4(cx, R.stageY - 0.004, 0.295, -0.2, 0, 0),
        color: 0x30363d,
      });
      // 段下の LED バー
      stageGeoms.push({
        geom: new THREE.BoxGeometry(cw - 0.03, 0.008, 0.01),
        matrix: mat4(cx, R.stageY - 0.02, 0.352),
        color: 0xffffff,
      });
      for (let cI = 0; cI < 12; cI++) {
        const selIdx = row * 12 + cI;
        const sel = SELECTIONS[selIdx];
        const p = PRODUCTS[COLUMNS[sel.column].product];
        const sx = FASCIA.sampleX0 + cI * FASCIA.samplePitch;
        // サンプル (半割りダミー相当だが全体表示)
        const sy = R.stageY + Math.cos(0.2) * 0 + p.len * 0.43;
        sampleGeoms.push({
          geom: buildProductGeometry(p).clone().applyMatrix4(
            mat4(sx, R.stageY + p.len * 0.42 * 0.86 + 0.008, 0.298,
              -0.06 + rng() * 0.02, -Math.PI / 2, 0, 0.86)
          ),
        });
      }
    }
    const stageMesh = new THREE.Mesh(mergeGeoms(stageGeoms), MAT.sideGray);
    box.add(stageMesh);
    const samplesMesh = new THREE.Mesh(mergeGeoms(sampleGeoms.map(s => ({ geom: s.geom }))), productAtlasMat());
    box.add(samplesMesh);

    // 押ボタン + 価格プレート (36個)
    this._buildButtons(d, zP, th);

    // 窓ガラス
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(cw, W.y1 - W.y0), MAT.glass);
    glass.position.set(cx, (W.y0 + W.y1) / 2, zP + th / 2 + 0.002);
    d.add(glass);

    // 展示室照明 (上部 LED)
    const tube = new THREE.Mesh(
      new THREE.BoxGeometry(cw - 0.05, 0.012, 0.03),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf0f8ff, emissiveIntensity: 0.85 })
    );
    tube.position.set(cx, W.y1 - 0.025, 0.30);
    box.add(tube);
    const lamp = new THREE.PointLight(0xeaf6ff, 0.22, 1.1);
    lamp.position.set(cx, W.y1 - 0.08, 0.30);
    box.add(lamp);
  }

  /* ---- 押ボタン 36個 (サンプル直下・価格プレート+つめた〜い帯) ---- */
  _buildButtons(d, zP, th) {
    const priceTexCache = new Map();
    const priceTex = (price) => {
      if (!priceTexCache.has(price)) {
        priceTexCache.set(price, canvasTexture(96, 44, (ctx, w, h) => {
          ctx.fillStyle = '#f4f6f8';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#16181b';
          ctx.font = '900 27px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${price}円`, w / 2, h / 2 + 1);
        }));
      }
      return priceTexCache.get(price);
    };
    // つめた〜い帯 (段ごとに1本)
    const coldTex = canvasTexture(1024, 40, (ctx, w, h) => {
      ctx.fillStyle = '#0d55a3';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e8f6ff';
      ctx.font = '900 25px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i < 6; i++) ctx.fillText('つめた〜い', (i + 0.5) * (w / 6), h / 2 + 1);
    });
    const btnGeom = new THREE.BoxGeometry(0.058, 0.024, 0.012);
    const plateGeom = new THREE.PlaneGeometry(0.06, 0.026);
    for (let row = 0; row < 3; row++) {
      const R = FASCIA.rows[row];
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(FASCIA.window.x1 - FASCIA.window.x0 - 0.02, 0.02),
        new THREE.MeshStandardMaterial({
          map: coldTex, emissive: 0xffffff, emissiveMap: coldTex, emissiveIntensity: 0.35, roughness: 0.4,
        })
      );
      band.position.set((FASCIA.window.x0 + FASCIA.window.x1) / 2, R.btnY - 0.028, zP + th / 2 + 0.003);
      d.add(band);
      for (let cI = 0; cI < 12; cI++) {
        const selIdx = row * 12 + cI;
        const sel = SELECTIONS[selIdx];
        const price = PRODUCTS[COLUMNS[sel.column].product].price;
        const sx = FASCIA.sampleX0 + cI * FASCIA.samplePitch;
        // 価格プレート
        const plate = new THREE.Mesh(plateGeom, new THREE.MeshStandardMaterial({
          map: priceTex(price), roughness: 0.45,
        }));
        plate.position.set(sx, R.btnY + 0.026, zP + th / 2 + 0.003);
        d.add(plate);
        // 押ボタン (点灯: 待機=消灯 / 購入可=白青 / 売切=赤「売切」)
        const lampTex = canvasTexture(96, 40, (ctx, w, h) => {
          ctx.fillStyle = '#20252a';
          ctx.fillRect(0, 0, w, h);
        });
        const soldTex = canvasTexture(96, 40, (ctx, w, h) => {
          ctx.fillStyle = '#3a0a0c';
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = '#ff5148';
          ctx.font = '900 24px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('売切', w / 2, h / 2 + 1);
        });
        const readyTex = canvasTexture(96, 40, (ctx, w, h) => {
          const g2 = ctx.createLinearGradient(0, 0, 0, h);
          g2.addColorStop(0, '#eaf8ff');
          g2.addColorStop(1, '#7fd0f8');
          ctx.fillStyle = g2;
          ctx.fillRect(0, 0, w, h);
        });
        const lampMat = new THREE.MeshStandardMaterial({
          map: lampTex, emissive: 0xffffff, emissiveMap: lampTex, emissiveIntensity: 0.5, roughness: 0.35,
        });
        const btn = new THREE.Mesh(btnGeom, lampMat);
        btn.position.set(sx, R.btnY, zP + th / 2 + 0.007);
        btn.userData.tap = { type: 'button', i: selIdx };
        d.add(btn);
        this.buttons.push({
          mesh: btn, lampMat, index: selIdx,
          texOff: lampTex, texReady: readyTex, texSold: soldTex,
          state: 'off',
        });
      }
    }
  }

  /* ---- 金銭部 (右縦帯) ---- */
  _buildMoneyStrip(d, zP, th) {
    const M = FASCIA.moneyStrip;
    const mx = (M.x0 + M.x1) / 2;
    // ベース (ややグレーの縦帯パネル)
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(M.x1 - M.x0, 0.62, 0.006),
      MAT.steel
    );
    strip.position.set(mx, 1.16, zP + th / 2 + 0.004);
    d.add(strip);
    this.registerXray(strip);

    // 7セグ金額表示
    this.ledCanvas = document.createElement('canvas');
    this.ledCanvas.width = 256; this.ledCanvas.height = 72;
    this.ledTex = new THREE.CanvasTexture(this.ledCanvas);
    this.ledTex.colorSpace = THREE.SRGBColorSpace;
    this.drawLED('0');
    const led = new THREE.Mesh(
      new THREE.PlaneGeometry(0.125, 0.038),
      new THREE.MeshStandardMaterial({
        map: this.ledTex, emissive: 0xffffff, emissiveMap: this.ledTex, emissiveIntensity: 0.95, roughness: 0.3,
      })
    );
    led.position.set(FASCIA.display7seg.u, FASCIA.display7seg.v, zP + th / 2 + 0.011);
    d.add(led);
    const ledBezel = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.008), MAT.darkPlastic);
    ledBezel.position.set(FASCIA.display7seg.u, FASCIA.display7seg.v, zP + th / 2 + 0.006);
    d.add(ledBezel);
    this.registerXray(ledBezel);

    // 硬貨投入口 (縦スロット)
    const slotFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02), MAT.steelDark);
    slotFrame.position.set(0.512, 1.30, zP + th / 2 + 0.012);
    d.add(slotFrame);
    const slotHole = new THREE.Mesh(
      new THREE.BoxGeometry(0.0055, 0.045, 0.024),
      new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9 })
    );
    slotHole.position.set(0.512, 1.30, zP + th / 2 + 0.013);
    d.add(slotHole);
    this.coinSlot = slotFrame;

    // 回転式返却レバー (銀のノブ)
    this.leverPivot = new THREE.Group();
    this.leverPivot.position.set(FASCIA.lever.u, FASCIA.lever.v, zP + th / 2 + 0.016);
    d.add(this.leverPivot);
    const knobBase = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.015, 14), MAT.steelDark);
    knobBase.rotation.x = Math.PI / 2;
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.056, 0.018), MAT.steel);
    knob.position.z = 0.012;
    this.leverPivot.add(knobBase, knob);

    // 紙幣挿入口 (千円札・緑LED枠)
    const billFrame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.018), MAT.darkPlastic);
    billFrame.position.set(BILL.slot.u, BILL.slot.v, zP + th / 2 + 0.011);
    billFrame.userData.tap = { type: 'bill' };
    d.add(billFrame);
    this.billFrame = billFrame;
    this.billLedMat = new THREE.MeshStandardMaterial({
      color: 0x0e3316, emissive: 0x37e06a, emissiveIntensity: 0.7, roughness: 0.4,
    });
    const billLed = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.006), this.billLedMat);
    billLed.position.set(BILL.slot.u, BILL.slot.v + 0.018, zP + th / 2 + 0.021);
    d.add(billLed);
    const billSlit = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.005, 0.022),
      new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.9 })
    );
    billSlit.position.set(BILL.slot.u, BILL.slot.v, zP + th / 2 + 0.012);
    d.add(billSlit);

    // つり銭切れ / お札中止 ランプ
    const mkLamp = (text, color, x, y) => {
      const tex = canvasTexture(128, 32, (ctx, w, h) => {
        ctx.fillStyle = '#1c1410';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = color;
        ctx.font = '900 19px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, w / 2, h / 2 + 1);
      });
      const mat = new THREE.MeshStandardMaterial({
        map: tex, color: 0x2a2016, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.0, roughness: 0.4,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.022), mat);
      m.position.set(x, y, zP + th / 2 + 0.004);
      d.add(m);
      return mat;
    };
    this.shortageMat = mkLamp('つり銭切れ', '#ffb020', FASCIA.lamps.u - 0.0, FASCIA.lamps.v);
    this.billStopMat = mkLamp('お札中止', '#ff5148', FASCIA.lamps.u, FASCIA.lamps.v - 0.03);

    // 電子マネーリーダー (ビジュアル)
    const icTex = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#14181d';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#3f9be0';
      ctx.lineWidth = 5;
      ctx.strokeRect(14, 14, w - 28, h - 28);
      ctx.fillStyle = '#cfe6f8';
      ctx.font = '900 34px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('IC', w / 2, 62);
      ctx.font = '700 16px sans-serif';
      ctx.fillText('タッチしてね', w / 2, 96);
    });
    const ic = new THREE.Mesh(
      new THREE.BoxGeometry(0.085, 0.085, 0.012),
      [MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic, MAT.darkPlastic,
        new THREE.MeshStandardMaterial({ map: icTex, emissive: 0xffffff, emissiveMap: icTex, emissiveIntensity: 0.15, roughness: 0.4 }),
        MAT.darkPlastic]
    );
    ic.position.set(FASCIA.icReader.u, FASCIA.icReader.v, zP + th / 2 + 0.008);
    d.add(ic);

    // ポスターパネル (金銭部の下)
    const posterTex = canvasTexture(192, 320, (ctx, w, h) => {
      const g2 = ctx.createLinearGradient(0, 0, 0, h);
      g2.addColorStop(0, '#0e3f70');
      g2.addColorStop(1, '#1b6fb4');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#eaf8ff';
      ctx.font = '900 34px "Hiragino Maru Gothic ProN", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('キンキンに', w / 2, 90);
      ctx.fillText('つめたい!', w / 2, 135);
      ctx.font = '800 20px sans-serif';
      ctx.fillStyle = '#9fd8ff';
      ctx.fillText('しくみも', w / 2, 205);
      ctx.fillText('まるみえ', w / 2, 232);
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.strokeRect(6, 6, w - 12, h - 12);
    });
    const poster = new THREE.Mesh(
      new THREE.PlaneGeometry(0.135, 0.24),
      new THREE.MeshStandardMaterial({ map: posterTex, roughness: 0.5 })
    );
    poster.position.set(FASCIA.poster.u, FASCIA.poster.v, zP + th / 2 + 0.003);
    d.add(poster);
    this.registerXray(poster);
  }

  /* ---- つり銭口 (跳ね上げ蓋付き) ---- */
  _buildCoinCup(d, zP, th) {
    const cupBox = new THREE.Group();
    d.add(cupBox);
    const mk = (w, h, dep, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), MAT.innerPlastic);
      m.position.set(x, y, z);
      cupBox.add(m);
      return m;
    };
    // つり銭口は扉を貫通する深い受け皿 (硬貨は z≈0.20 に落ちてくる)
    mk(0.14, 0.012, 0.19, 0.501, 0.414, 0.245);  // 底
    mk(0.012, 0.125, 0.19, 0.434, 0.475, 0.245); // 左
    mk(0.012, 0.125, 0.19, 0.568, 0.475, 0.245); // 右
    mk(0.14, 0.125, 0.01, 0.501, 0.475, 0.148);  // 奥
    // 跳ね上げ蓋 (半透明)
    this.cupLidPivot = new THREE.Group();
    this.cupLidPivot.position.set(0.501, 0.53, zP);
    cupBox.add(this.cupLidPivot);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.128, 0.115, 0.008),
      new THREE.MeshStandardMaterial({
        color: 0x556069, roughness: 0.3, transparent: true, opacity: 0.55,
      })
    );
    lid.position.y = -0.0575;
    this.cupLidPivot.add(lid);
    this.cupLidAngle = 0;
    this.cupLidTarget = 0;
  }

  /* ---- ステッカー・銘板 ---- */
  _buildStickers(d, zP, th) {
    const z = zP + th / 2 + 0.002;
    // 統一ステッカー (管理者/住所/連絡先 — 貼付義務)
    const unifiedTex = canvasTexture(200, 120, (ctx, w, h) => {
      ctx.fillStyle = '#f5f7f8';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2255aa';
      ctx.lineWidth = 4;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.fillStyle = '#16181b';
      ctx.font = '800 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('自動販売機管理者', w / 2, 26);
      ctx.font = '700 12px sans-serif';
      ctx.fillText('つめたい飲料サービス(株)', w / 2, 50);
      ctx.fillText('管理No. FR30-260716', w / 2, 70);
      ctx.fillText('TEL 0120-XXX-XXX', w / 2, 90);
      ctx.fillStyle = '#2255aa';
      ctx.font = '700 11px sans-serif';
      ctx.fillText('こまったときは ここにでんわ', w / 2, 108);
    });
    const unified = new THREE.Mesh(
      new THREE.PlaneGeometry(0.11, 0.066),
      new THREE.MeshStandardMaterial({ map: unifiedTex, roughness: 0.55 })
    );
    unified.position.set(-0.35, 0.24, z);
    d.add(unified);

    // 住所表示ステッカー (110/119通報用)
    const addrTex = canvasTexture(220, 80, (ctx, w, h) => {
      ctx.fillStyle = '#fffef2';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#d02020';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, w - 4, h - 4);
      ctx.fillStyle = '#d02020';
      ctx.font = '900 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ここの住所', w / 2, 24);
      ctx.fillStyle = '#16181b';
      ctx.font = '700 15px sans-serif';
      ctx.fillText('じはんき市つめた町2-6-7', w / 2, 48);
      ctx.font = '700 11px sans-serif';
      ctx.fillText('緊急通報のときに つたえてね', w / 2, 68);
    });
    const addr = new THREE.Mesh(
      new THREE.PlaneGeometry(0.115, 0.042),
      new THREE.MeshStandardMaterial({ map: addrTex, roughness: 0.55 })
    );
    addr.position.set(-0.13, 0.24, z);
    d.add(addr);

    // 新500円硬貨対応ステッカー
    const coinOkTex = canvasTexture(120, 56, (ctx, w, h) => {
      ctx.fillStyle = '#e8f2e0';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#187028';
      ctx.font = '800 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('新500円硬貨', w / 2, 22);
      ctx.fillText('使えます', w / 2, 42);
    });
    const coinOk = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, 0.033),
      new THREE.MeshStandardMaterial({ map: coinOkTex, roughness: 0.55 })
    );
    coinOk.position.set(0.435, 1.365, z + 0.01);
    d.add(coinOk);

    // 使える金種ステッカー
    const kindTex = canvasTexture(160, 84, (ctx, w, h) => {
      ctx.fillStyle = '#f2f5f8';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#333';
      ctx.font = '800 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('つかえるお金', w / 2, 22);
      ctx.font = '700 13px sans-serif';
      ctx.fillText('10・50・100・500円', w / 2, 44);
      ctx.fillText('千円札', w / 2, 62);
      ctx.fillStyle = '#a00';
      ctx.font = '700 10px sans-serif';
      ctx.fillText('五千円・一万円は つかえません', w / 2, 78);
    });
    const kind = new THREE.Mesh(
      new THREE.PlaneGeometry(0.095, 0.05),
      new THREE.MeshStandardMaterial({ map: kindTex, roughness: 0.55 })
    );
    kind.position.set(0.4925, 1.245, z + 0.01);
    d.add(kind);

    // 銘板 (型式)
    const plateTex = canvasTexture(160, 44, (ctx, w, h) => {
      ctx.fillStyle = '#c8ced4';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#22262b';
      ctx.font = '800 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FR30A6R40TK-FOP', w / 2, 20);
      ctx.font = '700 10px sans-serif';
      ctx.fillText('冷媒 R1234yf / AC100V 50/60Hz', w / 2, 36);
    });
    const modelPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.09, 0.025),
      new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4, metalness: 0.4 })
    );
    modelPlate.position.set(0.42, 0.24, z);
    d.add(modelPlate);

    // 防犯ステッカー
    const secTex = canvasTexture(120, 44, (ctx, w, h) => {
      ctx.fillStyle = '#fff480';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#16181b';
      ctx.font = '900 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('防犯カメラ', w / 2, 20);
      ctx.fillText('作動中', w / 2, 38);
    });
    const sec = new THREE.Mesh(
      new THREE.PlaneGeometry(0.065, 0.026),
      new THREE.MeshStandardMaterial({ map: secTex, roughness: 0.55 })
    );
    sec.position.set(0.30, 0.24, z);
    d.add(sec);
  }

  /* ---- LED描画 (7セグ風・4桁) ---- */
  drawLED(text) {
    const ctx = this.ledCanvas.getContext('2d');
    const w = this.ledCanvas.width, h = this.ledCanvas.height;
    ctx.fillStyle = '#170a05';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '700 52px "DSEG7", ui-monospace, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255,110,40,0.09)';
    ctx.fillText('8888', w - 12, h / 2 + 2);
    ctx.fillStyle = '#ff7a2a';
    ctx.shadowColor = '#ff7a2a';
    ctx.shadowBlur = 10;
    ctx.fillText(text, w - 12, h / 2 + 2);
    ctx.shadowBlur = 0;
    this.ledTex.needsUpdate = true;
  }

  /* ---- 状態表示 ---- */
  setLamp(i, state) {
    const b = this.buttons[i];
    if (!b || b.state === state) return;
    b.state = state;
    const tex = state === 'ready' ? b.texReady : state === 'soldout' ? b.texSold : b.texOff;
    b.lampMat.map = tex;
    b.lampMat.emissiveMap = tex;
    b.lampMat.emissiveIntensity = state === 'off' ? 0.25 : 1.0;
    b.lampMat.needsUpdate = true;
  }
  setShortage(on) { this.shortageMat.emissiveIntensity = on ? 1.0 : 0.0; }
  setBillStop(on) {
    this.billStopMat.emissiveIntensity = on ? 1.0 : 0.0;
    this.billLedMat.emissiveIntensity = on ? 0.08 : 0.7;
  }

  setDoorAngle(a) { this.doorPivot.rotation.y = -a; }
  setFlapAngle(a) { this.flapPivot.rotation.x = -a; }
  setInnerFlapAngle(a) { this.innerFlapPivot.rotation.x = -a; }
  setLever(pulled) { this.leverTarget = pulled ? -1.35 : 0; }
  openCupLid(open) { this.cupLidTarget = open ? 1.1 : 0; }

  /* ============ 店員用小道具 ============ */
  _buildOperatorProps() {
    this.opProps = new THREE.Group();
    this.opProps.visible = false;
    this.root.add(this.opProps);
    const crate = new THREE.Group();
    crate.position.set(-1.05, 0, 0.55);
    this.opProps.add(crate);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x3f6db5, roughness: 0.6 });
    const crateBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), crateMat);
    crateBox.position.y = 0.03;
    crate.add(crateBox);
    for (const [sx, sz] of [[-0.24, 0], [0.24, 0], [0, -0.16], [0, 0.16]]) {
      const wallM = new THREE.Mesh(
        new THREE.BoxGeometry(sx === 0 ? 0.5 : 0.02, 0.16, sx === 0 ? 0.02 : 0.34),
        crateMat
      );
      wallM.position.set(sx, 0.14, sz);
      crate.add(wallM);
    }
    const rng = makeRng(11);
    const crateGeoms = [];
    for (let i = 0; i < 8; i++) {
      const p = PRODUCTS[i % PRODUCTS.length];
      crateGeoms.push({
        geom: buildProductGeometry(p).clone().applyMatrix4(
          mat4(-0.18 + (i % 4) * 0.12, 0.1 + Math.floor(i / 4) * 0.07, -0.08 + rng() * 0.16,
            rng() * Math.PI, 0, Math.PI / 2)
        ),
      });
    }
    const crateProducts = new THREE.Mesh(mergeGeoms(crateGeoms), productAtlasMat());
    crate.add(crateProducts);
    this.crate = crate;
    const coinCase = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.07, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x87552f, roughness: 0.55 })
    );
    coinCase.position.set(-0.8, 0.035, 0.9);
    this.opProps.add(coinCase);
  }

  setOperatorProps(on) { this.opProps.visible = on; }

  update(dt, time) {
    this.time = time;
    if (this.xrayOn && MAT.xray.opacity > 0.13) {
      MAT.xray.opacity = Math.max(0.13, MAT.xray.opacity - dt * 0.9);
    }
    // ready ボタンのやわらかい点滅
    for (const b of this.buttons) {
      if (b.state === 'ready') {
        b.lampMat.emissiveIntensity = 0.8 + Math.sin(time * 5 + b.index) * 0.2;
      }
    }
    // 回転レバー
    if (this.leverTarget !== undefined) {
      this.leverPivot.rotation.z += (this.leverTarget - this.leverPivot.rotation.z) * Math.min(1, dt * 14);
    }
    // つり銭口の蓋
    this.cupLidAngle += (this.cupLidTarget - this.cupLidAngle) * Math.min(1, dt * 10);
    this.cupLidPivot.rotation.x = this.cupLidAngle;
    // 圧縮機の微振動
    if (this.compressorMesh) {
      this.compressorMesh.position.x = -0.25 + Math.sin(time * 47) * 0.0012;
    }
  }
}
