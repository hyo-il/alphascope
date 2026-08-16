import { useEffect, useState } from 'react';
import type { Fundamentals, PeerSummary } from '../types/company';
import type { ExchangeRate, Portfolio } from '../types/toss';

interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** 단순 GET 로더 — 탭을 열 때만 호출한다 (enabled=false 면 요청하지 않음). */
function useFetch<T>(url: string | null, pick: (payload: any) => T | undefined): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, loading: false, error: null });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });

    fetch(url, { signal: controller.signal })
      .then((res) => res.json())
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setState({ data: pick(payload) ?? null, loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return state;
}

export function useFundamentals(symbol: string, enabled: boolean) {
  return useFetch<Fundamentals>(
    enabled ? `/api/company?symbol=${symbol}` : null,
    (p) => p.fundamentals,
  );
}

export function usePeers(symbol: string, enabled: boolean) {
  return useFetch<PeerSummary[]>(enabled ? `/api/peers?symbol=${symbol}` : null, (p) => p.peers);
}

export function usePortfolio(enabled: boolean) {
  return useFetch<Portfolio>(enabled ? '/api/holdings' : null, (p) => p.portfolio);
}

export function useExchangeRate(enabled: boolean) {
  return useFetch<ExchangeRate>(enabled ? '/api/exchange-rate' : null, (p) => p.rate);
}
