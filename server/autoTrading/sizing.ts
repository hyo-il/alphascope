/**
 * 매수 수량 산정 — **AI형·규칙형·기존 전역 경로가 모두 이 함수를 쓴다.**
 *
 * 잔고 계산이 두 벌로 갈라지면 어느 쪽이 맞는지 알 수 없게 된다 (CLAUDE.md 의
 * `autoTrade.ts` 주석과 같은 이유). 계산 규칙은 기존 전역 자동매매에서 그대로 옮겼다.
 */

import { getAccountDetail, symbolCurrency, usdKrwRate } from '../paperTradingService';
import { convertAmount } from '../../src/utils/fx';
import { formatPrice } from '../../src/utils/formatters';

export type BuyPlan =
  | { ok: true; quantity: number; budget: number }
  | { ok: false; reason: string };

/**
 * 총자산 기준 비중으로 살 수량을 정한다.
 *
 * ⚠️ **현금이 아니라 총자산이 기준이다.** 현금 기준이면 매수를 거듭할수록 남은 현금이
 * 줄어 한 종목 비중이 계속 작아진다.
 *
 * 환산은 `convertAmount` 하나(v2.45.1) — 예산(계좌 통화) → 종목 통화로 수량, 실제 주문 금액(종목 통화) → 계좌 통화로 현금 검사.
 * 환율은 이 함수에서 한 번 받아 두 계산에 같이 쓴다(체결은 같은 60초 캐시 값을 쓴다).
 * 예전에는 「계좌 → 종목 환율」 로 **나눠** 원화 계좌의 미국 종목 예산이 환율 배로 부풀었다(₩1억 계좌가 약 18조 원어치를 사려 했다).
 */
export async function planBuy(
  accountId: number,
  symbol: string,
  price: number,
  positionSizePercent: number,
): Promise<BuyPlan> {
  if (!price || !Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: '현재가를 알 수 없어 주문하지 않았습니다' };
  }

  const detail = await getAccountDetail(accountId);
  const { account } = detail;
  const accountCurrency = account.currency;
  const stockCurrency = symbolCurrency(symbol);
  const budgetInAccount = (detail.totalValue * positionSizePercent) / 100;

  // 통화가 다르면 환율을 받는다. 못 가져오면 매수를 건너뛴다 — 1 로 넘어가면 원화 예산이 그대로 달러 예산이 된다.
  let usdKrw: number | null = null;
  if (stockCurrency !== accountCurrency) {
    try {
      usdKrw = await usdKrwRate();
    } catch (error) {
      return { ok: false, reason: `환율을 가져오지 못해 매수를 건너뜁니다 (${(error as Error).message})` };
    }
  }

  // 예산(계좌 통화) → 종목 통화
  const budget = convertAmount(budgetInAccount, accountCurrency, stockCurrency, usdKrw);
  const quantity = Math.floor(budget / price);
  if (quantity < 1) {
    return {
      ok: false,
      reason: `배정 예산 ${formatPrice(budget, stockCurrency)} 으로는 1주도 살 수 없습니다 (현재가 ${formatPrice(price, stockCurrency)})`,
    };
  }

  // 현금 검사는 계좌 통화로, **실제 주문 금액**(수량 × 가격 × (1 + 슬리피지) × (1 + 수수료))으로 본다 — 체결(fillOrder)이 빼는 금액과 같은 식.
  // 예전에는 예산(budgetInAccount)과 비교해, 수량을 내림한 실제 금액이 아니라 예산 전체가 현금보다 크면 막았다.
  const orderCost = quantity * price * (1 + account.slippageRate) * (1 + account.commissionRate);
  const needInAccount = convertAmount(orderCost, stockCurrency, accountCurrency, usdKrw);
  if (needInAccount > account.currentCash) {
    return {
      ok: false,
      reason: `현금 부족 — 필요 ${formatPrice(needInAccount, accountCurrency)}, 보유 ${formatPrice(account.currentCash, accountCurrency)}`,
    };
  }

  return { ok: true, quantity, budget };
}
