/**
 * 계좌별 자동매매 자체 점검 (v2.44.0 — 매매 규칙 엔진).
 * 실행: npm run autotrade:test
 *
 * 왜 필요한가 — 손절·트레일링은 **가격이 실제로 빠져야** 발동한다. 손실 난 포지션이 생기기를 기다릴 수 없으므로
 * **임시 계좌**(와 임시 매매 규칙)를 만들어 평균 매입가를 바꿔 놓고 청산 로직을 돌린다.
 * 청산·신호는 **그 종목 시장이 열려 있을 때만** 돌므로, 시험은 미국 장이 열려 있는 시각(`OPEN_US`)을 넣어 부른다.
 *
 * ⚠️ 임시 계좌·임시 규칙은 끝나고 지운다. 사용자의 계좌·규칙은 건드리지 않는다.
 * ⚠️ 여기서도 주문은 모의 계좌(SQLite)에만 들어간다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(v2.44.2)
import { getDb, loadCandles } from '../server/db';
import { createAccount, createOrder, deleteAccount, listPositions, listTrades } from '../server/paperTradingService';
import { runExitChecks, runSignalChecks, tryBuy } from '../server/autoTrading/engine';
import { dailyLossBlock, evaluateDailyLoss, setEarningsLookupForTest, strategyDay } from '../server/autoTrading/guards';
import { evaluateRule } from '../server/rules/engine';
import { createRule, deleteRule } from '../server/rules/store';
import { isMarketOpen, nextMarketOpen, setClosedLookupForTest } from '../server/marketHours';
import { explainNote } from '../src/utils/autoTradeExplain';
import type { IndicatorSeries } from '../src/types/chart';
import type { Candle } from '../src/types/toss';
import { getStrategyStatus } from '../server/autoTrading/scheduler';
import { marketDate } from '../src/utils/marketDate';
import {
  StrategyRuleError,
  deleteStrategy,
  getJudgedDay,
  getPeak,
  getStopDay,
  getStrategy,
  normalizeStrategy,
  saveStrategy,
  setJudgedDay,
  updatePeak,
} from '../server/autoTrading/store';
import type { AccountStrategy } from '../src/types/autoTrading';
import { defaultRuleBody, emptyRuleBody, type RuleBody } from '../src/types/tradingRule';

const SYMBOL = 'AAPL';
/** 미국 정규장이 열려 있는 시각 (수요일 11:00 ET) — 청산·신호 판단은 시장이 열려 있을 때만 돈다 */
const OPEN_US = new Date('2026-10-14T15:00:00Z');
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

