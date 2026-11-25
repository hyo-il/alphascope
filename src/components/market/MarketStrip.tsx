import { useEffect, useRef, useState } from 'react';
import Dialog from '../ui/Dialog';
import { Skeleton } from '../common/SkeletonLoader';
import { useMarketOverview } from '../../hooks/useMarketOverview';
import { MarketCardGrid } from './MarketOverview';

/**
 * 오늘 시황 한 줄 띠(v2.73.0 · 테마 3-4) — 폰 · 패드 모양에서 큰 화면 시황 줄(`MarketOverview`) 대신.
 *
 * - 높이 40 · 지수마다 「이름 값 등락」(13) · 넘치면 가로로 밀어 봄 · 더 밀 수 있으면 오른쪽 끝 32 흐림.
 * - 띠 전체가 단추 — 누르면 펼친 시황(카드)을 창으로 연다. 창은 공용 `Dialog`(폰 아래 판은 147차에 그 부품이 바뀌면 함께 바뀜).
 * - 접힘 기억(localStorage)은 쓰지 않는다(큰 화면만).
 */
export default function MarketStrip() {
  const { indices, rate, loaded } = useMarketOverview();
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLButtonElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [indices]);

  return (
    <div className="relative h-10 shrink-0 bg-bg-primary" data-testid="market-strip">
      <button
        ref={scrollRef}
        type="button"
        aria-label="시황 펼치기"
        onClick={() => setOpen(true)}
        className="flex h-full w-full items-center gap-4 overflow-x-auto whitespace-nowrap px-4 text-caption [scrollbar-width:none]"
      >
        {!loaded &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-2.5 w-24 shrink-0" />)}
        {indices.map((index) => {
          const up = index.changeRate != null && index.changeRate > 0;
          const down = index.changeRate != null && index.changeRate < 0;
          return (
            <span key={index.symbol} className="inline-flex shrink-0 items-baseline gap-1.5">
              <span className="text-text-secondary">{index.label}</span>
              <span className="tabular-nums text-text-primary">{index.price?.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) ?? '—'}</span>
              <span className={`tabular-nums ${up ? 'text-bullish' : down ? 'text-bearish' : 'text-text-secondary'}`}>
                {index.changeRate != null && `${up ? '+' : down ? '−' : ''}${Math.abs(index.changeRate).toFixed(2)}%`}
              </span>
            </span>
          );
        })}
      </button>
      {more && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-r from-transparent to-bg-primary" />}
      {open && (
        <Dialog title="시황" onClose={() => setOpen(false)} size="md">
          <MarketCardGrid indices={indices} rate={rate} className="grid grid-cols-2 gap-2" />
        </Dialog>
      )}
    </div>
  );
}
