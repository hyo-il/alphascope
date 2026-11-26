import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Dialog from '../ui/Dialog';
import { Skeleton } from '../common/SkeletonLoader';
import { useMarketOverview } from '../../hooks/useMarketOverview';
import { MarketCardGrid } from './MarketOverview';
import { ClockText } from '../common/KstClock';
import { useClockStore } from '../../hooks/useClockSetting';

/**
 * 오늘 시황 한 줄 띠(v2.73.0 · 테마 3-4) — 폰 · 패드 모양에서 큰 화면 시황 줄(`MarketOverview`) 대신.
 *
 * - 높이 40 · 지수마다 「이름 값 등락」(13) · 넘치면 가로로 밀어 봄 · 더 밀 수 있으면 오른쪽 끝 32 흐림.
 * - 띠 전체가 단추 — 누르면 펼친 시황(카드)을 창으로 연다. 창은 공용 `Dialog`(폰 아래 판은 147차에 그 부품이 바뀌면 함께 바뀜).
 * - 접힘 기억(localStorage)은 쓰지 않는다(큰 화면만).
 * - **맨 왼쪽에 한국 시간 시계**(v2.74.0 · 사용자 결정 1 — 떠 있는 상자 대신): 띠를 가로로 밀어도 그 자리(지수 글만 뒤로 밀림) · 오른쪽 끝 흐림 16 ·
 *   띠 단추 밖이라 시계를 눌러도 시황 창이 열리지 않는다 · 끌기 · 핀 없음. 글 · 시간 계산은 떠 있는 시계와 같은 것(`common/KstClock` 의 `ClockText`).
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
    <div className="relative flex h-10 shrink-0 bg-bg-primary" data-testid="market-strip">
      <StripClock />
      <button
        ref={scrollRef}
        type="button"
        aria-label="시황 펼치기"
        onClick={() => setOpen(true)}
        className="flex h-full min-w-0 flex-1 items-center gap-4 overflow-x-auto whitespace-nowrap pl-4 pr-4 text-caption [scrollbar-width:none]"
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

/**
 * 시황 띠 맨 왼쪽 한국 시간 시계(폰 · 패드) — 띠 줄의 자리를 토스트가 피하게 알린다(`useClockStore.box` — 토스트 묶음이 띠 아래로 내려가
 * 위쪽 막대 · 시황 띠를 가리지 않는다). 시계가 띠 안에 붙어 있으므로 띠 줄 전체를 알린다.
 */
function StripClock() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const strip = ref.current?.parentElement;
    if (!strip) return;
    const report = () => {
      const r = strip.getBoundingClientRect();
      useClockStore.setState({ box: { left: r.left, top: r.top, width: r.width, height: r.height } });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(strip);
    window.addEventListener('resize', report);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', report);
      useClockStore.setState({ box: null });
    };
  }, []);
  return (
    <div ref={ref} role="group" aria-label="한국 시간" data-strip-clock className="relative z-10 flex shrink-0 select-none items-center gap-1.5 bg-bg-primary pl-4">
      <ClockText size="text-caption" />
      {/* 밀린 지수 글이 시계에 바로 붙어 보이지 않게 — 띠 바탕색 흐림 */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-full w-4 bg-gradient-to-r from-bg-primary to-transparent" />
    </div>
  );
}
