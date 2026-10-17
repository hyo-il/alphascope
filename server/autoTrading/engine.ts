/**
 * 계좌 한 개의 자동매매 (매매 규칙 엔진).
 *
 * - ① **청산 검사**(매 틱 = 1분): 규칙의 매도 조건 손절 → 익절 → 트레일링. 꺼진 조건은 보지 않는다. 그 종목 시장이 열려 있을 때만.
 * - ② **신호 판단**(종목마다 하루 한 번): 그 종목 시장이 열려 있고 그 시장 날짜로 오늘 아직 보지 않았으면 —
 *   일봉 300개 → 끝난 봉만(`completedDaily`) → 지표 한 번 → 마지막 봉 i 로 `evaluateRule`. BUY + 미보유 → 안전장치를 지나면 매수,
 *   SELL + 보유 → 전량 매도. 캔들·지표를 못 불러오면 판단하지 않은 것으로 두고 다음 틱에 다시 본다.
 *   순서: 이번에 볼 종목을 모두 판단 → 매도 먼저 → 「사도 됨」 을 총점 순서로(`buyOrder.ts`) 위에서부터 매수 → 나머지.
 * - 손절(hard_stop)로 판 날을 계좌 × 종목별로 남겨 「손절 뒤 다시 매수」 대기(`lastStopDate`)에 쓴다. 트레일링·익절·신호 매도는 남기지 않는다.
 *
 * ⚠️ 실제 주문은 어디에도 나가지 않는다. `createOrder` 는 모의 계좌(SQLite) 전용이다.
 * ⚠️ 판단은 `evaluateRule` 하나 — 여기서 조건을 다시 계산하지 않는다(백테스트와 같은 판단).
 */

import { createOrder, valuePositions, getAccount } from '../paperTradingService';
import { exitLevels } from '../rules/engine';
import { judgeOnClose } from '../rules/judge';
import { planBuy } from './sizing';
import { rankBuyCandidates, recentReturn } from './buyOrder';
import { clearMarketRefMiss, markMarketRefMiss, marketOfSymbol, marketRefLoader } from '../rules/marketRef';
import { usesMarketFilter } from '../../src/types/tradingRule';
import { checkBeforeBuy } from '../aiCheck/check';
import { addUse } from '../aiCheck/store';
import { AI_UNAVAILABLE_LABEL } from '../../src/types/aiCheck';
import type { RuleEvaluation } from '../rules/engine';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import { clearPeak, getJudgedDay, getPeak, getStopDay, setJudgedDay, setStopDay, updatePeak } from './store';
import { dailyLossBlock, earningsGuard } from './guards';
import { isSymbolMarketOpen } from '../marketHours';
import { marketDate } from '../../src/utils/marketDate';
import type { AccountStrategy, AutoTradeRunResult, DecisionCode } from '../../src/types/autoTrading';
import type { RuleBody } from '../../src/types/tradingRule';

type Note = AutoTradeRunResult['notes'][number];

/**
 * 그날 다시 판단할 종목(시장 데이터 없음 · 일봉 미확정)의 「최근 판단」 을 처음 한 번만 남기려는 표 — 계좌 · 종목 · 시장 날짜 · **한국 날짜** · 종류.
 * 한국 날짜도 넣는다 — 「최근 판단」 은 한국 날짜로 묶여 자정에 비워지므로, 미국 장 중 자정을 넘기면 다시 한 번 남겨야 줄이 보인다.
 * 메모리에만 둔다(서버를 다시 켜면 한 번 더 남을 수 있다). 2,000개를 넘으면 비운다(지난 날짜 키가 쌓이지 않게).
 */
const pendingNoted = new Set<string>();
function firstPending(accountId: number, symbol: string, day: string, kind: string, now: number, force = false): boolean {
  if (force) return true; // 수동 실행은 늘 결과를 보인다
  const key = `${accountId}|${symbol}|${day}|${marketDate(now, '005930')}|${kind}`;
  if (pendingNoted.has(key)) return false;
  if (pendingNoted.size > 2000) pendingNoted.clear();
  pendingNoted.add(key);
  return true;
}

/**
 * 일봉을 확정하지 못한 종목은 5분 동안 다시 받지 않는다 — 토스 장애 동안 매 틱 · 계좌마다 · 종목마다 다시 부르면 호출이 쌓이고
 * 한 틱이 길어져 다른 계좌의 손절 검사가 밀린다. 종목 단위(모든 계좌가 같이 쓴다). 수동 실행은 기다리지 않는다.
 */
