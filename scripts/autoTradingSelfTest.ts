/**
 * 계좌별 자동매매 자체 점검 (매매 규칙 엔진).
 * 실행: npm run autotrade:test
 *
 * 왜 필요한가 — 손절·트레일링은 **가격이 실제로 빠져야** 발동한다. 손실 난 포지션이 생기기를 기다릴 수 없으므로
 * **임시 계좌**(와 임시 매매 규칙)를 만들어 평균 매입가를 바꿔 놓고 청산 로직을 돌린다.
 * 청산·신호는 **그 종목 시장이 열려 있을 때만** 돌므로, 시험은 미국 장이 열려 있는 시각(`OPEN_US`)을 넣어 부른다.
 *
 * ⚠️ 임시 계좌·임시 규칙은 끝나고 지운다. 사용자의 계좌·규칙은 건드리지 않는다.
 * ⚠️ 여기서도 주문은 모의 계좌(SQLite)에만 들어간다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { getDb, loadCandles } from '../server/db';
import { createAccount, createOrder, deleteAccount, getAccount, listAccounts, listPositions, listTrades, reorderAccounts, setUsdKrwForTest } from '../server/paperTradingService';
import { planBuy } from '../server/autoTrading/sizing';
import { aiCheckCallsForTest, kstDate, setAiCheckForTest } from '../server/aiCheck/check';
import { countCallsOn, findCheck, insertCheck } from '../server/aiCheck/store';
import { checkReturns } from '../server/aiCheck/history';
import { copyAccount } from '../server/autoTrading/copy';
import { JUDGE_CANDLE_LIMIT, judgeOnClose } from '../server/rules/judge';
import { GeminiError } from '../server/gemini/client';
import { fetchQuotes } from '../server/quoteService';
import { runExitChecks, runSignalChecks, setJudgeForTest, tryBuy } from '../server/autoTrading/engine';
import { rankBuyCandidates, recentReturn } from '../server/autoTrading/buyOrder';
import { dailyLossBlock, evaluateDailyLoss, setEarningsLookupForTest, strategyDay } from '../server/autoTrading/guards';
import { evaluateRule } from '../server/rules/engine';
import { createRule, deleteRule, ensureSeeded, listRules, resetSeedCheckForTest } from '../server/rules/store';
import { NOTES_MAX, readNotes, recordNotes } from '../server/autoTrading/store';
import { ABOVE200_RULE_NAME } from '../src/types/tradingRule';
import { groupNotes } from '../src/utils/autoTradeExplain';
import { loadMarketRef, marketRefLoader, MARKET_REF_RETRY_MS, resetMarketRefMissForTest, setMarketRefLoadForTest } from '../server/rules/marketRef';
import { resetPendingNotesForTest } from '../server/autoTrading/engine';
import { runCustomBacktest } from '../server/autoTrading/ruleResearch';
import { gateBlockLabel } from '../src/types/autoTrading';
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

    // ── 0-2. 다음 개장 시각 (서버가 휴장일까지 본다). 휴장일은 시험 안에서 넣는다(실제 DB 달력은 건드리지 않는다) ──
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
    // 판단 시각(OPEN_US)에 맞춘 고정 일봉(평일 300개 · 마지막 = 10-14, 아직 안 끝남 → 10-13 마감 기준)을 넘긴다 — 캐시에는 실제 오늘까지
    // 봉이 있어, 그대로 두면 판단이 오늘 봉 기준이 되어 손절일(OPEN_US)에서 5거래일이 지난 뒤로는 늘 실패한다(시험이 실제 날짜에 기댐).
    // 판단 함수(judgeOnClose) · 엔진에 lastStopDate 가 넘어가는 경로는 그대로다
    const fixedBars: Candle[] = [];
    for (let t = Date.parse('2026-10-14T04:00:00Z'); fixedBars.length < JUDGE_CANDLE_LIMIT; t -= 86_400_000) {
      const wd = new Date(t).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const c = 200 + 0.1 * (JUDGE_CANDLE_LIMIT - fixedBars.length);
      fixedBars.unshift({ timestamp: t, open: c, high: c + 1, low: c - 1, close: c, volume: 1_000_000 });
    }
    setJudgeForTest((symbol, rule, state, now, _candles, refs) => judgeOnClose(symbol, rule, state, now, fixedBars, refs));
    const waitRun = await runSignalChecks(base, defaultRuleBody(), { now: OPEN_US, force: true }).finally(() => setJudgeForTest(null));
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

  await fxSection();
  await aiSection();
  orderSection();
  await rankSection();
  dailySection();
  await marketSection();
  await retrySection();

  console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
  if (fail > 0) process.exit(1);
}

/**
 * 10. 통화가 다른 계좌·종목 — 환율 방향이 뒤집히면 원화 계좌는 미국 종목을,
 * 달러 계좌는 국내 종목을 사지 못한다(이 절이 그 경우를 지킨다). 환율은 1,350 으로 고정한다.
 */
