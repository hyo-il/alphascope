import { useCallback, useEffect, useState } from 'react';
import { toast } from '../store/uiStore';
import type {
  CreateOrderInput,
  CreateOrderResult,
  PaperAccount,
  PaperAccountDetail,
  PaperOrder,
  PaperPerformance,
  PaperSnapshot,
  PaperTrade,
} from '../types/paper';

/** 보유 종목 평가는 1초마다 갱신한다 — 대기 중인 지정가 체결도 이 호출에서 함께 처리된다. */
const POLL_MS = 1000;
const ACCOUNT_KEY = 'alphascope.paperAccountId';

/**
 * ⚠️ API 서버가 아직 뜨지 않았을 때를 구분한다.
 *
 * 앱을 재실행하면 브라우저는 vite(5173)가 응답하는 즉시 열리지만 API(4000)는 몇 초 더
 * 걸린다. 그동안 vite 프록시는 **본문이 빈 500** 을 돌려주는데, 예전에는 `res.json()` 이
 * SyntaxError 를 던지고 그것이 "계좌 목록 없음" 과 같은 길로 흘러 들어가
 * **"아직 모의투자 계좌가 없습니다"** 화면이 떴다 — 데이터는 SQLite 에 멀쩡히 있는데
 * 초기화된 것처럼 보였다. (그 화면을 보고 계좌를 새로 만든 흔적이 DB 에 7개 남아 있었다.)
 */
export class ApiUnreachableError extends Error {
  constructor() {
    super('API 서버에 연결하지 못했습니다. 잠시 후 다시 시도합니다…');
    this.name = 'ApiUnreachableError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiUnreachableError();
  }

  const text = await res.text();
  let body: { error?: string } | null = null;
  try {
    body = text ? (JSON.parse(text) as { error?: string }) : null;
  } catch {
    // JSON 이 아니면 서버가 답한 것이 아니다 (프록시의 502·500 본문).
    throw new ApiUnreachableError();
  }

  if (!body) throw new ApiUnreachableError();
  if (!res.ok || body.error) throw new Error(body.error ?? '요청에 실패했습니다.');
  return body as T;
}

/** API 가 뜰 때까지 다시 시도하는 간격 */
const RETRY_MS = 1500;