const UNCONFIRMED_RETRY_MS = 5 * 60_000;
const unconfirmedAt = new Map<string, number>();
/** 시험 전용 */
export function resetPendingNotesForTest(): void {
  pendingNoted.clear();
  unconfirmedAt.clear();
}

/** 판단 함수 — 시험(`npm run autotrade:test`)만 바꿔치기한다(총점 순서로 사기 시험에서 점수를 정하려고). 평소에는 `judgeOnClose` 그대로 */
let judge: typeof judgeOnClose = judgeOnClose;
export function setJudgeForTest(fn: typeof judgeOnClose | null): void {
  judge = fn ?? judgeOnClose;
}


const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

async function valuedPositions(accountId: number) {
  const account = getAccount(accountId);
  const { positions } = await valuePositions(accountId, account.currency);
  return positions;
}

async function sell(accountId: number, symbol: string, quantity: number, reason: string, code: DecisionCode): Promise<Note> {
  try {
    const result = await createOrder({ accountId, symbol, side: 'SELL', orderType: 'MARKET', quantity, reason });
    clearPeak(accountId, symbol);
    return { symbol, action: 'SELL', reason, code, orderId: result.order.id };
  } catch (error) {
    return { symbol, action: 'HOLD', reason: `매도 실패: ${(error as Error).message}`, code: 'error', orderId: null };
  }
}

/**
 * ① 청산 — 손절 → 익절 → 트레일링 (규칙의 매도 조건, 꺼진 것은 보지 않는다).
 * 손절이 꺼진 규칙이면 손절하지 않는다(사용자가 고른 것 — 화면이 경고한다).
 */
export async function runExitChecks(strategy: AccountStrategy, rule: RuleBody, now = new Date()): Promise<Note[]> {
  const notes: Note[] = [];
  const s = rule.sell;
  if (!s.stopLoss.on && !s.takeProfit.on && !s.trailing.on) return notes;
  const positions = await valuedPositions(strategy.accountId);

  for (const position of positions) {
    if (position.quantity <= 0) continue;
    if (!isSymbolMarketOpen(position.symbol, now)) continue;
    const price = position.currentPrice;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const changePercent = position.unrealizedPnlPercent ?? ((price - position.avgPrice) / position.avgPrice) * 100;

    if (s.stopLoss.on && changePercent <= -s.stopLoss.percent) {
      const note = await sell(
        strategy.accountId,
        position.symbol,
        position.quantity,
        `손절 ${pct(changePercent)} — 기준 −${s.stopLoss.percent}% 도달로 전량 매도`,
        'hard_stop',
      );
      // 손절 날짜 — 「손절 뒤 다시 매수」 대기 (그 종목 시장 날짜)
      if (note.orderId) setStopDay(strategy.accountId, position.symbol, marketDate(now.getTime(), position.symbol));
      notes.push(note);
      continue;
    }
    if (s.takeProfit.on && changePercent >= s.takeProfit.percent) {
      notes.push(
        await sell(strategy.accountId, position.symbol, position.quantity, `익절 ${pct(changePercent)} — 기준 +${s.takeProfit.percent}% 도달로 전량 매도`, 'take_profit'),
      );
      continue;
    }
    if (!s.trailing.on) continue;
    // 트레일링 — 고점은 올라갈 때만 갱신된다
    const peak = updatePeak(strategy.accountId, position.symbol, Math.max(price, position.avgPrice));
    const line = exitLevels(rule, { held: true, avgPrice: position.avgPrice, peak }).trailing;
    if (peak > 0 && line != null && price <= line) {
      const fromPeak = ((price - peak) / peak) * 100;
      notes.push(
        await sell(
          strategy.accountId,
          position.symbol,
          position.quantity,
          `트레일링 — 최고가 ${peak.toFixed(2)} 대비 ${pct(fromPeak)} (기준 −${s.trailing.percent}%)`,
          'trailing',
        ),
      );
    }
  }
  return notes;
}

/**
 * ② 신호 판단 — 종목마다 하루 한 번. `force`(수동 실행)면 시장 열림·오늘 판단 여부를 보지 않는다.
 * 판단을 마친 종목은 그 시장 날짜를 남긴다(재시작해도 같은 날 두 번 보지 않는다).
 */
