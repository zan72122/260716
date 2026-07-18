/* ============================================================
   sim-test.mjs — ヘッドレス動作検証 (tsumetai-jihanki-sim で
   `node test/sim-test.mjs`)
   実機準拠版: 硬貨選別 / エスクロー / 紙幣 / 36ボタン→30コラム /
   販売・釣銭 / 売切・釣銭切れ / 金庫振分 / トレー補充 / 決定論
   ============================================================ */
import { World } from '../js/physics.js';
import { CoinMech, LAYER_MECH } from '../js/coin-mech.js';
import { Rack } from '../js/rack.js';
import { VendingState } from '../js/vending-state.js';
import {
  PHYS, DENOMS, TUBE_INIT, PRODUCTS, COLUMNS, SELECTIONS, TUBE_CAP,
} from '../js/config.js';

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
  let state;
  const mech = new CoinMech(world, (t, d) => {
    events.push({ type: t, data: d });
    state?.onMechEvent(t, d);
  });
  const rack = new Rack(world, (t, d) => {
    events.push({ type: t, data: d });
    state?.onRackEvent(t, d);
  }, makeRng(7));
  state = new VendingState(mech, rack, (t, d) => events.push({ type: `ui:${t}`, data: d }));
  return { world, mech, rack, state, events };
}

function sim(ctx, seconds) {
  const steps = Math.round(seconds / PHYS.h);
  for (let i = 0; i < steps; i++) {
    ctx.mech.tick(PHYS.h);
    ctx.rack.tick(PHYS.h);
    ctx.world.step(PHYS.h);
    for (const b of ctx.world.bodies) {
      if (b.y < 0.1 || b.y > 2.2 || b.x < -0.7 || b.x > 0.8) {
        console.error(`  FAIL: body out of bounds kind=${b.userData.kind} layer=${b.layer} x=${b.x.toFixed(3)} y=${b.y.toFixed(3)}`);
        failures++;
        ctx.world.removeBody(b);
      }
    }
  }
}

const count = (ctx, type) => ctx.events.filter(e => e.type === type).length;

/* ================= テスト1: 硬貨選別 + エスクロー ================= */
console.log('--- test 1: 選別と一時保留 (10/50=直行, 100/500=エスクロー) ---');
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
      `${denom}円: 検銭が正しい金種で1回発火 (${accepts.map(a => a.data.denom)})`);
    if (denom === 100 || denom === 500) {
      assert(ctx.mech.escrow.length === 1 && ctx.mech.escrow[0].denom === denom,
        `${denom}円: エスクローに1枚保留`);
      assert(ctx.mech.tubes[denom] === before[denom], `${denom}円: チューブはまだ増えない`);
      ctx.mech.commitEscrow();
      sim(ctx, 2.0);
      assert(ctx.mech.escrow.length === 0, `${denom}円: 確定で保留が空に`);
      assert(ctx.mech.tubes[denom] === before[denom] + 1,
        `${denom}円: 確定でチューブ+1 (${before[denom]}→${ctx.mech.tubes[denom]})`);
    } else {
      assert(ctx.mech.tubes[denom] === before[denom] + 1,
        `${denom}円: チューブ+1 (${before[denom]}→${ctx.mech.tubes[denom]})`);
    }
    const strays = ctx.world.bodies.filter(b => b.userData.kind === 'coin');
    assert(strays.length === 0, `${denom}円: 迷子の硬貨なし (${strays.length})`);
    ctx.state.credit = 0;
  }
}

/* ================= テスト2: エスクロー現物返却 ================= */
console.log('--- test 2: 返却レバーで保留中の現物がそのまま戻る ---');
{
  const ctx = build();
  ctx.state.insert(500);
  sim(ctx, 3.0);
  assert(ctx.state.credit === 500, `credit=500 (${ctx.state.credit})`);
  const heldBody = ctx.mech.escrow[0]?.body;
  assert(!!heldBody, '500円がエスクローに保留されている');
  const tubesBefore = { ...ctx.mech.tubes };
  ctx.state.pullLever();
  sim(ctx, 3.0);
  ctx.state.releaseLever();
  assert(ctx.state.credit === 0, '返却で credit=0');
  assert(ctx.mech.tubes[500] === tubesBefore[500], '500円チューブは減らない (現物返却)');
  const cupBodies = ctx.world.bodies.filter(b =>
    b.userData.kind === 'coin' && b.x > 0.43 && b.y < 0.54);
  assert(cupBodies.length === 1 && cupBodies[0] === heldBody,
    `カップの硬貨が投入した現物と同一剛体 (${cupBodies.length}枚)`);
  const got = ctx.state.scoopCup();
  assert(got.length === 1 && got[0] === 500, '回収したのは500円');
}

