import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../types/toss';
import { useAppStore } from '../store/appStore';

interface CandleState {
  candles: Candle[];
  loading: boolean;
  error: string | null;
  /** 과거 구간을 추가로 불러오는 중 */
  loadingMore: boolean;
  /** 더 받을 과거 데이터가 없음 (토스는 1분봉을 3일치만 보유한다) */
  reachedEnd: boolean;
}

/** 타임프레임별 최초 요청 캔들 수 — 부족하면 스크롤로 과거를 이어 받는다. */
const LIMITS: Record<Timeframe, number> = {
  '1m': 500,
  '5m': 400,
  '15m': 300,
  '30m': 300,
  '1d': 300,
};

/** 과거로 스크롤할 때 한 번에 더 받는 양 */
const PAGE_SIZE = 200;

export function useCandleData(symbol: string, timeframe: Timeframe) {
  const [state, setState] = useState<CandleState>({
    candles: [],
    loading: true,
    error: null,
    loadingMore: false,
    reachedEnd: false,
  });
  const setMock = useAppStore((s) => s.setMock);
  /** 과거 로딩이 겹치지 않도록 */
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    loadingMoreRef.current = false;
    setState((prev) => ({ ...prev, loading: true, error: null, reachedEnd: false }));

    fetch(`/api/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${LIMITS[timeframe]}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMock(Boolean(data.mock));
        setState({
          candles: data.candles ?? [],
          loading: false,
          error: null,
          loadingMore: false,
          reachedEnd: false,
        });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          candles: [],
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          loadingMore: false,
          reachedEnd: false,
        });
      });

    return () => controller.abort();
  }, [symbol, timeframe, setMock]);

  /**
   * 차트를 과거로 스크롤했을 때 이어 받는다.
   * 빈 응답이 오면 더 이상 데이터가 없다는 뜻이므로 다시 시도하지 않는다.
   */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;

    const oldest = state.candles[0]?.timestamp;
    if (!oldest || state.reachedEnd || state.loading) return;

    loadingMoreRef.current = true;
    setState((prev) => ({ ...prev, loadingMore: true }));

    try {
      const res = await fetch(
        `/api/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${PAGE_SIZE}&before=${oldest}`,
      );
      const data = await res.json();
      const older: Candle[] = Array.isArray(data.candles) ? data.candles : [];

      setState((prev) => {
        if (!older.length) return { ...prev, loadingMore: false, reachedEnd: true };

        // 겹치는 구간을 제거하고 앞에 붙인다.
        const existing = new Set(prev.candles.map((c) => c.timestamp));
        const merged = [...older.filter((c) => !existing.has(c.timestamp)), ...prev.candles];

        return {
          ...prev,
          candles: merged,
          loadingMore: false,
          reachedEnd: merged.length === prev.candles.length,
        };
      });
    } catch {
      setState((prev) => ({ ...prev, loadingMore: false }));
    } finally {
      loadingMoreRef.current = false;
    }
  }, [symbol, timeframe, state.candles, state.reachedEnd, state.loading]);

  return { ...state, loadMore };
}
