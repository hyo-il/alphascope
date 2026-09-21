/**
 * 계좌 한 개의 자동매매 한 바퀴.
 *
 * 순서가 중요하다:
 *   ① **청산 검사**(하드 손절 · 트레일링) — 분석 주기와 무관하게 먼저 돈다.
 *      급락은 60분을 기다려 주지 않는다.
 *   ② 보유 종목 재평가 (AI: Gemini 가 SELL/HOLD / 규칙: 데드크로스·RSI 과열)
 *   ③ 미보유 종목 매수 판단
 *
 * ⚠️ 실제 주문은 어디에도 나가지 않는다. `createOrder` 는 모의 계좌(SQLite) 전용이다.
 */

import { createOrder, valuePositions, getAccount } from '../paperTradingService';
import { runAnalysis, signalDirection } from '../gemini/analyze';
import { isGeminiEnabled } from '../gemini/client';
import { evaluateRule } from './ruleEngine';
import { planBuy } from './sizing';
import { clearPeak, getPeak, updatePeak } from './store';
import type { AccountStrategy, AutoTradeRunResult } from '../../src/types/autoTrading';

type Note = AutoTradeRunResult['notes'][number];

const pct = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

/** 보유 종목의 현재가·수익률 — 청산 판단의 입력 */
async function valuedPositions(accountId: number) {
  const account = getAccount(accountId);
  const { positions } = await valuePositions(accountId, account.currency);
  return positions;
}

async function sell(
  accountId: number,
  symbol: string,
  quantity: number,
  reason: string,
): Promise<Note> {
  try {
    const result = await createOrder({
      accountId,
      symbol,
      side: 'SELL',
      orderType: 'MARKET',
      quantity,
      reason,
    });
    clearPeak(accountId, symbol);
    return { symbol, action: 'SELL', reason, orderId: result.order.id };
  } catch (error) {
    return { symbol, action: 'HOLD', reason: `매도 실패: ${(error as Error).message}`, orderId: null };
  }
}

/**
 * ① 청산 안전망 — 하드 손절과 트레일링 스톱.
 *
 * **AI·규칙 판단보다 먼저, 그리고 매 틱 돈다.** 스케줄러가 이 함수만 따로 부를 수 있게
 * 분리해 두었다 (분석 주기가 60분이어도 손절은 1분 간격으로 검사된다).
 */
export async function runExitChecks(strategy: AccountStrategy): Promise<Note[]> {
  const notes: Note[] = [];
  const positions = await valuedPositions(strategy.accountId);

  for (const position of positions) {
    if (position.quantity <= 0) continue;
    const price = position.currentPrice;
    if (price == null || !Number.isFinite(price) || price <= 0) continue;

    const changePercent = position.unrealizedPnlPercent ?? ((price - position.avgPrice) / position.avgPrice) * 100;

    // 하드 손절 — 항상 작동하는 안전망
    if (changePercent <= -strategy.hardStopLossPercent) {
      notes.push(
        await sell(
          strategy.accountId,
          position.symbol,
          position.quantity,
          `하드 손절 ${pct(changePercent)} — 기준 -${strategy.hardStopLossPercent}% 도달로 전량 청산`,
        ),
      );
      continue;
    }

    if (!strategy.trailingStopEnabled) continue;

    // 트레일링 — 고점은 올라갈 때만 갱신된다
    const peak = updatePeak(strategy.accountId, position.symbol, Math.max(price, position.avgPrice));
    if (peak <= 0) continue;
    const fromPeak = ((price - peak) / peak) * 100;
    if (fromPeak <= -strategy.trailingStopPercent) {
      notes.push(
        await sell(
          strategy.accountId,
          position.symbol,
          position.quantity,
          `트레일링 스톱 — 고점 ${peak.toFixed(2)} 대비 ${pct(fromPeak)} (기준 -${strategy.trailingStopPercent}%)`,
        ),
      );
    }
  }

  return notes;
}

