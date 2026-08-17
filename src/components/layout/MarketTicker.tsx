import { useEffect, useState } from 'react';
import type { MarketIndex } from '../../types/analysis';
import type { ExchangeRate } from '../../types/toss';

/** 시황은 초 단위로 볼 필요가 없다 */
const POLL_INTERVAL_MS = 30_000;

/** 상단 시황 바 — 주요 지수와 환율을 곁눈질로 확인한다. */
export default function MarketTicker() {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [rate, setRate] = useState<ExchangeRate | null>(null);

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

  const item = (label: string, price: number | null, changeRate: number | null, unit = '') => {
    const up = changeRate != null && changeRate > 0;
    const down = changeRate != null && changeRate < 0;
    const color = up ? 'text-bullish' : down ? 'text-bearish' : 'text-text-muted';

    return (
      <span key={label} className="flex shrink-0 items-baseline gap-1.5">
        <span className="text-text-muted">{label}</span>
        <span className="tabular-nums text-text-primary">
          {price != null
            ? `${unit}${price.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`
            : '—'}
        </span>
        {changeRate != null && (
          <span className={`tabular-nums ${color}`}>
            {up ? '▲' : down ? '▼' : ''}
            {Math.abs(changeRate).toFixed(2)}%
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-5 overflow-x-auto border-b border-border bg-bg-secondary px-3 text-[11px] whitespace-nowrap">
      {indices.length === 0 && <span className="text-text-muted">시황 불러오는 중…</span>}
      {indices.map((index) => item(index.label, index.price, index.changeRate))}
      {rate && (
        <>
          <span className="h-3 w-px shrink-0 bg-border" />
          {item(`${rate.baseCurrency}/${rate.quoteCurrency}`, rate.rate, null, '₩')}
        </>
      )}
    </div>
  );
}