export async function runSignalChecks(
  strategy: AccountStrategy,
  rule: RuleBody,
  options: { now?: Date; force?: boolean } = {},
): Promise<AutoTradeRunResult> {
  const now = options.now ?? new Date();
  const result: AutoTradeRunResult = { accountId: strategy.accountId, evaluated: 0, ordered: 0, notes: [], errors: [], skipped: null };
  if (!strategy.symbols.length) {
    result.skipped = '대상 종목이 없습니다';
    return result;
  }

  const positions = await valuedPositions(strategy.accountId);
  const heldMap = new Map(positions.filter((p) => p.quantity > 0).map((p) => [p.symbol, p]));
  let openCount = heldMap.size;

  // 시장 기준 — 이 바퀴에서 시장마다 한 번만 받는다. 시장 필터를 끈 규칙은 받지 않는다
  const refs = marketRefLoader(now.getTime());
  // ── 1) 이번에 볼 종목을 모두 먼저 판단한다(판단 함수·입력은 하나씩 볼 때와 같다) ──
  type Judged = Extract<Awaited<ReturnType<typeof judgeOnClose>>, { kind: 'ok' }>;
  const due: { symbol: string; today: string; position: (typeof positions)[number] | undefined; judged: Judged }[] = [];
  for (const symbol of strategy.symbols) {
    const today = marketDate(now.getTime(), symbol);
    if (!options.force) {
      if (!isSymbolMarketOpen(symbol, now)) continue;
      if (getJudgedDay(strategy.accountId, symbol) === today) continue;
    }
    const position = heldMap.get(symbol);
    const waitAt = unconfirmedAt.get(symbol);
    if (!options.force && waitAt != null && now.getTime() - waitAt < UNCONFIRMED_RETRY_MS) continue; // 일봉 미확정 — 5분 뒤 다시
    try {
      // 마감 판단은 매수 판단과 같은 함수 한 곳(`rules/judge.ts`)
      const judged = await judge(
        symbol,
        rule,
        {
          held: Boolean(position),
          avgPrice: position?.avgPrice,
          peak: getPeak(strategy.accountId, symbol) ?? undefined,
          lastStopDate: getStopDay(strategy.accountId, symbol),
        },
        now.getTime(),
        undefined,
        refs,
      );
      result.evaluated += 1;
      if (judged.kind !== 'unconfirmed') unconfirmedAt.delete(symbol);
      // 끝나지 않은 채 저장된 일봉 — 판단하지 않고 그날 판단을 마친 것으로 두지 않는다(다음 틱에 다시 받는다). 「최근 판단」 에는 그날 처음 한 번만
      if (judged.kind === 'unconfirmed') {
        unconfirmedAt.set(symbol, now.getTime());
        if (firstPending(strategy.accountId, symbol, today, 'bar_unconfirmed', now.getTime(), options.force)) {
          result.notes.push({ symbol, action: 'HOLD', reason: `일봉(${judged.dates.join(', ')})을 확정하지 못해 판단을 미룹니다`, code: 'bar_unconfirmed', orderId: null });
        }
        continue;
      }
      if (judged.kind === 'short') {
        result.notes.push({
          symbol,
          action: 'HOLD',
          reason: `캔들이 ${judged.count}개뿐이라 판단을 건너뜁니다`,
          code: 'not_enough_candles',
          orderId: null,
        });
        setJudgedDay(strategy.accountId, symbol, today);
        continue;
      }
      due.push({ symbol, today, position, judged });
    } catch (error) {
      // 캔들·지표를 못 불러왔다 — 판단하지 않은 것으로 두고 다음 틱에 다시
      result.errors.push(`${symbol}: ${(error as Error).message}`);
    }
  }

  // ── 2) 매도 먼저 — 판 만큼 더 살 수 있는 종목 수가 늘어난다 ──
  for (const d of due) {
    const { ev } = d.judged;
    if (!(ev.action === 'SELL' && d.position)) continue;
    const note = await sell(strategy.accountId, d.symbol, d.position.quantity, ev.reasons[0] ?? '', ev.code);
    if (note.orderId) {
      result.ordered += 1;
      openCount -= 1;
    }
    result.notes.push(note);
    setJudgedDay(strategy.accountId, d.symbol, d.today);
  }

  // ── 3) 「사도 됨」 을 총점 순서로 줄 세워 위에서부터 산다(`buyOrder.ts`) ──
  // 안전장치·현금·AI 검증으로 못 산 종목은 더 살 수 있는 종목 수를 쓰지 않는다(다음 순위로). 가득 차면 나머지는 순위와 함께 남긴다
  const ranked = rankBuyCandidates(
    due
      .filter((d) => d.judged.ev.action === 'BUY' && !d.position)
      .map((d) => ({ ...d, score: d.judged.ev.score, ret60: recentReturn(d.judged.completed) })),
  );
  const of = ranked.length;
  for (const [k, d] of ranked.entries()) {
    const { ev, candles, completed, series } = d.judged;
    const rank = of > 1 ? { n: k + 1, of } : undefined;
    let note: Note;
    if (rank && openCount >= strategy.maxPositions) {
      note = {
        symbol: d.symbol,
        action: 'HOLD',
        reason: `보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 ${rank.n}위 / ${of}종목 중)`,
        code: 'max_positions',
        orderId: null,
        rank,
      };
    } else {
      const price = candles.at(-1)?.close ?? null;
      // AI 검증을 켠 계좌만 이번 판단의 결과·끝난 봉·지표를 AI 질문에 쓴다(다시 계산하지 않게). 끈 계좌는 쓰지 않는다
      note = await tryBuy(strategy, rule, d.symbol, price, ev.reasons[0] ?? '', openCount, ev.code, { ev, candles: completed, series, now });
      if (note.orderId) {
        result.ordered += 1;
        openCount += 1;
        if (rank) note = { ...note, reason: `${note.reason} · 총점 순위 ${rank.n}위(${of}종목 중)`, rank };
      }
    }
    result.notes.push(note);
    setJudgedDay(strategy.accountId, d.symbol, d.today);
  }

  // ── 4) 나머지(기다림·보유) ──
  for (const d of due) {
    const { ev } = d.judged;
    if ((ev.action === 'SELL' && d.position) || (ev.action === 'BUY' && !d.position)) continue;
    const note: Note = { symbol: d.symbol, action: 'HOLD', reason: ev.reasons[0] ?? '', code: ev.code, orderId: null, ...(ev.gateReason ? { gateReason: ev.gateReason } : {}) };
    // 「시장 데이터 없음」(사용자 결정: 그날 다시 시도) — 그날 판단을 마친 것으로 두지 않는다. 그 시장이 열려 있는 동안 다음 틱에 다시 판단하고,
    // 시장 기준 받기는 5분 간격(`markMarketRefMiss`). 같은 실패를 매 틱 남기지 않게 「최근 판단」 에는 그날 처음 한 번만
    if (ev.gateReason === 'market_nodata') {
      markMarketRefMiss(marketOfSymbol(d.symbol), now.getTime());
      if (firstPending(strategy.accountId, d.symbol, d.today, 'market_nodata', now.getTime(), options.force)) result.notes.push(note);
      continue;
    }
    result.notes.push(note);
    setJudgedDay(strategy.accountId, d.symbol, d.today);
  }
  // 시장 기준을 **실제로 받아** 이번 바퀴에 「시장 데이터 없음」 이 하나도 없었던 시장만 다시 받기 기다림을 푼다
  // (점수 미달 · 보유 중 종목은 시장 필터까지 가지 않아 이유가 없으므로 그것으로 풀지 않는다)
  if (usesMarketFilter(rule)) {
    for (const m of new Set(due.map((d) => marketOfSymbol(d.symbol)))) {
      const missed = due.some((d) => marketOfSymbol(d.symbol) === m && d.judged.ev.gateReason === 'market_nodata');
      if (!missed && (await refs.get(m))) clearMarketRefMiss(m);
    }
  }
  return result;
}

