import type { Orderbook } from '../types/toss';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 1000;

/**
 * 호가 1초 REST 폴링.
 *
 * `enabled` 가 필요한 이유: 차트는 캡처 대상으로 쓰려고 다른 화면에서도
 * 언마운트하지 않는다(화면 밖으로 보낸다). 그래서 가드가 없으면 모의투자·AI 분석
 * 화면에서도 보이지도 않는 호가를 초당 한 번씩 계속 받아 온다.
 */
export function useOrderbook(symbol: string | null, enabled = true): Orderbook | null {
  return usePolling<Orderbook>(
    `/api/orderbook?symbol=${symbol ?? ''}`,
    (payload) => payload.orderbook as Orderbook | undefined,
    POLL_INTERVAL_MS,
    Boolean(symbol) && enabled,
  );
}
