/* ============================================================
   config.js — つめた〜い自販機シミュレーター 全設定
   基準機: 富士電機 FR30A6R40TK-FOP (30セレクション・36押ボタン)
   実機仕様: W1185×H1830×D731mm / 収容595本(250ml換算) /
             3室×上下段ラック×前後5コラム=30コラム / 硬貨4金種+千円札
   単位: メートル / キログラム / 秒。THREE 非依存 (Node でテスト可)。
   座標系:
     ワールド: x=横(右+), y=上, z=奥行き(客側+)。筐体中心 x=0。
     コインメック層: 2D (u,v) = (ワールドx, ワールドy) ※扉ローカル
     コラム/シュート層: 2D (u,v) = (ワールドz, ワールドy)
   ============================================================ */

/* ---------------- 硬貨 (実寸) ---------------- */
export const COINS = {
  10:  { value: 10,  d: 0.0235, thick: 0.0015, mass: 0.0045, color: 0xa56b46, name: '10円' },
  50:  { value: 50,  d: 0.0210, thick: 0.0017, mass: 0.0040, color: 0xc9cdd2, name: '50円' },
  100: { value: 100, d: 0.0226, thick: 0.0017, mass: 0.0048, color: 0xd4d8dd, name: '100円' },
  500: { value: 500, d: 0.0265, thick: 0.0018, mass: 0.0070, color: 0xd9c98e, name: '500円' },
};
export const DENOMS = [10, 50, 100, 500];
/* エスクロー対象金種 (実機: 高額硬貨は一時保留し返却レバーで現物返却) */
export const ESCROW_DENOMS = [100, 500];

/* 財布の初期内容 (枚数)。bill = 千円札 */
export const WALLET_INIT = { 10: 12, 50: 5, 100: 8, 500: 2, bill: 3 };

/* ---------------- 筐体 (FR30A6R40TK 実寸) ---------------- */
export const CABINET = {
  w: 1.185, h: 1.83, d: 0.731,
  zFront: 0.3655, zBack: -0.3655,
  doorZBack: 0.24,                     // 扉アセンブリの背面 (展示室は扉内に収まる)
  mechZ: 0.245,                        // コインメック描画面 (ワールドz)
  mechBackZ: 0.205,                    // 金庫経路 (メック背面側)
  hingeX: -0.5925,                     // 扉ヒンジ (左端)
  portX: [-0.50, 0.20],                // 取出口の横範囲 (下部中央〜左)
  portFloorY: 0.365,
};

/* ---------------- 商品 (10種) ----------------
   atlas: ラベルアトラス上の行番号 (テクスチャは10行1列) */
export const PRODUCTS = [
  { id: 'blackcoffee', short: 'ブラック',   kind: 'can', r: 0.0264, len: 0.1047, price: 130, colors: ['#1d1712', '#c9a227'], atlas: 0 },
  { id: 'bitocoffee',  short: 'カフェオレ', kind: 'can', r: 0.0264, len: 0.1047, price: 130, colors: ['#7a5230', '#e8d5b0'], atlas: 1 },
  { id: 'cola',        short: 'コーラ',     kind: 'can', r: 0.033,  len: 0.122,  price: 140, colors: ['#b01e28', '#ffffff'], atlas: 2 },
  { id: 'cider',       short: 'サイダー',   kind: 'can', r: 0.033,  len: 0.122,  price: 140, colors: ['#2a7fd4', '#bfe8ff'], atlas: 3 },
  { id: 'orange',      short: 'オレンジ',   kind: 'can', r: 0.033,  len: 0.122,  price: 130, colors: ['#ff8a1e', '#ffd23f'], atlas: 4 },
  { id: 'water',       short: 'てんねん水', kind: 'pet', r: 0.0335, len: 0.200,  price: 110, colors: ['#9fd8ef', '#e8f8ff'], atlas: 5 },
  { id: 'tea',         short: '緑茶',       kind: 'pet', r: 0.0335, len: 0.200,  price: 150, colors: ['#3f8f3f', '#d7ecc0'], atlas: 6 },
  { id: 'sports',      short: 'スポーツ',   kind: 'pet', r: 0.0335, len: 0.200,  price: 160, colors: ['#2255aa', '#cfe6ff'], atlas: 7 },
  { id: 'lemontea',    short: 'レモンティ', kind: 'pet', r: 0.0335, len: 0.200,  price: 150, colors: ['#d8a020', '#fff0c0'], atlas: 8 },
  { id: 'soda',        short: 'たんさん水', kind: 'pet', r: 0.0335, len: 0.200,  price: 120, colors: ['#5aa8c8', '#eaffff'], atlas: 9 },
];

