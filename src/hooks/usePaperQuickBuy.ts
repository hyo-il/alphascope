import { useCallback } from 'react';
import { modal, toast } from '../store/uiStore';

/**
 * [모의 매수] — 모의투자 계좌에 시장가 매수를 넣는다.
 *
 * ⚠️ 실제 주문이 아니다. 계좌·환율·수량 계산은 QuickOrderPanel 과 같은 규칙을 쓴다
 * (계좌 현금의 일정 비율). 돈이 움직이는 동작이라 항상 확인창을 띄운다.
 * 급등 탐지와 스윙 추천이 같은 버튼을 쓰므로 훅 하나로 모아 둔다.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  }
  return payload as T;
}

export function usePaperQuickBuy(defaultPercent = 5) {
  return useCallback(
    async (symbol: string, price: number | null, percent = defaultPercent) => {
      if (!price || price <= 0) {
        toast.warning('현재가를 알 수 없어 주문할 수 없습니다');
        return;
      }
      try {
        const { accounts } = await json<{
          accounts: { id: number; name: string; currency: string; commissionRate: number }[];
        }>('/api/paper/accounts');
        const account = accounts[0];
        if (!account) {
          toast.warning('모의투자 계좌가 없습니다', '모의투자 메뉴에서 계좌를 먼저 만드세요.');
          return;
        }

        const detail = await json<{ account: { currentCash: number }; fxRate?: number }>(
          `/api/paper/accounts/${account.id}`,
        );
        const currency = /^\d{6}$/.test(symbol) ? 'KRW' : 'USD';
        const fxRate = typeof detail.fxRate === 'number' && detail.fxRate > 0 ? detail.fxRate : null;
        const cash =
          account.currency === currency
            ? detail.account.currentCash
            : fxRate == null
              ? 0
              : currency === 'USD'
                ? detail.account.currentCash / fxRate
                : detail.account.currentCash * fxRate;

        const budget = (cash * percent) / 100;
        const quantity = Math.floor(budget / (price * (1 + (account.commissionRate ?? 0.001))));
        if (quantity < 1) {
          toast.warning('현금이 부족합니다', `${percent}% 예산으로 1주도 살 수 없습니다.`);
          return;
        }

        modal.confirm({
          title: '모의 매수',
          message: `${account.name} 계좌에 시장가 매수 주문을 넣습니다. 실제 주문이 아닙니다.`,
          rows: [
            { label: '종목', value: symbol },
            { label: '수량', value: `${quantity}주 (현금의 ${percent}%)` },
            { label: '예상 단가', value: price.toLocaleString() },
          ],
          confirmText: '매수',
          onConfirm: async () => {
            try {
              await json('/api/paper/orders', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  accountId: account.id,
                  symbol,
                  side: 'BUY',
                  orderType: 'MARKET',
                  quantity,
                  reason: '추천 화면에서 주문',
                }),
              });
              toast.success(`${symbol} ${quantity}주 매수 주문을 넣었습니다`);
            } catch (e) {
              toast.error('주문 실패', (e as Error).message);
            }
          },
        });
      } catch (e) {
        toast.error('계좌를 읽지 못했습니다', (e as Error).message);
      }
    },
    [defaultPercent],
  );
}
