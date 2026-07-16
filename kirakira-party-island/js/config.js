// ゲーム全体の設定値。数値をいじるだけで難易度・見た目を調整できる。

// URLパラメータで回数・時間を調整できる(テスト・お好み用)
// 例: ?rounds=3&mgtime=15&mg=balloon
const qp = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const CONFIG = {
  ROUNDS: Math.max(1, parseInt(qp.get('rounds'), 10) || 5), // ボードゲームの周回数
  TILE_COUNT: 24,          // すごろくマスの数
  BOARD_RADIUS: 13.2,      // マスが並ぶ円の半径
  ISLAND_RADIUS: 20,       // 島の半径
  SEA_SIZE: 260,           // 海の一辺
  HOP_TIME: 0.34,          // 1マス移動にかける秒数
  COIN_TILE_GAIN: 3,
  HEART_TILE_GAIN: 2,
  MINIGAME_WIN_COINS: 5,
  MINIGAME_TIME: Math.max(5, parseInt(qp.get('mgtime'), 10) || 20), // ミニゲーム制限秒
  PIXEL_RATIO_MAX: 2,
};

// キャラクター定義(オリジナルの どうぶつフレンズ)
export const CHARACTERS = [
  {
    id: 'momo', name: 'モモ', species: 'bunny', emoji: '🐰',
    color: 0xffa7c4, accent: 0xffffff, ui: '#ff8fb5',
  },
  {
    id: 'piyo', name: 'ピヨ', species: 'chick', emoji: '🐤',
    color: 0xffd94d, accent: 0xffaa33, ui: '#ffc93e',
  },
  {
    id: 'pen', name: 'ペン', species: 'penguin', emoji: '🐧',
    color: 0x6fb7ff, accent: 0xffffff, ui: '#5aa7f7',
  },
  {
    id: 'kero', name: 'ケロ', species: 'frog', emoji: '🐸',
    color: 0x84d96c, accent: 0xfff6c8, ui: '#63c94f',
  },
];

// マスの種類
export const TILE_TYPES = {
  COIN:    { key: 'COIN',    color: 0x63b3ff, label: 'コイン' },
  HEART:   { key: 'HEART',   color: 0xff9dbe, label: 'ハート' },
  RAINBOW: { key: 'RAINBOW', color: 0xc19bff, label: 'にじワープ' },
  EVENT:   { key: 'EVENT',   color: 0x7fe08a, label: 'はなび' },
  STAR:    { key: 'STAR',    color: 0xffd23e, label: 'スター' },
};

// タイル並び(スターは動的に配置される)。均等に楽しいマスを散らす。
export function buildTileLayout(count) {
  const layout = [];
  for (let i = 0; i < count; i++) {
    if (i % 8 === 4) layout.push('RAINBOW');
    else if (i % 6 === 3) layout.push('HEART');
    else if (i % 12 === 7) layout.push('EVENT');
    else layout.push('COIN');
  }
  return layout;
}

// ミニゲームを固定したいとき(?mg=balloon など)
export const FORCED_MINIGAME = qp.get('mg');

export const MINIGAMES = [
  { id: 'balloon', name: 'ふうせん パンパン', icon: '🎈', desc: 'ふうせんを タッチで わろう!' },
  { id: 'fruits',  name: 'フルーツ キャッチ', icon: '🍎', desc: 'かごを うごかして キャッチ!' },
  { id: 'race',    name: 'ぴょんぴょん レース', icon: '🏁', desc: 'タップれんだで はしろう!' },
  { id: 'stars',   name: 'きらきら タッチ', icon: '⭐', desc: 'でてきた ほしを タッチ!' },
];
