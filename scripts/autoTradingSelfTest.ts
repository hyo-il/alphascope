/**
 * 계좌별 자동매매 자체 점검.
 * 실행: npm run autotrade:test
 *
 * 왜 필요한가 — 하드 손절·트레일링 스톱은 **가격이 실제로 빠져야** 발동한다.
 * 장중에 손실 난 포지션이 생기기를 기다릴 수는 없으므로, **임시 계좌**를 만들어
 * 평균 매입가를 손실 상태로 바꿔 놓고 청산 로직을 돌린다.
 *
 * ⚠️ 임시 계좌는 끝나고 지운다. 사용자의 계좌는 건드리지 않는다.
 * ⚠️ 여기서도 주문은 모의 계좌(SQLite)에만 들어간다.
 */
import { getDb, loadCandles } from '../server/db';
import {
  createAccount,
  createOrder,
  deleteAccount,
  listPositions,
  listTrades,
} from '../server/paperTradingService';
import { runExitChecks, tryBuy } from '../server/autoTrading/engine';
import { dailyLossBlock, evaluateDailyLoss, setEarningsLookupForTest, strategyDay } from '../server/autoTrading/guards';
import { decideRule } from '../server/autoTrading/ruleEngine';
import { explainNote } from '../src/utils/autoTradeExplain';
import type { IndicatorSeries } from '../src/types/chart';
import { getStrategyStatus } from '../server/autoTrading/scheduler';
import { marketDate } from '../src/utils/marketDate';
import { deleteStrategy, getPeak, normalizeStrategy, saveStrategy, updatePeak } from '../server/autoTrading/store';
import type { AccountStrategy } from '../src/types/autoTrading';

const SYMBOL = 'AAPL';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

