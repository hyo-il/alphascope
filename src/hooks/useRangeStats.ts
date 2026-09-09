import { useEffect, useState } from 'react';

/**
 * 52주 고저 (`GET /api/stats/52w`).
 *
 * 메인 차트와 캡처 팝업이 같은 값을 쓰므로 **모듈 캐시를 공유한다** — 훅을 두 번 부르는
 * 화면에서 같은 요청이 두 번 나가지 않는다 (종목명 캐시와 같은 방식).
 * 서버도 10분 캐시라, 종목을 오가며 봐도 왕복이 늘지 않는다.
 */

export interface RangeStats {
  symbol: string;
  high: number;
  low: number;
  highTime: number;
  lowTime: number;
  days: number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: RangeStats | null }>();
const inflight = new Map<string, Promise<RangeStats | null>>();

function load(symbol: string): Promise<RangeStats | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.value);

  const running = inflight.get(symbol);
  if (running) return running;

  const task = fetch(`/api/stats/52w?symbol=${encodeURIComponent(symbol)}`)
    .then((res) => (res.ok ? res.json() : { stats: null }))
    .then((data) => {
      const value = (data.stats ?? null) as RangeStats | null;
      cache.set(symbol, { at: Date.now(), value });
      return value;
    })
    // 실패해도 화면은 그대로 둔다 — 52주 고저는 없으면 그 줄만 비는 부가 정보다.
    .catch(() => null)
    .finally(() => inflight.delete(symbol));

  inflight.set(symbol, task);
  return task;
}

export function useRangeStats(symbol: string | null | undefined): RangeStats | null {
  const [stats, setStats] = useState<RangeStats | null>(null);

  useEffect(() => {
    if (!symbol) {
      setStats(null);
      return;
    }
    let cancelled = false;
    void load(symbol).then((value) => {
      if (!cancelled) setStats(value);
    });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  return stats;
}
