import { useMemo, useRef } from 'react';
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
 *
 * ⚠️ **목록이 바뀌어도 이미 받은 값은 새 응답이 올 때까지 유지한다** (v2.22.0).
 * 종목 목록이 곧 URL 이라, 폴더를 접고 펴면 URL 이 바뀌고 `usePolling` 은 새 URL 의 첫 응답 전까지
 * null 을 준다 — 그 사이 화면에 남아 있는 **다른** 종목의 가격·등락률이 한 번씩 비었다(접기·펴기 10번에 10번).
 * 마지막 값을 기억했다가 **지금 목록에 있는 종목만** 꺼내 쓴다 — 목록에서 빠진 종목의 옛 값은 내지 않는다.
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

  /** 마지막으로 받은 값 (종목 → 시세). 새 응답이 오면 통째로 바뀐다 */
  const lastRef = useRef<Record<string, Quote>>({});

  return useMemo(() => {
    if (quotes) {
      const next: Record<string, Quote> = {};
      for (const quote of quotes) next[quote.symbol] = quote;
      lastRef.current = next;
      return next;
    }
    // 새 목록의 첫 응답 전 — 지금 목록에 있는 종목만 직전 값으로 채운다.
    const kept: Record<string, Quote> = {};
    if (key) {
      for (const symbol of key.split(',')) {
        const quote = lastRef.current[symbol];
        if (quote) kept[symbol] = quote;
      }
    }
    return kept;
  }, [quotes, key]);
}
