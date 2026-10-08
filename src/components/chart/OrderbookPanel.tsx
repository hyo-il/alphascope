import { useEffect, useMemo, useRef } from 'react';
import type { Orderbook, OrderbookLevel } from '../../types/toss';
import { formatCompact } from '../../utils/formatters';

interface Props {
  orderbook: Orderbook | null;
  /** 현재가 — 중앙에 크게 표시한다 */
  currentPrice: number | null;
  /** 전일 종가 — 각 호가의 등락률 기준 */
  previousClose: number | null;
  /** 원화 종목은 소수점을 쓰지 않는다 */
  currency: 'KRW' | 'USD';
  /** 지금 종목 — 바뀌면 현재가 칸을 다시 가운데로 스크롤한다 */
  symbol: string | null;
  /** 호가 가격 칸을 누르면 그 가격을 빠른주문 가격 칸으로 보낸다 */
  onPickPrice?: (price: number) => void;
}

/** 호가 한 줄 — 매도는 왼쪽, 매수는 오른쪽으로 잔량 막대가 자란다 (토스 WTS 방식). */
function Row({
  level,
  max,
  side,
  previousClose,
  isBest,
  isCurrent,
  currency,
  onPick,
}: {
  level: OrderbookLevel;
  max: number;
  side: 'ask' | 'bid';
  previousClose: number | null;
  isBest: boolean;
  /** 현재가와 같은 가격 칸 — 테두리 상자 (v2.41.0, 예전 가운데 현재가 줄 대신) */
  isCurrent: boolean;
  currency: 'KRW' | 'USD';
  onPick?: (price: number) => void;
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
    <div className="relative flex flex-1 items-center px-1.5">
      {/* 잔량 막대 — 매도는 오른쪽 끝(가격 쪽)에서, 매수는 왼쪽 끝에서 자란다 */}
      <div
        className={`absolute inset-y-0.5 ${isAsk ? 'right-0' : 'left-0'} rounded-sm ${
          isAsk ? 'bg-bearish/20' : 'bg-bullish/20'
        }`}
        style={{ width: `${ratio}%` }}
      />
      <span
        className={`relative block w-full text-caption tabular-nums text-text-secondary ${
          isAsk ? 'text-right' : 'text-left'
        }`}
      >
        {level.quantity > 0 ? formatCompact(level.quantity) : ''}
      </span>
    </div>
  );

  const label = currency === 'KRW' ? Math.round(level.price).toLocaleString('ko-KR') : level.price.toFixed(2);
  /* 가격 칸 = 버튼(키보드로도) — 누르면 빠른주문 가격 칸이 이 가격으로 채워진다 */
  const price = (
    <button
      type="button"
      onClick={() => onPick?.(level.price)}
      title={`${label} — 빠른주문 가격 칸에 넣기`}
      aria-label={`호가 ${label} — 빠른주문 가격 칸에 넣기`}
      className={`flex w-[92px] shrink-0 flex-col items-center justify-center rounded-md px-1 transition-colors hover:bg-bg-elevated ${
        isBest ? 'bg-bg-tertiary/60' : ''
      } ${isCurrent ? 'ring-1 ring-inset ring-text-primary/60' : ''}`}
    >
      <span className={`block whitespace-nowrap text-xs font-medium leading-tight tabular-nums ${priceColor}`}>{label}</span>
      {rate != null && (
        <span className={`block whitespace-nowrap text-caption leading-tight tabular-nums ${priceColor} opacity-70`}>
          {rate > 0 ? '+' : ''}
          {rate.toFixed(2)}%
        </span>
      )}
    </button>
  );

  return (
    <div className="flex h-10 items-stretch" data-price={level.price}>
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

export default function OrderbookPanel({
  orderbook,
  currentPrice,
  previousClose,
  currency,
  symbol,
  onPickPrice,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const boundaryRef = useRef<HTMLDivElement>(null);
  /** 이 종목에서 이미 가운데로 맞췄는가 — 1초 폴링마다 다시 스크롤하지 않는다(사용자가 옮긴 위치 유지) */
  const centeredFor = useRef<string | null>(null);
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
  const bookSymbol = orderbook?.symbol ?? null;

  // 처음·종목이 바뀔 때 한 번 — 매도·매수 경계(현재가 근처)를 목록 가운데로
  useEffect(() => {
    if (isEmpty || !bookSymbol || bookSymbol !== symbol || centeredFor.current === bookSymbol) return;
    const list = listRef.current;
    const mark = boundaryRef.current;
    if (!list || !mark) return;
    const offset = mark.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += offset - list.clientHeight / 2;
    centeredFor.current = bookSymbol;
  }, [isEmpty, bookSymbol, symbol]);

  return (
    // 최소 높이 241px = 머리 36 + 줄 이름 23 + 호가 3칸 120 + 총잔량 62 (v2.41.0) — 이보다 낮은 창에서만 열 전체가 스크롤된다
    <aside className="flex min-h-[241px] w-[248px] flex-1 flex-col border-l border-border bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium">호가</h2>
      </header>

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-xs text-text-secondary">호가가 비어 있습니다</p>
          <p className="text-caption leading-relaxed text-text-muted">
            {currency === 'KRW'
              ? '국내장 정규 시간(09:00~15:30)에 호가가 들어옵니다.'
              : '미국장 정규 시간(한국시간 22:30~05:00)에 호가가 들어옵니다.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-between px-3 py-0.5 text-caption text-text-muted">
            <span>매도 잔량</span>
            <span>호가</span>
            <span>매수 잔량</span>
          </div>

          {/* 호가 목록 — 이 열의 **유일한 스크롤**(v2.41.0). 최소 3칸, 스크롤바 자리는 미리 비워 둔다(Windows 칸 어긋남) */}
          <div ref={listRef} className="min-h-[120px] flex-1 overflow-y-auto [scrollbar-gutter:stable]">
            {asks.map((level, index) => (
              <Row
                key={`ask-${level.price}`}
                level={level}
                max={maxQuantity}
                side="ask"
                previousClose={previousClose}
                isBest={index === asks.length - 1}
                isCurrent={currentPrice != null && level.price === currentPrice}
                currency={currency}
                onPick={onPickPrice}
              />
            ))}

            {/* 매도·매수 경계 — 처음·종목이 바뀔 때 여기를 가운데로 스크롤한다 */}
            <div ref={boundaryRef} className="h-px bg-border" aria-hidden />

            {bids.map((level, index) => (
              <Row
                key={`bid-${level.price}`}
                level={level}
                max={maxQuantity}
                side="bid"
                previousClose={previousClose}
                isBest={index === 0}
                isCurrent={currentPrice != null && level.price === currentPrice}
                currency={currency}
                onPick={onPickPrice}
              />
            ))}
          </div>

          <div className="border-t border-border px-3 py-1">
            <div className="flex items-center justify-between text-caption tabular-nums">
              <span className="text-bearish">{formatCompact(askTotal)}</span>
              <span className="text-caption text-text-muted">총잔량</span>
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
              <p className="mt-1.5 text-center text-caption text-text-muted">
                스프레드 {currency === 'KRW' ? Math.round(spread).toLocaleString('ko-KR') : spread.toFixed(2)}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
