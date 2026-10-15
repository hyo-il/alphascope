import { useCallback } from 'react';
import { modal, toast } from '../store/uiStore';
import { stockNameOf } from '../utils/stockNames';
import { currencyOfSymbol } from '../utils/market';
import { usePaperAccounts } from './usePaperTrading';
import { convertAmount } from '../utils/fx';

/**
 * [모의 매수] — 모의투자 계좌에 시장가 매수를 넣는다.
 *
 * ⚠️ 실제 주문이 아니다. 계좌·환율·수량 계산은 QuickOrderPanel 과 같은 규칙을 쓴다
 * (계좌 현금의 일정 비율). 돈이 움직이는 동작이라 항상 확인창을 띄운다.
 * 급등 탐지 카드가 쓴다(v2.45.0 에 매수 판단 화면의 [모의 매수] 는 없앴다).
 *
 * ⚠️ **계좌는 지금 고른 계좌다** — 예전에는 목록을 직접 받아 `accounts[0]` 로 샀다.
 * 계좌가 여럿이면 사용자가 보고 있는 계좌가 아니라 **첫 계좌**에 주문이 들어갔다.
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
  const { accounts, selectedId } = usePaperAccounts();

  return useCallback(
    async (symbol: string, price: number | null, percent = defaultPercent) => {
      if (!price || price <= 0) {
        toast.warning('현재가를 알 수 없어 주문할 수 없습니다');
        return;
      }
      try {
        const account = accounts.find((a) => a.id === selectedId) ?? accounts[0];
        if (!account) {
          toast.warning('모의투자 계좌가 없습니다', '모의투자 메뉴에서 계좌를 먼저 만드세요.');
          return;
        }

        const detail = await json<{ account: { currentCash: number }; usdKrw?: number | null }>(
          `/api/paper/accounts/${account.id}`,
        );
        const currency = currencyOfSymbol(symbol);
        const usdKrw = typeof detail.usdKrw === 'number' && detail.usdKrw > 0 ? detail.usdKrw : null;
        // 계좌 통화 현금 → 종목 통화(convertAmount 하나). 통화가 다른데 환율이 없으면 0 — 수량이 부풀지 않게
        const cash =
          account.currency === currency || usdKrw != null
            ? convertAmount(detail.account.currentCash, account.currency, currency, usdKrw)
            : 0;

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
            { label: '종목', value: `${symbol}${stockNameOf(symbol) ? ` ${stockNameOf(symbol)}` : ''}` },
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
    [defaultPercent, accounts, selectedId],
  );
}
