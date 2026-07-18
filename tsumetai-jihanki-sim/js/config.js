/* ============================================================
   config.js — つめた〜い自販機シミュレーター 全設定
   機体寸法・硬貨仕様・コインメック経路・ラック形状・価格
   単位: メートル / キログラム / 秒。THREE 非依存 (Node でテスト可)。
   座標系:
     ワールド: x=横(右+), y=上, z=奥行き(客側+)。筐体中心 x=0。
     コインメック層: 2D (u,v) = (ワールドx, ワールドy) ※扉ローカル
     コラム層:       2D (u,v) = (ワールドz, ワールドy)
   ============================================================ */

/* ---------------- 硬貨 (実寸) ---------------- */
export const COINS = {
  10:  { value: 10,  d: 0.0235, thick: 0.0015, mass: 0.0045, color: 0xa56b46, name: '10円' },
  50:  { value: 50,  d: 0.0210, thick: 0.0017, mass: 0.0040, color: 0xc9cdd2, name: '50円' },
  100: { value: 100, d: 0.0226, thick: 0.0017, mass: 0.0048, color: 0xd4d8dd, name: '100円' },
  500: { value: 500, d: 0.0265, thick: 0.0018, mass: 0.0070, color: 0xd9c98e, name: '500円' },
};
export const DENOMS = [10, 50, 100, 500];

/* 財布の初期内容 (枚数) */
export const WALLET_INIT = { 10: 12, 50: 5, 100: 8, 500: 2 };

/* ---------------- 筐体 ---------------- */
export const CABINET = {
  w: 1.00, h: 1.83, d: 0.72,          // 外形
  zFront: 0.36, zBack: -0.36,
  doorZBack: 0.30,                     // 扉の背面 (メックはここから奥へ張り出す)
  mechZ: 0.25,                         // コインメック描画面 (ワールドz)
  mechBackZ: 0.205,                    // 金庫経路 (メック背面側)
  hingeX: -0.50,                       // 扉ヒンジ (左端)
  portX: [-0.44, 0.06],                // 取出口の横範囲 (右側はメック/金庫が占有)
  portFloorY: 0.365,
};

/* ---------------- 商品 ---------------- */
export const PRODUCTS = [
  { id: 'coffee', label: 'ホットじゃないコーヒー', short: 'コーヒー', kind: 'can', r: 0.0264, len: 0.1047, price: 120, colors: ['#3d2b1f', '#c9a227'] },
  { id: 'orange', label: 'つぶつぶオレンジ',       short: 'オレンジ', kind: 'can', r: 0.033,  len: 0.122,  price: 130, colors: ['#ff8a1e', '#ffd23f'] },
  { id: 'cider',  label: 'しゅわしゅわサイダー',   short: 'サイダー', kind: 'can', r: 0.033,  len: 0.122,  price: 140, colors: ['#2a7fd4', '#bfe8ff'] },
  { id: 'water',  label: 'てんねん水',             short: 'みず',     kind: 'pet', r: 0.0335, len: 0.200,  price: 110, colors: ['#9fd8ef', '#e8f8ff'] },
  { id: 'tea',    label: 'にがくない緑茶',         short: 'おちゃ',   kind: 'pet', r: 0.0335, len: 0.200,  price: 150, colors: ['#3f8f3f', '#d7ecc0'] },
];

/* コラム: x中心 / 取出口へ寄せる描画x */
export const COLUMNS = [
  { x: -0.360, portX: -0.340, product: 0, capacity: 8 },
  { x: -0.195, portX: -0.220, product: 1, capacity: 7 },
  { x: -0.030, portX: -0.100, product: 2, capacity: 7 },
  { x:  0.145, portX: -0.280, product: 3, capacity: 6 },
  { x:  0.355, portX: -0.060, product: 4, capacity: 6 },
];

