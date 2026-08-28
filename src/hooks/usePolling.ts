import { useEffect, useRef, useState } from 'react';

/**
 * 일정 주기로 데이터를 가져오는 공용 폴링 훅.
 *
 * - 탭이 백그라운드면 쉰다 (불필요한 API 호출 방지)
 * - 다시 보이는 순간 즉시 한 번 갱신한다. 그러지 않으면 숨겨진 채로 열린 탭은
 *   데이터가 영영 채워지지 않는다.
 * - 이전 요청이 끝나기 전에는 다음 요청을 보내지 않는다.
 * - **같은 URL 을 여러 컴포넌트가 구독하면 요청은 한 번만 나간다.**
 *   예전에는 App 헤더와 모의투자 주문 패널이 같은 종목의 현재가를 각각 1초마다
 *   따로 받아 왔다 — 같은 데이터를 두 번 받으면서 토스 Rate Limit 만 갉아먹었다.
 */

interface Poller {
  subscribers: Set<(payload: Record<string, unknown>) => void>;
  /** 마지막 응답 — 새 구독자에게 즉시 넘겨 빈 화면을 건너뛴다 */
  last: Record<string, unknown> | null;
  timer: ReturnType<typeof setInterval> | null;
  inflight: boolean;
  onVisible: () => void;
}

const pollers = new Map<string, Poller>();

function subscribe(
  url: string,
  intervalMs: number,
  onData: (payload: Record<string, unknown>) => void,
): () => void {
  const key = `${intervalMs}|${url}`;
  let poller = pollers.get(key);

  if (!poller) {
    const created: Poller = {
      subscribers: new Set(),
      last: null,
      timer: null,
      inflight: false,
      onVisible: () => {
        if (!document.hidden) void tick();
      },
    };

    // 최초 1회는 탭이 숨겨져 있어도 받아 온다.
    const tick = async (force = false) => {
      if (created.inflight || (document.hidden && !force)) return;
      created.inflight = true;
      try {
        const response = await fetch(url);
        const payload = (await response.json()) as Record<string, unknown>;
        created.last = payload;
        for (const subscriber of created.subscribers) subscriber(payload);
      } catch {
        // 폴링 실패는 조용히 넘긴다 — 다음 tick 에서 자연스럽게 재시도된다.
      } finally {
        created.inflight = false;
      }
    };

    created.timer = setInterval(() => void tick(), intervalMs);
    document.addEventListener('visibilitychange', created.onVisible);
    pollers.set(key, created);
    poller = created;
    void tick(true);
  } else if (poller.last) {
    // 이미 받아 둔 값이 있으면 즉시 넘긴다.
    onData(poller.last);
  }

  poller.subscribers.add(onData);

  return () => {
    const current = pollers.get(key);
    if (!current) return;
    current.subscribers.delete(onData);
    if (current.subscribers.size > 0) return;

    // 마지막 구독자가 떠나면 폴러를 접는다.
    if (current.timer) clearInterval(current.timer);
    document.removeEventListener('visibilitychange', current.onVisible);
    pollers.delete(key);
  };
}

export function usePolling<T>(
  url: string,
  pick: (payload: Record<string, unknown>) => T | undefined,
  intervalMs: number,
  /** false 면 아무것도 부르지 않는다 (종목 미선택 등) */
  enabled = true,
): T | null {
  const [data, setData] = useState<T | null>(null);

  // pick 은 매 렌더 새 함수라 의존성에 넣을 수 없다 — 호출 시점의 최신 정의를 쓴다.
  const pickRef = useRef(pick);
  pickRef.current = pick;

  useEffect(() => {
    setData(null);
    if (!enabled) return;

    return subscribe(url, intervalMs, (payload) => {
      const value = pickRef.current(payload);
      if (value !== undefined) setData(value);
    });
  }, [url, intervalMs, enabled]);

  return data;
}
