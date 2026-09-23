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
function usePolledJson<T>(url: string, active: boolean, pick: (body: unknown) => T) {
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
    }, POLL_MS);
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
  }, [active, refresh]);

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

export function useAutoTradingOverview(active: boolean) {
  const { data, error, refresh } = usePolledJson<StrategyOverviewItem[]>(
    '/api/auto-trading/overview',
    active,
    (body) => ((body as { items?: StrategyOverviewItem[] }).items ?? []),
  );
  return { items: data, error, refresh };
}