/* ---------------- 庫内: 3室 × 上下段 × 前後5コラム = 30コラム ----------------
   chamber: 0=左庫, 1=中庫, 2=右庫 (x中心)。
   実機: 左庫=細缶(コーヒー), 中庫=太缶, 右庫=PET (4列PET対応ラック) */
export const CHAMBERS = [
  { x: -0.3695, width: 0.345 },
  { x: 0.0,     width: 0.345 },
  { x: 0.3695,  width: 0.345 },
];
/* 各室の商品 (前後スロット0=奥...4=前, 上段/下段) */
const CH_PRODUCTS = [
  // 左庫: 缶コーヒー系
  { upper: [0, 0, 1, 1, 0], lower: [1, 0, 0, 1, 1] },
  // 中庫: 太缶
  { upper: [2, 2, 3, 4, 3], lower: [4, 3, 2, 4, 2] },
  // 右庫: PET
  { upper: [5, 6, 7, 5, 6], lower: [8, 9, 5, 6, 9] },
];

/* コラム定義 30本: id = chamber*10 + stage*5 + slot */
export const COLUMNS = [];
for (let ch = 0; ch < 3; ch++) {
  for (let stage = 0; stage < 2; stage++) {         // 0=上段, 1=下段
    for (let slot = 0; slot < 5; slot++) {
      const product = stage === 0 ? CH_PRODUCTS[ch].upper[slot] : CH_PRODUCTS[ch].lower[slot];
      COLUMNS.push({
        chamber: ch, stage, slot, product,
        x: CHAMBERS[ch].x,
        // 取出口へ寄せる描画x (室と奥行スロットで分散)
        portX: Math.max(-0.46, Math.min(0.16, CHAMBERS[ch].x * 0.55 + (slot - 2) * 0.05)),
      });
    }
  }
}

/* ---------------- セレクション: 36ボタン → 30コラム ----------------
   3段×12列。row0(上段窓)=PET, row1=太缶, row2=細缶コーヒー。
   実機と同じく人気商品は隣接2ボタンに同一コラムを割当 (36→30)。
   col(chamber,stage,slot) → COLUMNS index = ch*10 + stage*5 + slot */
