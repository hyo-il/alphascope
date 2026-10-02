import { useEffect, useState } from 'react';
import type { Fundamentals, PeerSummary } from '../types/company';
import type { ExchangeRate, Portfolio } from '../types/toss';

interface Loadable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /**
   * 이 url 의 응답(성공·실패)을 받았는가 (v2.29.0). 요청 effect 가 돌기 전 한 번의 렌더에서는 `loading` 이 아직 false 라,
   * "기다려야 하는가" 를 `loading` 만으로 판단하면 그 사이에 막힘이 풀린다(수동 분석의 동종업계).
   */
  settled: boolean;
}

/** 단순 GET 로더 — 탭을 열 때만 호출한다 (enabled=false 면 요청하지 않음). */
function useFetch<T>(
  url: string | null,
  pick: (payload: Record<string, unknown>) => T | undefined,
): Loadable<T> {
  const [state, setState] = useState<Loadable<T>>({ data: null, loading: false, error: null, settled: false });

  useEffect(() => {
    if (!url) {
      setState({ data: null, loading: false, error: null, settled: false });
      return;
    }

    const controller = new AbortController();
    setState({ data: null, loading: true, error: null, settled: false });

    fetch(url, { signal: controller.signal })
      .then((res) => res.json())
      .then((payload) => {
        if (payload.error) throw new Error(String(payload.error));
        setState({ data: pick(payload) ?? null, loading: false, error: null, settled: true });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          data: null,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          settled: true,
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
    (p) => p.fundamentals as Fundamentals | undefined,
  );
}

export function usePeers(symbol: string, enabled: boolean) {
  return useFetch<PeerSummary[]>(enabled ? `/api/peers?symbol=${symbol}` : null, (p) => p.peers as PeerSummary[] | undefined);
}

export function usePortfolio(enabled: boolean) {
  return useFetch<Portfolio>(enabled ? '/api/holdings' : null, (p) => p.portfolio as Portfolio | undefined);
}

export function useExchangeRate(enabled: boolean) {
  return useFetch<ExchangeRate>(enabled ? '/api/exchange-rate' : null, (p) => p.rate as ExchangeRate | undefined);
}
