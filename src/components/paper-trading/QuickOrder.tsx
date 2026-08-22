import { useEffect, useState } from 'react';
import type { OrderSide, PaperAccount } from '../../types/paper';
import { submitOrder } from '../../hooks/usePaperTrading';
import { formatPrice } from '../../utils/formatters';

interface Props {
  symbol: string;
  price: number | null;
  currency: 'KRW' | 'USD';
}

const ACCOUNT_KEY = 'alphascope.paperAccountId';

/**
 * 차트 화면에서 바로 넣는 모의 시장가 주문.
 *
 * 모의투자 화면에서 고른 계좌를 그대로 쓴다 (localStorage 공유).
 * 계좌가 없으면 아무것도 그리지 않는다 — 차트 화면을 어지럽히지 않기 위해서다.
 */
export default function QuickOrder({ symbol, price, currency }: Props) {
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [quantity, setQuantity] = useState(10);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/paper/accounts')
      .then((r) => r.json())
      .then((d: { accounts?: PaperAccount[] }) => {
        if (cancelled) return;
        const list = d.accounts ?? [];
        const savedId = Number(localStorage.getItem(ACCOUNT_KEY));
        setAccount(list.find((a) => a.id === savedId) ?? list[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!account) return null;

  const order = async (side: OrderSide) => {
    const label = side === 'BUY' ? '매수' : '매도';
    if (
      !window.confirm(
        `[모의투자] ${symbol} ${quantity}주를 시장가로 ${label}합니다.\n` +
          `현재가 ${formatPrice(price, currency)} · 계좌 "${account.name}"\n\n` +
          `실제 주문이 아닙니다. 진행할까요?`,
      )
    )
      return;

    setBusy(true);
    setMessage(null);
    try {
      const result = await submitOrder({
        accountId: account.id,
        symbol,
        side,
        orderType: 'MARKET',
        quantity,
        reason: '차트 간편 주문',
      });
      const t = result.trade!;
      setMessage({ kind: 'ok', text: `${label} ${t.quantity}주 @ ${formatPrice(t.price, currency)}` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-t border-border px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between text-[10px] text-text-muted">
        <span>💰 모의 주문</span>
        <span className="truncate">{account.name}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
          className="w-14 rounded border border-border bg-bg-primary px-1.5 py-1 text-right text-[11px] tabular-nums text-text-primary focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void order('BUY')}
          disabled={busy || price == null}
          className="flex-1 rounded bg-bearish/85 py-1 text-[11px] font-medium text-white transition-colors hover:bg-bearish disabled:opacity-40"
        >
          매수
        </button>
        <button
          type="button"
          onClick={() => void order('SELL')}
          disabled={busy || price == null}
          className="flex-1 rounded bg-bullish/85 py-1 text-[11px] font-medium text-white transition-colors hover:bg-bullish disabled:opacity-40"
        >
          매도
        </button>
      </div>

      {message && (
        <p className={`mt-1 text-[10px] ${message.kind === 'ok' ? 'text-bullish' : 'text-bearish'}`}>
          {message.kind === 'ok' ? '✅' : '❌'} {message.text}
        </p>
      )}
    </div>
  );
}