async function fxSection(): Promise<void> {
  console.log('\n10) 통화가 다른 계좌·종목 (환율 1,350 고정)');
  const RATE = 1350;
  setUsdKrwForTest(RATE);
  const krw = createAccount({ name: `__환율 점검 원화 ${Date.now()}`, initialBalance: 100_000_000, currency: 'KRW' });
  const usd = createAccount({ name: `__환율 점검 달러 ${Date.now()}`, initialBalance: 100_000, currency: 'USD' });
  const small = createAccount({ name: `__환율 점검 현금 경계 ${Date.now()}`, initialBalance: 1_000, currency: 'USD' });
  try {
    // 손 계산: 예산 = 총자산 × 10% → 종목 통화 → 내림
    const cases: [string, number, string, number, number][] = [
      ['원화 ₩1억 + 미국 AAPL $300', krw.id, 'AAPL', 300, Math.floor((100_000_000 * 0.1) / RATE / 300)], // $7,407.41 → 24주
      ['달러 $10만 + 국내 005930 ₩70,000', usd.id, '005930', 70_000, Math.floor((100_000 * 0.1 * RATE) / 70_000)], // ₩1,350만 → 192주
      ['원화 ₩1억 + 국내 005930 ₩70,000', krw.id, '005930', 70_000, Math.floor((100_000_000 * 0.1) / 70_000)], // 142주
      ['달러 $10만 + 미국 AAPL $300', usd.id, 'AAPL', 300, Math.floor((100_000 * 0.1) / 300)], // 33주
    ];
    for (const [label, id, sym, price, want] of cases) {
      const plan = await planBuy(id, sym, price, 10);
      check(`${label} → ${want}주`, plan.ok && plan.quantity === want, JSON.stringify(plan));
    }

    // 현금 경계: 100% 비중, $250 → 4주 = $1,000 + 슬리피지·수수료 > 현금 $1,000 → 막는다 / $300 → 3주는 산다
    const edge = await planBuy(small.id, 'AAPL', 250, 100);
    check('실제 주문 금액(수수료·슬리피지 포함)이 현금을 넘으면 막는다', !edge.ok && edge.reason.startsWith('현금 부족') && edge.reason.includes('$'), JSON.stringify(edge));
    const fits = await planBuy(small.id, 'AAPL', 300, 100);
    check('현금 안이면 산다(3주)', fits.ok && fits.quantity === 3, JSON.stringify(fits));
    const tiny = await planBuy(small.id, '005930', 70_000_000, 10);
    check('「1주도 살 수 없습니다」 에 통화 기호', !tiny.ok && tiny.reason.includes('₩'), JSON.stringify(tiny));

    // 환율을 못 가져오면 매수를 건너뛴다(통화가 같으면 환율을 부르지 않는다)
    setUsdKrwForTest('fail');
    const noFx = await planBuy(krw.id, 'AAPL', 300, 10);
    check('환율 실패 → 매수를 건너뛴다', !noFx.ok && noFx.reason.includes('환율을 가져오지 못해'), JSON.stringify(noFx));
    const sameCur = await planBuy(krw.id, '005930', 70_000, 10);
    check('같은 통화는 환율 실패와 무관', sameCur.ok && sameCur.quantity === 142, JSON.stringify(sameCur));
    setUsdKrwForTest(RATE);

    // 원화 계좌가 미국 종목을 **실제로 산다** — 자동매매 매수 경로(tryBuy) 그대로, 체결까지
    const strategy = normalizeStrategy(krw.id, { enabled: true, ruleId: null, symbols: ['AAPL', '005930'], positionSizePercent: 10, maxPositions: 5 });
    const rule = defaultRuleBody();
    for (const sym of ['AAPL', '005930']) {
      const [quote] = await fetchQuotes([sym]);
      const price = quote?.price ?? null;
      const cashBefore = getAccount(krw.id).currentCash;
      const note = await tryBuy({ ...strategy, earningsBlackoutDays: 0, dailyLossLimitPercent: 0 }, rule, sym, price, '환율 점검 매수', 0, 'score_buy');
      const pos = listPositions(krw.id).find((p) => p.symbol === sym);
      const spent = cashBefore - getAccount(krw.id).currentCash;
      // 예산 ₩1,000만 근처(내림 · 슬리피지 · 수수료 · 그 사이 가격 변동) — 0 보다 크고 예산의 1.01배를 넘지 않는다
      const budgetKrw = getAccount(krw.id).initialBalance * 0.1;
      check(`원화 계좌가 ${sym} 를 실제로 산다(체결)`, note.action === 'BUY' && (pos?.quantity ?? 0) > 0 && spent > budgetKrw * 0.5 && spent <= budgetKrw * 1.01,
        `${note.reason} · 보유 ${pos?.quantity ?? 0}주 · 쓴 현금 ₩${Math.round(spent).toLocaleString('ko-KR')} (가격 ${price})`);
      const easy = explainNote(note, sym, strategy, rule);
      check(`「최근 판단」 문장 — ${sym}`, easy != null && /\d+주/.test(note.reason), `${easy} / ${note.reason}`);
    }
  } finally {
    setUsdKrwForTest(null);
    deleteAccount(krw.id);
    deleteAccount(usd.id);
    deleteAccount(small.id);
    console.log(`임시 계좌 #${krw.id} · #${usd.id} · #${small.id} 삭제 완료`);
  }
}

/**
 * 11. AI 검증 — Gemini 는 부르지 않는다(가짜 답 · 실패 · 시간 초과 · 429 로 바꿔치기).
 * 매수 경로(tryBuy)를 그대로 부르고, 검증 결과·주문·사용 기록을 본다. 시험 종목의 오늘 검증 줄은 경우마다 지운다(사본 DB).
 */