/** 평균 매입가를 올려 손실 상태를 만든다 (가격이 빠지기를 기다리지 않기 위해) */
function inflateAvgPrice(accountId: number, symbol: string, factor: number): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT avg_price, quantity FROM paper_positions WHERE account_id = ? AND symbol = ?`)
    .get(accountId, symbol) as { avg_price: number; quantity: number } | undefined;
  if (!row) throw new Error('포지션이 없습니다');
  const next = row.avg_price * factor;
  db.prepare(
    `UPDATE paper_positions SET avg_price = ?, total_cost = ? WHERE account_id = ? AND symbol = ?`,
  ).run(next, next * row.quantity, accountId, symbol);
  return next;
}

/** 주말을 건너뛰며 N 거래일 뒤 날짜 */
function addTradingDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  console.log('계좌별 자동매매 자체 점검 — 임시 계좌를 만들어 청산 로직을 검증합니다\n');

  const account = createAccount({
    name: `__자동매매 점검 ${Date.now()}`,
    initialBalance: 100_000,
    currency: 'USD',
  });
  console.log(`임시 계좌 #${account.id} 생성 (USD 100,000)\n`);

  try {
    const base: AccountStrategy = normalizeStrategy(account.id, {
      enabled: true,
      mode: 'rule',
      symbols: [SYMBOL],
      hardStopLossPercent: 7,
      trailingStopEnabled: false,
      trailingStopPercent: 8,
    });
    saveStrategy(account.id, base);

    // ── 1. 하드 손절 ────────────────────────────────
    console.log('1) 손절 (-7%)');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });

    // 손실이 기준에 못 미치면 청산되지 않아야 한다 (-3% 상태)
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.97);
    const notHit = await runExitChecks(base);
    check('손실 -3% 는 청산하지 않는다', notHit.length === 0, `주문 ${notHit.length}건`);

    // 기준을 넘기면 즉시 전량 청산
    inflateAvgPrice(account.id, SYMBOL, 0.97 / 0.9);
    const hit = await runExitChecks(base);
    const stopNote = hit.find((n) => n.action === 'SELL');
    check('손실 -10% 는 전량 청산한다', Boolean(stopNote), stopNote?.reason ?? '주문 없음');
    check('사유에 "손절" 이 적힌다 (v2.40.0 용어 — 예전 "하드 손절")', Boolean(stopNote?.reason.startsWith('손절 ')) && stopNote?.code === 'hard_stop', stopNote?.reason ?? '');
    check('포지션이 비었다', listPositions(account.id).every((p) => p.symbol !== SYMBOL || p.quantity === 0));

    // ── 2. 트레일링 스톱 ────────────────────────────
    console.log('\n2) 트레일링 (-8%)');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });
    const trailing: AccountStrategy = { ...base, trailingStopEnabled: true, trailingStopPercent: 8 };

    // 고점을 현재가보다 20% 높게 박아 둔다 = 고점 대비 -16.7% 하락 상태
    const position = listPositions(account.id).find((p) => p.symbol === SYMBOL)!;
    updatePeak(account.id, SYMBOL, position.avgPrice * 1.2);
    const trailed = await runExitChecks(trailing);
    const trailNote = trailed.find((n) => n.action === 'SELL');
    check('고점 대비 -8% 이상 하락하면 청산한다', Boolean(trailNote), trailNote?.reason ?? '주문 없음');
    check('사유에 "트레일링" 이 적힌다 (v2.40.0 용어 — 예전 "트레일링 스톱")', Boolean(trailNote?.reason.startsWith('트레일링 — ')) && trailNote?.code === 'trailing', trailNote?.reason ?? '');

    // ── 3. 트레일링이 꺼져 있으면 작동하지 않는다 ──
    console.log('\n3) 트레일링 꺼짐');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });
    updatePeak(account.id, SYMBOL, listPositions(account.id).find((p) => p.symbol === SYMBOL)!.avgPrice * 1.5);
    const off = await runExitChecks(base); // trailingStopEnabled: false
    check('꺼져 있으면 고점이 높아도 청산하지 않는다', off.length === 0, `주문 ${off.length}건`);

    // ── 4. 사유가 거래내역에 남는다 ────────────────
    console.log('\n4) 거래내역의 사유');
    const trades = listTrades(account.id);
    const sells = trades.filter((t) => t.side === 'SELL');
    check('매도 거래가 기록됐다', sells.length >= 2, `${sells.length}건`);
    check('모든 매도에 사유가 있다', sells.every((t) => Boolean(t.reason)), sells.map((t) => t.reason).join(' | ').slice(0, 120));

    // ── 5. 실적 발표 직전 신규 매수 회피 (v2.16.0) ──
    console.log('\n5) 실적 발표 직전 매수 회피 (3거래일)');
    // 예산 계산용 가격 — 캐시된 일봉 종가 (점검에 실시간 시세가 필요 없다)
    const price = loadCandles(SYMBOL, '1d', 1).at(-1)?.close ?? 300;
    const guarded: AccountStrategy = { ...base, earningsBlackoutDays: 3, dailyLossLimitPercent: 0 };
    saveStrategy(account.id, guarded);
    // 가짜 실적일 = 오늘로부터 2거래일 뒤 — ⚠️ 실제 DB 의 실적 달력은 건드리지 않는다(v2.41.0). 판정 함수에 날짜를 넣는다
    const marketToday = marketDate(Date.now(), SYMBOL);
    const fakeEarnings = (date: string | null, isEstimate = true) =>
      setEarningsLookupForTest((sym) => (sym.toUpperCase() === SYMBOL && date ? { date, isEstimate } : null));
    try {
      fakeEarnings(addTradingDays(marketToday, 2));
      const skip = await tryBuy(guarded, SYMBOL, price, '점검용 자동 매수', 0);
      check('실적 2거래일 전에는 새로 사지 않는다', skip.action === 'HOLD' && !skip.orderId, skip.reason);
      check('사유에 실적일·거래일이 적힌다', skip.reason.includes('실적 발표') && skip.reason.includes('2거래일 전'), skip.reason);

      const off0 = await tryBuy({ ...guarded, earningsBlackoutDays: 0 }, SYMBOL, price, '점검용 자동 매수', 0);
      check('설정 0 이면 막지 않는다', off0.action === 'BUY', off0.reason);

      fakeEarnings(null);
      const unknown = await tryBuy(guarded, SYMBOL, price, '점검용 자동 매수', 0);
      check('실적일을 모르면 사되 사유에 남긴다', unknown.action === 'BUY' && unknown.reason.includes('실적일 미확인'), unknown.reason);

      // 실적 회피 중에도 손절은 돈다
      fakeEarnings(addTradingDays(marketToday, 1), false);
      inflateAvgPrice(account.id, SYMBOL, 1 / 0.85);
      const stopDuring = await runExitChecks(guarded);
      check('실적 회피 중에도 손절은 돈다', stopDuring.some((n) => n.action === 'SELL'), stopDuring.map((n) => n.reason).join(' | '));

      // ── 5-2. 매수 신호가 있는데 실적 회피 기간이면 (v2.41.0 — 화면으로는 신호가 나와야만 확인할 수 있어 여기서 본다) ──
      console.log('\n5-2) 매수 신호(골든크로스) + 실적 회피 기간');
      // 봉 0 → 1 에서 5일선이 20일선을 아래→위로 통과하는 지표(합성)
      const series = { sma5: [9, 11], sma20: [10, 10], sma60: [null, null], sma120: [null, null], rsi14: [50, 52] } as unknown as IndicatorSeries;
      const rule = { maShort: 5, maLong: 20, rsiBuyBelow: 30, rsiSellAbove: 70, useMaCross: true, useRsi: false };
      const signal = decideRule(series, 1, rule, false, marketToday);
      check('합성 지표에서 매수 신호가 나온다', signal.action === 'BUY' && signal.code === 'golden', signal.reason);
      fakeEarnings(addTradingDays(marketToday, 2));
      const ruleStrategy: AccountStrategy = { ...guarded, mode: 'rule', rule };
      const blocked = await tryBuy(ruleStrategy, SYMBOL, price, signal.reason, 0, signal.code);
      check('신호가 있어도 회피 기간이면 사지 않는다 (code earnings_blackout)', blocked.action === 'HOLD' && blocked.code === 'earnings_blackout' && !blocked.orderId, `${blocked.code} · ${blocked.reason}`);
      const easy = explainNote({ ...blocked, symbol: SYMBOL }, SYMBOL, ruleStrategy);
      check('쉬운 문장이 나온다', Boolean(easy && easy.includes('실적')), easy ?? '(없음)');
      const allowed = await tryBuy({ ...ruleStrategy, earningsBlackoutDays: 0 }, SYMBOL, price, signal.reason, 0, signal.code);
      check('회피 일수 0(끔)이면 신호대로 산다', allowed.action === 'BUY' && allowed.code === 'golden', `${allowed.code} · ${allowed.reason}`);
      fakeEarnings(null);
      const unknown2 = await tryBuy(ruleStrategy, SYMBOL, price, signal.reason, 0, signal.code);
      check('실적일을 모르면 사되 "실적일 미확인"', unknown2.action === 'BUY' && unknown2.reason.includes('실적일 미확인'), unknown2.reason);
    } finally {
      setEarningsLookupForTest(null);
    }

    // ── 6. 하루 손실 한도 (킬 스위치) ───────────────
    console.log('\n6) 하루 손실 한도 (-2%)');
    const kill: AccountStrategy = {
      ...base,
      enabled: true,
      marketHoursOnly: false,
      earningsBlackoutDays: 0,
      dailyLossLimitPercent: 2,
    };
    saveStrategy(account.id, kill);
    const now = Date.now();
    const value = (v: number) => async () => v;
    await evaluateDailyLoss(kill, now, value(100_000)); // 그 거래일의 첫 평가액 = 기준
    const small = await evaluateDailyLoss(kill, now + 60_000, value(99_000));
    check('-1% 는 한도에 닿지 않는다', small?.hit === false, `${small?.drawdownPercent.toFixed(2)}%`);
    const big = await evaluateDailyLoss(kill, now + 120_000, value(97_000));
    check('-3% 면 한도에 닿는다', big?.hit === true, `${big?.drawdownPercent.toFixed(2)}%`);
    const blockedBuy = await tryBuy(kill, SYMBOL, price, '점검용 자동 매수', 0);
    check('닿으면 신규 매수를 막는다', blockedBuy.action === 'HOLD' && blockedBuy.reason.includes('하루 손실 한도'), blockedBuy.reason);
    const status = getStrategyStatus(account.id);
    check('상태가 daily_loss(⚠ 멈춤)', status.blockedKind === 'daily_loss', status.blockedReason ?? '');

    await createOrder({ accountId: account.id, symbol: SYMBOL, side: 'BUY', orderType: 'MARKET', quantity: 5, reason: '점검용 매수' });
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.85);
    const stopUnderKill = await runExitChecks(kill);
    check('킬 스위치 중에도 손절·청산은 돈다', stopUnderKill.some((n) => n.action === 'SELL'), stopUnderKill.map((n) => n.reason).join(' | '));

    const recovered = await evaluateDailyLoss(kill, now + 180_000, value(99_900));
    check('같은 거래일에는 회복해도 풀리지 않는다', recovered?.hit === true, `${recovered?.drawdownPercent.toFixed(2)}%`);

    // 다음 거래일로 — 날짜가 바뀌면 새 기준으로 저절로 풀린다
    let next = now;
    const today = strategyDay(kill, now);
    while (strategyDay(kill, next) === today) next += 6 * 60 * 60_000;
    const nextDay = await evaluateDailyLoss(kill, next, value(97_000));
    check('다음 거래일에는 풀린다', nextDay?.hit === false && dailyLossBlock(kill, next) === null, `${strategyDay(kill, next)} 기준 ${nextDay?.base}`);
    await evaluateDailyLoss({ ...kill, dailyLossLimitPercent: 0 }, next); // 기록 정리

    // ── 7. 익절 (v2.39.0, 기본 꺼짐) ─────────────────
    console.log('\n7) 익절 (기본 꺼짐 · 기준 +10%)');
    const defaults = normalizeStrategy(account.id, {});
    check('기본값은 꺼짐 · 10%', defaults.takeProfitEnabled === false && defaults.takeProfitPercent === 10);
    check('범위는 1~100 으로 조인다', normalizeStrategy(account.id, { takeProfitPercent: 150 }).takeProfitPercent === 100);
    const leftover = listPositions(account.id).find((p) => p.symbol === SYMBOL && p.quantity > 0);
    if (leftover) {
      await createOrder({ accountId: account.id, symbol: SYMBOL, side: 'SELL', orderType: 'MARKET', quantity: leftover.quantity, reason: '점검 정리' });
    }
    await createOrder({ accountId: account.id, symbol: SYMBOL, side: 'BUY', orderType: 'MARKET', quantity: 10, reason: '점검용 매수' });
    inflateAvgPrice(account.id, SYMBOL, 1 / 1.15); // 평균 매입가를 낮춰 +15% 수익 상태
    const tpOff = await runExitChecks({ ...base, takeProfitEnabled: false, takeProfitPercent: 10 });
    check('꺼져 있으면 +15% 여도 팔지 않는다', tpOff.length === 0, `주문 ${tpOff.length}건`);
    const below = await runExitChecks({ ...base, takeProfitEnabled: true, takeProfitPercent: 20 });
    check('+15% 는 기준 +20% 에 못 미쳐 팔지 않는다', below.length === 0, `주문 ${below.length}건`);
    updatePeak(account.id, SYMBOL, 999_999); // 청산하면 트레일링 고점 기록도 버리는지
    const tp = await runExitChecks({ ...base, takeProfitEnabled: true, takeProfitPercent: 10 });
    const tpNote = tp.find((n) => n.action === 'SELL');
    check('+15% 면 기준 +10% 에 닿아 전량 청산한다', Boolean(tpNote) && tpNote?.code === 'take_profit', tpNote?.reason ?? '주문 없음');
    check('포지션이 비었다', listPositions(account.id).every((p) => p.symbol !== SYMBOL || p.quantity === 0));
    check('트레일링 고점 기록을 버렸다', getPeak(account.id, SYMBOL) == null);
  } finally {
    deleteStrategy(account.id);
    deleteAccount(account.id);
    console.log(`\n임시 계좌 #${account.id} 삭제 완료`);
  }

  console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
  if (fail > 0) process.exit(1);
}

void main().catch((error) => {
  console.error('점검 실패:', error);
  process.exit(1);
});
