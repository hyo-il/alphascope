import { useEffect, useState } from 'react';
import type { Candle, Timeframe } from '../types/toss';
import { useAppStore } from '../store/appStore';

interface CandleState {
  candles: Candle[];
  loading: boolean;
  error: string | null;
}

/** 타임프레임별 요청 캔들 수 — 분봉은 더 많이 받아야 화면이 채워진다. */
const LIMITS: Record<Timeframe, number> = {
  '1m': 500,
  '5m': 400,
  '15m': 300,
  '30m': 300,
  '1d': 300,
};

/** 심볼/타임프레임에 해당하는 캔들을 API 서버에서 가져온다. */
export function useCandleData(symbol: string, timeframe: Timeframe): CandleState {
  const [state, setState] = useState<CandleState>({
    candles: [],
    loading: true,
    error: null,
  });
  const setMock = useAppStore((s) => s.setMock);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(`/api/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${LIMITS[timeframe]}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setMock(Boolean(data.mock));
        setState({ candles: data.candles ?? [], loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          candles: [],
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });

    return () => controller.abort();
  }, [symbol, timeframe, setMock]);

  return state;
}
