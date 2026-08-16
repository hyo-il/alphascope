import type { Orderbook } from '../types/toss';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 1000;

/** 호가 1초 REST 폴링 */
export function useOrderbook(symbol: string): Orderbook | null {
  return usePolling<Orderbook>(
    `/api/orderbook?symbol=${symbol}`,
    (payload) => payload.orderbook as Orderbook | undefined,
    POLL_INTERVAL_MS,
  );
}