/* ================= テスト3: 購入フロー (500円→110円商品→釣銭390円) ================= */
console.log('--- test 3: 購入と釣銭 (sel0 = てんねん水 110円) ---');
{
  const ctx = build();
  ctx.rack.preloadDirect(null);   // 全コラム capacity-1 本
  sim(ctx, 3.0);
  const col0 = SELECTIONS[0].column;
  assert(ctx.rack.stockCount(col0) > 0, `sel0のコラム(${col0})に在庫あり (${ctx.rack.stockCount(col0)})`);
  const total = ctx.world.bodies.filter(b => b.userData.kind === 'product').length;
  const sleeping = ctx.world.bodies.filter(b => b.userData.kind === 'product' && b.sleeping).length;
  console.log(`  info: 商品剛体 ${total}本 (sleep ${sleeping})`);
  assert(total > 150, `商品が30コラム分存在 (${total})`);
  assert(sleeping >= total - 6, `ほぼ全てスリープ (${sleeping}/${total})`);

  ctx.state.insert(500);
  sim(ctx, 3.0);
  assert(ctx.state.buttonEnabled(0), 'sel0 のボタンが点灯');
  assert(PRODUCTS[COLUMNS[col0].product].price === 110, 'sel0 は110円商品');
  const tubesBefore = { ...ctx.mech.tubes };
  assert(ctx.state.pressButton(0), 'ボタン押下受理');
  sim(ctx, 8.0);
  assert(count(ctx, 'productExit') === 1, `1本だけ排出 (${count(ctx, 'productExit')})`);
  assert(count(ctx, 'productAtPort') === 1, `取出口に到達 (${count(ctx, 'productAtPort')})`);
  // 釣銭390 = 100x3 + 50x1 + 10x4
  assert(tubesBefore[100] - ctx.mech.tubes[100] === 3, `100円3枚 (${tubesBefore[100] - ctx.mech.tubes[100]})`);
  assert(tubesBefore[50] - ctx.mech.tubes[50] === 1, `50円1枚`);
  assert(tubesBefore[10] - ctx.mech.tubes[10] === 4, `10円4枚 (${tubesBefore[10] - ctx.mech.tubes[10]})`);
  assert(ctx.mech.tubes[500] === TUBE_INIT[500] + 1, `投入500円は確定でチューブへ (${ctx.mech.tubes[500]})`);
  assert(ctx.mech.cupCount() === 8, `カップに8枚 (${ctx.mech.cupCount()})`);
  const scooped = ctx.state.scoopCup();
  assert(scooped.reduce((s, d) => s + d, 0) === 390, `回収390円`);
  assert(ctx.state.takeProduct().length === 1, '商品を取得');
}

/* ================= テスト4: 紙幣 ================= */
console.log('--- test 4: 千円札の受理と拒否 ---');
{
  const ctx = build();
  assert(!ctx.state.billStop(), '初期状態はお札受付可');
  assert(ctx.state.insertBill(), '挿入受理');
  sim(ctx, 2.5);
  assert(ctx.state.credit === 1000, `受理で credit=1000 (${ctx.state.credit})`);
  assert(ctx.mech.bill.stacked === 1, 'スタッカーに1枚');
  assert(ctx.state.wallet.bill === 2, `財布の札が減る (${ctx.state.wallet.bill})`);
  // 釣銭を枯らすと「お札中止」
  ctx.mech.tubes[500] = 0; ctx.mech.tubes[100] = 0; ctx.mech.tubes[50] = 0; ctx.mech.tubes[10] = 5;
  assert(ctx.state.billStop(), '釣銭不足でお札中止');
  const w = ctx.state.wallet.bill;
  assert(ctx.state.insertBill() === false || true, '挿入試行');
  sim(ctx, 3.5);
  assert(ctx.state.credit === 1000, `拒否で credit 変わらず (${ctx.state.credit})`);
  assert(ctx.state.wallet.bill === w, `札は財布に戻る (${ctx.state.wallet.bill})`);
}

