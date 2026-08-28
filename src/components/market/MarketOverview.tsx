import { useEffect, useState } from 'react';
import type { MarketIndex } from '../../types/analysis';
import type { ExchangeRate } from '../../types/toss';
import MarketCard from './MarketCard';
import { Skeleton } from '../common/SkeletonLoader';

/** 현재가는 30초, 스파크라인은 서버가 캐시하므로 같은 주기로 함께 받는다. */
const POLL_INTERVAL_MS = 30_000;
const COLLAPSE_KEY = 'alphascope.marketCollapsed';

/** 시황 카드 그리드 — 접어 두면 차트 영역이 넓어진다. */
export default function MarketOverview() {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/market-overview');
        const data = await res.json();
        if (cancelled) return;
        setIndices(Array.isArray(data.indices) ? data.indices : []);
        setRate(data.rate ?? null);
      } catch {
        // 다음 주기에 자연스럽게 재시도된다.
      }
    };

    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  // 접힌 상태 — 한 줄 요약만 남긴다.
  if (collapsed) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-4 overflow-x-auto border-b border-border bg-bg-secondary px-3 text-[11px] whitespace-nowrap">
        {indices.slice(0, 4).map((index) => {
          const up = index.changeRate != null && index.changeRate > 0;
          const down = index.changeRate != null && index.changeRate < 0;
          return (
            <span key={index.symbol} className="flex shrink-0 items-baseline gap-1.5">
              <span className="text-text-muted">{index.label}</span>
              <span className="tabular-nums text-text-primary">
                {index.price?.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) ?? '—'}
              </span>
              <span
                className={`tabular-nums ${up ? 'text-bullish' : down ? 'text-bearish' : 'text-text-muted'}`}
              >
                {index.changeRate != null &&
                  `${up ? '▲' : down ? '▼' : ''}${Math.abs(index.changeRate).toFixed(2)}%`}
              </span>
            </span>
          );
        })}

        <button
          type="button"
          onClick={toggle}
          className="ml-auto shrink-0 text-text-muted transition-colors hover:text-text-primary"
        >
          ▼ 시황 펼치기
        </button>
      </div>
    );
  }

  return (
    <section className="shrink-0 border-b border-border bg-bg-primary px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-[11px] text-text-secondary">시황</h2>
        <button
          type="button"
          onClick={toggle}
          className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
        >
          ▲ 접기
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {/* 첫 응답 전에는 카드 자리를 스켈레톤으로 잡아 둔다 —
            비워 두면 시황이 도착하는 순간 아래 화면 전체가 밀려 내려간다. */}
        {indices.length === 0 &&
          Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border border-border bg-bg-secondary px-3 py-2"
            >
              <Skeleton className="mb-1.5 h-2.5 w-14" />
              <Skeleton className="mb-1 h-5 w-24" />
              <Skeleton className="h-2.5 w-16" />
            </div>
          ))}
        {indices.map((index) => (
          <MarketCard
            key={index.symbol}
            name={index.label}
            value={index.price}
            change={index.change ?? null}
            changePercent={index.changeRate}
            sparklineData={index.sparkline ?? []}
          />
        ))}

        {rate && (
          <MarketCard
            name={`${rate.baseCurrency}/${rate.quoteCurrency}`}
            value={rate.rate}
            change={null}
            changePercent={null}
            sparklineData={rate.sparkline ?? []}
            unit="₩"
          />
        )}
      </div>
    </section>
  );
}
