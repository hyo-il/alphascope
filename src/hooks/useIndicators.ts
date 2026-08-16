import { useEffect, useState } from 'react';
import type { IndicatorSeries } from '../types/chart';
import type { Timeframe } from '../types/toss';

interface IndicatorState {
  indicators: IndicatorSeries | null;
  loading: boolean;
  /** 지표 엔진(Python)이 꺼져 있는 경우 — 앱 오류와 구분해 안내한다. */
  engineDown: boolean;
  error: string | null;
}

const LIMITS: Record<Timeframe, number> = {
  '1m': 500,
  '5m': 400,
  '15m': 300,
  '30m': 300,
  '1d': 300,
};

/**
 * Python 지표 엔진에서 계산된 시리즈를 가져온다.
 * `enabled` 가 false 면(모든 지표 토글이 꺼짐) 호출하지 않는다.
 */
export function useIndicators(
  symbol: string,
  timeframe: Timeframe,
  enabled: boolean,
): IndicatorState {
  const [state, setState] = useState<IndicatorState>({
    indicators: null,
    loading: false,
    engineDown: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ indicators: null, loading: false, engineDown: false, error: null });
      return;
    }

    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    fetch(`/api/indicators?symbol=${symbol}&timeframe=${timeframe}&limit=${LIMITS[timeframe]}`, {
      signal: controller.signal,
    })
      .then(async (res) => ({ ok: res.ok, body: await res.json() }))
      .then(({ ok, body }) => {
        if (!ok || body.error) {
          setState({
            indicators: null,
            loading: false,
            engineDown: Boolean(body.engineDown),
            error: body.error ?? '지표를 불러오지 못했습니다.',
          });
          return;
        }
        setState({
          indicators: body.indicators,
          loading: false,
          engineDown: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setState({
          indicators: null,
          loading: false,
          engineDown: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });

    return () => controller.abort();
  }, [symbol, timeframe, enabled]);

  return state;
}