/** 평균 매입가를 바꿔 손익 상태를 만든다 (가격이 움직이기를 기다리지 않기 위해) */
function inflateAvgPrice(accountId: number, symbol: string, factor: number): number {
  const db = getDb();
  const row = db.prepare(`SELECT avg_price, quantity FROM paper_positions WHERE account_id = ? AND symbol = ?`).get(accountId, symbol) as
    | { avg_price: number; quantity: number }
    | undefined;
  if (!row) throw new Error('포지션이 없습니다');
  const next = row.avg_price * factor;
  db.prepare(`UPDATE paper_positions SET avg_price = ?, total_cost = ? WHERE account_id = ? AND symbol = ?`).run(next, next * row.quantity, accountId, symbol);
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

/** 규칙 하나를 매도 조건만 바꿔서 */
function ruleWith(sell: Partial<RuleBody['sell']>): RuleBody {
  const r = defaultRuleBody();
  r.sell = { ...r.sell, ...sell };
  return r;
}

const buy = (accountId: number, quantity = 10) =>
  createOrder({ accountId, symbol: SYMBOL, side: 'BUY', orderType: 'MARKET', quantity, reason: '점검용 매수' });

async function main(): Promise<void> {
  console.log('계좌별 자동매매 자체 점검 — 임시 계좌·임시 규칙으로 청산·신호·안전장치를 검증합니다\n');

  const account = createAccount({ name: `__자동매매 점검 ${Date.now()}`, initialBalance: 100_000, currency: 'USD' });
  const tempRule = createRule(`__점검 규칙 ${Date.now()}`, defaultRuleBody());
  console.log(`임시 계좌 #${account.id} · 임시 규칙 #${tempRule.id}\n`);
  const exists = (id: number) => id === tempRule.id;

  try {
    const base: AccountStrategy = normalizeStrategy(account.id, { enabled: true, ruleId: tempRule.id, symbols: [SYMBOL] });
    saveStrategy(account.id, base, exists);
    const stop7 = ruleWith({ stopLoss: { on: true, percent: 7 }, trailing: { on: false, percent: 8 }, takeProfit: { on: false, percent: 10 } });

    // ── 0. 시장 열림 (국내·미국) ─────────────────────
    console.log('0) 시장 열림');
    check('미국 수요일 11:00 ET 열림', isMarketOpen('US', OPEN_US));
    check('미국 수요일 09:00 ET 닫힘(개장 전)', !isMarketOpen('US', new Date('2026-10-14T13:00:00Z')));
    check('미국 토요일 닫힘', !isMarketOpen('US', new Date('2026-10-17T15:00:00Z')));
    check('국내 수요일 10:00 KST 열림', isMarketOpen('KR', new Date('2026-10-14T01:00:00Z')));
    check('국내 수요일 15:40 KST 닫힘(마감 뒤)', !isMarketOpen('KR', new Date('2026-10-14T06:40:00Z')));
    check('국내 일요일 닫힘', !isMarketOpen('KR', new Date('2026-10-18T01:00:00Z')));

    // ── 0-2. 다음 개장 시각 (v2.44.1 — 서버가 휴장일까지 본다). 휴장일은 시험 안에서 넣는다(실제 DB 달력은 건드리지 않는다) ──
    console.log('\n0-2) 다음 개장 시각 (휴장일 반영)');
    const fakeHolidays = new Set(['US:2026-11-26', 'KR:2026-10-09']);
    setClosedLookupForTest((market, day) => {
      const w = new Date(`${day}T12:00:00Z`).getUTCDay();
      return w === 0 || w === 6 || fakeHolidays.has(`${market}:${day}`);
    });
    try {
      const iso = (d: Date) => d.toISOString();
      const us1 = nextMarketOpen('US', new Date('2026-11-25T21:00:00Z')); // 휴장일(11-26 목) 전날 마감 뒤
      check('미국: 휴장일 전날 마감 뒤 → 휴장일 다음 영업일(11-27 09:30 ET)', iso(us1) === '2026-11-27T14:30:00.000Z', iso(us1));
      const us2 = nextMarketOpen('US', new Date('2026-10-17T15:00:00Z')); // 토요일
      check('미국: 주말 → 월요일(10-19 09:30 ET)', iso(us2) === '2026-10-19T13:30:00.000Z', iso(us2));
      const us3 = nextMarketOpen('US', new Date('2026-10-14T12:00:00Z')); // 수요일 개장 전
      check('미국: 평일 개장 전 → 그날 09:30 ET', iso(us3) === '2026-10-14T13:30:00.000Z', iso(us3));
      const kr1 = nextMarketOpen('KR', new Date('2026-10-08T07:00:00Z')); // 휴장일(10-09 금) 전날 마감 뒤
      check('국내: 휴장일 전날 마감 뒤 → 휴장일 다음 영업일(10-12 월 09:00 KST)', iso(kr1) === '2026-10-12T00:00:00.000Z', iso(kr1));
      const kr2 = nextMarketOpen('KR', new Date('2026-10-17T03:00:00Z')); // 토요일
      check('국내: 주말 → 월요일(10-19 09:00 KST)', iso(kr2) === '2026-10-19T00:00:00.000Z', iso(kr2));
      check('휴장일에는 열려 있지 않다', !isMarketOpen('KR', new Date('2026-10-09T02:00:00Z')) && !isMarketOpen('US', new Date('2026-11-26T16:00:00Z')));
    } finally {
      setClosedLookupForTest(null);
    }

    // ── 1. 손절 ──────────────────────────────────────
    console.log('\n1) 손절 (규칙 −7%)');
    await buy(account.id);
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.97);
    const notHit = await runExitChecks(base, stop7, OPEN_US);
    check('손실 −3% 는 청산하지 않는다', notHit.length === 0, `주문 ${notHit.length}건`);
    const closedHours = await runExitChecks(base, stop7, new Date('2026-10-17T15:00:00Z'));
    inflateAvgPrice(account.id, SYMBOL, 0.97 / 0.9);
    const closedHit = await runExitChecks(base, stop7, new Date('2026-10-17T15:00:00Z'));
    check('시장이 닫혀 있으면 손실 −10% 여도 청산하지 않는다', closedHours.length === 0 && closedHit.length === 0, `주문 ${closedHit.length}건`);
    const hit = await runExitChecks(base, stop7, OPEN_US);
    const stopNote = hit.find((n) => n.action === 'SELL');
    check('손실 −10% 는 전량 청산한다', Boolean(stopNote), stopNote?.reason ?? '주문 없음');
    check('사유 "손절" · code hard_stop', Boolean(stopNote?.reason.startsWith('손절 ')) && stopNote?.code === 'hard_stop', stopNote?.reason ?? '');
    check('손절한 날(그 종목 시장 날짜)을 남긴다', getStopDay(account.id, SYMBOL) === marketDate(OPEN_US.getTime(), SYMBOL), String(getStopDay(account.id, SYMBOL)));
    check('포지션이 비었다', listPositions(account.id).every((p) => p.symbol !== SYMBOL || p.quantity === 0));

    // ── 1-2. 손절 뒤 다시 매수 대기 (엔진에 lastStopDate 가 넘어가는지) ──
    console.log('\n1-2) 손절 뒤 다시 매수 대기 (5거래일)');
    const waitRun = await runSignalChecks(base, defaultRuleBody(), { now: OPEN_US, force: true });
    const waitNote = waitRun.notes.find((n) => n.symbol === SYMBOL);
    check('손절 당일 판단은 reentry_wait', waitNote?.code === 'reentry_wait', waitNote ? `${waitNote.code} · ${waitNote.reason}` : waitRun.errors.join(' / '));

    // ── 1-3. 손절이 꺼진 규칙 ────────────────────────
    console.log('\n1-3) 손절 꺼진 규칙');
    await buy(account.id);
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.85);
    const noStop = await runExitChecks(base, ruleWith({ stopLoss: { on: false, percent: 7 } }), OPEN_US);
    check('손절이 꺼져 있으면 −15% 여도 팔지 않는다', noStop.length === 0, `주문 ${noStop.length}건`);

    // ── 2. 트레일링 ─────────────────────────────────
    console.log('\n2) 트레일링 (−8%)');
    const trailRule = ruleWith({ stopLoss: { on: false, percent: 7 }, trailing: { on: true, percent: 8 } });
    const position = listPositions(account.id).find((p) => p.symbol === SYMBOL)!;
    updatePeak(account.id, SYMBOL, position.avgPrice * 1.5);
    const trailed = await runExitChecks(base, trailRule, OPEN_US);
    const trailNote = trailed.find((n) => n.action === 'SELL');
    check('고점 대비 −8% 이상 하락하면 청산한다', Boolean(trailNote), trailNote?.reason ?? '주문 없음');
    check('사유 "트레일링" · code trailing', Boolean(trailNote?.reason.startsWith('트레일링 — ')) && trailNote?.code === 'trailing', trailNote?.reason ?? '');
    check('트레일링 매도는 손절 날짜를 바꾸지 않는다', getStopDay(account.id, SYMBOL) === marketDate(OPEN_US.getTime(), SYMBOL));

    // ── 3. 트레일링이 꺼져 있으면 작동하지 않는다 ──
    console.log('\n3) 트레일링 꺼짐');
    await buy(account.id);
    updatePeak(account.id, SYMBOL, listPositions(account.id).find((p) => p.symbol === SYMBOL)!.avgPrice * 1.5);
    const off = await runExitChecks(base, stop7, OPEN_US);
    check('꺼져 있으면 고점이 높아도 청산하지 않는다', off.length === 0, `주문 ${off.length}건`);

    // ── 4. 사유가 거래내역에 남는다 ────────────────
    console.log('\n4) 거래내역의 사유');
    const sells = listTrades(account.id).filter((t) => t.side === 'SELL');
    check('매도 거래가 기록됐다', sells.length >= 2, `${sells.length}건`);
    check('모든 매도에 사유가 있다', sells.every((t) => Boolean(t.reason)), sells.map((t) => t.reason).join(' | ').slice(0, 120));

    // ── 5. 실적 발표 직전 신규 매수 회피 ──
    console.log('\n5) 실적 발표 직전 매수 회피 (3거래일)');
    const price = loadCandles(SYMBOL, '1d', 1).at(-1)?.close ?? 300;
    const guarded: AccountStrategy = { ...base, earningsBlackoutDays: 3, dailyLossLimitPercent: 0 };
    saveStrategy(account.id, guarded, exists);
    const marketToday = marketDate(Date.now(), SYMBOL);
    const fakeEarnings = (date: string | null, isEstimate = true) =>
      setEarningsLookupForTest((sym) => (sym.toUpperCase() === SYMBOL && date ? { date, isEstimate } : null));
    const rule = defaultRuleBody();
    try {
      fakeEarnings(addTradingDays(marketToday, 2));
      const skip = await tryBuy(guarded, rule, SYMBOL, price, '점검용 자동 매수', 0);
      check('실적 2거래일 전에는 새로 사지 않는다', skip.action === 'HOLD' && !skip.orderId, skip.reason);
      check('사유에 실적일·거래일이 적힌다', skip.reason.includes('실적 발표') && skip.reason.includes('2거래일 전'), skip.reason);
      const off0 = await tryBuy({ ...guarded, earningsBlackoutDays: 0 }, rule, SYMBOL, price, '점검용 자동 매수', 0);
      check('설정 0 이면 막지 않는다', off0.action === 'BUY', off0.reason);
      fakeEarnings(null);
      const unknown = await tryBuy(guarded, rule, SYMBOL, price, '점검용 자동 매수', 0);
      check('실적일을 모르면 사되 사유에 남긴다', unknown.action === 'BUY' && unknown.reason.includes('실적일 미확인'), unknown.reason);
      fakeEarnings(addTradingDays(marketToday, 1), false);
      inflateAvgPrice(account.id, SYMBOL, 1 / 0.85);
      const stopDuring = await runExitChecks(guarded, stop7, OPEN_US);
      check('실적 회피 중에도 손절은 돈다', stopDuring.some((n) => n.action === 'SELL'), stopDuring.map((n) => n.reason).join(' | '));

      // ── 5-2. 매수 신호 + 실적 회피 기간 ──
      console.log('\n5-2) 매수 신호(이동평균 교차 점수) + 실적 회피 기간');
      const day = 86_400_000;
      const candles: Candle[] = [0, 1].map((k) => ({ timestamp: Date.parse('2026-10-12T04:00:00Z') + k * day, open: 100, high: 101, low: 99, close: 100, volume: 1 }));
      const series = { sma5: [9, 11], sma20: [10, 10], sma60: [null, null], sma120: [null, null], rsi14: [50, 52] } as unknown as IndicatorSeries;
      const crossRule = emptyRuleBody();
      crossRule.buy.maCross = { on: true, points: 1, short: 5, long: 20 };
      crossRule.buy.minScore = 1;
      const signal = evaluateRule({ symbol: SYMBOL, candles, series }, 1, crossRule, { held: false }, { testOnlySkipRrGuard: true });
      check('합성 지표에서 매수 신호가 나온다', signal.action === 'BUY' && signal.code === 'score_buy', signal.reasons[0]);
      fakeEarnings(addTradingDays(marketToday, 2));
      const blocked = await tryBuy(guarded, crossRule, SYMBOL, price, signal.reasons[0], 0, signal.code);
      check('신호가 있어도 회피 기간이면 사지 않는다 (code earnings_blackout)', blocked.action === 'HOLD' && blocked.code === 'earnings_blackout' && !blocked.orderId, `${blocked.code} · ${blocked.reason}`);
      const easy = explainNote({ ...blocked, symbol: SYMBOL }, SYMBOL, guarded, crossRule);
      check('쉬운 문장이 나온다', Boolean(easy && easy.includes('실적')), easy ?? '(없음)');
      const allowed = await tryBuy({ ...guarded, earningsBlackoutDays: 0 }, crossRule, SYMBOL, price, signal.reasons[0], 0, signal.code);
      check('회피 일수 0(끔)이면 신호대로 산다', allowed.action === 'BUY' && allowed.code === 'score_buy', `${allowed.code} · ${allowed.reason}`);
      fakeEarnings(null);
      const unknown2 = await tryBuy(guarded, crossRule, SYMBOL, price, signal.reasons[0], 0, signal.code);
      check('실적일을 모르면 사되 "실적일 미확인"', unknown2.action === 'BUY' && unknown2.reason.includes('실적일 미확인'), unknown2.reason);
    } finally {
      setEarningsLookupForTest(null);
    }

    // ── 6. 하루 손실 한도 (킬 스위치) ───────────────
    console.log('\n6) 하루 손실 한도 (−2%)');
    const kill: AccountStrategy = { ...base, enabled: true, earningsBlackoutDays: 0, dailyLossLimitPercent: 2 };
    saveStrategy(account.id, kill, exists);
    const now = Date.now();
    const value = (v: number) => async () => v;
    await evaluateDailyLoss(kill, now, value(100_000));
    const small = await evaluateDailyLoss(kill, now + 60_000, value(99_000));
    check('−1% 는 한도에 닿지 않는다', small?.hit === false, `${small?.drawdownPercent.toFixed(2)}%`);
    const big = await evaluateDailyLoss(kill, now + 120_000, value(97_000));
    check('−3% 면 한도에 닿는다', big?.hit === true, `${big?.drawdownPercent.toFixed(2)}%`);
    const blockedBuy = await tryBuy(kill, rule, SYMBOL, price, '점검용 자동 매수', 0);
    check('닿으면 신규 매수를 막는다', blockedBuy.action === 'HOLD' && blockedBuy.reason.includes('하루 손실 한도'), blockedBuy.reason);
    const status = getStrategyStatus(account.id);
    check('상태가 daily_loss(⚠ 멈춤)', status.blockedKind === 'daily_loss', status.blockedReason ?? '');
    await buy(account.id, 5);
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.85);
    const stopUnderKill = await runExitChecks(kill, stop7, OPEN_US);
    check('킬 스위치 중에도 손절·청산은 돈다', stopUnderKill.some((n) => n.action === 'SELL'), stopUnderKill.map((n) => n.reason).join(' | '));
    const recovered = await evaluateDailyLoss(kill, now + 180_000, value(99_900));
    check('같은 거래일에는 회복해도 풀리지 않는다', recovered?.hit === true, `${recovered?.drawdownPercent.toFixed(2)}%`);
    let next = now;
    const today = strategyDay(kill, now);
    while (strategyDay(kill, next) === today) next += 6 * 60 * 60_000;
    const nextDay = await evaluateDailyLoss(kill, next, value(97_000));
    check('다음 거래일에는 풀린다', nextDay?.hit === false && dailyLossBlock(kill, next) === null, `${strategyDay(kill, next)} 기준 ${nextDay?.base}`);
    await evaluateDailyLoss({ ...kill, dailyLossLimitPercent: 0 }, next);

    // ── 7. 익절 ──────────────────────────────────────
    console.log('\n7) 익절 (규칙 +10%)');
    const leftover = listPositions(account.id).find((p) => p.symbol === SYMBOL && p.quantity > 0);
    if (leftover) await createOrder({ accountId: account.id, symbol: SYMBOL, side: 'SELL', orderType: 'MARKET', quantity: leftover.quantity, reason: '점검 정리' });
    await buy(account.id);
    inflateAvgPrice(account.id, SYMBOL, 1 / 1.15);
    const tpOff = await runExitChecks(base, ruleWith({ stopLoss: { on: true, percent: 7 }, takeProfit: { on: false, percent: 10 } }), OPEN_US);
    check('꺼져 있으면 +15% 여도 팔지 않는다', tpOff.length === 0, `주문 ${tpOff.length}건`);
    const below = await runExitChecks(base, ruleWith({ takeProfit: { on: true, percent: 20 } }), OPEN_US);
    check('+15% 는 기준 +20% 에 못 미쳐 팔지 않는다', below.length === 0, `주문 ${below.length}건`);
    updatePeak(account.id, SYMBOL, 999_999);
    const tp = await runExitChecks(base, ruleWith({ takeProfit: { on: true, percent: 10 } }), OPEN_US);
    const tpNote = tp.find((n) => n.action === 'SELL');
    check('+15% 면 기준 +10% 에 닿아 전량 청산한다', Boolean(tpNote) && tpNote?.code === 'take_profit', tpNote?.reason ?? '주문 없음');
    check('포지션이 비었다', listPositions(account.id).every((p) => p.symbol !== SYMBOL || p.quantity === 0));
    check('트레일링 고점 기록을 버렸다', getPeak(account.id, SYMBOL) == null);

    // ── 8. 하루 한 번 판단 ───────────────────────────
    console.log('\n8) 하루 한 번 판단');
    const once = { ...base, earningsBlackoutDays: 0, dailyLossLimitPercent: 0 };
    setJudgedDay(account.id, SYMBOL, '2000-01-01'); // 1-2 의 수동 실행(force)도 오늘 판단으로 남았다 — 지우고 시작
    const first = await runSignalChecks(once, rule, { now: OPEN_US });
    check('시장이 열려 있으면 판단한다', first.evaluated === 1 || first.errors.length > 0, `판단 ${first.evaluated} · ${first.notes.map((n) => n.code).join(',')} ${first.errors.join(' / ')}`);
    check('그 시장 날짜를 남긴다', getJudgedDay(account.id, SYMBOL) === marketDate(OPEN_US.getTime(), SYMBOL), String(getJudgedDay(account.id, SYMBOL)));
    const second = await runSignalChecks(once, rule, { now: new Date(OPEN_US.getTime() + 60_000) });
    check('같은 시장 날짜에 두 번 판단하지 않는다', second.evaluated === 0 && second.notes.length === 0, `판단 ${second.evaluated}`);
    const closed = await runSignalChecks(once, rule, { now: new Date('2026-10-17T15:00:00Z') });
    check('시장이 닫혀 있으면 판단하지 않는다', closed.evaluated === 0, `판단 ${closed.evaluated}`);

    // ── 9. 규칙 없음 · 규칙 삭제 ─────────────────────
    console.log('\n9) 규칙 없음 · 규칙 삭제');
    let threw = false;
    try {
      saveStrategy(account.id, { enabled: true, ruleId: null }, exists);
    } catch (e) {
      threw = e instanceof StrategyRuleError && e.message === '매매 규칙을 고르세요.';
    }
    check('규칙 없이 켜면 막는다 (「매매 규칙을 고르세요.」)', threw);
    let threw2 = false;
    try {
      saveStrategy(account.id, { enabled: true, ruleId: 999_999 }, exists);
    } catch (e) {
      threw2 = e instanceof StrategyRuleError;
    }
    check('없는 규칙으로 켜면 막는다', threw2);
    saveStrategy(account.id, { enabled: true, ruleId: tempRule.id }, exists);
    check('있는 규칙이면 켜진다', getStrategy(account.id).enabled && getStrategy(account.id).ruleId === tempRule.id);
    const detached = deleteRule(tempRule.id);
    const after = getStrategy(account.id);
    check('쓰는 규칙을 지우면 그 계좌는 꺼지고 규칙이 비워진다', Boolean(detached?.includes(account.id)) && !after.enabled && after.ruleId === null, JSON.stringify(after));
  } finally {
    deleteStrategy(account.id);
    deleteAccount(account.id);
    deleteRule(tempRule.id);
    console.log(`\n임시 계좌 #${account.id} · 임시 규칙 #${tempRule.id} 삭제 완료`);
  }

  console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
  if (fail > 0) process.exit(1);
}

void main().catch((error) => {
  console.error('점검 실패:', error);
  process.exit(1);
});
