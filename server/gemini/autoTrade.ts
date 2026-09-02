/**
 * 신호 → 모의 주문 어댑터.
 *
 * 체결·잔고·손익 계산은 전부 paperTradingService 가 이미 한다.
 * 여기서 다시 구현하면 잔고 계산이 두 벌로 갈라지므로, 이 파일은
 * "몇 주를 살지" 만 정하고 createOrder 에 넘긴다.
 *
 * ⚠️ 실제 주문은 절대 내지 않는다. 모의투자 계좌만 건드린다.
 */

import type { GeminiAnalysis } from '../../src/types/gemini';
import { createOrder, getAccountDetail, listPositions, accountToSymbolRate} from '../paperTradingService';
import { signalDirection } from './analyze';
import { attachOrder } from './store';

export interface AutoTradeOptions {
  accountId: number;
  /** 매수할 최소 신호 — 'STRONG_BUY' 면 강력 매수만 산다 */
  buySignal: 'BUY' | 'STRONG_BUY';
  /** 매수 최소 신뢰도 */
  buyMinConfidence: number;
  /** 매도할 최소 신호 */
  sellSignal: 'SELL' | 'STRONG_SELL';
  /** 매도 최소 신뢰도 */
  sellMinConfidence: number;
  /** 한 종목에 넣을 자산 비중(%) */
  positionSizePercent: number;
  /** 동시에 보유할 최대 종목 수 */
  maxPositions: number;
}

export interface AutoTradeResult {
  orderId: number | null;
  /** 주문을 걸지 않았다면 그 이유 */
  note: string;
}

/**
 * 분석 한 건을 주문으로 옮긴다. 결과는 분석 레코드에 기록한다 —
 * 나중에 "왜 이 신호에 주문이 안 나갔지" 를 화면에서 바로 볼 수 있어야 한다.
 */
export async function applySignal(
  analysis: GeminiAnalysis,
  options: AutoTradeOptions,
): Promise<AutoTradeResult> {
  const direction = signalDirection(analysis.signal);

  const record = (note: string, orderId: number | null = null): AutoTradeResult => {
    attachOrder(analysis.id, orderId, note);
    return { orderId, note };
  };

  if (!direction) return record('HOLD 신호 — 주문 없음');

  // 신호 강도 조건 — 'STRONG_BUY 만' 으로 좁혀 둔 경우 일반 BUY 는 거른다.
  if (direction === 'BUY' && options.buySignal === 'STRONG_BUY' && analysis.signal !== 'STRONG_BUY') {
    return record('매수 조건이 "강력 매수만" 이라 일반 매수 신호는 건너뜁니다');
  }
  if (
    direction === 'SELL' &&
    options.sellSignal === 'STRONG_SELL' &&
    analysis.signal !== 'STRONG_SELL'
  ) {
    return record('매도 조건이 "강력 매도만" 이라 일반 매도 신호는 건너뜁니다');
  }

  const minConfidence =
    direction === 'BUY' ? options.buyMinConfidence : options.sellMinConfidence;
  if (analysis.confidence < minConfidence) {
    return record(
      `신뢰도 ${(analysis.confidence * 100).toFixed(0)}% < ${direction === 'BUY' ? '매수' : '매도'} 기준 ${(minConfidence * 100).toFixed(0)}% — 주문 없음`,
    );
  }

  const price = analysis.priceAtAnalysis;
  if (!price || !Number.isFinite(price) || price <= 0) {
    return record('현재가를 알 수 없어 주문하지 않았습니다');
  }

  try {
    if (direction === 'SELL') {
      // 공매도는 하지 않는다 — 보유분만 정리한다.
      const position = listPositions(options.accountId).find(
        (item) => item.symbol === analysis.symbol,
      );
      if (!position || position.quantity <= 0) {
        return record('보유 수량이 없어 매도하지 않았습니다 (공매도 안 함)');
      }
      const result = await createOrder({
        accountId: options.accountId,
        symbol: analysis.symbol,
        side: 'SELL',
        orderType: 'MARKET',
        quantity: position.quantity,
        reason: `Gemini ${analysis.signal} (신뢰도 ${(analysis.confidence * 100).toFixed(0)}%) — ${analysis.summary}`,
      });
      return record(`전량 매도 ${position.quantity}주`, result.order.id);
    }

    // 보유 종목 수 한도 — 이미 들고 있는 종목을 더 사는 것은 막지 않는다
    // (한도는 "몇 종목에 분산할지" 이지 "추가 매수 금지" 가 아니다).
    const positions = listPositions(options.accountId);
    const alreadyHeld = positions.some((item) => item.symbol === analysis.symbol);
    if (!alreadyHeld && positions.length >= options.maxPositions) {
      return record(
        `보유 종목이 한도(${options.maxPositions}종목)에 도달해 신규 매수를 건너뜁니다`,
      );
    }

    // 매수: 총자산 기준 비중으로 수량을 정한다.
    // 현금이 아니라 총자산을 기준으로 삼아야 매수를 거듭할수록 한 종목 비중이
    // 줄어드는 왜곡이 생기지 않는다.
    const detail = await getAccountDetail(options.accountId);
    const budgetInAccount = (detail.totalValue * options.positionSizePercent) / 100;
    // 계좌 통화 → 종목 통화. 환율을 못 가져오면 매수를 건너뛴다 —
    // 여기서 1 로 넘어가면 원화 계좌의 예산이 그대로 달러 예산이 돼 버린다.
    let budget: number;
    try {
      budget = budgetInAccount / (await accountToSymbolRate(analysis.symbol, detail.account.currency));
    } catch (error) {
      return record(`환율을 가져오지 못해 매수를 건너뜁니다 (${(error as Error).message})`);
    }
    const quantity = Math.floor(budget / price);

    if (quantity < 1) {
      return record(
        `배정 예산 ${budget.toFixed(2)} 으로는 1주도 살 수 없습니다 (현재가 ${price.toFixed(2)})`,
      );
    }
    if (detail.account.currentCash < budgetInAccount) {
      return record(
        `현금 부족 — 필요 ${budgetInAccount.toFixed(0)}, 보유 ${detail.account.currentCash.toFixed(0)}`,
      );
    }

    const result = await createOrder({
      accountId: options.accountId,
      symbol: analysis.symbol,
      side: 'BUY',
      orderType: 'MARKET',
      quantity,
      reason: `Gemini ${analysis.signal} (신뢰도 ${(analysis.confidence * 100).toFixed(0)}%) — ${analysis.summary}`,
    });
    return record(`매수 ${quantity}주`, result.order.id);
  } catch (error) {
    // 주문 실패가 분석 자체를 실패로 만들면 안 된다 — 이유만 남기고 넘어간다.
    return record(`주문 실패: ${(error as Error).message}`);
  }
}
