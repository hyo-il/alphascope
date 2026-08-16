import type { Orderbook, OrderbookLevel } from '../../types/toss';
import { formatCompact } from '../../utils/formatters';

interface Props {
  orderbook: Orderbook | null;
  /** 현재가 — 매도/매수 경계에 표시한다. */
  currentPrice: number | null;
}

/** 잔량 막대의 기준이 되는 최대 잔량 */
function maxQuantity(orderbook: Orderbook): number {
  const all = [...orderbook.asks, ...orderbook.bids].map((l) => l.quantity);
  return Math.max(1, ...all);
}

function Row({
  level,
  max,
  side,
}: {
  level: OrderbookLevel;
  max: number;
  side: 'ask' | 'bid';
}) {
  const ratio = Math.min(100, (level.quantity / max) * 100);
  const isAsk = side === 'ask';

  return (
    <div className="relative flex items-center justify-between px-3 py-1 text-xs tabular-nums">
      {/* 잔량 막대 — 매도는 오른쪽, 매수는 왼쪽에서 자란다 */}
      <div
        className={`absolute inset-y-0 ${isAsk ? 'right-0' : 'left-0'} ${
          isAsk ? 'bg-bearish/12' : 'bg-bullish/12'
        }`}
        style={{ width: `${ratio}%` }}
      />
      <span className={`relative ${isAsk ? 'text-bearish' : 'text-bullish'}`}>
        {level.price.toFixed(2)}
      </span>
      <span className="relative text-text-secondary">{formatCompact(level.quantity)}</span>
    </div>
  );
}

export default function OrderbookPanel({ orderbook, currentPrice }: Props) {
  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-l border-border bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-medium">호가</h2>
        <span className="text-xs text-text-muted">잔량</span>
      </header>

      {!orderbook || (!orderbook.asks.length && !orderbook.bids.length) ? (
        <p className="p-3 text-xs text-text-muted">호가 데이터 없음</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto">
          {/* 매도는 높은 가격이 위로 오도록 뒤집어 표시 */}
          <div>
            {[...orderbook.asks].reverse().map((level) => (
              <Row key={`ask-${level.price}`} level={level} max={maxQuantity(orderbook)} side="ask" />
            ))}
          </div>

          <div className="my-1 border-y border-border bg-bg-tertiary px-3 py-1.5 text-center text-sm font-semibold tabular-nums">
            {currentPrice != null ? currentPrice.toFixed(2) : '—'}
          </div>

          <div>
            {orderbook.bids.map((level) => (
              <Row key={`bid-${level.price}`} level={level} max={maxQuantity(orderbook)} side="bid" />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