const C = (ch, st, sl) => ch * 10 + st * 5 + sl;
export const SELECTIONS = [
  // row 0 (最上段, PET 12ボタン → 右庫10コラム: 2商品を2ボタン化)
  { row: 0, col: 0,  column: C(2, 0, 0) }, { row: 0, col: 1,  column: C(2, 0, 1) },
  { row: 0, col: 2,  column: C(2, 0, 2) }, { row: 0, col: 3,  column: C(2, 0, 3) },
  { row: 0, col: 4,  column: C(2, 0, 3) }, { row: 0, col: 5,  column: C(2, 0, 4) },
  { row: 0, col: 6,  column: C(2, 1, 0) }, { row: 0, col: 7,  column: C(2, 1, 1) },
  { row: 0, col: 8,  column: C(2, 1, 2) }, { row: 0, col: 9,  column: C(2, 1, 2) },
  { row: 0, col: 10, column: C(2, 1, 3) }, { row: 0, col: 11, column: C(2, 1, 4) },
  // row 1 (中段, 太缶 12ボタン → 中庫10コラム)
  { row: 1, col: 0,  column: C(1, 0, 0) }, { row: 1, col: 1,  column: C(1, 0, 1) },
  { row: 1, col: 2,  column: C(1, 0, 2) }, { row: 1, col: 3,  column: C(1, 0, 3) },
  { row: 1, col: 4,  column: C(1, 0, 4) }, { row: 1, col: 5,  column: C(1, 0, 4) },
  { row: 1, col: 6,  column: C(1, 1, 0) }, { row: 1, col: 7,  column: C(1, 1, 1) },
  { row: 1, col: 8,  column: C(1, 1, 2) }, { row: 1, col: 9,  column: C(1, 1, 3) },
  { row: 1, col: 10, column: C(1, 1, 3) }, { row: 1, col: 11, column: C(1, 1, 4) },
  // row 2 (下段, 細缶コーヒー 12ボタン → 左庫10コラム)
  { row: 2, col: 0,  column: C(0, 0, 0) }, { row: 2, col: 1,  column: C(0, 0, 0) },
  { row: 2, col: 2,  column: C(0, 0, 1) }, { row: 2, col: 3,  column: C(0, 0, 2) },
  { row: 2, col: 4,  column: C(0, 0, 3) }, { row: 2, col: 5,  column: C(0, 0, 4) },
  { row: 2, col: 6,  column: C(0, 1, 0) }, { row: 2, col: 7,  column: C(0, 1, 1) },
  { row: 2, col: 8,  column: C(0, 1, 1) }, { row: 2, col: 9,  column: C(0, 1, 2) },
  { row: 2, col: 10, column: C(0, 1, 3) }, { row: 2, col: 11, column: C(0, 1, 4) },
];

/* ---------------- 物理 ---------------- */
export const PHYS = {
  h: 1 / 480,
  gravity: 9.81,
  solverIters: 7,
  posCorrect: 0.55,
  slop: 0.0004,
  // sleepVel は重力1ステップ分 (g*h≈0.02) より大きくしないと
  // 接触スタックの解決残差で永遠に覚醒し続ける
  sleepVel: 0.035, sleepAngVel: 0.9, sleepTime: 0.5,
  maxStepsPerFrame: 14,
  airDrag: 0.10,
};

/* ---------------- ラック (垂直細ジグザグチャンネル) ----------------
   実機: 蛇行通路をほぼ垂直に降りる。前後5コラムの出口(ベンドメカ)は
   ラック前面に段違いに並ぶ (五重サーペンタイン)。 */
export const RACK = {
  zSlots: [-0.292, -0.206, -0.120, -0.034, 0.052],  // 前後スロット中心 (0=奥)
  laneZ: [0.105, 0.195],       // 前面落下レーン (上段商品の通り道)
  exitZ: 0.085,                // ベンドメカ位置 (チャンネル前面)
  upper: { top: 1.755, exitBase: 1.315 },   // 上段: チャンネル上端 / 出口基準高
  lower: { top: 1.245, exitBase: 0.775 },   // 下段
  exitStep: 0.048,             // スロットごとの出口高さの段差 (前が低い)
  wallGap: 0.004,              // チャンネル壁と商品の遊び
  bumpPitchK: 2.15,            // デフレクタ縦ピッチ (×r)
  bumpDepthK: 0.34,            // デフレクタ突出量 (×r)
  trayDrop: 0.05,              // トレー開口の余白
};

/* チャンネル生成: 商品半径 r, スロット slot, 段 stage から
   { walls, bumps, ramp, mouthZ, top } を返す (すべて (u,v)=(z,y) の線分) */