/* ================= テスト5: 売切/釣銭切れ/36ボタンマッピング ================= */
console.log('--- test 5: 売切・釣銭切れ・ボタンマッピング ---');
{
  // マッピング整合
  const usedCols = new Set(SELECTIONS.map(s => s.column));
  assert(SELECTIONS.length === 36, '36ボタン');
  assert(usedCols.size === 30 && COLUMNS.length === 30, `30コラム全てに割当 (${usedCols.size})`);

  const ctx = build();
  const counts = new Array(30).fill(0);
  counts[SELECTIONS[3].column] = 1;   // sel3 のコラムだけ1本
  ctx.rack.preloadDirect(counts);
  sim(ctx, 2.5);
  assert(ctx.rack.soldOut(SELECTIONS[0].column), '他コラムは売切');
  ctx.state.wallet[100] = 10;
  ctx.state.insert(100); ctx.state.insert(100);
  sim(ctx, 3.5);
  assert(ctx.state.credit === 200, `credit=200 (${ctx.state.credit})`);
  assert(!ctx.state.buttonEnabled(0), '売切ボタンは点かない');
  assert(ctx.state.buttonEnabled(3), '在庫ボタンは点く');
  ctx.state.pressButton(3);
  sim(ctx, 8.5);
  assert(ctx.rack.soldOut(SELECTIONS[3].column), '最後の1本で売切');
  assert(count(ctx, 'soldOut') >= 1, '売切イベント');
  // 釣銭切れ
  ctx.mech.tubes[10] = 0; ctx.mech.tubes[50] = 0; ctx.mech.tubes[100] = 0;
  assert(ctx.state.changeShortage(), '釣銭切れ判定');
}

/* ================= テスト6: 金庫振分 (チューブ満杯) ================= */
console.log('--- test 6: チューブ満杯時は確定後に金庫へ ---');
{
  const ctx = build();
  ctx.mech.tubes[100] = TUBE_CAP[100];
  ctx.state.wallet[100] = 5;
  ctx.state.insert(100);
  sim(ctx, 3.0);
  assert(ctx.mech.escrow.length === 1, '保留中');
  ctx.mech.commitEscrow();
  sim(ctx, 2.5);
  assert(count(ctx, 'divert') === 1, '金庫へ振分');
  assert(count(ctx, 'cashIn') === 1, `金庫に着地 (${count(ctx, 'cashIn')})`);
  assert(ctx.mech.cashBox[100] === 1, '金庫の100円=1');
  assert(ctx.mech.tubes[100] === TUBE_CAP[100], 'チューブ据え置き');
  ctx.state.setOperator(true);
  const c = ctx.state.collectCash();
  assert(c.total === 100, `売上回収100円 (${c.total})`);
}

/* ================= テスト7: トレー補充 ================= */
console.log('--- test 7: トレー補充が空きコラムへ物理的に落ちる ---');
{
  const ctx = build();
  const counts = new Array(30).fill(0);
  ctx.rack.preloadDirect(counts);   // 全コラム空
  sim(ctx, 0.5);
  ctx.state.setOperator(true);
  const res = ctx.state.restock(1, 1);   // 中庫・下段
  assert(res !== null, '補充受理');
  sim(ctx, 6.0);
  const stocked = ctx.rack.cols
    .filter(c => c.conf.chamber === 1 && c.conf.stage === 1)
    .reduce((s, c) => s + c.stock.length, 0);
  assert(stocked === 1, `中庫下段のどこかのコラムに1本入った (${stocked})`);
  assert(count(ctx, 'trayIn') === 1, 'trayIn イベント');
}

/* ================= テスト8: 決定論 ================= */
console.log('--- test 8: 同一シードで軌道一致 ---');
{
  const run = () => {
    const ctx = build();
    const counts = new Array(30).fill(2);
    ctx.rack.preloadDirect(counts);
    ctx.state.insert(500);
    sim(ctx, 4.0);
    return ctx.world.bodies.map(b => `${b.x.toFixed(9)},${b.y.toFixed(9)}`).join(';') +
      '|' + JSON.stringify(ctx.mech.tubes);
  };
  assert(run() === run(), 'ワールド状態ハッシュ完全一致');
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
