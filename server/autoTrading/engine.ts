/**
 * 계좌 한 개의 자동매매 (v2.44.0 — 매매 규칙 엔진).
 *
 * - ① **청산 검사**(매 틱 = 1분): 규칙의 매도 조건 손절 → 익절 → 트레일링. 꺼진 조건은 보지 않는다. 그 종목 시장이 열려 있을 때만.
 * - ② **신호 판단**(종목마다 하루 한 번): 그 종목 시장이 열려 있고 그 시장 날짜로 오늘 아직 보지 않았으면 —
 *   일봉 300개 → 끝난 봉만(`completedDaily`) → 지표 한 번 → 마지막 봉 i 로 `evaluateRule`. BUY + 미보유 → 안전장치를 지나면 매수,
 *   SELL + 보유 → 전량 매도. 캔들·지표를 못 불러오면 판단하지 않은 것으로 두고 다음 틱에 다시 본다.
 * - 손절(hard_stop)로 판 날을 계좌 × 종목별로 남겨 「손절 뒤 다시 매수」 대기(`lastStopDate`)에 쓴다. 트레일링·익절·신호 매도는 남기지 않는다.
 *
 * ⚠️ 실제 주문은 어디에도 나가지 않는다. `createOrder` 는 모의 계좌(SQLite) 전용이다.
 * ⚠️ 판단은 `evaluateRule` 하나 — 여기서 조건을 다시 계산하지 않는다(백테스트와 같은 판단).
 */

import { createOrder, valuePositions, getAccount } from '../paperTradingService';
import { exitLevels } from '../rules/engine';
import { judgeOnClose } from '../rules/judge';
import { planBuy } from './sizing';
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

  for (const symbol of strategy.symbols) {
    const today = marketDate(now.getTime(), symbol);
    if (!options.force) {
      if (!isSymbolMarketOpen(symbol, now)) continue;
      if (getJudgedDay(strategy.accountId, symbol) === today) continue;
    }
    const position = heldMap.get(symbol);
    try {
      // 마감 판단은 매수 판단과 같은 함수 한 곳(`rules/judge.ts`, v2.45.0)
      const judged = await judgeOnClose(
        symbol,
        rule,
        {
          held: Boolean(position),
          avgPrice: position?.avgPrice,
          peak: getPeak(strategy.accountId, symbol) ?? undefined,
          lastStopDate: getStopDay(strategy.accountId, symbol),
        },
        now.getTime(),
      );
      result.evaluated += 1;
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
      const { ev, candles, completed, series } = judged;
      const reason = ev.reasons[0] ?? '';
      const price = candles.at(-1)?.close ?? null;

      if (ev.action === 'SELL' && position) {
        const note = await sell(strategy.accountId, symbol, position.quantity, reason, ev.code);
        if (note.orderId) {
          result.ordered += 1;
          openCount -= 1;
        }
        result.notes.push(note);
      } else if (ev.action === 'BUY' && !position) {
        // AI 검증을 켠 계좌만 이번 판단의 결과·끝난 봉·지표를 AI 질문에 쓴다(다시 계산하지 않게). 끈 계좌는 쓰지 않는다
        const note = await tryBuy(strategy, rule, symbol, price, reason, openCount, ev.code, { ev, candles: completed, series, now });
        if (note.orderId) {
          result.ordered += 1;
          openCount += 1;
        }
        result.notes.push(note);
      } else {
        result.notes.push({ symbol, action: 'HOLD', reason, code: ev.code, orderId: null });
      }
      setJudgedDay(strategy.accountId, symbol, today);
    } catch (error) {
      // 캔들·지표를 못 불러왔다 — 판단하지 않은 것으로 두고 다음 틱에 다시
      result.errors.push(`${symbol}: ${(error as Error).message}`);
    }
  }
  return result;
}

/**
 * 매수 시도 — 신규 매수 안전장치(v2.16.0) → 보유 종목 수 한도 → 예산 순으로 본다.
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
  /** AI 검증(v2.46.0)에 쓸 이번 판단 — 없으면 AI 검증 모듈이 다시 계산한다. AI 검증을 끈 계좌는 쓰지 않는다 */
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

  // ── AI 검증 (v2.46.0) — 안전장치·수량·현금을 모두 지난 뒤, 주문 앞. 꺼진 계좌는 이 자리를 지나치기만 한다 ──
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