export function genChannel(r, slot, stage) {
  const S = RACK;
  const zc = S.zSlots[slot];
  const st = stage === 0 ? S.upper : S.lower;
  const yExit = st.exitBase + (4 - slot) * S.exitStep;  // 前(slot4)が低い
  const half = r + S.wallGap;
  // 出口ランプ: チャンネル底から前面のベンドメカへ下る
  const rampSlope = 0.5;
  const rampEndZ = S.exitZ + 0.012;
  const yBend = yExit + (rampEndZ - (zc - half)) * rampSlope;
  const segs = [];
  // 垂直壁 (奥側/前側)。前壁はランプ上の通過空間を空けて終わる
  segs.push({ a: [zc - half, st.top], b: [zc - half, yBend], kind: 'wall' });
  segs.push({ a: [zc + half, st.top], b: [zc + half, yBend + 2 * r + 0.008], kind: 'wall' });
  // 交互デフレクタ (蛇行を作る小さな突起)
  const pitch = r * S.bumpPitchK;
  const depth = r * S.bumpDepthK;
  let side = -1;
  for (let y = st.top - pitch * 0.8; y > yBend + pitch * 0.6; y -= pitch) {
    const zw = zc + side * half;
    segs.push({
      a: [zw, y + depth * 1.3],
      b: [zw - side * depth, y],
      kind: 'bump',
    });
    side = -side;
  }
  // 出口ランプ (最終進入棚に相当。ベンドピンはこの上に立つ)
  const ramp = { a: [zc - half, yBend], b: [rampEndZ, yExit] };
  segs.push({ ...ramp, kind: 'ramp' });
  // ランプ上面ガイド (列の上の商品が暴れないように)
  segs.push({
    a: [zc + half, yBend + 2 * r + 0.012],
    b: [rampEndZ + 0.012, yExit + 2 * r + 0.014],
    kind: 'rampTop',
  });
  // 落下ガイド: 排出された商品が扉側/ラック側へ暴れないように
  segs.push({ a: [S.laneZ[1], yExit + 0.06], b: [S.laneZ[1], 0.60], kind: 'laneFront' });
  if (stage === 0) {
    segs.push({ a: [S.laneZ[0] - 0.002, yExit - 0.06], b: [S.laneZ[0] - 0.002, 0.60], kind: 'laneBack' });
  }
  return { segs, ramp, yExit, mouthZ: zc, top: st.top, half, rampEndZ };
}

/* トップトレー: 補充商品が転がって空きコラムに落ちる */
export const TRAY = {
  frontZ: 0.20, backZ: -0.33,
  upperY: 1.795, lowerY: 1.285,   // トレー前端の高さ (後傾斜)
  tilt: 0.06,                      // 前端から後端への下がり
};

/* ベンドメック (2ピン式) — 従来と同じサイクル */
export const VEND = {
  cycle: {
    upperIn: 0.18, lowerOut: 0.42, lowerIn: 0.80, upperOut: 1.05, done: 1.35,
  },
};

/* シュート & 取出口 (per-chamber 共有層の共通プロフィール) */
export const CHUTE = {
  tray: { a: [-0.30, 0.52], b: [0.155, 0.405] },      // 傾斜シュート
  backWall: { a: [-0.315, 0.72], b: [-0.315, 0.52] },
  portFloor: { a: [0.155, 0.385], b: [0.298, 0.353] },
  // 落下デフレクタ: 落ちてきた商品の運動量を前方向へ変換して搬出扉に当てる
  deflector: { a: [0.105, 0.565], b: [0.215, 0.425] },
  // 搬出扉 (庫内断熱フラップ。デフレクタで加速した商品が押し開ける。
  //  軽い樹脂扉なので減衰は小さく、当たるとバタつく)
  innerFlap: { pivot: [0.235, 0.55], len: 0.19, restAngle: 0, maxAngle: 1.25, k: 0.12, c: 0.015, inertia: 0.0025 },
  // 外フラッパー (お客が持ち上げる取出口扉)
  flap: { pivot: [0.315, 0.565], len: 0.20, maxAngle: 0.95, k: 24, c: 0.38, inertia: 0.005 },
};

/* ---------------- コインメック 経路レイアウト ----------------
   前面: 投入口 y≈1.30 (実機 床上約1250mm)。メックは扉裏 y0.55-1.35。 */
const RAIL_X0 = 0.475, RAIL_Y0 = 1.215, RAIL_SLOPE = 0.22;
const railY = (x) => RAIL_Y0 - (RAIL_X0 - x) * RAIL_SLOPE;

export const GATES = [
  { denom: 50,  cx: 0.415, passD: 0.0218 },
  { denom: 100, cx: 0.355, passD: 0.0230 },
  { denom: 10,  cx: 0.295, passD: 0.0245 },
];
export const RAIL_END_X = 0.225;
export const CH500_CX = 0.212;

