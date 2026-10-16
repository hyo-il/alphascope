import { useEffect } from 'react';
import { useStockNames } from './useStockNames';

/**
 * 브라우저 탭 제목 — 보고 있는 종목이 있으면 **`AlphaScope · 애플`**(앱 이름 먼저 · 종목 **이름**, v2.51.3 사용자 결정).
 * 종목이 없으면 `AlphaScope`.
 *
 * 여러 탭을 띄워 두었을 때 어느 탭이 어느 종목인지 구분하려는 것이다.
 * - 이름은 `StockName` 과 같은 출처(`utils/stockNames` 캐시 — `useStockNames` 가 모르는 이름을 받아 온다).
 *   **이름을 아직 모르면 `AlphaScope` 만** — 티커(코드)는 보이지 않는다.
 * - ⚠️ **가격은 넣지 않는다** — 현재가는 1초 폴링이라 제목이 매초 바뀌어 산만하고,
 *   탭 목록·방문 기록에도 그 값이 그대로 남는다.
 */
export function useDocumentTitle(symbol: string | null) {
  const nameOf = useStockNames([symbol]);
  const name = symbol ? nameOf(symbol)?.trim() || null : null;
  useEffect(() => {
    document.title = name ? `AlphaScope · ${name}` : 'AlphaScope';
  }, [name]);
}
