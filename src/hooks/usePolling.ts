import { useEffect, useRef, useState } from 'react';

/**
 * 일정 주기로 데이터를 가져오는 공용 폴링 훅.
 *
 * - 탭이 백그라운드면 쉰다 (불필요한 API 호출 방지)
 * - 다시 보이는 순간 즉시 한 번 갱신한다. 그러지 않으면 숨겨진 채로 열린 탭은
 *   데이터가 영영 채워지지 않는다.
 * - 이전 요청이 끝나기 전에는 다음 요청을 보내지 않는다.
 */
export function usePolling<T>(
  url: string,
  pick: (payload: Record<string, unknown>) => T | undefined,
  intervalMs: number,
): T | null {
  const [data, setData] = useState<T | null>(null);
  const inflight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);

    // 최초 1회는 탭이 숨겨져 있어도 받아 온다.
    const tick = async (force = false) => {
      if (inflight.current || (document.hidden && !force)) return;
      inflight.current = true;
      try {
        const res = await fetch(url);
        const payload = await res.json();
        const value = pick(payload);
        if (!cancelled && value !== undefined) setData(value);
      } catch {
        // 폴링 실패는 조용히 넘긴다 — 다음 tick 에서 자연스럽게 재시도된다.
      } finally {
        inflight.current = false;
      }
    };

    void tick(true);
    const timer = setInterval(() => void tick(), intervalMs);
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
    // pick 은 매 렌더 새 함수라 의존성에서 뺀다 (호출 시점의 최신 정의를 쓴다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, intervalMs]);

  return data;
}