/** 계좌 목록 + 선택 상태 (선택은 localStorage 에 남긴다) */
export function usePaperAccounts() {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const saved = localStorage.getItem(ACCOUNT_KEY);
    return saved ? Number(saved) : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * ⚠️ **조회에 실패했을 때 `accounts` 를 건드리지 않는다.**
   * 빈 배열로 두면 화면이 "계좌가 없습니다" 로 넘어가 데이터가 지워진 것처럼 보인다.
   * 실패는 `error` 로만 알리고, 목록은 마지막으로 성공한 값을 지킨다.
   */
  const reload = useCallback(async () => {
    try {
      const { accounts: list } = await request<{ accounts: PaperAccount[] }>('/api/paper/accounts');
      setAccounts(list);
      setError(null);
      // 저장해 둔 계좌가 사라졌으면 첫 계좌로 되돌린다.
      setSelectedId((current) =>
        current && list.some((a) => a.id === current) ? current : (list[0]?.id ?? null),
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  /*
   * 첫 조회는 성공할 때까지 다시 시도한다 — 앱을 재실행한 직후에는 API 가 아직 뜨지 않아
   * 거의 항상 한 번은 실패한다. 여기서 멈추면 사용자는 빈 계좌 화면을 보게 된다.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const attempt = () => {
      void reload().then((ok) => {
        if (ok || cancelled) return;
        timer = setTimeout(attempt, RETRY_MS);
      });
    };

    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reload]);

  const select = useCallback((id: number | null) => {
    setSelectedId(id);
    if (id) localStorage.setItem(ACCOUNT_KEY, String(id));
    else localStorage.removeItem(ACCOUNT_KEY);
  }, []);

  const create = useCallback(
    async (input: { name: string; initialBalance: number; commissionRate?: number; slippageRate?: number }) => {
      const { account } = await request<{ account: PaperAccount }>('/api/paper/accounts', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await reload();
      select(account.id);
      return account;
    },
    [reload, select],
  );

  const remove = useCallback(
    async (id: number) => {
      await request(`/api/paper/accounts/${id}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  const reset = useCallback(
    async (id: number) => {
      await request(`/api/paper/accounts/${id}/reset`, { method: 'PATCH', body: '{}' });
      await reload();
    },
    [reload],
  );

  return {
    accounts,
    selectedId,
    select,
    loading,
    /** 계좌 목록 조회 실패 — 화면은 이걸 '계좌 없음' 과 다르게 그려야 한다 */
    error,
    reload,
    create,
    remove,
    reset,
  };
}

/**
 * 계좌 상세 + 보유 종목 실시간 평가.
 * `/api/paper/positions` 가 대기 중인 지정가 주문도 함께 체결하므로, 이 폴링이 곧 체결 엔진이다.
 */
export function usePaperAccountDetail(accountId: number | null) {
  const [detail, setDetail] = useState<PaperAccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!accountId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    let inFlight = false;
    /*
     * ⚠️ **첫 조회가 성공할 때까지는 숨김 가드를 걸지 않는다.**
     * 앱 재실행 직후에는 API(4000)가 vite(5173)보다 늦게 떠서 첫 조회가 거의 항상 실패하는데,
     * 그다음부터 `document.hidden` 으로 걸러 버리면 배경 탭에서는 영영 다시 시도하지 않아
     * 계좌가 비어 있는 것처럼 보인다 (에러 문구만 남고 스켈레톤이 계속 돈다).
     * 한 번 받아 온 뒤에는 원래대로 보이는 탭에서만 폴링한다.
     */
    let loaded = false;

    /*
     * 최초 1회는 탭이 숨겨져 있어도 받아 온다 (usePolling 과 같은 규칙).
     * 이 가드를 첫 호출에도 걸면, 숨겨진 채로 열린 탭은 화면이 영영 비어 있는다.
     */
    const load = async (force = false) => {
      if (inFlight || (document.hidden && !force && loaded)) return;
      inFlight = true;
      try {
        // settle=1 이 대기 주문 체결과 계좌 평가를 한 번에 처리한다.
        // 예전처럼 /positions 를 따로 부르면 두 라우트가 각각 시세·환율을 조회해
        // 토스 호출이 초당 4회가 된다.
        const data = await request<PaperAccountDetail>(
          `/api/paper/accounts/${accountId}?settle=1`,
        );
        if (!cancelled) {
          loaded = true;
          setDetail(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight = false;
      }
    };

    void load(true);
    const timer = setInterval(() => void load(), POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accountId, tick]);

  return { detail, error, refresh };
}

export function usePaperTrades(accountId: number | null, tick = 0) {
  const [trades, setTrades] = useState<PaperTrade[]>([]);

  useEffect(() => {
    if (!accountId) {
      setTrades([]);
      return;
    }
    let cancelled = false;
    void request<{ trades: PaperTrade[] }>(`/api/paper/trades?accountId=${accountId}`)
      .then((d) => !cancelled && setTrades(d.trades))
      // 조용히 빈 배열로 두면 "거래 내역이 없다" 로 오해한다.
      .catch((e) => !cancelled && toast.error('거래 내역을 불러오지 못했습니다', String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, tick]);

  return trades;
}

export function usePaperOrders(accountId: number | null, tick = 0) {
  const [orders, setOrders] = useState<PaperOrder[]>([]);

  useEffect(() => {
    if (!accountId) {
      setOrders([]);
      return;
    }
    let cancelled = false;
    void request<{ orders: PaperOrder[] }>(`/api/paper/orders?accountId=${accountId}`)
      .then((d) => !cancelled && setOrders(d.orders))
      .catch((e) => !cancelled && toast.error('주문 내역을 불러오지 못했습니다', String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, tick]);

  return orders;
}

export function usePaperPerformance(accountId: number | null, tick = 0) {
  const [data, setData] = useState<{
    performance: PaperPerformance;
    snapshots: PaperSnapshot[];
  } | null>(null);

  useEffect(() => {
    if (!accountId) {
      setData(null);
      return;
    }
    let cancelled = false;
    void request<{ performance: PaperPerformance; snapshots: PaperSnapshot[] }>(
      `/api/paper/performance?accountId=${accountId}`,
    )
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && toast.error('성과를 계산하지 못했습니다', String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [accountId, tick]);

  return data;
}

export async function submitOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  return request<CreateOrderResult>('/api/paper/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function cancelPaperOrder(orderId: number): Promise<void> {
  await request(`/api/paper/orders/${orderId}/cancel`, { method: 'POST', body: '{}' });
}