export const TUBES = {
  50:  { cx: 0.415 },
  100: { cx: 0.355 },
  10:  { cx: 0.295 },
  500: { cx: 0.212 },
};
export const TUBE_TOP = 0.845, TUBE_BOTTOM = 0.625;
export const TUBE_INIT = { 10: 14, 50: 8, 100: 12, 500: 5 };
export const TUBE_CAP = { 10: 60, 50: 55, 100: 55, 500: 45 };

export const MECH = {
  slot: { u: 0.495, v: 1.30 },
  spawn: { u: 0.495, v: 1.335 },
  railY, RAIL_X0, RAIL_Y0, RAIL_SLOPE,
  sensorY: 1.115,                  // 検銭センサー
  escrowY: 1.055,                  // 保留シャッター (100/500のみ。硬貨はこの上に滞留)
  escrowReturnY: 1.015,            // 返却振分センサー (シャッター直下・返却時のみ有効)
  flipperY: 0.975,                 // 金庫振分 (チューブ満杯時)
  tubeMouthY: 0.848,               // チューブ入口センサー
  returnGate: { pivot: [0.537, 1.243], len: 0.064 },
  returnLaneX: [0.487, 0.545],     // 返却落下レーン (ゲート開時の素通り)
  cup: { left: 0.44, right: 0.545, floor: 0.42, top: 0.53 },
  payoutChute: { a: [0.19, 0.585], b: [0.432, 0.492] },
  // エスクロー返却シュート (専用層。保留現物をカップへ)
  escrowChute: { a: [0.185, 0.975], b: [0.505, 0.63] },
  escrowCupSensor: { u: 0.495, v: 0.605 },
  // 金庫 (背面層)
  cashChute: { a: [0.185, 0.855], b: [0.408, 0.575] },
  cashMouth: { u: 0.395, v: 0.548 },
  cashBox: { x0: 0.29, x1: 0.42, y0: 0.28, y1: 0.52 },
  payoutInterval: 0.14,
  entryFunnel: [
    [[0.455, 1.345], [0.479, 1.272]],
    [[0.537, 1.345], [0.512, 1.272]],
  ],
};

/* ---------------- 紙幣 (千円札) ---------------- */
export const BILL = {
  slot: { u: 0.495, v: 1.185 },     // 札口 (前面)
  size: [0.15, 0.076],              // 千円札 150×76mm
  insertTime: 1.1,                  // 搬送時間
  validateTime: 0.7,                // 判定時間
  rejectTime: 1.0,                  // 吐き出し時間
  stacker: { x0: 0.42, x1: 0.57, y0: 1.06, y1: 1.16, z: 0.215 },
  value: 1000,
  minChangeCoins: 13,               // 実機: 釣銭13枚確保できないと受け付けない
};

/* ---------------- 前面レイアウト (描画用) ---------------- */
export const FASCIA = {
  window: { x0: -0.565, x1: 0.41, y0: 0.945, y1: 1.745 },
  moneyStrip: { x0: 0.415, x1: 0.575 },
  rows: [
    { stageY: 1.520, btnY: 1.474 },   // row0 (PET)
    { stageY: 1.280, btnY: 1.234 },   // row1 (太缶)
    { stageY: 1.040, btnY: 0.994 },   // row2 (細缶)
  ],
  sampleX0: -0.506, samplePitch: 0.0783,   // 12列
  display7seg: { u: 0.495, v: 1.40 },
  lever: { u: 0.44, v: 1.30 },             // 回転ノブ式返却レバー
  icReader: { u: 0.495, v: 1.04 },
  lamps: { u: 0.495, v: 1.125 },           // つり銭切れ / お札中止
  poster: { u: 0.495, v: 0.77 },
  model: 'FR30A6R40TK',
};

/* ---------------- 販売設定 ---------------- */
export const PRICES = PRODUCTS.map(p => p.price);

export const TIMES = {
  doorOpen: 0.9,
  productTakeTween: 0.55,
};
