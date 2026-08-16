import { useMemo } from 'react';
import type { Orderbook, OrderbookLevel } from '../../types/toss';
import { formatCompact } from '../../utils/formatters';

interface Props {
  orderbook: Orderbook | null;
  /** 현재가 — 중앙에 크게 표시한다 */
  currentPrice: number | null;
  /** 전일 종가 — 각 호가의 등락률 기준 */
  previousClose: number | null;
}

/** 호가 한 줄 — 매도는 왼쪽, 매수는 오른쪽으로 잔량 막대가 자란다 (토스 WTS 방식). */
function Row({
  level,
  max,
  side,
  previousClose,
  isBest,
}: {
  level: OrderbookLevel;
  max: number;
  side: 'ask' | 'bid';
  previousClose: number | null;
  isBest: boolean;
}) {
  const isAsk = side === 'ask';
  const ratio = Math.min(100, (level.quantity / max) * 100);
  const rate =
    previousClose && previousClose > 0 ? ((level.price - previousClose) / previousClose) * 100 : null;

  const priceColor =
    rate == null
      ? 'text-text-primary'
      : rate > 0
        ? 'text-bearish'
        : rate < 0
          ? 'text-bullish'
          : 'text-text-secondary';

  const quantity = (
    <div className="relative flex-1 px-1.5 py-1">
      {/* 잔량 막대 — 매도는 오른쪽 끝(가격 쪽)에서, 매수는 왼쪽 끝에서 자란다 */}
      <div
        className={`absolute inset-y-0.5 ${isAsk ? 'right-0' : 'left-0'} rounded-sm ${
          isAsk ? 'bg-bearish/20' : 'bg-bullish/20'
        }`}
        style={{ width: `${ratio}%` }}
      />
      <span
        className={`relative block text-[11px] tabular-nums text-text-secondary ${
          isAsk ? 'text-right' : 'text-left'
        }`}
      >
        {level.quantity > 0 ? formatCompact(level.quantity) : ''}
      </span>
    </div>
  );

  const price = (
    <div
      className={`w-[86px] shrink-0 px-1.5 py-1 text-center ${
        isBest ? 'bg-bg-tertiary/60' : ''
      }`}
    >
      <span className={`block text-xs font-medium tabular-nums ${priceColor}`}>
        {level.price.toFixed(2)}
      </span>
      {rate != null && (
        <span className={`block text-[10px] tabular-nums ${priceColor} opacity-70`}>
          {rate > 0 ? '+' : ''}
          {rate.toFixed(2)}%
        </span>
      )}
    </div>
  );

  return (
    <div className="flex items-stretch">
      {isAsk ? (
        <>
          {quantity}
          {price}
          <div className="flex-1" />
        </>
      ) : (
        <>
          <div className="flex-1" />
          {price}
          {quantity}
        </>
      )}
    </div>
  );
}

export default function OrderbookPanel({ orderbook, currentPrice, previousClose }: Props) {
  const { asks, bids, maxQuantity, askTotal, bidTotal, spread } = useMemo(() => {
    // 매도는 현재가에서 먼 것이 위로 가도록 내림차순으로 뒤집는다.
    const askList = [...(orderbook?.asks ?? [])].sort((a, b) => b.price - a.price);
    const bidList = [...(orderbook?.bids ?? [])].sort((a, b) => b.price - a.price);
    const all = [...askList, ...bidList];

    const bestAsk = askList.at(-1)?.price ?? null;
    const bestBid = bidList[0]?.price ?? null;

    return {
      asks: askList,
      bids: bidList,
      maxQuantity: Math.max(1, ...all.map((l) => l.quantity)),
      askTotal: askList.reduce((sum, l) => sum + l.quantity, 0),
      bidTotal: bidList.reduce((sum, l) => sum + l.quantity, 0),
      spread: bestAsk != null && bestBid != null ? bestAsk - bestBid : null,
    };
  }, [orderbook]);

  const isEmpty = asks.length === 0 && bids.length === 0;
  const changeRate =
    previousClose && previousClose > 0 && currentPrice != null
      ? ((currentPrice - previousClose) / previousClose) * 100
      : null;

  return (
    <aside className="flex w-[248px] shrink-0 flex-col border-l border-border bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium">호가</h2>
        {orderbook && (
          <span className="text-[10px] text-text-muted">
            {new Date(orderbook.fetchedAt).toLocaleTimeString('ko-KR')}
          </span>
        )}
      </header>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-xs text-text-secondary">호가가 비어 있습니다</p>
          <p className="text-[11px] leading-relaxed text-text-muted">
            미국장 정규 시간(한국시간 22:30~05:00)에 호가가 들어옵니다.
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-between px-3 py-1 text-[10px] text-text-muted">
            <span>매도 잔량</span>
            <span>호가</span>
            <span>매수 잔량</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {asks.map((level, index) => (
              <Row
                key={`ask-${level.price}`}
                level={level}
                max={maxQuantity}
                side="ask"
                previousClose={previousClose}
                isBest={index === asks.length - 1}
              />
            ))}

            {/* 현재가 — 매도벽과 매수벽 사이 */}
            <div className="my-1 border-y border-border bg-bg-tertiary/70 px-3 py-1.5 text-center">
              <span className="block text-sm font-bold tabular-nums">
                {currentPrice != null ? currentPrice.toFixed(2) : '—'}
              </span>
              {changeRate != null && (
                <span
                  className={`block text-[10px] tabular-nums ${
                    changeRate > 0 ? 'text-bearish' : changeRate < 0 ? 'text-bullish' : 'text-text-muted'
                  }`}
                >
                  {changeRate > 0 ? '+' : ''}
                  {changeRate.toFixed(2)}%
                </span>
              )}
            </div>

            {bids.map((level, index) => (
              <Row
                key={`bid-${level.price}`}
                level={level}
                max={maxQuantity}
                side="bid"
                previousClose={previousClose}
                isBest={index === 0}
              />
            ))}
          </div>

          <div className="border-t border-border px-3 py-1.5">
            <div className="flex items-center justify-between text-[11px] tabular-nums">
              <span className="text-bearish">{formatCompact(askTotal)}</span>
              <span className="text-[10px] text-text-muted">총잔량</span>
              <span className="text-bullish">{formatCompact(bidTotal)}</span>
            </div>

            {/* 매도·매수 잔량 비율 — 어느 쪽 압력이 센지 한눈에 */}
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="bg-bearish/70"
                style={{ width: `${(askTotal / Math.max(1, askTotal + bidTotal)) * 100}%` }}
              />
              <div className="flex-1 bg-bullish/70" />
            </div>

            {spread != null && (
              <p className="mt-1.5 text-center text-[10px] text-text-muted">
                스프레드 {spread.toFixed(2)}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
