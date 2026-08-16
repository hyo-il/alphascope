import { useEffect, useRef, useState } from 'react';
import type { Price } from '../types/toss';

const POLL_INTERVAL_MS = 1000;

/**
 * 현재가 1초 REST 폴링.
 * - 탭이 백그라운드일 때는 폴링을 멈춰 불필요한 API 호출을 줄인다.
 * - 이전 요청이 끝나기 전에는 다음 요청을 보내지 않는다 (겹침 방지).
 */
export function useRealtimePrice(symbol: string): Price | null {
  const [price, setPrice] = useState<Price | null>(null);
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPrice(null);

    const tick = async () => {
      if (inflight.current || document.hidden) return;
      inflight.current = true;
      try {
        const res = await fetch(`/api/prices?symbol=${symbol}`);
        const data = await res.json();
        if (!cancelled && data.price) setPrice(data.price);
      } catch {
        // 폴링 실패는 조용히 넘긴다 — 다음 tick 에서 자연스럽게 재시도된다.
      } finally {
        inflight.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [symbol]);

  return price;
}
