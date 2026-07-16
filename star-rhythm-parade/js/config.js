// ================================================================
// 全体設定 — タイミング判定・色・演出パラメータ
// 4歳児向けなので判定はとても甘く、失敗してもマイナスにしない。
// ================================================================

export const JUDGE = {
  perfect: 0.16,   // ±160ms → 「ぴったり!」
  good: 0.34,      // ±340ms → 「いいね!」
  // それ以外のタップ/スルーは「おしい!」(減点なし・キャラは可愛く転ぶだけ)
};

export const COLORS = {
  nightTop: 0x2a1f6e,
  nightBottom: 0x0d0a2e,
  horizon: 0xff9fb8,
  moon: 0xfff3c4,
  ground: 0x8f7bff,
  groundDark: 0x5a4bc4,
  stageWood: 0xffc078,
  stageWoodDark: 0xe09a4f,

  rabbit: 0xfff6ef,
  rabbitEar: 0xffc9d8,
  cat: 0xffd27a,
  catStripe: 0xe8a84e,
  bear: 0xc98f5f,
  bearMuzzle: 0xf2d4ac,
  star: 0xffe066,
  starDeep: 0xffb830,

  mochi: 0xfffdf4,
  usu: 0xa46a3c,
  kine: 0xdba05e,

  perfect: 0xffd94a,
  good: 0x7ce8c4,
  miss: 0xffb1c9,
};

// 各ミニゲームの基本情報
export const GAMES = {
  mochi: {
    name: 'もちつき ぺったん',
    bpm: 104,
    measures: 18,        // 演奏する小節数(4/4)
    introMeasures: 2,    // お手本のみの小節
  },
  catch: {
    name: 'おほしさま キャッチ',
    bpm: 100,
    measures: 18,
    introMeasures: 2,
  },
  jump: {
    name: 'みんなで ジャンプ',
    bpm: 112,
    measures: 18,
    introMeasures: 2,
  },
};

// 結果画面: 4歳児向けに必ず1つ以上、たくさん当たれば3つ
export function starCount(hitRate) {
  if (hitRate >= 0.55) return 3;
  if (hitRate >= 0.3) return 2;
  return 1;
}

export const RESULT_TEXT = {
  3: { title: 'すごーい!', msg: 'リズムばっちり! ほしが 3つ かがやいたよ☆' },
  2: { title: 'やったね!', msg: 'とっても じょうず! つぎは 3つ ねらおう!' },
  1: { title: 'たのしかったね!', msg: 'いっぱい タップできたね! もういっかい あそぼう!' },
};
