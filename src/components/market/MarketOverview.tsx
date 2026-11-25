import Button from '../ui/Button';
import { ICON_SM } from '../ui/icon';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { MarketIndex } from '../../types/analysis';
import type { ExchangeRate } from '../../types/toss';
import MarketCard from './MarketCard';
import { Skeleton } from '../common/SkeletonLoader';
import { useMarketOverview } from '../../hooks/useMarketOverview';

const COLLAPSE_KEY = 'alphascope.marketCollapsed';

/** 시황 카드 그리드 — 접어 두면 차트 영역이 넓어진다. 1280 이상 화면만(폰 · 패드는 `MarketStrip` 한 줄 띠) */
export default function MarketOverview() {
  const { indices, rate } = useMarketOverview();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  const toggle = () => {
    setCollapsed((prev) => {
      localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1');
      return !prev;
    });
  };

  // 접힌 상태 — 한 줄 요약만 남긴다.
  // ⚠️ 스크롤 막대가 생기지 않게: 버튼은 줄(h-8 − 아래 테두리 1px = 안쪽 31px)에 들어가는 sm(28px) · 지수가 넘치면 말줄임으로 자른다(스크롤 없음).
  if (collapsed) {
    return (
      <div className="flex h-8 shrink-0 items-center gap-4 overflow-hidden border-b border-border bg-bg-secondary px-3 text-caption whitespace-nowrap">
        <div className="min-w-0 flex-1 truncate">
          {indices.slice(0, 4).map((index) => {
            const up = index.changeRate != null && index.changeRate > 0;
            const down = index.changeRate != null && index.changeRate < 0;
            return (
              <span key={index.symbol} className="mr-4 inline-flex items-baseline gap-1.5 last:mr-0">
                <span className="text-text-muted">{index.label}</span>
                <span className="tabular-nums text-text-primary">
                  {index.price?.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) ?? '—'}
                </span>
                <span
                  className={`tabular-nums ${up ? 'text-bullish' : down ? 'text-bearish' : 'text-text-muted'}`}
                >
                  {index.changeRate != null &&
                    `${up ? '+' : down ? '−' : ''}${Math.abs(index.changeRate).toFixed(2)}%`}
                </span>
              </span>
            );
          })}
        </div>

        <Button variant="ghost" size="sm" onClick={toggle}>
          <ChevronDown {...ICON_SM} />
          시황 펼치기
        </Button>
      </div>
    );
  }

  return (
    <section className="shrink-0 border-b border-border bg-bg-primary px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-caption text-text-secondary">시황</h2>
        <Button variant="ghost" size="sm"
          onClick={toggle}>
          <ChevronUp {...ICON_SM} />
          접기
        </Button>
      </div>

      <MarketCardGrid indices={indices} rate={rate} />
    </section>
  );
}

/**
 * 펼친 시황 카드들 — 큰 화면 시황 줄과 폰 · 패드 시황 띠를 누르면 여는 창(`MarketStrip`)이 같은 것을 쓴다.
 * `className` = 칸 나눔(큰 화면은 화면 폭에 따라 2 · 4 · 7칸 — 기본값, 창 안은 2칸).
 */
export function MarketCardGrid({
  indices,
  rate,
  className = 'grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7',
}: {
  indices: MarketIndex[];
  rate: ExchangeRate | null;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* 첫 응답 전에는 카드 자리를 스켈레톤으로 잡아 둔다 —
          비워 두면 시황이 도착하는 순간 아래 화면 전체가 밀려 내려간다. */}
      {indices.length === 0 &&
        Array.from({ length: 7 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl bg-bg-secondary px-3 py-2"
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
  );
}
