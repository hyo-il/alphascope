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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = await res.json();
  if (!res.ok || body?.error) throw new Error(body?.error ?? '요청에 실패했습니다.');
  return body as T;
}

/** 계좌 목록 + 선택 상태 (선택은 localStorage 에 남긴다) */
export function usePaperAccounts() {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const saved = localStorage.getItem(ACCOUNT_KEY);
    return saved ? Number(saved) : null;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { accounts: list } = await request<{ accounts: PaperAccount[] }>('/api/paper/accounts');
      setAccounts(list);
      setError(null);
      // 저장해 둔 계좌가 사라졌으면 첫 계좌로 되돌린다.
      setSelectedId((current) =>
        current && list.some((a) => a.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
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

  return { accounts, selectedId, select, loading, error, reload, create, remove, reset };
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
     * 최초 1회는 탭이 숨겨져 있어도 받아 온다 (usePolling 과 같은 규칙).
     * 이 가드를 첫 호출에도 걸면, 숨겨진 채로 열린 탭은 화면이 영영 비어 있는다.
     */
    const load = async (force = false) => {
      if (inFlight || (document.hidden && !force)) return;
      inFlight = true;
      try {
        // settle=1 이 대기 주문 체결과 계좌 평가를 한 번에 처리한다.
        // 예전처럼 /positions 를 따로 부르면 두 라우트가 각각 시세·환율을 조회해
        // 토스 호출이 초당 4회가 된다.
        const data = await request<PaperAccountDetail>(
          `/api/paper/accounts/${accountId}?settle=1`,
        );
        if (!cancelled) {
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
