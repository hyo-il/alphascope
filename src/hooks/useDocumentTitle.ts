import { useEffect } from 'react';

/**
 * 브라우저 탭 제목 — 보고 있는 종목이 있으면 `AAPL · AlphaScope`.
 *
 * 여러 탭을 띄워 두었을 때 어느 탭이 어느 종목인지 구분하려는 것이다.
 * ⚠️ **가격은 넣지 않는다** — 현재가는 1초 폴링이라 제목이 매초 바뀌어 산만하고,
 * 탭 목록·방문 기록에도 그 값이 그대로 남는다.
 */
export function useDocumentTitle(symbol: string | null) {
  useEffect(() => {
    document.title = symbol ? `${symbol} · AlphaScope` : 'AlphaScope';
  }, [symbol]);
}
