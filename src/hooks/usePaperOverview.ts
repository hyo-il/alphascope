import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaperAccount } from '../types/paper';
import type { AccountStrategy, AccountStrategyStatus } from '../types/autoTrading';

/**
 * 계좌 **모아보기** 데이터 — 계좌 요약 한 묶음 + 자동매매 상태 한 묶음.
 *
 * ⚠️ 카드마다 `/accounts/:id` · `/auto-trading/status/:id` 를 부르면 계좌 수만큼 요청이
 * 늘어난다(N+1). 서버에 묶음 라우트를 두고 여기서는 **두 번만** 부른다.
 * ⚠️ 조회가 실패해도 **마지막 성공 목록을 지우지 않는다** — 비우면 "계좌가 없다" 로 읽힌다
 * (모의투자 대시보드가 같은 이유로 에러 화면과 빈 화면을 갈라 둔다).
 */

const POLL_MS = 5000;
/**
 * 오른쪽 계좌 탭은 더 느리게 본다 — 거기서 쓰는 것은 계좌명 옆 기호 하나뿐이고,
 * `AutoTradeBar` 의 상태 폴링과 같은 주기다. 스케줄러 틱이 1분이라 더 촘촘할 이유도 없다.
 */
export const SIDE_POLL_MS = 15_000;

export interface AccountOverviewItem {
  account: PaperAccount;
  totalValue: number | null;
  stockValue: number | null;
  totalPnl: number | null;
  totalReturn: number | null;
  pendingOrders: number;
  positions: number;
  error: string | null;
}

export interface StrategyOverviewItem {
  strategy: AccountStrategy;
  status: AccountStrategyStatus;
}

/** 화면이 켜져 있을 때만 폴링한다 (탭이 숨으면 쉰다) */
function usePolledJson<T>(
  url: string,
  active: boolean,
  pick: (body: unknown) => T,
  pollMs: number = POLL_MS,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pickRef = useRef(pick);
  pickRef.current = pick;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(url);
      const body: unknown = await res.json();
      if (!res.ok) throw new Error((body as { error?: string })?.error ?? `조회 실패 (${res.status})`);
      setData(pickRef.current(body));
      setError(null);
    } catch (e) {
      // 값은 그대로 두고 에러만 표시한다.
      setError((e as Error).message);
    }
  }, [url]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => {
      // 숨은 탭에서는 쉰다 — 보이지도 않는 값에 시세·환율 조회를 쓰지 않는다.
      if (document.hidden) return;
      void refresh();
    }, pollMs);
    /*
      ⚠️ 다시 보이는 순간 **즉시** 한 번 받는다. 이것이 없으면 숨어 있던 동안 멈춘 값이
      다음 주기(최대 5초)까지 그대로 보인다 — 켜 둔 자동매매가 꺼진 것처럼 읽힌다.
      (`hooks/usePolling.ts` 도 같은 이유로 같은 처리를 한다.)
    */
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, refresh, pollMs]);

  return { data, error, refresh };
}

export function usePaperAccountsOverview(active: boolean) {
  const { data, error, refresh } = usePolledJson<AccountOverviewItem[]>(
    '/api/paper/accounts/overview',
    active,
    (body) => ((body as { items?: AccountOverviewItem[] }).items ?? []),
  );
  return { items: data, error, refresh };
}

/**
 * 전 계좌의 자동매매 설정 + 상태 — **묶음 라우트 한 번**이다.
 * ⚠️ 계좌마다 `/status/:id` 를 부르면 계좌 수만큼 요청이 늘어난다(N+1).
 * 모아보기와 오른쪽 계좌 탭이 같은 라우트를 쓰되 주기만 다르다.
 */
export function useAutoTradingOverview(active: boolean, pollMs: number = POLL_MS) {
  const { data, error, refresh } = usePolledJson<StrategyOverviewItem[]>(
    '/api/auto-trading/overview',
    active,
    (body) => ((body as { items?: StrategyOverviewItem[] }).items ?? []),
    pollMs,
  );
  return { items: data, error, refresh };
}
