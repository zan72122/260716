/* =========================================================
 * カラーじしゃく すなもよう庭 — 設定値
 * すべての調整パラメータをここに集約する。
 * 単位: 距離は CSS ピクセル、時間は秒。
 * ======================================================= */
"use strict";

var CONFIG = {
  /* ---- 粒 ---- */
  particle: {
    baseCount: 3600,        // 初期粒数(端末性能で自動増減)
    minCount: 1800,
    maxCount: 5600,
    lineWidth: 2.4,         // 粒の太さ
    minLen: 2.0,            // 寝ている粒の描画長
    maxLen: 9.0,            // 強い場で立ち上がった粒の最大長
    restFriction: 5.5,      // 解放後の減速(大きいほどすぐ止まる)
    restSpeed: 5.0,         // これ未満の速さで「その場に定着」
  },

  /* ---- 磁石 ---- */
  magnet: {
    fieldRadius: 150,       // 引き寄せが届く距離
    grabRadius: 120,        // この距離以内のタッチで磁石をつかむ
    liftOffset: 78,         // 指より上に磁石を出す量(指隠れ防止)
    liftTime: 0.22,         // つかんだ瞬間からのオフセット移行時間
    captureRate: 9.0,       // 場の強さ→捕獲確率の係数(毎秒)
    releaseDist: 250,       // 目標からこれ以上離れたら粒を解放(尾がちぎれる)
    springK: 42,            // 捕獲粒のばね強さ(粒ごとに±30%ゆらぎ)
    springDamp: 8.5,        // 捕獲粒の減衰
    moundBase: 10,          // 砂山の最小半径
    moundGrain: 1.75,       // 砂山半径 = base + grain*sqrt(粒数)
    glideSpeed: 300,        // タップ先へ磁石が滑る速さ
    mergeDist: 40,          // 磁石同士がこの距離まで重なると合体
    swirlGain: 0.38,        // 磁石の向き変化 → 砂山の渦回転
    swirlDecay: 2.2,        // 渦回転の減衰
    snapRadius: 55,         // この距離では確率を待たず一気に吸い付く(急坂)
    snapImpulse: 320,       // 吸い付き初速
    nearSpringBoost: 0.8,   // 磁石に近い捕獲粒ほどばねが硬い(最大+80%)
    coreTighten: 0.8,       // 砂山の芯ほどばねが硬い(山ごと運ぶ感触)
    shedSpeed: 400,         // これより速く動かしながら離すと…
    shedRatio: 0.55,        // …外周(slotR がこの割合より外)の粒がちぎれて跡になる
    dropTime: 0.3,          // 2個目の磁石が落ちてくる時間
    dropHeight: 150,        // 落下開始の高さ
  },

  /* ---- 2磁石間の橋 ---- */
  bridge: {
    range: 340,             // 橋が架かり始める磁石間距離(+砂山半径)
    reach: 0.78,            // 伸びる長さ = 磁石間距離 × reach × 粒ごとの係数
    maxReach: 0.55,         // 伸びの上限(磁石間距離比。両側で中央がつながる)
    onThreshold: 0.35,      // 橋「完成」とみなす係数(グリッサンドが鳴る)
    offThreshold: 0.02,     // これを下回ると橋が「切れる」(ぱちん)
    snapImpulse: 300,       // 切れた瞬間の反動の強さ
  },

  /* ---- 場の可視化(触る前のヒント) ---- */
  field: {
    standThreshold: 0.05,   // 場の強さがこれを超えた寝粒は立ち上がる
    brightThreshold1: 0.16, // 明るさ段階1
    brightThreshold2: 0.45, // 明るさ段階2
    viewRadiusScale: 1.6,   // 力線が見える範囲(捕獲半径の倍率)
    spokeCount: 8,          // 力線の「筋」の本数
    spokeThreshold: 0.72,   // 筋に乗った粒だけ長く明るく
    swayAmp: 0.45,          // 遠くの粒の「そよぎ」の大きさ
  },

  /* ---- 砂の連鎖吸い ---- */
  chain: {
    contactPad: 40,         // 砂山の縁 + この距離まで接触捕獲が届く
    tugRadius: 20,          // 捕まった粒が隣を引っ張る距離
    tugImpulse: 60,         // 引っ張りの強さ
    maxEvents: 12,          // 1フレームに処理する連鎖の数
  },

  /* ---- シェイク(磁力を切る → 波でならす → 再点灯) ---- */
  shake: {
    waveTime: 1.35,         // 波が端から中央へ届くまでの時間
    settleK: 26,            // ならし中の粒のばね
    settleDamp: 7.5,
    flashTime: 0.55,        // 波が通った粒が光る時間
    rebootDelay: 0.4,       // 波が終わってから磁力が戻るまで
    slumpSpeed: 34,         // 磁場オフで山がふわっと崩れる速さ
  },

  /* ---- タッチ即応(触った瞬間の粒の反応) ---- */
  poke: {
    radius: 90,             // 反応する半径
    impulseMin: 45,         // 外向きインパルスの最小
    impulseMax: 130,        // 中心での最大
    flashTime: 0.30,        // 光る時間
  },

  /* ---- おさそい(無操作時の非言語の誘い) ---- */
  idle: {
    delay: 12,              // 最初のおさそいまでの無操作秒数
    repeat: 8,              // 以降の繰り返し間隔
    pokeRadius: 110,        // 磁石まわりで跳ねさせる範囲
    pokeMax: 8,             // 跳ねる粒の数
  },

  /* ---- 入力 ---- */
  input: {
    tapMaxTime: 0.45,       // これより短く
    tapMaxMove: 14,         // これより動かなければ「タップ」
  },

  /* ---- 性能自動調整 ---- */
  perf: {
    sampleTime: 1.5,        // fps計測窓
    lowFps: 42,             // 下回ったら粒を減らす
    highFps: 57,            // 上回り続けたら粒を増やす
    step: 0.85,             // 減量係数
  },
};

/* ---- 色テーマ(粒はテーマ内の色を粒単位で保持する) ---- */
var THEMES = [
  {
    name: "にじいろ",
    bg: "#171a2b",
    tray: "#20243d",
    frame: ["#9c7a54", "#6d4c35"],
    sand: ["#4FC3F7", "#F48FB1", "#FFD54F", "#AED581", "#B39DDB", "#EDF2F7"],
  },
  {
    name: "ゆうやけ",
    bg: "#221726",
    tray: "#2d1f33",
    frame: ["#a3684a", "#71402c"],
    sand: ["#FF8A65", "#FFD54F", "#F48FB1", "#CE93D8", "#FFAB91", "#FFE0B2"],
  },
  {
    name: "うみ",
    bg: "#0f1e2c",
    tray: "#15293b",
    frame: ["#5f8aa8", "#3c5d77"],
    sand: ["#4DD0E1", "#4FC3F7", "#B2EBF2", "#AED581", "#F8FBFF", "#FFD54F"],
  },
];

var MAGNET_STYLES = [
  { body: "#ef5350", edge: "#c62828", glow: "rgba(255,120,110,0.20)" },
  { body: "#5c6bc0", edge: "#3949ab", glow: "rgba(120,140,255,0.20)" },
];