/* ---------------- 物理 ---------------- */
export const PHYS = {
  h: 1 / 480,                // 固定ステップ (トンネリング防止)
  gravity: 9.81,
  solverIters: 7,
  posCorrect: 0.55,          // 位置補正率
  slop: 0.0004,
  // sleepVel は重力1ステップ分 (g*h≈0.02) より大きくしないと
  // 接触スタックの解決残差で永遠に覚醒し続ける
  sleepVel: 0.035, sleepAngVel: 0.9, sleepTime: 0.5,
  maxStepsPerFrame: 14,
  airDrag: 0.10,             // 簡易空気抵抗 (チューブ内の暴れ抑制)
};

/* ---------------- コインメック 経路レイアウト ----------------
   全て (u,v)。u=ワールドx (扉が閉まっている時), v=y。
   実機モチーフ: 投入口 → 返却ゲート → 傾斜選別レール (径ゲート)
   → 検銭センサー → 振分フリッパー → 釣銭チューブ / 金庫
------------------------------------------------------------- */
const RAIL_X0 = 0.345, RAIL_Y0 = 0.925, RAIL_SLOPE = 0.22; // 下り勾配 (左へ)
const railY = (x) => RAIL_Y0 - (RAIL_X0 - x) * RAIL_SLOPE;

/* 径ゲート: 中央 cx / 通過させる最大直径 passD (これ未満なら落ちる) */
export const GATES = [
  { denom: 50,  cx: 0.285, passD: 0.0218 },
  { denom: 100, cx: 0.225, passD: 0.0230 },
  { denom: 10,  cx: 0.165, passD: 0.0245 },
];
export const GATE_HALF = 0.0115;       // ゲート開口の半長 (視覚と物理の両方)
export const RAIL_END_X = 0.095;       // レール終端 (500円はここから落ちる)
export const CH500_CX = 0.082;

/* 釣銭チューブ */
export const TUBES = {
  50:  { cx: 0.285 },
  100: { cx: 0.225 },
  10:  { cx: 0.165 },
  500: { cx: 0.082 },
};
export const TUBE_TOP = 0.775, TUBE_BOTTOM = 0.60;
export const TUBE_INIT = { 10: 14, 50: 8, 100: 12, 500: 5 };
export const TUBE_CAP = { 10: 60, 50: 55, 100: 55, 500: 45 };

export const MECH = {
  slot: { u: 0.36, v: 1.01 },                 // 投入口 (硬貨スポーン位置はやや上)
  spawn: { u: 0.36, v: 1.05 },
  railY,
  RAIL_X0, RAIL_Y0, RAIL_SLOPE,
  gateY: railY,                                // ゲート位置のレール高さ
  sensorY: 0.845,                              // 検銭センサー (各チャンネル)
  flipperY: 0.798,                             // 振分フリッパー
  tubeMouthY: 0.778,                           // チューブ入口センサー (通過で計数化)
  returnGate: { pivot: [0.402, 0.958], len: 0.064 }, // 返却ゲート (右端ピボット)
  returnLaneX: [0.352, 0.408],                 // 返却落下レーン
  cup: { left: 0.325, right: 0.408, floor: 0.442, top: 0.56 }, // 返却口カップ
  payoutChute: { a: [0.070, 0.578], b: [0.318, 0.498] },       // 払出しシュート
  cashChute:   { a: [0.055, 0.775], b: [0.295, 0.560] },       // 金庫へのシュート (背面層)
  cashMouth:   { u: 0.282, v: 0.505 },
  cashBox: { x0: 0.06, x1: 0.30, y0: 0.30, y1: 0.485 },        // 金庫 (描画用)
  payoutInterval: 0.14,                        // 連続払出しの間隔 (秒)
  entryFunnel: [
    // 投入口の漏斗 (左右の壁)
    [[0.318, 1.055], [0.343, 0.985]],
    [[0.402, 1.055], [0.377, 0.985]],
  ],
};

