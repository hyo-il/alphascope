import type { Price } from '../types/toss';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 1000;

/**
 * 현재가 1초 REST 폴링 — 메인 차트 헤더(App)와 실시간 순위 미리보기가 쓴다.
 * `enabled` 가 false 면 부르지 않는다(보이지 않는 쪽은 쉰다 — 토스 요청 수).
 */
export function useRealtimePrice(symbol: string | null, enabled = true): Price | null {
  return usePolling<Price>(
    `/api/prices?symbol=${symbol ?? ''}`,
    (payload) => payload.price as Price | undefined,
    POLL_INTERVAL_MS,
    Boolean(symbol) && enabled,
  );
}
