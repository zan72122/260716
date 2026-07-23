// ゲーム全体の設定値。数値をいじるだけで難易度・見た目を調整できる。

// URLパラメータで回数・時間を調整できる(テスト・お好み用)
// 例: ?rounds=3&mgtime=15&mg=balloon
const qp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const CONFIG = {
  ROUNDS: Math.max(1, parseInt(qp.get('rounds'), 10) || 5), // ボードゲームの周回数
  TILE_COUNT: 48,          // すごろくマスの数(4ゾーン × 12マス)
  BOARD_RADIUS: 16.5,      // マスが並ぶ円の半径
  ISLAND_RADIUS: 30,       // 島の半径
  SEA_SIZE: 340,           // 海の一辺
  HOP_TIME: 0.3,           // 1マス移動にかける秒数
  COIN_TILE_GAIN: 3,
  HEART_TILE_GAIN: 2,
  MINIGAME_WIN_COINS: 5,
  MINIGAME_TIME: Math.max(5, parseInt(qp.get('mgtime'), 10) || 20), // ミニゲーム制限秒
  PIXEL_RATIO_MAX: 2,
  SUPER_STARS: 2,          // スターこの数でスーパーすがたに変身
  ROPEWAY_DIST: 14,        // ロープウェイで進むマス数
  TURTLE_DIST: 5,          // カメさんで進むマス数
  HOLE_EXIT_DIST: 8,       // どうくつの出口(おとしあなから何マス先か)
};

// テスト用: ボードイベントを強制(?tile=STORM 等)/ボス・コースター即時発火
export const DEBUG = {
  forceTile: qp.get('tile'),
  forceEvent: qp.get('event'), // boss | coaster | cave | turtle | ropeway
};

// キャラクター定義(オリジナルの どうぶつフレンズ)
// startTile: それぞれ別のゾーンからスタートして、島じゅうが舞台になる
export const CHARACTERS = [
  {
    id: 'momo', name: 'モモ', species: 'bunny', emoji: '🐰',
    color: 0xffa7c4, accent: 0xffffff, ui: '#ff8fb5', startTile: 0,
  },
  {
    id: 'piyo', name: 'ピヨ', species: 'chick', emoji: '🐤',
    color: 0xffd94d, accent: 0xffaa33, ui: '#ffc93e', startTile: 12,
  },
  {
    id: 'pen', name: 'ペン', species: 'penguin', emoji: '🐧',
    color: 0x6fb7ff, accent: 0xffffff, ui: '#5aa7f7', startTile: 24,
  },
  {
    id: 'kero', name: 'ケロ', species: 'frog', emoji: '🐸',
    color: 0x84d96c, accent: 0xfff6c8, ui: '#63c94f', startTile: 36,
  },
];

// 4つのゾーン(12マスごと)
export const ZONES = [
  { id: 'beach',   name: 'はまべ',     emoji: '🏖️' },
  { id: 'jungle',  name: 'ジャングル', emoji: '🌴' },
  { id: 'volcano', name: 'かざん',     emoji: '🌋' },
  { id: 'park',    name: 'ゆうえんち', emoji: '🎡' },
];

export function zoneOfTile(i) {
  return Math.floor(((i % 48) + 48) % 48 / 12);
}

// マスの種類
export const TILE_TYPES = {
  COIN:    { key: 'COIN',    color: 0x63b3ff, label: 'コイン' },
  HEART:   { key: 'HEART',   color: 0xff9dbe, label: 'ハート' },
  RAINBOW: { key: 'RAINBOW', color: 0xc19bff, label: 'にじワープ' },
  EVENT:   { key: 'EVENT',   color: 0x7fe08a, label: 'はなび' },
  STAR:    { key: 'STAR',    color: 0xffd23e, label: 'スター' },
  STORM:   { key: 'STORM',   color: 0x6b6485, label: 'くろくも' },
  BOMB:    { key: 'BOMB',    color: 0x4a4a58, label: 'ばくだんサイコロ' },
  HOLE:    { key: 'HOLE',    color: 0x8a6a4a, label: 'おとしあな' },
  TURTLE:  { key: 'TURTLE',  color: 0x4fd0c0, label: 'カメさん' },
  ROPEWAY: { key: 'ROPEWAY', color: 0xffb03c, label: 'ロープウェイ' },
  COASTER: { key: 'COASTER', color: 0xff6f9c, label: 'コースター' },
};

// 48マスのならび(ゾーンごとに味付け)。スターは動的に配置される。
const LAYOUT_48 = [
  // 🏖️ はまべ (0-11)
  'COIN', 'COIN', 'HEART', 'COIN', 'RAINBOW', 'COIN',
  'TURTLE', 'COIN', 'COIN', 'HEART', 'STORM', 'COIN',
  // 🌴 ジャングル (12-23)
  'COIN', 'COIN', 'HEART', 'HOLE', 'COIN', 'RAINBOW',
  'ROPEWAY', 'COIN', 'EVENT', 'STORM', 'COIN', 'HEART',
  // 🌋 かざん (24-35)
  'COIN', 'STORM', 'COIN', 'BOMB', 'COIN', 'HEART',
  'EVENT', 'COIN', 'RAINBOW', 'HOLE', 'STORM', 'COIN',
  // 🎡 ゆうえんち (36-47)
  'COIN', 'HEART', 'COIN', 'BOMB', 'RAINBOW', 'COIN',
  'COASTER', 'COIN', 'EVENT', 'HEART', 'STORM', 'COIN',
];

export function buildTileLayout(count) {
  const layout = [];
  for (let i = 0; i < count; i++) {
    let t = LAYOUT_48[i % 48];
    if (DEBUG.forceTile && TILE_TYPES[DEBUG.forceTile] && t === 'COIN') t = DEBUG.forceTile;
    layout.push(t);
  }
  return layout;
}

// 天気:ラウンドごとにうつりかわる(最終ラウンドは夕焼けの大一番)
export function weatherForRound(round, total) {
  if (round >= total) return 'sunset';
  return ['sunny', 'cloudy', 'squall', 'rainbowy'][(round - 1) % 4];
}

// ミニゲームを固定したいとき(?mg=balloon など)
export const FORCED_MINIGAME = qp.get('mg');

export const MINIGAMES = [
  { id: 'balloon', name: 'ふうせん パンパン', icon: '🎈', desc: 'ふうせんを タッチで わろう!' },
  { id: 'fruits',  name: 'フルーツ キャッチ', icon: '🍎', desc: 'かごを うごかして キャッチ!' },
  { id: 'race',    name: 'ぴょんぴょん レース', icon: '🏁', desc: 'タップれんだで はしろう!' },
  { id: 'stars',   name: 'きらきら タッチ', icon: '⭐', desc: 'でてきた ほしを タッチ!' },
  { id: 'fish',    name: 'おさかな すくい', icon: '🐟', desc: 'およぐ おさかなを タッチ!' },
  { id: 'cake',    name: 'ケーキ つみつみ', icon: '🎂', desc: 'タップで スポンジを おとそう!' },
  { id: 'cart',    name: 'トロッコ コースター', icon: '🚂', desc: 'みぎ ひだり タップで ほしあつめ!' },
  { id: 'volcano', name: 'ドッカン かざん', icon: '🌋', desc: 'いわを よけて ほうせき キャッチ!' },
];
