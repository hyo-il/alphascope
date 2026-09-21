/**
 * 매수 수량 산정 — **AI형·규칙형·기존 전역 경로가 모두 이 함수를 쓴다.**
 *
 * 잔고 계산이 두 벌로 갈라지면 어느 쪽이 맞는지 알 수 없게 된다 (CLAUDE.md 의
 * `autoTrade.ts` 주석과 같은 이유). 계산 규칙은 기존 전역 자동매매에서 그대로 옮겼다.
 */

import { accountToSymbolRate, getAccountDetail } from '../paperTradingService';

export type BuyPlan =
  | { ok: true; quantity: number; budget: number }
  | { ok: false; reason: string };

/**
 * 총자산 기준 비중으로 살 수량을 정한다.
 *
 * ⚠️ **현금이 아니라 총자산이 기준이다.** 현금 기준이면 매수를 거듭할수록 남은 현금이
 * 줄어 한 종목 비중이 계속 작아진다.
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
  const budgetInAccount = (detail.totalValue * positionSizePercent) / 100;

  // 계좌 통화 → 종목 통화. 환율을 못 가져오면 매수를 건너뛴다 —
  // 여기서 1 로 넘어가면 원화 계좌의 예산이 그대로 달러 예산이 돼 버린다.
  let budget: number;
  try {
    budget = budgetInAccount / (await accountToSymbolRate(symbol, detail.account.currency));
  } catch (error) {
    return { ok: false, reason: `환율을 가져오지 못해 매수를 건너뜁니다 (${(error as Error).message})` };
  }

  const quantity = Math.floor(budget / price);
  if (quantity < 1) {
    return {
      ok: false,
      reason: `배정 예산 ${budget.toFixed(2)} 으로는 1주도 살 수 없습니다 (현재가 ${price.toFixed(2)})`,
    };
  }
  if (detail.account.currentCash < budgetInAccount) {
    return {
      ok: false,
      reason: `현금 부족 — 필요 ${budgetInAccount.toFixed(0)}, 보유 ${detail.account.currentCash.toFixed(0)}`,
    };
  }

  return { ok: true, quantity, budget };
}