/** ②③ 보유 재평가 + 신규 매수. 청산 검사는 호출부가 먼저 돌린다. */
export async function runStrategyCycle(strategy: AccountStrategy): Promise<AutoTradeRunResult> {
  const result: AutoTradeRunResult = {
    accountId: strategy.accountId,
    evaluated: 0,
    ordered: 0,
    notes: [],
    errors: [],
    skipped: null,
  };

  if (strategy.mode === 'ai' && !isGeminiEnabled()) {
    result.skipped = 'GEMINI_API_KEY 가 없어 AI형을 실행할 수 없습니다 (규칙형으로 바꾸면 키 없이 돕니다)';
    return result;
  }
  if (!strategy.symbols.length) {
    result.skipped = '대상 종목이 없습니다';
    return result;
  }

  const positions = await valuedPositions(strategy.accountId);
  const heldMap = new Map(positions.filter((p) => p.quantity > 0).map((p) => [p.symbol, p]));
  let openCount = heldMap.size;

  for (const symbol of strategy.symbols) {
    const position = heldMap.get(symbol);
    const held = Boolean(position);

    try {
      result.evaluated += 1;

      // ── 규칙형 ────────────────────────────────
      if (strategy.mode === 'rule') {
        const decision = await evaluateRule(symbol, strategy.rule, held);

        if (decision.action === 'SELL' && position) {
          const note = await sell(strategy.accountId, symbol, position.quantity, decision.reason);
          if (note.orderId) {
            result.ordered += 1;
            openCount -= 1;
          }
          result.notes.push(note);
          continue;
        }
        if (decision.action === 'BUY' && !held) {
          result.notes.push(await tryBuy(strategy, symbol, decision.price, decision.reason, openCount));
          if (result.notes.at(-1)?.orderId) {
            result.ordered += 1;
            openCount += 1;
          }
          continue;
        }
        result.notes.push({ symbol, action: 'HOLD', reason: decision.reason, orderId: null });
        continue;
      }

      // ── AI형 ──────────────────────────────────
      const analysis = await runAnalysis({ symbol, trigger: 'auto', horizon: strategy.horizon });
      const direction = signalDirection(analysis.signal);
      const confidence = `신뢰도 ${(analysis.confidence * 100).toFixed(0)}%`;
      const summary = analysis.summary ? ` — ${analysis.summary}` : '';

      if (direction === 'SELL' && held && position) {
        const strongOnly = strategy.sellSignal === 'STRONG_SELL' && analysis.signal !== 'STRONG_SELL';
        if (strongOnly) {
          result.notes.push({ symbol, action: 'HOLD', reason: `매도 조건이 "강력 매도만" 이라 ${analysis.signal} 는 건너뜁니다`, orderId: null });
          continue;
        }
        if (analysis.confidence < strategy.sellMinConfidence) {
          result.notes.push({
            symbol,
            action: 'HOLD',
            reason: `AI 매도 신호지만 ${confidence} < 기준 ${(strategy.sellMinConfidence * 100).toFixed(0)}% — 보유 유지`,
            orderId: null,
          });
          continue;
        }
        const note = await sell(strategy.accountId, symbol, position.quantity, `AI 매도: ${analysis.signal} (${confidence})${summary}`);
        if (note.orderId) {
          result.ordered += 1;
          openCount -= 1;
        }
        result.notes.push(note);
        continue;
      }

      if (direction === 'BUY' && !held) {
        const strongOnly = strategy.buySignal === 'STRONG_BUY' && analysis.signal !== 'STRONG_BUY';
        if (strongOnly) {
          result.notes.push({ symbol, action: 'HOLD', reason: `매수 조건이 "강력 매수만" 이라 ${analysis.signal} 는 건너뜁니다`, orderId: null });
          continue;
        }
        if (analysis.confidence < strategy.buyMinConfidence) {
          result.notes.push({
            symbol,
            action: 'HOLD',
            reason: `AI 매수 신호지만 ${confidence} < 기준 ${(strategy.buyMinConfidence * 100).toFixed(0)}% — 매수 없음`,
            orderId: null,
          });
          continue;
        }
        const note = await tryBuy(
          strategy,
          symbol,
          analysis.priceAtAnalysis,
          `AI 매수: ${analysis.signal} (${confidence})${summary}`,
          openCount,
        );
        if (note.orderId) {
          result.ordered += 1;
          openCount += 1;
        }
        result.notes.push(note);
        continue;
      }

      // 보유 중인데 HOLD/BUY → 추세가 살아 있다고 본다 (고정 익절을 두지 않는 이유다)
      result.notes.push({
        symbol,
        action: 'HOLD',
        reason: held
          ? `AI 판단 ${analysis.signal} (${confidence}) — 보유 유지${summary}`
          : `AI 판단 ${analysis.signal} (${confidence}) — 매수 조건 아님`,
        orderId: null,
      });
    } catch (error) {
      result.errors.push(`${symbol}: ${(error as Error).message}`);
    }
  }

  return result;
}

/** 매수 시도 — 보유 종목 수 한도와 예산을 함께 본다 */
async function tryBuy(
  strategy: AccountStrategy,
  symbol: string,
  price: number | null,
  reason: string,
  openCount: number,
): Promise<Note> {
  /*
   * 한도는 "몇 종목에 분산할지" 이지 "추가 매수 금지" 가 아니다 —
   * 이미 들고 있는 종목은 이 함수로 오지 않는다(호출부가 held 를 걸러낸다).
   */
  if (openCount >= strategy.maxPositions) {
    return {
      symbol,
      action: 'HOLD',
      reason: `보유 종목이 한도(${strategy.maxPositions}종목)에 도달해 신규 매수를 건너뜁니다`,
      orderId: null,
    };
  }

  const plan = await planBuy(strategy.accountId, symbol, price ?? 0, strategy.positionSizePercent);
  if (!plan.ok) return { symbol, action: 'HOLD', reason: plan.reason, orderId: null };

  try {
    const result = await createOrder({
      accountId: strategy.accountId,
      symbol,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: plan.quantity,
      reason,
    });
    // 트레일링 기준점을 매수가로 시작한다 (첫 고점 = 산 가격)
    if (strategy.trailingStopEnabled && price) updatePeak(strategy.accountId, symbol, price);
    return { symbol, action: 'BUY', reason: `${reason} → ${plan.quantity}주`, orderId: result.order.id };
  } catch (error) {
    return { symbol, action: 'HOLD', reason: `매수 실패: ${(error as Error).message}`, orderId: null };
  }
}

/** 보유 종목의 고점만 갱신한다 (매수 판단 주기와 무관하게 틱마다 부른다) */
export async function refreshPeaks(strategy: AccountStrategy): Promise<void> {
  if (!strategy.trailingStopEnabled) return;
  const positions = await valuedPositions(strategy.accountId);
  for (const p of positions) {
    if (p.quantity > 0 && p.currentPrice) updatePeak(strategy.accountId, p.symbol, p.currentPrice);
  }
}

export { getPeak };
