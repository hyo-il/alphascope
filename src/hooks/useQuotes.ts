import { useEffect, useRef, useState } from 'react';
import type { Quote } from '../types/toss';

const POLL_INTERVAL_MS = 1000;

/**
 * 여러 종목의 현재가·전일 대비를 1초 간격으로 갱신한다 (관심 목록·최근 조회용).
 *
 * 목록 전체를 한 번의 요청으로 받는다. 탭이 백그라운드면 쉬고, 다시 보이면 즉시 갱신한다.
 * Rate Limit 을 고려해 **화면에 보이는 목록만** 넘겨야 한다.
 */
export function useQuotes(symbols: string[]): Record<string, Quote> {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const inflight = useRef(false);

  // 배열은 매 렌더 새 참조라 내용으로 의존성을 만든다.
  const key = symbols.join(',');

  useEffect(() => {
    if (!key) {
      setQuotes({});
      return;
    }

    let cancelled = false;

    // 최초 1회는 탭이 숨겨져 있어도 받아 온다 — 나중에 창을 봤을 때 빈 목록이 아니도록.
    const tick = async (force = false) => {
      if (inflight.current || (document.hidden && !force)) return;
      inflight.current = true;
      try {
        const res = await fetch(`/api/quotes?symbols=${key}`);
        const data = await res.json();
        if (cancelled || !Array.isArray(data.quotes)) return;

        const next: Record<string, Quote> = {};
        for (const quote of data.quotes as Quote[]) next[quote.symbol] = quote;
        setQuotes(next);
      } catch {
        // 다음 tick 에서 자연스럽게 재시도된다.
      } finally {
        inflight.current = false;
      }
    };

    void tick(true);
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      // StrictMode 재마운트 시 이 플래그가 true 로 남으면 다음 effect 의 첫 요청이
      // 통째로 스킵되고, 이미 날아간 응답은 cancelled 로 버려져 데이터가 비어 버린다.
      inflight.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);

  return quotes;
}