async function aiSection(): Promise<void> {
  console.log('\n11) AI 검증 (Gemini 바꿔치기)');
  const SYM = SYMBOL;
  const db = getDb();
  const rule = createRule(`__AI 검증 점검 ${Date.now()}`, defaultRuleBody());
  const exists = (id: number) => id === rule.id;
  const a = createAccount({ name: `__AI 검증 점검 A ${Date.now()}`, initialBalance: 100_000, currency: 'USD' });
  const b = createAccount({ name: `__AI 검증 점검 B ${Date.now()}`, initialBalance: 100_000, currency: 'USD' });
  const poor = createAccount({ name: `__AI 검증 점검 현금 ${Date.now()}`, initialBalance: 10, currency: 'USD' });
  const copies: number[] = [];
  const resetChecks = () => {
    db.prepare(`DELETE FROM ai_check_uses WHERE check_id IN (SELECT id FROM ai_checks WHERE symbol = ?)`).run(SYM);
    db.prepare(`DELETE FROM ai_checks WHERE symbol = ?`).run(SYM);
  };
  let fakeCalls = 0;
  const fake = (data: unknown, delayMs = 0) => async () => {
    fakeCalls += 1;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return { data: data as { verdict?: unknown; reasons?: unknown }, raw: JSON.stringify(data), model: 'fake-model', tokens: 42, elapsedMs: 1 };
  };
  const NEWS_TITLE = '점검용 뉴스 제목 — 실적 기대감';
  setAiCheckForTest({
    enabled: true,
    news: async (s) => ({ symbol: s, source: 'ticker', items: [{ title: NEWS_TITLE, publisher: '점검', link: 'https://example.com', publishedAt: new Date().toISOString() }], fetchedAt: new Date().toISOString() }),
    earnings: () => ({ date: '2099-01-02', isEstimate: true }),
  });
  try {
    const judged = await judgeOnClose(SYM, rule, { held: false });
    if (judged.kind !== 'ok') throw new Error(`${SYM} 캔들이 모자랍니다`);
    const ctx = { ev: judged.ev, candles: judged.completed, series: judged.series };
    const price = judged.candles.at(-1)!.close;
    const strategyOf = (accountId: number, aiCheck: boolean) =>
      normalizeStrategy(accountId, { enabled: true, ruleId: rule.id, symbols: [SYM], positionSizePercent: 10, maxPositions: 5, earningsBlackoutDays: 0, aiCheck });
    const buyWith = (accountId: number, aiCheck = true, openCount = 0) => tryBuy(strategyOf(accountId, aiCheck), rule, SYM, price, '점검 매수', openCount, 'score_buy', ctx);
    const usesOf = (accountId: number) => db.prepare(`SELECT u.action, u.order_id, c.verdict FROM ai_check_uses u JOIN ai_checks c ON c.id = u.check_id WHERE u.account_id = ?`).all(accountId) as { action: string; order_id: number | null; verdict: string }[];
    const today = () => findCheck(marketDate(Date.now(), SYM), SYM);

    // ── 통과 → 매수 ──
    resetChecks();
    setAiCheckForTest({ caller: fake({ verdict: 'PASS', reasons: ['RSI(14) 가 과열이 아닙니다', '[1] 위험 근거 없음'] }) });
    const pass = await buyWith(a.id);
    check('켬 + 통과 → 매수(ai_pass)', pass.action === 'BUY' && pass.code === 'ai_pass' && pass.orderId != null && (pass.detail?.length ?? 0) === 2, `${pass.code} · ${pass.reason}`);
    check('통과 → 사용 기록 「샀음」 + 주문 번호', usesOf(a.id).some((u) => u.action === 'bought' && u.order_id === pass.orderId));
    const row = today();
    const input = JSON.parse(row?.input_json ?? '{}');
    check('AI 에게 준 정보(input_json)에 뉴스 제목 · 실적일 · 규칙 점수', input.news?.[0]?.title === NEWS_TITLE && input.earnings?.date === '2099-01-02' && input.rule?.score === judged.ev.score && input.bars?.length > 0,
      `뉴스 ${input.news?.length} · 실적 ${input.earnings?.date} · 점수 ${input.rule?.score}/${input.rule?.maxScore} · 봉 ${input.bars?.length}`);
    check('원문 답 · 모델 · 질문 버전 저장', row?.raw_output?.includes('PASS') === true && row?.model === 'fake-model' && row?.prompt_version === 'ai-check-v1');

    // ── 위험 → 사지 않음 ──
    resetChecks();
    setAiCheckForTest({ caller: fake({ verdict: 'RISK', reasons: ['[1] 실적 발표 전 변동 위험', 'RSI(14) 75 — 과열', '(실적일) 가까움'] }) });
    const risk = await buyWith(a.id);
    const riskRow = today();
    check('켬 + 위험 → 사지 않음(ai_risk)', risk.action === 'HOLD' && risk.code === 'ai_risk' && risk.reason.startsWith('AI 검증: 위험 — [1] 실적') && risk.detail?.length === 3, risk.reason);
    check('위험 → 이유 3줄 저장 · 사용 기록 「사지 않음」', JSON.parse(riskRow?.reasons_json ?? '[]').length === 3 && usesOf(a.id).some((u) => u.action === 'skipped' && u.verdict === 'risk'));

    // ── 못 함 — 까닭별 ──
    const cases: [string, Parameters<typeof setAiCheckForTest>[0], string][] = [
      ['오류', { caller: async () => { fakeCalls += 1; throw new Error('가짜 오류'); } }, 'error'],
      ['429', { caller: async () => { fakeCalls += 1; throw new GeminiError('Gemini 한도 초과(429)', 429, true); } }, 'rate_limit'],
      ['시간 초과', { caller: () => { fakeCalls += 1; return new Promise(() => {}); }, timeoutMs: 300 }, 'timeout'],
      ['형식 오류', { caller: fake({ verdict: 'MAYBE', reasons: [] }), timeoutMs: null }, 'format'],
      ['이유 비어 있음', { caller: fake({ verdict: 'RISK', reasons: ['  '] }) }, 'format'],
    ];
    for (const [label, opts, reason] of cases) {
      resetChecks();
      setAiCheckForTest(opts);
      const n = await buyWith(a.id);
      check(`켬 + ${label} → 사지 않음(ai_unavailable · ${reason})`, n.action === 'HOLD' && n.code === 'ai_unavailable' && today()?.unavailable_reason === reason, n.reason);
    }
    setAiCheckForTest({ timeoutMs: null });
    resetChecks();
    setAiCheckForTest({ enabled: false, caller: fake({ verdict: 'PASS', reasons: ['x'] }) });
    let before = fakeCalls;
    const off = await buyWith(a.id);
    check('Gemini 꺼짐 → 부르지 않고 ai_unavailable(disabled)', off.code === 'ai_unavailable' && today()?.unavailable_reason === 'disabled' && fakeCalls === before, off.reason);
    setAiCheckForTest({ enabled: true });

    // ── 하루 20번 ──
    resetChecks();
    const now = new Date();
    const dummy = Array.from({ length: 20 }, (_, k) => `ZZAI${k}`);
    const baseCount = countCallsOn(kstDate(now));
    for (const s of dummy.slice(0, Math.max(0, 20 - baseCount)))
      insertCheck({ market_date: marketDate(now.getTime(), s), symbol: s, verdict: 'pass', reasons_json: '["x"]', unavailable_reason: null, price_at_check: 1, model: 'fake', prompt_version: 'ai-check-v1', input_json: '{}', raw_output: '{}', tokens: 1, elapsed_ms: 1 }, now);
    check('하루 셈 = 20', countCallsOn(kstDate(now)) === 20, String(countCallsOn(kstDate(now))));
    setAiCheckForTest({ caller: fake({ verdict: 'PASS', reasons: ['x'] }) });
    before = fakeCalls;
    const limited = await buyWith(a.id);
    check('21번째는 부르지 않고 ai_unavailable(daily_limit)', limited.code === 'ai_unavailable' && today()?.unavailable_reason === 'daily_limit' && fakeCalls === before, limited.reason);
    const again = await buyWith(b.id);
    check('저장된 결과 재사용은 세지 않음(셈 그대로 · 부르지 않음)', again.code === 'ai_unavailable' && countCallsOn(kstDate(now)) === 20 && fakeCalls === before);
    db.prepare(`DELETE FROM ai_checks WHERE symbol LIKE 'ZZAI%'`).run();

    // ── 두 계좌가 같은 날 같은 종목 → 1번 ──
    resetChecks();
    setAiCheckForTest({ caller: fake({ verdict: 'PASS', reasons: ['위험 근거 없음'] }, 300) });
    before = fakeCalls;
    const [na, nb] = await Promise.all([buyWith(a.id), buyWith(b.id)]);
    const checkId = today()?.id;
    const uses = db.prepare(`SELECT COUNT(*) AS n FROM ai_check_uses WHERE check_id = ?`).get(checkId) as { n: number };
    check('두 계좌 동시 → Gemini 1번 · 사용 기록 2줄', fakeCalls - before === 1 && uses.n === 2 && na.code === 'ai_pass' && nb.code === 'ai_pass', `호출 ${fakeCalls - before} · 사용 ${uses.n}`);

    // ── 끔 → AI 를 부르지 않음 · 끈 계좌와 같은 판단 ──
    resetChecks();
    before = fakeCalls;
    const callsBefore = aiCheckCallsForTest();
    const plain = await buyWith(a.id, false);
    check('끔 → AI 함수를 부르지 않음 · 검증 줄 없음', fakeCalls === before && aiCheckCallsForTest() === callsBefore && today() == null);
    check('끔 → 예전 판단 그대로(score_buy · 「점검 매수 → N주」 · detail 없음)', plain.code === 'score_buy' && /^점검 매수 → \d+주$/.test(plain.reason) && !('detail' in plain), plain.reason);

    // ── 안전장치에 막히면 AI 를 부르지 않음 ──
    resetChecks();
    before = fakeCalls;
    const maxed = await buyWith(a.id, true, 5);
    setEarningsLookupForTest((s) => (s.toUpperCase() === SYM ? { date: marketDate(Date.now(), SYM), isEstimate: false } : null));
    const earnings = await tryBuy({ ...strategyOf(a.id, true), earningsBlackoutDays: 3 }, rule, SYM, price, '점검 매수', 0, 'score_buy', ctx);
    setEarningsLookupForTest(null);
    const cash = await buyWith(poor.id);
    check('최대 보유 · 실적 · 현금에 막히면 AI 를 부르지 않음', maxed.code === 'max_positions' && earnings.code === 'earnings_blackout' && cash.code === 'other' && fakeCalls === before && today() == null,
      `${maxed.code} · ${earnings.code} · ${cash.code}`);

    // ── 채점 계산 (손 계산) ──
    // 검증한 날 2026-01-05(월) 검증 때 가격 100 → 뒤 거래일 종가 101, 102, … — 5거래일 뒤 = 105 → +5% · 10거래일 뒤 = 110 → +10% · 20거래일 뒤는 아직(끝난 봉 15개) → null
    const day0 = Date.UTC(2026, 0, 5, 5); // ET 자정 = 05:00 UTC(겨울)
    const bars = Array.from({ length: 16 }, (_, k) => ({ timestamp: day0 + k * 86_400_000, close: 100 + k }));
    const ret = checkReturns(bars, 16, SYM, '2026-01-05', 100);
    check('채점 5·10·20거래일 = 손 계산(+5% · +10% · 아직)', ret[5] === 5 && ret[10] === 10 && ret[20] === null, JSON.stringify(ret));
    const ret2 = checkReturns(bars, 8, SYM, '2026-01-05', 100);
    check('끝나지 않은 봉은 쓰지 않음(끝난 봉 8개 → 10거래일 null)', ret2[5] === 5 && ret2[10] === null, JSON.stringify(ret2));

    // ── 계좌 복사 ──
    saveStrategy(a.id, { ...strategyOf(a.id, true), enabled: true, dailyLossLimitPercent: 3 }, exists);
    const c1 = copyAccount(a.id, null, exists);
    const c2 = copyAccount(a.id, null, exists);
    copies.push(c1.id, c2.id);
    const src = getStrategy(a.id);
    const dst = getStrategy(c1.id);
    const same = JSON.stringify({ ...src, accountId: 0, enabled: false }) === JSON.stringify({ ...dst, accountId: 0 });
    check('계좌 복사 → 설정 같음(규칙 · 종목 · 운용 · 안전장치 · AI 검증) · 자동매매 꺼짐', same && !dst.enabled && dst.aiCheck, JSON.stringify(dst));
    check('계좌 복사 → 초기 자금 · 통화 · 수수료 같음 · 보유·거래 없음', c1.initialBalance === a.initialBalance && c1.currency === a.currency && c1.commissionRate === a.commissionRate && listPositions(c1.id).length === 0 && listTrades(c1.id).length === 0);
    check('계좌 복사 이름 「… 복사본」 → 겹치면 「… 복사본 2」', c1.name === `${a.name} 복사본` && c2.name === `${a.name} 복사본 2`, `${c1.name} / ${c2.name}`);
  } finally {
    setAiCheckForTest({ caller: null, enabled: null, timeoutMs: null, news: null, earnings: null });
    resetChecks();
    db.prepare(`DELETE FROM ai_checks WHERE symbol LIKE 'ZZAI%'`).run();
    for (const id of [a.id, b.id, poor.id, ...copies]) {
      deleteStrategy(id);
      deleteAccount(id);
      db.prepare(`DELETE FROM ai_check_uses WHERE account_id = ?`).run(id);
    }
    deleteRule(rule.id);
    console.log(`임시 계좌 #${a.id} · #${b.id} · #${poor.id}${copies.length ? ` · 복사 #${copies.join(' · #')}` : ''} · 임시 규칙 #${rule.id} 삭제 완료`);
  }
}

/**
 * 12. 계좌 순서 — 순서 저장·읽기 · 새 계좌는 맨 뒤 · 계좌 삭제 뒤 나머지 순서 유지 · 잘못된 목록은 거절.
 * 임시 계좌를 만들었다 지우고, 원래 계좌들의 순서는 끝에 되돌린다.
 */
function orderSection(): void {
  console.log('\n── 12. 계좌 순서 ──');
  const original = listAccounts().map((a) => a.id);
  const made: number[] = [];
  try {
    const x = createAccount({ name: 'ZZ순서 X', initialBalance: 1_000_000 });
    const y = createAccount({ name: 'ZZ순서 Y', initialBalance: 1_000_000 });
    made.push(x.id, y.id);
    const ids = () => listAccounts().map((a) => a.id);
    check('새 계좌는 맨 뒤', ids().slice(-2).join(',') === `${x.id},${y.id}`, ids().join(','));
    // Y 를 맨 앞으로
    const wanted = [y.id, ...ids().filter((id) => id !== y.id)];
    const after = reorderAccounts(wanted).map((a) => a.id);
    check('순서 저장 → 읽기 같음', after.join(',') === wanted.join(',') && ids().join(',') === wanted.join(','), ids().join(','));
    const z = createAccount({ name: 'ZZ순서 Z', initialBalance: 1_000_000 });
    made.push(z.id);
    check('순서를 바꾼 뒤 새 계좌도 맨 뒤', ids().at(-1) === z.id && ids()[0] === y.id, ids().join(','));
    deleteAccount(x.id);
    made.splice(made.indexOf(x.id), 1);
    const left = wanted.filter((id) => id !== x.id).concat(z.id);
    check('계좌 삭제 뒤 나머지 순서 유지', ids().join(',') === left.join(','), ids().join(','));
    let rejected = 0;
    for (const bad of [ids().slice(1), [...ids(), ids()[0]], [...ids().slice(1), 999_999]]) {
      try {
        reorderAccounts(bad);
      } catch {
        rejected++;
      }
    }
    check('빠지거나 겹치거나 없는 id 면 거절(순서 그대로)', rejected === 3 && ids().join(',') === left.join(','), `거절 ${rejected}/3`);
  } finally {
    for (const id of made) deleteAccount(id);
    if (original.length) reorderAccounts(original);
    console.log(`임시 계좌 ${made.length ? `#${made.join(' · #')} ` : ''}삭제 · 원래 순서로 되돌림`);
  }
}

void main().catch((error) => {
  console.error('점검 실패:', error);
  process.exit(1);
});

/**
 * 13. 총점 순서로 사기 — 같은 판단에서 「사도 됨」 이 더 살 수 있는 종목 수보다 많으면 총점 높은 순(→ 60거래일 수익률 → 티커)으로 산다.
 * 판단 함수를 바꿔치기해 점수만 정한다(끝난 봉·지표는 실제 `judgeOnClose` 결과 — 가격·AI 질문은 진짜 값). 임시 계좌·규칙은 끝에 지운다.
 */
async function rankSection(): Promise<void> {
  console.log('\n── 13. 총점 순서로 사기 ──');
  const db = getDb();
  const SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN'];
  const rule = createRule(`__순서 점검 ${Date.now()}`, defaultRuleBody());
  const exists = (id: number) => id === rule.id;
  const made: number[] = [];
  const real = new Map<string, Awaited<ReturnType<typeof judgeOnClose>>>();
  for (const sym of SYMS) real.set(sym, await judgeOnClose(sym, rule, { held: false }));
  // 종목 → [action, score]. 없는 종목은 기다림(HOLD)
  let plan: Record<string, ['BUY' | 'SELL' | 'HOLD', number]> = {};
  setJudgeForTest(async (symbol) => {
    const j = real.get(symbol)!;
    if (j.kind !== 'ok') return j;
    const [action, score] = plan[symbol] ?? ['HOLD', 30];
    const code = action === 'BUY' ? 'score_buy' : action === 'SELL' ? 'score_sell' : 'no_signal_buy';
    return { ...j, ev: { ...j.ev, action, score, code, reasons: [`점검 ${action} ${score}점`] } };
  });
  const account = (maxPositions: number, symbols = SYMS, extra: Partial<AccountStrategy> = {}) => {
    const a = createAccount({ name: `__순서 점검 ${Date.now()} ${made.length}`, initialBalance: 1_000_000, currency: 'USD' });
    made.push(a.id);
    const st = normalizeStrategy(a.id, { enabled: true, ruleId: rule.id, symbols, positionSizePercent: 5, maxPositions, earningsBlackoutDays: 0, ...extra });
    saveStrategy(a.id, st, exists);
    return st;
  };
  const run = (st: AccountStrategy) => runSignalChecks(st, rule, { force: true });
  const bought = (r: Awaited<ReturnType<typeof run>>) => r.notes.filter((n) => n.action === 'BUY').map((n) => n.symbol);
  const noteOf = (r: Awaited<ReturnType<typeof run>>, sym: string) => r.notes.find((n) => n.symbol === sym);
  try {
    if (SYMS.some((x) => real.get(x)?.kind !== 'ok')) throw new Error('점검 종목 캔들이 모자랍니다');

    // ① 사도 됨 3 · 더 살 수 있는 종목 수 1 → 총점 1위만, 나머지는 A-2 문장(2·3위)
    plan = { AAPL: ['BUY', 70], MSFT: ['BUY', 80], NVDA: ['BUY', 75] };
    const r1 = await run(account(1));
    const ok1 = bought(r1).join() === 'MSFT' && /· 총점 순위 1위\(3종목 중\)$/.test(noteOf(r1, 'MSFT')!.reason);
    const nv = noteOf(r1, 'NVDA')!;
    const aa = noteOf(r1, 'AAPL')!;
    check('사도 됨 3 · 1자리 → 총점 1위(MSFT 80)만 매수 · 「총점 순위 1위(3종목 중)」', ok1, noteOf(r1, 'MSFT')?.reason);
    check('나머지 → 「보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 2위 / 3종목 중)」 · 3위 · max_positions',
      nv.code === 'max_positions' && nv.reason === '보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 2위 / 3종목 중)' && aa.reason === '보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 3위 / 3종목 중)' && nv.rank?.n === 2,
      `${nv.reason} / ${aa.reason}`);
    const ex = explainNote(nv, '엔비디아', { maxPositions: 1, dailyLossLimitPercent: 0 }, rule);
    check('쉬운 말 — 가득 참 · 순위', !!ex && ex.includes('보유 종목 수가 가득 차') && ex.includes('총점 순위 2위') && !ex.includes('빈자리'), ex ?? '');

    // ② 총점 같음 → 60거래일 수익률 → 티커 (순수 함수 + 실제 실행)
    const ranked = rankBuyCandidates([
      { symbol: 'BBB', score: 70, ret60: 0.1 },
      { symbol: 'AAA', score: 70, ret60: 0.1 },
      { symbol: 'CCC', score: 70, ret60: 0.2 },
      { symbol: 'DDD', score: 70, ret60: null },
      { symbol: 'EEE', score: 71, ret60: -0.5 },
    ]).map((x) => x.symbol).join();
    check('순서 = 총점 → 60거래일 수익률 → 티커 · 봉 부족(null)은 맨 뒤', ranked === 'EEE,CCC,AAA,BBB,DDD', ranked);
    const flat = Array.from({ length: 61 }, (_, k) => ({ timestamp: k, open: 1, high: 1, low: 1, close: k === 60 ? 110 : 100, volume: 1 }));
    check('60거래일 수익률 = 종가[i] / 종가[i−60] − 1 · 61봉 미만 null', Math.abs((recentReturn(flat) ?? 0) - 0.1) < 1e-12 && recentReturn(flat.slice(1)) === null);
    plan = { AAPL: ['BUY', 70], MSFT: ['BUY', 70], NVDA: ['BUY', 70] };
    const expect = ['AAPL', 'MSFT', 'NVDA']
      .map((x) => { const j = real.get(x)!; return { symbol: x, score: 70, ret60: j.kind === 'ok' ? recentReturn(j.completed) : null }; });
    const top = rankBuyCandidates(expect)[0].symbol;
    const r2 = await run(account(1));
    check('총점 같음 → 실제 60거래일 수익률이 가장 높은 종목을 매수', bought(r2).join() === top, `${bought(r2)} (기대 ${top} · ${expect.map((e) => `${e.symbol} ${e.ret60?.toFixed(4)}`).join(' ')})`);

    // ③ 1위가 AI 검증 「위험」 → 2위를 산다
    const resetAi = () => {
      db.prepare(`DELETE FROM ai_check_uses WHERE check_id IN (SELECT id FROM ai_checks WHERE symbol IN (${SYMS.map(() => '?').join(',')}))`).run(...SYMS);
      db.prepare(`DELETE FROM ai_checks WHERE symbol IN (${SYMS.map(() => '?').join(',')})`).run(...SYMS);
    };
    resetAi();
    let calls = 0;
    setAiCheckForTest({
      enabled: true,
      news: async (sym) => ({ symbol: sym, source: 'ticker', items: [], fetchedAt: new Date().toISOString() }),
      earnings: () => null,
      caller: async () => {
        calls += 1;
        const data = calls === 1 ? { verdict: 'RISK', reasons: ['점검 — 위험'] } : { verdict: 'PASS', reasons: ['점검 — 통과'] };
        return { data, raw: JSON.stringify(data), model: 'fake-model', tokens: 1, elapsedMs: 1 };
      },
    });
    plan = { AAPL: ['BUY', 70], MSFT: ['BUY', 80], NVDA: ['BUY', 75] };
    const r3 = await run(account(1, SYMS, { aiCheck: true }));
    setAiCheckForTest({ caller: null, enabled: null, timeoutMs: null, news: null, earnings: null });
    resetAi();
    check('1위 AI 검증 「위험」 → 자리를 쓰지 않고 2위(NVDA) 매수 · 3위는 가득 참', noteOf(r3, 'MSFT')?.code === 'ai_risk' && bought(r3).join() === 'NVDA' && /총점 순위 2위\(3종목 중\)$/.test(noteOf(r3, 'NVDA')!.reason) && noteOf(r3, 'AAPL')?.code === 'max_positions',
      r3.notes.map((n) => `${n.symbol}:${n.code}`).join(' '));

    // ④ 1위가 실적 발표 전 막힘 → 2위
    setEarningsLookupForTest((sym) => (sym.toUpperCase() === 'MSFT' ? { date: marketDate(Date.now(), 'MSFT'), isEstimate: false } : null));
    const r4 = await run(account(1, SYMS, { earningsBlackoutDays: 3 }));
    setEarningsLookupForTest(null);
    check('1위 실적 발표 전 막힘 → 2위(NVDA) 매수', noteOf(r4, 'MSFT')?.code === 'earnings_blackout' && bought(r4).join() === 'NVDA', r4.notes.map((n) => `${n.symbol}:${n.code}`).join(' '));

    // ⑤ 같은 판단에서 매도 1 + 매수 후보 2, 자리 0 → 매도 뒤 1개 매수
    const st5 = account(1);
    await createOrder({ accountId: st5.accountId, symbol: 'AMZN', side: 'BUY', orderType: 'MARKET', quantity: 1, reason: '점검 보유' });
    plan = { AMZN: ['SELL', 20], AAPL: ['BUY', 70], NVDA: ['BUY', 75] };
    const r5 = await run(st5);
    check('매도 1 + 후보 2 · 자리 0 → 매도 먼저, 뒤에 1위(NVDA) 매수 · 2위 가득 참', noteOf(r5, 'AMZN')?.action === 'SELL' && bought(r5).join() === 'NVDA' && noteOf(r5, 'AAPL')?.code === 'max_positions',
      r5.notes.map((n) => `${n.symbol}:${n.action}:${n.code}`).join(' '));

    // ⑥ 사도 됨 1개 → 순위 없는 문장
    plan = { NVDA: ['BUY', 75] };
    const r6 = await run(account(1));
    const n6 = noteOf(r6, 'NVDA')!;
    check('사도 됨 1개 → 「점검 BUY 75점 → N주」 그대로 · rank 없음', /^점검 BUY 75점 → \d+주$/.test(n6.reason) && n6.rank == null, n6.reason);
    // 가득 참 — 최대 보유 1 · 이미 1종목(AMZN) 보유 (최대 보유는 1 아래로 저장되지 않는다)
    plan = { NVDA: ['BUY', 75] };
    const st6b = account(1);
    await createOrder({ accountId: st6b.accountId, symbol: 'AMZN', side: 'BUY', orderType: 'MARKET', quantity: 1, reason: '점검 보유' });
    const n6b = noteOf(await run(st6b), 'NVDA')!;
    check('사도 됨 1개 · 가득 참 → 예전 문장(보유 종목이 한도…)', n6b.code === 'max_positions' && n6b.reason.startsWith('보유 종목이 한도') && n6b.rank == null, n6b.reason);

    // ⑦ 대상 종목 목록 순서를 바꿔도 같다
    plan = { AAPL: ['BUY', 70], MSFT: ['BUY', 80], NVDA: ['BUY', 75], AMZN: ['BUY', 60] };
    const key = (r: Awaited<ReturnType<typeof run>>) => r.notes.map((n) => `${n.symbol}:${n.action}:${n.code}:${n.rank?.n ?? ''}`).sort().join(' ');
    const ra = await run(account(2, ['AAPL', 'MSFT', 'NVDA', 'AMZN']));
    const rb = await run(account(2, ['AMZN', 'NVDA', 'MSFT', 'AAPL']));
    check('대상 종목 순서를 바꿔도 같은 결과(MSFT · NVDA 매수)', key(ra) === key(rb) && bought(ra).sort().join() === 'MSFT,NVDA', `${key(ra)} | ${key(rb)}`);
  } finally {
    setJudgeForTest(null);
    setAiCheckForTest({ caller: null, enabled: null, timeoutMs: null, news: null, earnings: null });
    setEarningsLookupForTest(null);
    for (const id of made) {
      deleteStrategy(id);
      deleteAccount(id);
      db.prepare(`DELETE FROM ai_check_uses WHERE account_id = ?`).run(id);
    }
    deleteRule(rule.id);
    console.log(`임시 계좌 ${made.length}개 · 임시 규칙 #${rule.id} 삭제 완료`);
  }
}

/**
 * 14. 거름망 문장 · 「최근 판단」 하루치 · 예시 규칙.
 * 최근 판단은 임시 계좌 번호(쓰지 않는 큰 수)로 기록했다 지운다. 예시 규칙은 사본 DB 에서 지우고 다시 넣어 본다.
 */
function dailySection(): void {
  console.log('\n── 14. 거름망 · 최근 판단 하루치 · 예시 규칙 ──');
  // 거름망 쉬운 말
  const ex = explainNote({ symbol: 'NVDA', action: 'HOLD', reason: '…', code: 'gate_block' }, '엔비디아', { maxPositions: 5, dailyLossLimitPercent: 0 }, null);
  check('gate_block 쉬운 말 — 거름망 · 200일선', !!ex && ex.includes('거름망') && ex.includes('200일선'), ex ?? '');

  // 최근 판단 하루치 — 같은 날 덧붙임 · 최근이 위 · 날짜 바뀌면 비움 · 200줄
  const ID = 987_654;
  const db = getDb();
  // 이 계좌 번호의 설정·고점·최근 판단·판단 날짜를 지운다(계좌는 없다)
  const clear = () => deleteStrategy(ID);
  try {
    clear();
    const kr = new Date('2026-10-16T00:05:00Z'); // 09:05 KST
    const us = new Date('2026-10-16T13:35:00Z'); // 22:35 KST · 09:35 ET
    recordNotes(ID, [{ symbol: '005930', action: 'BUY', reason: '국내 매수', code: 'score_buy' }, { symbol: '000660', action: 'HOLD', reason: '국내 기다림', code: 'no_signal_buy' }], kr);
    recordNotes(ID, [{ symbol: 'NVDA', action: 'HOLD', reason: '거름망', code: 'gate_block' }], us);
    const day = readNotes(ID);
    check('같은 날 국내 판단 + 미국 판단 → 모두 남음 · 최근(미국)이 위', day.notes.length === 3 && day.notes[0].symbol === 'NVDA' && day.notes[0].market === 'US' && day.notes[2].market === 'KR', day.notes.map((n) => `${n.symbol}:${n.market}`).join(' '));
    const groups = groupNotes(day.notes);
    check('판단 한 번씩 묶음 — 미국 1종목 · 국내 2종목', groups.length === 2 && groups[0].market === '미국' && groups[0].symbols === 1 && groups[1].market === '국내' && groups[1].symbols === 2 && groups[1].at === kr.toISOString(), JSON.stringify(groups.map((g) => [g.at, g.market, g.symbols])));
    recordNotes(ID, [{ symbol: 'AAPL', action: 'HOLD', reason: '다음 날', code: 'no_signal_buy' }], new Date('2026-10-17T00:05:00Z'));
    check('한국 날짜가 바뀐 첫 판단 → 예전 날 비움', readNotes(ID).notes.length === 1 && readNotes(ID).notes[0].symbol === 'AAPL');
    const many = Array.from({ length: 150 }, (_, k) => ({ symbol: `ZZ${k}`, action: 'HOLD' as const, reason: 'x', code: 'no_signal_buy' as const }));
    recordNotes(ID, many, new Date('2026-10-17T01:00:00Z'));
    recordNotes(ID, many, new Date('2026-10-17T02:00:00Z'));
    const capped = readNotes(ID).notes;
    check(`계좌마다 최대 ${NOTES_MAX}줄 — 오래된 줄부터 버림`, capped.length === NOTES_MAX && capped[0].at === '2026-10-17T02:00:00.000Z' && !capped.some((n) => n.symbol === 'AAPL'), `${capped.length}줄`);
  } finally {
    clear();
  }

  // 예시 규칙 「기본 규칙 + 200일선」 — 한 번만 · 지우면 다시 만들지 않음 · 같은 이름이 있으면 표시만
  const named = () => listRules().filter((r) => r.name === ABOVE200_RULE_NAME);
  const mark = () => db.prepare(`SELECT value FROM app_settings WHERE key = 'tradingRules.seeded.above200'`).get();
  ensureSeeded();
  const first = named();
  check('예시 규칙 있음 · 거름망 켬 · 나머지는 기본 규칙과 같음', first.length === 1 && first[0].buy.gates?.above200?.on === true && (() => {
    const def = listRules().find((r) => r.name === '기본 규칙');
    if (!def) return true; // 사용자가 기본 규칙을 지운 DB
    const a = { ...first[0].buy, gates: undefined };
    const b = { ...def.buy, gates: undefined };
    return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(first[0].sell) === JSON.stringify(def.sell) && first[0].reentryWaitDays === def.reentryWaitDays;
  })());
  const def = listRules().find((r) => r.name === '기본 규칙');
  check('「기본 규칙」 은 그대로(거름망 칸 없음 또는 꺼짐)', !def || !def.buy.gates?.above200?.on);
  resetSeedCheckForTest();
  ensureSeeded();
  check('다시 확인해도 하나뿐', named().length === 1);
  const saved = first[0];
  deleteRule(saved.id);
  resetSeedCheckForTest();
  ensureSeeded();
  check('지운 뒤 다시 만들지 않음', named().length === 0 && !!mark());
  // 같은 이름이 이미 있고 표시가 없으면 → 만들지 않고 표시만
  const again = createRule(ABOVE200_RULE_NAME, saved);
  db.prepare(`DELETE FROM app_settings WHERE key = 'tradingRules.seeded.above200'`).run();
  resetSeedCheckForTest();
  ensureSeeded();
  check('같은 이름이 있으면 만들지 않고 표시만', named().length === 1 && named()[0].id === again.id && !!mark());
}

/**
 * 15. 시장 필터 · 거름망 이유 — 이유 4가지 표시 · 쉬운 말 · 한 판단에서 시장 기준을 시장마다 한 번 · 받기 실패면 사지 않음.
 */
async function marketSection(): Promise<void> {
  console.log('\n── 15. 시장 필터 · 거름망 이유 ──');
  const base = { maxPositions: 5, dailyLossLimitPercent: 0 };
  const note = (symbol: string, gateReason?: 'below200' | 'short' | 'market' | 'market_nodata') =>
    explainNote({ symbol, action: 'HOLD', reason: '…', code: 'gate_block', ...(gateReason ? { gateReason } : {}) }, symbol, base, null) ?? '';
  check('표시 이름 4가지 + 옛 기록', gateBlockLabel('below200') === '거름망에 걸림 (200일선 아래)' && gateBlockLabel('short') === '거름망에 걸림 (일봉 부족)' && gateBlockLabel('market') === '거름망에 걸림 (시장 하락)' && gateBlockLabel('market_nodata') === '거름망에 걸림 (시장 데이터 없음)' && gateBlockLabel() === '거름망에 걸림');
  check('쉬운 말 — 이유마다 다름 · 시장은 종목 시장의 기준 이름', note('AAPL', 'market').includes('SPY') && note('AAPL', 'market').includes('시장 하락') && note('005930', 'market').includes('KODEX 200') &&
    note('AAPL', 'market_nodata').includes('시장 데이터 없음') && note('AAPL', 'short').includes('일봉 부족') && note('AAPL', 'below200').includes('200일선 아래') && note('AAPL').includes('거름망'),
    note('005930', 'market'));

  // 한 판단에서 시장마다 한 번 — 받기를 세는 바꿔치기(실제 받기는 그대로)
  const counts: Record<string, number> = {};
  setMarketRefLoadForTest(async (m, now, limit) => {
    counts[m] = (counts[m] ?? 0) + 1;
    return loadMarketRef(m, now, limit);
  });
  const loader = marketRefLoader();
  await Promise.all([loader.get('US'), loader.get('US'), loader.get('KR'), loader.get('US')]);
  check('marketRefLoader — 같은 판단에서 같은 시장은 한 번만 받는다', JSON.stringify(loader.fetched()) === JSON.stringify({ US: 1, KR: 1 }), JSON.stringify(loader.fetched()));

  const rule = createRule(`__시장 필터 점검 ${Date.now()}`, (() => { const b = defaultRuleBody(); b.buy.minScore = 1; b.buy.gates = { above200: { on: false }, marketAbove200: { on: true } }; return b; })());
  const exists = (id: number) => id === rule.id;
  const made: number[] = [];
  try {
    const acc = createAccount({ name: `__시장 필터 점검 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
    made.push(acc.id);
    const st = normalizeStrategy(acc.id, { enabled: true, ruleId: rule.id, symbols: ['AAPL', 'MSFT', 'NVDA', '005930', '000660'], positionSizePercent: 5, maxPositions: 10, earningsBlackoutDays: 0 });
    saveStrategy(acc.id, st, exists);
    for (const k of Object.keys(counts)) delete counts[k];
    const r = await runSignalChecks(st, rule, { force: true });
    check('계좌 한 바퀴(미국 3 · 국내 2종목) → SPY 1번 · KODEX 200 1번', counts.US === 1 && counts.KR === 1, JSON.stringify(counts));
    const gated = r.notes.filter((n) => n.code === 'gate_block');
    check('거름망 줄에 이유가 붙음(시장 하락 또는 통과) · 거름망 줄 1개 이상', gated.length > 0 && gated.every((n) => n.gateReason === 'market' || n.gateReason === 'market_nodata'), `${r.notes.map((n) => `${n.symbol}:${n.code}${n.gateReason ? `(${n.gateReason})` : ''}`).join(' ')} | ${gated[0]?.reason ?? ''}`);

    // 받기 실패 → 점수가 기준 이상인 종목은 모두 「시장 데이터 없음」 · 주문 없음
    setMarketRefLoadForTest(async () => null);
    const acc2 = createAccount({ name: `__시장 필터 점검 실패 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
    made.push(acc2.id);
    const st2 = { ...st, accountId: acc2.id };
    saveStrategy(acc2.id, st2, exists);
    const r2 = await runSignalChecks(st2, rule, { force: true });
    const scored = r2.notes.filter((n) => n.code !== 'not_enough_candles');
    check('시장 데이터 받기 실패 → 「시장 데이터 없음」 으로 사지 않음 · 주문 0', r2.ordered === 0 && scored.length > 0 && scored.every((n) => n.code === 'gate_block' && n.gateReason === 'market_nodata'),
      r2.notes.map((n) => `${n.symbol}:${n.code}${n.gateReason ? `(${n.gateReason})` : ''}`).join(' '));
    // 백테스트 — 시장 기준을 받지 못하면 결과에 알린다(조용히 거래 0 이 되지 않게). 시장 필터를 끈 방법이면 알림 칸이 없다(결과 모양이 그대로)
    const input = (r: typeof rule, ruleBody: typeof rule) => ({ symbols: ['AAPL', 'MSFT'], years: 1, conditions: [{ label: 'A' as const, ruleId: r.id, ruleName: r.name, rule: ruleBody }] });
    const failed = await runCustomBacktest(input(rule, rule) as never);
    const plainBody = (() => { const b = defaultRuleBody(); b.buy.minScore = 1; return b; })();
    setMarketRefLoadForTest(null);
    const plain = await runCustomBacktest(input(rule, { ...rule, ...plainBody }) as never);
    check('백테스트 — 시장 기준 받기 실패 → 결과에 「SPY 일봉을 받지 못해 …」 한 줄 · 거래 0', failed.marketWarnings?.length === 1 && failed.marketWarnings[0].includes('SPY 일봉을 받지 못해') && (failed.conditions[0].summary.avgTrades ?? 0) === 0,
      JSON.stringify(failed.marketWarnings));
    check('백테스트 — 시장 필터를 끈 방법은 알림 칸 없음', !('marketWarnings' in plain));
  } finally {
    setMarketRefLoadForTest(null);
    for (const id of made) {
      deleteStrategy(id);
      deleteAccount(id);
    }
    deleteRule(rule.id);
    console.log(`임시 계좌 ${made.length}개 · 임시 규칙 #${rule.id} 삭제 완료`);
  }
}

/**
 * 16. 시장 데이터를 잠깐 못 받은 날 (사용자 결정: 그날 다시 시도).
 * 「시장 데이터 없음」 은 그날 판단을 마친 것으로 두지 않는다 → 다음 틱에 다시. 시장 기준 받기는 실패 뒤 5분 간격. 「최근 판단」 은 처음 한 번 + 성공했을 때.
 * 시장이 열린 시각(OPEN_US)부터 1분 · 5분 뒤로 틱을 흉내 낸다(force 없이 — 「오늘 판단함」 기록까지 본다).
 */
async function retrySection(): Promise<void> {
  console.log('\n── 16. 시장 데이터 다시 시도 ──');
  const rule = createRule(`__다시 시도 점검 ${Date.now()}`, (() => { const b = defaultRuleBody(); b.buy.minScore = 1; b.buy.gates = { above200: { on: false }, marketAbove200: { on: true } }; return b; })());
  const exists = (id: number) => id === rule.id;
  const acc = createAccount({ name: `__다시 시도 점검 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
  const SYMS = ['AAPL', 'MSFT'];
  let calls = 0;
  let fail = true;
  resetMarketRefMissForTest();
  resetPendingNotesForTest();
  setMarketRefLoadForTest(async (m, n, limit) => {
    calls += 1;
    return fail ? null : loadMarketRef(m, n, limit);
  });
  try {
    const st = normalizeStrategy(acc.id, { enabled: true, ruleId: rule.id, symbols: SYMS, positionSizePercent: 5, maxPositions: 10, earningsBlackoutDays: 0 });
    saveStrategy(acc.id, st, exists);
    const t0 = OPEN_US.getTime();
    const day = marketDate(t0, 'AAPL');
    const tick = (ms: number) => runSignalChecks(st, rule, { now: new Date(t0 + ms) });
    const nodata = (r: Awaited<ReturnType<typeof tick>>) => r.notes.filter((n) => n.gateReason === 'market_nodata').length;

    const r1 = await tick(0);
    check('실패 → 「시장 데이터 없음」 · 그날 판단을 마친 것으로 두지 않음 · 받기 1번', nodata(r1) === 2 && calls === 1 && SYMS.every((s) => getJudgedDay(acc.id, s) !== day), `${r1.notes.map((n) => `${n.symbol}:${n.gateReason ?? n.code}`)} · 받기 ${calls}`);
    const r2 = await tick(60_000);
    check('1분 뒤 틱 — 다시 판단하지만 5분이 안 지나 받지 않음 · 「최근 판단」 중복 없음', calls === 1 && r2.evaluated === 2 && nodata(r2) === 0 && r2.notes.length === 0, `받기 ${calls} · 판단 ${r2.evaluated} · 줄 ${r2.notes.length}`);
    fail = false;
    const r3 = await tick(MARKET_REF_RETRY_MS - 60_000);
    check('5분 전에는 받기 성공 기회가 있어도 받지 않음(간격 지킴)', calls === 1 && nodata(r3) === 0 && r3.notes.length === 0);
    const r4 = await tick(MARKET_REF_RETRY_MS);
    const judged = SYMS.every((s) => getJudgedDay(acc.id, s) === day);
    check('5분 뒤 다시 받아 성공 → 정상 판단 · 그날 판단 마침 · 「최근 판단」 에 남음', calls === 2 && nodata(r4) === 0 && r4.notes.length === 2 && judged, `받기 ${calls} · ${r4.notes.map((n) => `${n.symbol}:${n.gateReason ?? n.code}`)}`);
    const r5 = await tick(MARKET_REF_RETRY_MS + 60_000);
    check('그 뒤 틱 — 이미 판단을 마쳐 다시 보지 않음(같은 날 판단은 한 번만 확정)', r5.evaluated === 0 && r5.notes.length === 0);

    // 섞인 종목 — 한 종목은 시장 데이터 없음, 다른 종목은 점수 미달(시장 필터까지 가지 않음) → 기다림이 풀리지 않는다(5분 간격 유지)
    {
      resetMarketRefMissForTest();
      resetPendingNotesForTest();
      fail = true;
      calls = 0;
      const acc4 = createAccount({ name: `__다시 시도 점검 섞임 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
      try {
        const st4 = { ...st, accountId: acc4.id };
        saveStrategy(acc4.id, st4, exists);
        setJudgeForTest(async (symbol, r, state, n, candles, refsArg) => {
          const j = await judgeOnClose(symbol, r, state, n, candles, refsArg);
          return j.kind === 'ok' && symbol === 'MSFT' ? { ...j, ev: { ...j.ev, action: 'HOLD', code: 'no_signal_buy', gateReason: undefined, reasons: ['점수 미달(시험)'] } } : j;
        });
        await runSignalChecks(st4, rule, { now: new Date(t0) });
        await runSignalChecks(st4, rule, { now: new Date(t0 + 60_000) });
        check('섞인 종목(시장 데이터 없음 + 점수 미달) → 기다림이 풀리지 않아 1분 뒤 받지 않음', calls === 1, `받기 ${calls}`);
      } finally {
        setJudgeForTest(null);
        deleteStrategy(acc4.id);
        deleteAccount(acc4.id);
      }
    }
    // 일봉 미확정 — 종목마다 5분 동안 다시 받지 않는다(토스 장애 때 매 틱 다시 부르지 않게)
    {
      resetPendingNotesForTest();
      let judges = 0;
      const acc5 = createAccount({ name: `__다시 시도 점검 미확정 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
      try {
        const st5 = { ...st, accountId: acc5.id, symbols: ['AAPL'] };
        saveStrategy(acc5.id, st5, exists);
        setJudgeForTest(async () => {
          judges += 1;
          return { kind: 'unconfirmed', dates: ['2026-10-13'], candles: [] };
        });
        const u1 = await runSignalChecks(st5, rule, { now: new Date(t0) });
        const u2 = await runSignalChecks(st5, rule, { now: new Date(t0 + 60_000) });
        const u3 = await runSignalChecks(st5, rule, { now: new Date(t0 + 5 * 60_000) });
        check('일봉 미확정 → 5분 동안 다시 판단하지 않음 · 5분 뒤 다시 · 「최근 판단」 은 처음 한 번 · 그날 판단 마치지 않음',
          judges === 2 && u1.notes.some((n) => n.code === 'bar_unconfirmed') && u2.notes.length === 0 && u3.notes.length === 0 && getJudgedDay(acc5.id, 'AAPL') !== day,
          `판단 ${judges} · ${u1.notes.map((n) => n.code)} / ${u2.notes.length} / ${u3.notes.length}`);
      } finally {
        setJudgeForTest(null);
        resetPendingNotesForTest();
        deleteStrategy(acc5.id);
        deleteAccount(acc5.id);
      }
    }
    // 장 마감까지 실패 — 마감 뒤에는 판단하지 않는다(그날은 「시장 데이터 없음」 으로 끝, 오늘 판단 기록 없음)
    const acc2 = createAccount({ name: `__다시 시도 점검 마감 ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
    try {
      resetMarketRefMissForTest();
      fail = true;
      calls = 0;
      const st2 = { ...st, accountId: acc2.id };
      saveStrategy(acc2.id, st2, exists);
      await runSignalChecks(st2, rule, { now: new Date(t0) });
      const afterClose = new Date('2026-10-14T20:30:00Z'); // 16:30 ET — 장 마감 뒤
      const r6 = await runSignalChecks(st2, rule, { now: afterClose });
      check('장 마감까지 못 받음 → 마감 뒤에는 판단하지 않고 그날 판단 기록도 없음', r6.evaluated === 0 && SYMS.every((s) => getJudgedDay(acc2.id, s) !== day));
    } finally {
      deleteStrategy(acc2.id);
      deleteAccount(acc2.id);
    }
    // 일봉 부족(종목 200일선) · 시장 하락은 데이터가 늘지 않거나 판정이 끝난 것 — 지금처럼 그날 마침(판단 결과만 바꿔치기)
    for (const reason of ['short', 'market'] as const) {
      const acc3 = createAccount({ name: `__다시 시도 점검 ${reason} ${Date.now()}`, initialBalance: 1_000_000, currency: 'USD' });
      try {
        const st3 = { ...st, accountId: acc3.id, symbols: ['AAPL'] };
        saveStrategy(acc3.id, st3, exists);
        setJudgeForTest(async (symbol, r, state, now, candles, refs) => {
          const j = await judgeOnClose(symbol, r, state, now, candles, refs);
          return j.kind === 'ok' ? { ...j, ev: { ...j.ev, action: 'HOLD', code: 'gate_block', gateReason: reason } } : j;
        });
        await runSignalChecks(st3, rule, { now: new Date(t0) });
        check(`「${reason === 'short' ? '일봉 부족' : '시장 하락'}」 은 그날 판단을 마친 것으로 기록(다시 시도 아님)`, getJudgedDay(acc3.id, 'AAPL') === day);
      } finally {
        setJudgeForTest(null);
        deleteStrategy(acc3.id);
        deleteAccount(acc3.id);
      }
    }
  } finally {
    setMarketRefLoadForTest(null);
    resetMarketRefMissForTest();
    deleteStrategy(acc.id);
    deleteAccount(acc.id);
    deleteRule(rule.id);
    console.log(`임시 계좌 · 임시 규칙 #${rule.id} 삭제 완료`);
  }
}
