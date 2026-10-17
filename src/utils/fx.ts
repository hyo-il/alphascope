import type { Currency } from '../types/paper';

/**
 * 금액 바꾸기 — **앱의 통화 환산은 이 함수 하나다**. 서버(자동매매 수량 · 주문 체결 · 평가액)와
 * 화면(빠른주문 · 급등 [모의 매수])이 같이 쓴다. 서버도 컴파일한다(DOM 없음).
 *
 * `from` 통화 금액 → `to` 통화 금액. `usdKrw` = 1달러가 몇 원인지(토스 USD→KRW 환율 하나).
 * 같은 통화면 그대로 돌려준다(환율이 없어도 된다).
 *
 * ⚠️ 곱할지 나눌지는 **여기서만** 정한다. 「환율 값」 을 넘겨받은 쪽이 그 값의 방향을 짐작해
 * 곱하거나 나누면 방향이 뒤집혀, 원화 계좌의 미국 종목 예산이 환율 배(약 1,380배)로
 * 부풀거나 달러 계좌의 국내 종목 평가액에 원화 금액이 그대로 달러로 더해진다.
 * 환율이 없거나 0 이하면 던진다 — 1 로 넘어가면 원화가 그대로 달러가 된다.
 */
export function convertAmount(amount: number, from: Currency, to: Currency, usdKrw: number | null): number {
  if (from === to) return amount;
  if (usdKrw == null || !Number.isFinite(usdKrw) || usdKrw <= 0) {
    throw new Error('환율이 없어 금액을 바꿀 수 없습니다');
  }
  return from === 'USD' ? amount * usdKrw : amount / usdKrw;
}
