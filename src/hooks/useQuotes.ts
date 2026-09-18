import { useMemo } from 'react';
import type { Quote } from '../types/toss';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 1000;

/**
 * 여러 종목의 현재가·전일 대비를 1초 간격으로 갱신한다 (관심 목록·최근 조회·탐색 홈).
 *
 * 목록 전체를 한 번의 요청으로 받는다. 탭이 백그라운드면 쉬고, 다시 보이면 즉시 갱신한다.
 * Rate Limit 을 고려해 **화면에 보이는 목록만** 넘겨야 한다.
 *
 * ⚠️ 폴링은 `usePolling` 의 **URL 별 공유 폴러**를 쓴다. 예전에는 이 훅이 자기 타이머를
 * 들고 있어서, 같은 목록을 보는 화면이 둘이면(관심 목록 패널 + 그 위에 뜬 관리 팝업)
 * 같은 요청이 초당 두 번 나갔다 — CLAUDE.md 의 「같은 데이터를 두 번 받지 않는다」 원칙이다.
 */
export function useQuotes(symbols: string[]): Record<string, Quote> {
  // 배열은 매 렌더 새 참조라 내용으로 URL 을 만든다 (폴러 공유의 키이기도 하다).
  const key = symbols.join(',');

  const quotes = usePolling<Quote[]>(
    `/api/quotes?symbols=${key}`,
    (payload) => (Array.isArray(payload.quotes) ? (payload.quotes as Quote[]) : undefined),
    POLL_INTERVAL_MS,
    Boolean(key),
  );

  return useMemo(() => {
    const next: Record<string, Quote> = {};
    for (const quote of quotes ?? []) next[quote.symbol] = quote;
    return next;
  }, [quotes]);
}
