/* ============================================================
   sim-test.mjs — ヘッドレス動作検証 (node test/sim-test.mjs)
   描画なしで物理＋機構ロジックを走らせ、
   硬貨選別・販売・釣銭・売切の正しさを検証する。
   ============================================================ */
import { World } from '../js/physics.js';
import { CoinMech, LAYER_MECH, LAYER_MECH_BACK } from '../js/coin-mech.js';
import { Rack } from '../js/rack.js';
import { VendingState } from '../js/vending-state.js';
import { PHYS, COINS, DENOMS, TUBE_INIT, PRICES, COLUMNS } from '../js/config.js';

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok: ${msg}`); }
  else { console.error(`  FAIL: ${msg}`); failures++; }
}

function makeRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function build() {
  const world = new World();
  const events = [];
  const emit = (type, data) => {
    events.push({ type, data });
    state?.onMechEvent(type, data);
  };
  const rackEmit = (type, data) => {
    events.push({ type, data });
    state?.onRackEvent(type, data);
  };
  const mech = new CoinMech(world, (t, d) => emit(t, d));
  const rack = new Rack(world, (t, d) => rackEmit(t, d), makeRng(7));
  let state = new VendingState(mech, rack, (t, d) => events.push({ type: `ui:${t}`, data: d }));
  return { world, mech, rack, state, events };
}

function sim(ctx, seconds) {
  const steps = Math.round(seconds / PHYS.h);
  for (let i = 0; i < steps; i++) {
    ctx.mech.tick(PHYS.h);
    ctx.rack.tick(PHYS.h);
    ctx.world.step(PHYS.h);
    // 境界チェック: 剛体が世界の外へ吹き飛んでいないか
    for (const b of ctx.world.bodies) {
      if (b.y < 0.1 || b.y > 2.2 || b.x < -0.6 || b.x > 0.7) {
        console.error(`  FAIL: body out of bounds kind=${b.userData.kind} layer=${b.layer} x=${b.x.toFixed(3)} y=${b.y.toFixed(3)}`);
        failures++;
        ctx.world.removeBody(b);
      }
    }
  }
}

function eventCount(ctx, type) {
  return ctx.events.filter(e => e.type === type).length;
}

/* ================= テスト1: 硬貨選別 ================= */
console.log('--- test 1: 硬貨が金種別に正しく選別される ---');
{
  const ctx = build();
  for (const denom of DENOMS) {
    const before = { ...ctx.mech.tubes };
    ctx.events.length = 0;
    ctx.state.wallet[denom] = 99;
    ctx.state.insert(denom);
    sim(ctx, 4.0);
    const accepts = ctx.events.filter(e => e.type === 'accept');
    assert(accepts.length === 1 && accepts[0].data.denom === denom,
      `${denom}円: 検銭センサーが1回だけ正しい金種で発火 (${accepts.map(a => a.data.denom)})`);
    assert(ctx.mech.tubes[denom] === before[denom] + 1,
      `${denom}円: チューブ枚数が+1 (${before[denom]}→${ctx.mech.tubes[denom]})`);
    const strays = ctx.world.bodies.filter(b => b.userData.kind === 'coin');
    assert(strays.length === 0, `${denom}円: メック内に迷子の硬貨なし (${strays.length})`);
  }
}

/* ================= テスト2: 購入と釣銭 ================= */
console.log('--- test 2: 500円投入 → 120円商品 → 釣銭380円 ---');
{
  const ctx = build();
  ctx.rack.preload([3, 2, 2, 2, 2]);
  sim(ctx, 14.0);
  assert(ctx.rack.cols[0].stock.length === 3, `コラム0 に3本待機 (${ctx.rack.cols[0].stock.length})`);
  const sleeping = ctx.world.bodies.filter(b => b.userData.kind === 'product' && b.sleeping).length;
  const total = ctx.world.bodies.filter(b => b.userData.kind === 'product').length;
  assert(total === 11, `商品剛体が11本 (${total})`);
  assert(sleeping >= total - 2, `ほぼ全ての商品がスリープ静止 (${sleeping}/${total})`);

  ctx.state.insert(500);
  sim(ctx, 4.5);
  assert(ctx.state.credit === 500, `credit=500 (${ctx.state.credit})`);
  assert(ctx.state.buttonEnabled(0), 'コラム0のボタンが点灯');

  const tubesBefore = { ...ctx.mech.tubes };
  const ok = ctx.state.pressButton(0);
  assert(ok, 'ボタン押下が受理される');
  assert(ctx.state.credit === 0, '押下で credit が0に');
  sim(ctx, 6.0);
  assert(eventCount(ctx, 'productExit') === 1, `商品が1本だけ排出 (${eventCount(ctx, 'productExit')})`);
  assert(eventCount(ctx, 'productAtPort') === 1, `商品が取出口に到達 (${eventCount(ctx, 'productAtPort')})`);
  assert(ctx.rack.cols[0].stock.length === 2, `コラム0 残り2本 (${ctx.rack.cols[0].stock.length})`);
  // 釣銭 380 = 100x3 + 50x1 + 10x3
  assert(tubesBefore[100] - ctx.mech.tubes[100] === 3, `100円チューブから3枚 (${tubesBefore[100] - ctx.mech.tubes[100]})`);
  assert(tubesBefore[50] - ctx.mech.tubes[50] === 1, `50円チューブから1枚 (${tubesBefore[50] - ctx.mech.tubes[50]})`);
  assert(tubesBefore[10] - ctx.mech.tubes[10] === 3, `10円チューブから3枚 (${tubesBefore[10] - ctx.mech.tubes[10]})`);
  assert(ctx.mech.tubes[500] === TUBE_INIT[500] + 1, `投入した500円はチューブへ (${ctx.mech.tubes[500]})`);
  assert(ctx.mech.cupCount() === 7, `カップに7枚 (${ctx.mech.cupCount()})`);
  const scooped = ctx.state.scoopCup();
  assert(scooped.length === 7, `7枚回収 (${scooped.length})`);
  const sum = scooped.reduce((s, d) => s + d, 0);
  assert(sum === 380, `回収額が380円 (${sum})`);
  // 商品を取る
  const taken = ctx.state.takeProduct();
  assert(taken.length === 1, `取出口から1本取得 (${taken.length})`);
}

/* ================= テスト3: 返却レバー ================= */
console.log('--- test 3: 返却レバーで全額返金 & ゲート開時は素通り ---');
{
  const ctx = build();
  ctx.state.insert(100);
  ctx.state.insert(50);
  sim(ctx, 4.0);
  assert(ctx.state.credit === 150, `credit=150 (${ctx.state.credit})`);
  ctx.state.pullLever();
  sim(ctx, 3.0);
  ctx.state.releaseLever();
  assert(ctx.state.credit === 0, '返金で credit=0');
  assert(ctx.mech.cupCount() >= 2, `カップに硬貨が戻る (${ctx.mech.cupCount()}枚)`);
  const scooped = ctx.state.scoopCup();
  assert(scooped.reduce((s, d) => s + d, 0) === 150, '返金額150円');

  // ゲート開放中の投入は選別されず素通りで返却される
  ctx.events.length = 0;
  ctx.state.pullLever();
  ctx.state.insert(100);
  sim(ctx, 3.0);
  assert(eventCount(ctx, 'accept') === 0, '返却中の投入は受理されない');
  assert(ctx.mech.cupCount() === 1, `素通りしてカップへ (${ctx.mech.cupCount()})`);
  ctx.state.releaseLever();
}

/* ================= テスト4: 売切と釣銭切れ ================= */
console.log('--- test 4: 売切ランプ / 釣銭切れ判定 ---');
{
  const ctx = build();
  ctx.rack.preload([0, 0, 1, 0, 0]);
  sim(ctx, 12.0);
  assert(ctx.rack.soldOut(0), 'コラム0は売切');
  assert(!ctx.rack.soldOut(2), 'コラム2は在庫あり');
  ctx.state.wallet[100] = 10;
  ctx.state.insert(100);
  ctx.state.insert(100);
  sim(ctx, 4.0);
  assert(!ctx.state.buttonEnabled(0), '売切コラムのボタンは点かない');
  assert(ctx.state.buttonEnabled(2), '在庫コラムのボタンは点く');
  ctx.state.pressButton(2);
  sim(ctx, 6.5);
  assert(ctx.rack.soldOut(2), '最後の1本で売切に');
  assert(eventCount(ctx, 'soldOut') >= 1, '売切イベント発火');

  // 釣銭切れ: チューブを空にすると警告
  ctx.mech.tubes[10] = 0; ctx.mech.tubes[50] = 0; ctx.mech.tubes[100] = 0;
  assert(ctx.state.changeShortage(), '釣銭切れランプ点灯条件');
  // 釣銭が払えない購入は成立しない (500円投入で120円商品)
  ctx.state.wallet[500] = 5;
  ctx.state.insert(500);
  sim(ctx, 3.5);
  assert(!ctx.state.buttonEnabled(1), '釣銭不能な取引はボタンが点かない');
}

/* ================= テスト5: 金庫振分 (チューブ満杯) ================= */
console.log('--- test 5: チューブ満杯時は金庫へ ---');
{
  const ctx = build();
  ctx.mech.tubes[100] = 55;   // TUBE_CAP[100] と同値 → 満杯
  ctx.state.wallet[100] = 5;
  ctx.state.insert(100);
  sim(ctx, 4.5);
  assert(eventCount(ctx, 'accept') === 1, '満杯でも受理はされる');
  assert(eventCount(ctx, 'divert') === 1, '金庫へ振分イベント');
  assert(eventCount(ctx, 'cashIn') === 1, `金庫に着地 (${eventCount(ctx, 'cashIn')})`);
  assert(ctx.mech.cashBox[100] === 1, `金庫の100円が1枚 (${ctx.mech.cashBox[100]})`);
  assert(ctx.mech.tubes[100] === 55, 'チューブ枚数は変わらず');
  const cash = ctx.state.collectCash();
  assert(cash === null, '店員モード外では回収不可');
  ctx.state.setOperator(true);
  const cash2 = ctx.state.collectCash();
  assert(cash2.total === 100, `売上回収 100円 (${cash2.total})`);
}

/* ================= テスト6: 決定論 ================= */
console.log('--- test 6: 同一シードで軌道が一致 (決定論) ---');
{
  const run = () => {
    const ctx = build();
    ctx.rack.preload([2, 0, 0, 0, 0]);
    ctx.state.insert(500);
    sim(ctx, 5.0);
    return ctx.world.bodies.map(b => `${b.x.toFixed(9)},${b.y.toFixed(9)}`).join(';') +
      '|' + JSON.stringify(ctx.mech.tubes);
  };
  const a = run(), b = run();
  assert(a === b, '2回実行のワールド状態ハッシュが完全一致');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
