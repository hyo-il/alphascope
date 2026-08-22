import type { Price } from '../types/toss';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 1000;

/** 현재가 1초 REST 폴링 */
export function useRealtimePrice(symbol: string | null): Price | null {
  return usePolling<Price>(
    `/api/prices?symbol=${symbol ?? ''}`,
    (payload) => payload.price as Price | undefined,
    POLL_INTERVAL_MS,
    Boolean(symbol),
  );
}
