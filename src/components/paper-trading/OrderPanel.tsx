import { useMemo, useState } from 'react';
import type { OrderSide, OrderType, PaperAccount, PaperPositionValued } from '../../types/paper';
import { submitOrder } from '../../hooks/usePaperTrading';
import { useRealtimePrice } from '../../hooks/useRealtimePrice';
import { useStockInfo } from '../../hooks/useStockInfo';
import { currencyOf, formatPrice } from '../../utils/formatters';
import SymbolSearch from '../common/SymbolSearch';

interface Props {
  account: PaperAccount;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  positions: PaperPositionValued[];
  onOrdered: () => void;
}

/**
 * 모의 주문 패널.
 *
 * 예상 체결가는 서버와 **같은 식**으로 계산해 보여 준다 (슬리피지 ±, 수수료 별도).
 * 실제 체결은 서버가 그 시점 현재가로 다시 계산하므로 소수점 단위 차이는 날 수 있다.
 */
export default function OrderPanel({
  account,
  symbol,
  onSymbolChange,
  positions,
  onOrdered,
}: Props) {
  const [side, setSide] = useState<OrderSide>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [quantity, setQuantity] = useState(10);
  const [limitPrice, setLimitPrice] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const livePrice = useRealtimePrice(symbol);
  const stockInfo = useStockInfo(symbol);
  const currency = currencyOf(stockInfo?.market);
  const price = livePrice?.close ?? null;
  const position = positions.find((p) => p.symbol === symbol) ?? null;

  const estimate = useMemo(() => {
    const base = orderType === 'LIMIT' && limitPrice !== '' ? Number(limitPrice) : price;
    if (base == null || !Number.isFinite(base) || !(quantity > 0)) return null;

    const executed =
      side === 'BUY'
        ? base * (1 + account.slippageRate)
        : base * (1 - account.slippageRate);
    const amount = executed * quantity;
    const commission = amount * account.commissionRate;
    const realized =
      side === 'SELL' && position ? (executed - position.avgPrice) * quantity - commission : null;

    return { base, executed, amount, commission, total: amount + commission, realized };
  }, [orderType, limitPrice, price, quantity, side, account, position]);

  const canSubmit =
    Boolean(estimate) && quantity > 0 && (orderType === 'MARKET' || limitPrice !== '');

  const run = async () => {
    if (!estimate) return;

    const label = side === 'BUY' ? '매수' : '매도';
    const priceText =
      orderType === 'MARKET'
        ? `예상 체결가 ${formatPrice(estimate.executed, currency)}`
        : `지정가 ${formatPrice(Number(limitPrice), currency)}`;

    // 되돌릴 수 없는 동작이라 반드시 확인을 받는다 (모의 자금이라도 마찬가지다).
    if (
      !window.confirm(
        `${symbol} ${quantity}주를 ${label}합니다.\n\n${priceText}\n` +
          `주문 금액 ${formatPrice(estimate.amount, currency)}\n` +
          `수수료 ${formatPrice(estimate.commission, currency)}\n\n진행할까요?`,
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
        orderType,
        quantity,
        requestedPrice: orderType === 'LIMIT' ? Number(limitPrice) : null,
        reason: reason.trim() || null,
      });

      if (result.pending) {
        setMessage({ kind: 'ok', text: `지정가 주문 접수 — 조건에 닿으면 체결됩니다.` });
      } else {
        const t = result.trade!;
        const pnl =
          t.pnl != null ? ` · 실현손익 ${formatPrice(t.pnl, currency)} (${t.pnlPercent?.toFixed(2)}%)` : '';
        setMessage({
          kind: 'ok',
          text: `${label} 체결 ${t.quantity}주 @ ${formatPrice(t.price, currency)}${pnl}`,
        });
      }
      setReason('');
      onOrdered();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: string, tone = 'text-text-secondary') => (
    <div className="flex justify-between text-[11px]">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </div>
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-3">
      <h3 className="text-xs font-medium text-text-secondary">주문</h3>

      <SymbolSearch symbol={symbol} onSubmit={onSymbolChange} />

      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-text-muted">{stockInfo?.name ?? symbol}</span>
        <span className="text-lg font-bold tabular-nums text-text-primary">
          {formatPrice(price, currency)}
        </span>
      </div>

      {/* 매수 / 매도 */}
      <div className="grid grid-cols-2 gap-1.5">
        {(['BUY', 'SELL'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSide(value)}
            className={`rounded-md border py-1.5 text-xs font-medium transition-colors ${
              side === value
                ? value === 'BUY'
                  ? 'border-bearish bg-bearish/15 text-bearish'
                  : 'border-bullish bg-bullish/15 text-bullish'
                : 'border-border text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {value === 'BUY' ? '매수' : '매도'}
          </button>
        ))}
      </div>

      {side === 'SELL' && (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-text-muted">
            보유 <span className="tabular-nums text-text-secondary">{position?.quantity ?? 0}</span>주
          </span>
          {position && (
            <button
              type="button"
              onClick={() => setQuantity(position.quantity)}
              className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            >
              전량 매도
            </button>
          )}
        </div>
      )}

      {/* 시장가 / 지정가 */}
      <div className="grid grid-cols-2 gap-1.5">
        {(['MARKET', 'LIMIT'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setOrderType(value)}
            className={`rounded-md border py-1 text-[11px] transition-colors ${
              orderType === value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {value === 'MARKET' ? '시장가' : '지정가'}
          </button>
        ))}
      </div>

      {orderType === 'LIMIT' && (
        <label className="flex items-center gap-2 text-[11px] text-text-muted">
          가격
          <input
            type="number"
            step="0.01"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder={price != null ? String(price) : ''}
            className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-right tabular-nums text-text-primary focus:border-accent focus:outline-none"
          />
        </label>
      )}

      <label className="flex items-center gap-2 text-[11px] text-text-muted">
        수량
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(0, Number(e.target.value)))}
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-right tabular-nums text-text-primary focus:border-accent focus:outline-none"
        />
      </label>

      {estimate && (
        <div className="space-y-1 rounded-md bg-bg-tertiary/50 px-2.5 py-2">
          {row('주문 금액', formatPrice(estimate.amount, currency))}
          {row('수수료', formatPrice(estimate.commission, currency))}
          {row(
            '예상 체결가',
            formatPrice(estimate.executed, currency),
            'text-text-primary',
          )}
          {row(
            side === 'BUY' ? '필요 금액' : '수령 금액',
            formatPrice(side === 'BUY' ? estimate.total : estimate.amount - estimate.commission, currency),
            'text-text-primary',
          )}
          {estimate.realized != null &&
            row(
              '예상 실현손익',
              formatPrice(estimate.realized, currency),
              estimate.realized >= 0 ? 'text-bullish' : 'text-bearish',
            )}
        </div>
      )}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="주문 사유 (예: RSI 30 이하)"
        className="rounded border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary focus:border-accent focus:outline-none"
      />

      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || !canSubmit}
        className={`rounded-md py-2 text-sm font-medium text-white transition-colors disabled:opacity-40 ${
          side === 'BUY' ? 'bg-bearish hover:brightness-110' : 'bg-bullish hover:brightness-110'
        }`}
      >
        {busy ? '주문 중…' : side === 'BUY' ? '매수 주문' : '매도 주문'}
      </button>

      {message && (
        <p className={`text-[11px] ${message.kind === 'ok' ? 'text-bullish' : 'text-bearish'}`}>
          {message.kind === 'ok' ? '✅' : '❌'} {message.text}
        </p>
      )}
    </section>
  );
}
