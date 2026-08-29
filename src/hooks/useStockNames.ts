import { useEffect, useSyncExternalStore } from 'react';
import { requestStockNames, stockNameOf, subscribeStockNames } from '../utils/stockNames';

/**
 * 목록에 필요한 종목명을 확보한다.
 *
 * 심볼 목록을 넘기면 모르는 것만 한 번에 받아 오고, 도착하면 리렌더한다.
 * 반환값은 조회 함수라, 호출부는 `name(symbol) ?? symbol` 로 쓰면 된다.
 */
export function useStockNames(symbols: (string | null | undefined)[]) {
  const key = symbols.filter(Boolean).join(',');

  useEffect(() => {
    requestStockNames(symbols);
    // key 로 의존성을 만든다 — 배열은 매 렌더 새 참조다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 캐시가 갱신되면 다시 그린다.
  useSyncExternalStore(
    subscribeStockNames,
    () => version(),
    () => 0,
  );

  return stockNameOf;
}

/**
 * useSyncExternalStore 는 스냅샷이 바뀌어야 리렌더한다.
 * 캐시 자체는 Map 이라 참조가 그대로이므로, 갱신 횟수를 스냅샷으로 쓴다.
 */
let versionCounter = 0;
subscribeStockNames(() => {
  versionCounter += 1;
});
function version() {
  return versionCounter;
}
