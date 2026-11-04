/**
 * 차트 빠른주문의 주문 수량 — 한 곳(`QuickOrderPanel` 이 이것만 쓴다 · 시험 `quickorder:test`).
 *
 * | 상태 | 매수 | 매도 |
 * |---|---|---|
 * | 「주」 · 숫자 | 입력 수량 그대로 | `min(입력 수량, 보유)` — 줄었으면 「보유 전부」 |
 * | 「주」 · 「최대」 | 그 주문 가격 기준 매수 최대(`maxBuyableAt`) | 보유 수량 전부 — 「보유 전부」 |
 * | 「%」 | 쓸 수 있는 현금의 N% 로 살 수 있는 수량 | 보유 수량의 N% |
 *
 * - 매도가 보유보다 많으면 서버(`paperTradingService` 보유 수량 검사)가 「보유 수량이 부족합니다」 로 거절한다 —
 *   「최대」(매수 기준 수량)를 누른 채 매도하면 그렇게 됐다. 화면에서 보유 수량까지만 보낸다(서버 검사는 그대로).
 * - % 는 매수·매도에서 기준이 다르다(매수 = 현금의 N% · 매도 = 보유의 N%). 매수 환산에는 수수료·슬리피지를 넣는다
 *   (`buyCostFactor` — 그러지 않으면 100% 가 현금을 넘겨 거부된다).
 */
import type { OrderSide } from '../types/paper';

export type QuickOrderUnit = 'shares' | 'percent';

export interface QuickOrderQuantityInput {
  unit: QuickOrderUnit;
  /** 「주」 칸에 입력한 수량 */
  quantity: number;
  /** 「%」 칸 값(0~100) */
  percent: number;
  /** 「주」 단위에서 「최대」 를 누른 상태 */
  max: boolean;
  side: OrderSide;
  /** 주문 가격(지정가 = 가격 칸 · 시장가 = 현재가) — 매수 수량 계산에만 쓴다 */
  price: number | null;
  /** 쓸 수 있는 현금(종목 통화로 환산한 값) */
  cash: number;
  /** 한 주를 살 때 드는 배수 — (1 + 슬리피지) × (1 + 수수료) */
  buyCostFactor: number;
  /** 보유 수량 */
  held: number;
}

export interface QuickOrderQuantity {
  /** 서버로 보낼 주문 수량 */
  quantity: number;
  /** 매도가 보유 수량 전부로 정해졌다(「최대」 이거나 입력이 보유보다 커서 줄었다) — 「보유 전부」 표시용 */
  allHeld: boolean;
}

/** 그 가격으로 살 수 있는 최대 수량 — 「매수 가능」 줄과 「최대」 의 매수 수량 */
export function maxBuyableAt(cash: number, price: number | null, buyCostFactor: number): number {
  return price && price > 0 ? Math.floor(cash / (price * buyCostFactor)) : 0;
}

export function quickOrderQuantity(i: QuickOrderQuantityInput): QuickOrderQuantity {
  if (i.unit === 'percent') {
    if (i.side === 'BUY') {
      if (!i.price || i.price <= 0) return { quantity: 0, allHeld: false };
      const budget = (i.cash * i.percent) / 100;
      return { quantity: Math.max(0, Math.floor(budget / (i.price * i.buyCostFactor))), allHeld: false };
    }
    return { quantity: Math.max(0, Math.floor((i.held * i.percent) / 100)), allHeld: false };
  }
  if (i.side === 'BUY') {
    return { quantity: i.max ? maxBuyableAt(i.cash, i.price, i.buyCostFactor) : i.quantity, allHeld: false };
  }
  const held = Math.max(0, i.held);
  const want = i.max ? held : i.quantity;
  const quantity = Math.max(0, Math.min(want, held));
  return { quantity, allHeld: held > 0 && (i.max || want > held) };
}

/**
 * 수량 칸 아래 안내 줄 — 입력이 매수·매도에서 몇 주가 되는지(같으면 없음).
 * - 「%」: 지금 문구 그대로.
 * - 「주」: 매수 · 매도 수량이 다를 때만 「매수 71주 · 매도 3주 (보유 전부)」 · 보유 0주면 「(보유 없음)」.
 */
export function quickOrderHint(
  unit: QuickOrderUnit,
  percent: number,
  held: number,
  buy: QuickOrderQuantity,
  sell: QuickOrderQuantity,
): string | null {
  if (unit === 'percent') {
    if (percent >= 100 && held > 0) return `매수 ${buy.quantity}주 · 매도 전량 (${held}주)`;
    if (buy.quantity === sell.quantity) return `= 약 ${buy.quantity}주`;
    return `매수 약 ${buy.quantity}주 · 매도 약 ${sell.quantity}주`;
  }
  if (buy.quantity === sell.quantity) return null;
  const note = held <= 0 ? ' (보유 없음)' : sell.allHeld ? ' (보유 전부)' : '';
  return `매수 ${buy.quantity}주 · 매도 ${sell.quantity}주${note}`;
}
