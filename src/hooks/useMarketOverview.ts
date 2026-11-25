import { useEffect, useState } from 'react';
import type { MarketIndex } from '../types/analysis';
import type { ExchangeRate } from '../types/toss';

/** 현재가는 30초, 스파크라인은 서버가 캐시하므로 같은 주기로 함께 받는다. */
const POLL_INTERVAL_MS = 30_000;

/**
 * 시황(지수 · 환율) 받기 — 큰 화면 시황 카드(`MarketOverview`)와 폰 · 패드 시황 띠(`MarketStrip`)가 같은 것을 쓴다.
 * 한 화면에는 둘 중 하나만 그려지므로 받기도 한 벌이다.
 * `loaded` = 첫 응답을 받았나(받기 전에는 「없음」 을 그리지 않고 스켈레톤).
 */
export function useMarketOverview() {
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch('/api/market-overview');
        const data = await res.json();
        if (cancelled) return;
        setIndices(Array.isArray(data.indices) ? data.indices : []);
        setRate(data.rate ?? null);
        setLoaded(true);
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

  return { indices, rate, loaded };
}
