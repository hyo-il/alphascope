import { PANEL_X, TOUCH_TABLE_ROW } from '../ui/tokens';
import { useEffect, useMemo, useRef } from 'react';
import type { Orderbook, OrderbookLevel } from '../../types/toss';
import { formatCompact, formatSigned, formatNumber } from '../../utils/formatters';
import { usRegularSessionKstText } from '../../utils/marketDate';
import { Skeleton } from '../common/SkeletonLoader';

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
  /**
   * 폭 전체(v2.82.0 폰 — 차트 아래 [호가] 탭 안). 줄 높이 · 글 · 색은 그대로이고, 목록은 안에서 따로 밀지 않고 본문과 함께 밀린다.
   * 넘기지 않으면 지금처럼 차트 오른쪽 열(248).
   */
  full?: boolean;
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
  /** 현재가와 같은 가격 칸 — 테두리 상자 */
  isCurrent: boolean;
  currency: 'KRW' | 'USD';
  onPick?: (price: number) => void;
}) {
  const isAsk = side === 'ask';
  const ratio = Math.min(100, (level.quantity / max) * 100);
  const rate =
    previousClose && previousClose > 0 ? ((level.price - previousClose) / previousClose) * 100 : null;

  // 전일 종가보다 오르면 초록 · 내리면 빨강(앱 전체 등락 색과 같음 — 테마 9-1 R2 · R3)
  const priceColor =
    rate == null
      ? 'text-text-primary'
      : rate > 0
        ? 'text-bullish'
        : rate < 0
          ? 'text-bearish'
          : 'text-text-secondary';

  const quantity = (
    <div className="relative flex flex-1 items-center px-1.5">
      {/* 잔량 막대 — 매도는 오른쪽 끝(가격 쪽)에서, 매수는 왼쪽 끝에서 자란다 */}
      <div
        className={`absolute inset-y-0.5 ${isAsk ? 'right-0' : 'left-0'} rounded-sm ${
          isAsk ? 'bg-bearish/20' : 'bg-bullish/20'
        }`}
        data-tone={isAsk ? 'sell' : undefined}
        data-side={isAsk ? 'ask' : 'bid'}
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

  const label = currency === 'KRW' ? Math.round(level.price).toLocaleString('ko-KR') : formatNumber(level.price, 2);
  /* 가격 칸 = 버튼(키보드로도) — 누르면 빠른주문 가격 칸이 이 가격으로 채워진다 */
  const price = (
    <button
      type="button"
      onClick={() => onPick?.(level.price)}
      data-tip={`${label} — 빠른주문 가격 칸에 넣기`}
      aria-label={`호가 ${label} — 빠른주문 가격 칸에 넣기`}
      className={`flex w-[92px] shrink-0 flex-col items-center justify-center rounded-md px-1 transition-colors hover:bg-bg-elevated ${
        isBest ? 'bg-bg-tertiary/60' : ''
      } ${isCurrent ? 'ring-1 ring-inset ring-text-primary/60' : ''}`}
    >
      <span className={`block whitespace-nowrap text-xs font-medium leading-tight tabular-nums ${priceColor}`} data-tone={rate != null && rate < 0 ? 'down' : undefined}>{label}</span>
      {rate != null && (
        <span className={`block whitespace-nowrap text-caption leading-tight tabular-nums ${priceColor} opacity-70`}>
          {formatSigned(rate, 2, '%')}
        </span>
      )}
    </button>
  );

  return (
    <div className={`flex h-10 items-stretch ${TOUCH_TABLE_ROW}`} data-price={level.price}>
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
  full = false,
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

  /** 사용자가 이 종목에서 목록을 직접 스크롤했는가 — 그 뒤로는 위치를 건드리지 않는다 */
  const userMoved = useRef(false);
  /** 우리가 맞춘 scrollTop — 이 값으로 생긴 scroll 이벤트는 사용자 스크롤로 세지 않는다 */
  const programmatic = useRef<number | null>(null);
  const center = () => {
    const list = listRef.current;
    const mark = boundaryRef.current;
    if (!list || !mark) return;
    const offset = mark.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += offset - list.clientHeight / 2;
    programmatic.current = list.scrollTop;
  };

  // 처음·종목이 바뀔 때 한 번 — 매도·매수 경계(현재가 근처)를 목록 가운데로
  useEffect(() => {
    if (isEmpty || !bookSymbol || bookSymbol !== symbol || centeredFor.current === bookSymbol) return;
    userMoved.current = false;
    center();
    centeredFor.current = bookSymbol;
  }, [isEmpty, bookSymbol, symbol]);

  /*
   * 목록 높이가 나중에 바뀌면(차트 화면이 보이게 될 때·빠른주문이 그려질 때·창 크기) 다시 가운데로.
   * 오른쪽 열이 길어 처음 맞춘 뒤 목록이 자라면 매수 호가가 화면 밖에 남는다(1920 에서 매수 0줄).
   * 사용자가 직접 스크롤한 뒤에는 맞추지 않는다 — 1초 폴링으로 다시 맞추지 않는 규칙도 그대로다.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    let lastH = list.clientHeight;
    const ro = new ResizeObserver(() => {
      if (list.clientHeight === lastH) return;
      lastH = list.clientHeight;
      if (!userMoved.current && centeredFor.current) center();
    });
    ro.observe(list);
    const onScroll = () => {
      if (programmatic.current != null && Math.abs(list.scrollTop - programmatic.current) <= 1) return;
      userMoved.current = true;
    };
    list.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      list.removeEventListener('scroll', onScroll);
    };
  }, [isEmpty]);

  return (
    // 최소 높이 241px = 머리 36 + 줄 이름 23 + 호가 3칸 120 + 총잔량 62 — 이보다 낮은 창에서만 열 전체가 스크롤된다
    <aside data-testid="orderbook" className={full ? 'flex w-full flex-col bg-bg-secondary' : 'flex min-h-[241px] w-[248px] flex-1 flex-col border-l border-border bg-bg-secondary'}>
      <header className={`flex items-center justify-between border-b border-border py-2 ${full ? PANEL_X : 'px-3'}`}>
        <h2 className="text-xs font-medium">호가</h2>
      </header>

      {orderbook == null ? (
        // 받기 전 — 「비어 있습니다」 를 그리지 않고 호가 줄 자리를 잡는다
        <div className="flex-1 space-y-2 px-3 py-3" aria-hidden>
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
          <p className="text-xs text-text-secondary">호가가 비어 있습니다</p>
          <p className="text-caption leading-relaxed text-text-muted">
            {currency === 'KRW'
              ? '국내장 정규 시간(09:00~15:30)에 호가가 들어옵니다.'
              : `미국장 정규 시간(한국시간 ${usRegularSessionKstText()})에 호가가 들어옵니다.`}
          </p>
        </div>
      ) : (
        <>
          <div className={`flex justify-between py-0.5 text-caption text-text-muted ${full ? PANEL_X : 'px-3'}`}>
            <span>매도 잔량</span>
            <span>호가</span>
            <span>매수 잔량</span>
          </div>

          {/* 호가 목록 — 이 열의 **유일한 스크롤**. 최소 3칸, 스크롤바 자리는 미리 비워 둔다(Windows 칸 어긋남) */}
          <div ref={listRef} className={full ? '' : 'min-h-[120px] flex-1 overflow-y-auto [scrollbar-gutter:stable]'}>
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

          <div className={`border-t border-border py-1 ${full ? PANEL_X : 'px-3'}`}>
            <div className="flex items-center justify-between text-caption tabular-nums">
              <span className="text-bearish" data-tone="sell">{formatCompact(askTotal)}</span>
              <span className="text-caption text-text-muted">총잔량</span>
              <span className="text-bullish">{formatCompact(bidTotal)}</span>
            </div>

            {/* 매도·매수 잔량 비율 — 어느 쪽 압력이 센지 한눈에 */}
            <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-bg-tertiary">
              <div
                className="bg-bearish/70"
                data-tone="sell"
                style={{ width: `${(askTotal / Math.max(1, askTotal + bidTotal)) * 100}%` }}
              />
              <div className="flex-1 bg-bullish/70" />
            </div>

            {spread != null && (
              <p className="mt-1.5 text-center text-caption text-text-muted">
                스프레드 {currency === 'KRW' ? Math.round(spread).toLocaleString('ko-KR') : formatNumber(spread, 2)}
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