/**
 * 매수 시도 — 신규 매수 안전장치 → 보유 종목 수 한도 → 예산 순으로 본다.
 * ⚠️ 안전장치는 **여기서만** 막는다. 매도·청산 경로는 이 함수를 지나지 않는다.
 * export 는 점검 스크립트(`npm run autotrade:test`)용이다.
 */
export async function tryBuy(
  strategy: AccountStrategy,
  rule: RuleBody,
  symbol: string,
  price: number | null,
  reason: string,
  openCount: number,
  /** 매수가 나갔을 때의 판단 종류 — 막히면 막힌 이유의 코드로 바뀐다 */
  code: DecisionCode = 'other',
  /** AI 검증에 쓸 이번 판단 — 없으면 AI 검증 모듈이 다시 계산한다. AI 검증을 끈 계좌는 쓰지 않는다 */
  ai?: { ev: RuleEvaluation; candles: Candle[]; series: IndicatorSeries; now?: Date },
): Promise<Note> {
  const lossBlock = dailyLossBlock(strategy);
  if (lossBlock) return { symbol, action: 'HOLD', reason: lossBlock, code: 'daily_loss', orderId: null };

  const earnings = earningsGuard(strategy, symbol);
  if (earnings.blocked) return { symbol, action: 'HOLD', reason: earnings.blocked, code: 'earnings_blackout', orderId: null };
  if (earnings.note) reason = `${reason} · ${earnings.note}`;

  if (openCount >= strategy.maxPositions) {
    return {
      symbol,
      action: 'HOLD',
      reason: `보유 종목이 한도(${strategy.maxPositions}종목)에 도달해 신규 매수를 건너뜁니다`,
      code: 'max_positions',
      orderId: null,
    };
  }

  const plan = await planBuy(strategy.accountId, symbol, price ?? 0, strategy.positionSizePercent);
  if (!plan.ok) return { symbol, action: 'HOLD', reason: plan.reason, code: 'other', orderId: null };

  // ── AI 검증 — 안전장치·수량·현금을 모두 지난 뒤, 주문 앞. 꺼진 계좌는 이 자리를 지나치기만 한다 ──
  let aiCheckId: number | null = null;
  let aiReasons: string[] = [];
  if (strategy.aiCheck) {
    const { row } = await checkBeforeBuy({ symbol, price: price ?? 0, rule, context: ai, now: ai?.now });
    aiCheckId = row.id;
    const reasons = JSON.parse(row.reasons_json) as string[];
    aiReasons = reasons;
    if (row.verdict !== 'pass') {
      addUse(row.id, strategy.accountId, 'skipped', null);
      if (row.verdict === 'risk') {
        return { symbol, action: 'HOLD', reason: `AI 검증: 위험 — ${reasons[0] ?? ''}`, code: 'ai_risk', orderId: null, detail: reasons };
      }
      const why = row.unavailable_reason ? AI_UNAVAILABLE_LABEL[row.unavailable_reason] : 'AI 오류';
      return { symbol, action: 'HOLD', reason: `AI 검증을 하지 못해 사지 않았습니다 (${why})`, code: 'ai_unavailable', orderId: null, detail: [why] };
    }
    reason = `${reason} · AI 검증 통과`;
    code = 'ai_pass';
  }

  try {
    const result = await createOrder({ accountId: strategy.accountId, symbol, side: 'BUY', orderType: 'MARKET', quantity: plan.quantity, reason });
    // 트레일링 기준점을 매수가로 시작한다 (첫 고점 = 산 가격). 옛 고점이 남아 있으면 버린다
    clearPeak(strategy.accountId, symbol);
    if (rule.sell.trailing.on && price) updatePeak(strategy.accountId, symbol, price);
    if (aiCheckId != null) addUse(aiCheckId, strategy.accountId, 'bought', result.order.id);
    return { symbol, action: 'BUY', reason: `${reason} → ${plan.quantity}주`, code, orderId: result.order.id, ...(aiReasons.length ? { detail: aiReasons } : {}) };
  } catch (error) {
    if (aiCheckId != null) addUse(aiCheckId, strategy.accountId, 'skipped', null);
    return { symbol, action: 'HOLD', reason: `매수 실패: ${(error as Error).message}`, code: 'error', orderId: null };
  }
}

/** 보유 종목의 고점만 갱신한다 (트레일링이 켜진 규칙, 그 종목 시장이 열려 있을 때 — 틱마다) */
export async function refreshPeaks(strategy: AccountStrategy, rule: RuleBody, now = new Date()): Promise<void> {
  if (!rule.sell.trailing.on) return;
  const positions = await valuedPositions(strategy.accountId);
  for (const p of positions) {
    if (p.quantity > 0 && p.currentPrice && isSymbolMarketOpen(p.symbol, now)) updatePeak(strategy.accountId, p.symbol, p.currentPrice);
  }
}