/* ---------------- サーペンタインラック ----------------
   コラム層 (u=z, v=y)。棚は互い違いの傾斜。プログラム生成。
------------------------------------------------------------- */
export const RACK = {
  zBack: -0.285, zFront: 0.155,       // 棚の奥行き範囲
  topY: 1.66,                          // 最上段の高さ
  exitZ: 0.045,                        // 最下段出口 (ベンドメック位置)
  exitY: 0.775,
  dropGap: 0.012,                      // 段差すき間の余白
  shelfDrop: 0.045,                    // 棚の傾斜 (高い側と低い側の差)
  loadZ: 0.115, loadY: 1.76,           // 補充投入位置
};

/* 棚を生成: 商品半径 r から互い違い棚のポリラインを返す
   戻り値: [{a:[u,v], b:[u,v]}] (a→b が転がり方向)
   偶数番の棚は前→奥、奇数番は奥→前へ下る。
   最終進入棚が必ず「奥→出口へ下る」よう、通常棚は奇数本にする。 */
export function genShelves(r) {
  // 段間隔: 落下端では下の棚の高い側と向き合うため、
  // クリアランス = levelGap - shelfDrop。これが直径+余白を上回ること。
  const levelGap = 2 * r + RACK.shelfDrop + 0.020;
  const drop = 2 * r + RACK.dropGap;             // 落下開口の幅
  // 通常棚の本数 n。最終進入棚 (奥→出口) が緩勾配になるよう最大限詰める。
  let n = Math.floor((RACK.topY - (RACK.exitY + 0.03)) / levelGap);
  if (n < 1) n = 1;
  // 最後の通常棚は「前→奥」(奥端で落下) である必要がある。
  // 棚 k の向き = d0 * (-1)^k。 d0 を n の偶奇で選ぶ。
  const d0 = (n % 2 === 1) ? -1 : 1;
  const shelves = [];
  let y = RACK.topY;
  for (let k = 0; k < n; k++) {
    const dir = (k % 2 === 0) ? d0 : -d0;
    if (dir < 0) {
      // 前端から奥へ下る棚。奥端に落下開口。
      shelves.push({ a: [RACK.zFront, y], b: [RACK.zBack + drop, y - RACK.shelfDrop] });
    } else {
      // 奥端から前へ下る棚。前端に落下開口。
      shelves.push({ a: [RACK.zBack, y], b: [RACK.zFront - drop, y - RACK.shelfDrop] });
    }
    y -= levelGap;
  }
  // 最終進入棚: 奥から出口 (ベンドメック) へ下る
  shelves.push({ a: [RACK.zBack, y], b: [RACK.exitZ + 0.01, RACK.exitY] });
  // 投入位置: 最上段の高い側に落とす
  const loadZ = d0 < 0 ? 0.115 : -0.245;
  return { shelves, loadZ };
}

/* ベンドメック (2ピン式) */
export const VEND = {
  pinLowerU: null,      // 実行時に r から決定 (rack.js)
  cycle: {              // サイクル秒 (シム時間)
    upperIn: 0.18,      // 上ピン突出完了
    lowerOut: 0.42,     // 下ピン退避完了 → 1本目落下
    lowerIn: 0.80,      // 下ピン復帰
    upperOut: 1.05,     // 上ピン退避 → 列が前進
    done: 1.35,
  },
};

/* シュート & 取出口 (コラム層の共通プロフィール) */
export const CHUTE = {
  tray: { a: [-0.28, 0.555], b: [0.095, 0.425] },   // 傾斜トレイ
  backWall: { a: [-0.29, 0.75], b: [-0.29, 0.55] },
  portFloor: { a: [0.095, 0.378], b: [0.298, 0.362] },
  flap: { pivot: [0.315, 0.565], len: 0.20, maxAngle: 0.9, k: 22, c: 0.35, inertia: 0.004 },
};

/* ---------------- 販売設定 ---------------- */
export const PRICES = PRODUCTS.map(p => p.price);

/* ---------------- 品質 / 演出 ---------------- */
export const TIMES = {
  doorOpen: 0.9,
  coinStackTween: 0.22,
  productTakeTween: 0.55,
};
