import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candle } from '../types/toss';
import type { CompareChartData, CompareTimeframe } from '../types/compare';
import type { Fundamentals } from '../types/company';
import { aggregateWeekly } from '../utils/candleAggregator';
import { useSymbolSummaries } from './useSymbolSummaries';

/** 비교 차트는 메인 차트만큼 길게 보지 않는다 — 화면이 작아 봉이 뭉개진다 */
const LIMITS: Record<CompareTimeframe, number> = {
  '1m': 300,
  '5m': 300,
  '15m': 250,
  '30m': 250,
  '1d': 250,
  '1w': 300, // 일봉을 받아 주 단위로 묶으므로 원본을 넉넉히 받는다
};

const keyOf = (symbol: string, timeframe: CompareTimeframe) => `${symbol}|${timeframe}`;

async function fetchCandles(
  symbol: string,
  timeframe: CompareTimeframe,
  signal: AbortSignal,
): Promise<Candle[]> {
  // 주봉은 토스가 주지 않는다. 일봉을 받아 월요일 기준으로 묶는다.
  const base = timeframe === '1w' ? '1d' : timeframe;
  const res = await fetch(
    `/api/candles?symbol=${symbol}&timeframe=${base}&limit=${LIMITS[timeframe]}`,
    { signal },
  );
  const data = await res.json();
  if (data.error) throw new Error(String(data.error));
  const candles: Candle[] = Array.isArray(data.candles) ? data.candles : [];
  return timeframe === '1w' ? aggregateWeekly(candles) : candles;
}

async function fetchFundamentals(symbol: string, signal: AbortSignal): Promise<Fundamentals> {
  const res = await fetch(`/api/company?symbol=${symbol}`, { signal });
  const data = await res.json();
  if (data.error) throw new Error(String(data.error));
  return data.fundamentals as Fundamentals;
}

/**
 * 비교 화면의 데이터 적재.
 *
 * ⚠️ **캔들과 기업정보는 순차로 받는다.** 차트 4개를 동시에 띄우면 요청도 4개가 한꺼번에
 * 나가는데, 종목별 왕복이 겹치면 화면이 전부 동시에 멈춘 것처럼 보인다. 하나씩 도착하는
 * 편이 체감이 훨씬 낫고 Rate Limit 여유도 남는다. 지표·재무 요약만 `/api/summary` 로
 * 한 번에 받는다 (원래 다종목 API 다).
 *
 * 이미 받은 (종목, 타임프레임) 조합은 캐시에 남겨 둔다 — 타임프레임을 오가거나
 * 차트를 숨겼다 켜도 다시 받지 않는다. [새로고침] 이 캐시를 통째로 버린다.
 */
export function useCompareData(symbols: string[], timeframes: Record<string, CompareTimeframe>) {
  const [charts, setCharts] = useState<Record<string, CompareChartData>>({});
  const [fundamentals, setFundamentals] = useState<Record<string, Fundamentals | null>>({});
  const [nonce, setNonce] = useState(0);

  const candleCache = useRef(new Map<string, Candle[]>());
  const fundamentalsCache = useRef(new Map<string, Fundamentals | null>());

  const symbolKey = symbols.join(',');
  const timeframeKey = symbols.map((s) => timeframes[s] ?? '1d').join(',');

  const {
    summaries,
    loading: summariesLoading,
    error: summariesError,
  } = useSymbolSummaries(symbols, nonce);

  // ── 캔들 (순차) ──────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const wanted = symbols.map((symbol) => ({
      symbol,
      timeframe: timeframes[symbol] ?? ('1d' as CompareTimeframe),
    }));

    // 화면에서 뺀 종목은 상태에서도 지운다 (다음 추가 때 옛 값이 스쳐 보이지 않게).
    setCharts((prev) => {
      const next: Record<string, CompareChartData> = {};
      for (const { symbol, timeframe } of wanted) {
        const cached = candleCache.current.get(keyOf(symbol, timeframe));
        next[symbol] = cached
          ? { symbol, timeframe, candles: cached, loading: false, error: null }
          : (prev[symbol]?.timeframe === timeframe
              ? prev[symbol]
              : { symbol, timeframe, candles: [], loading: true, error: null });
      }
      return next;
    });

    (async () => {
      for (const { symbol, timeframe } of wanted) {
        if (cancelled) return;
        const key = keyOf(symbol, timeframe);
        if (candleCache.current.has(key)) continue;

        try {
          const candles = await fetchCandles(symbol, timeframe, controller.signal);
          if (cancelled) return;
          candleCache.current.set(key, candles);
          setCharts((prev) => ({
            ...prev,
            [symbol]: { symbol, timeframe, candles, loading: false, error: null },
          }));
        } catch (e) {
          if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
          setCharts((prev) => ({
            ...prev,
            [symbol]: {
              symbol,
              timeframe,
              candles: [],
              loading: false,
              error: e instanceof Error ? e.message : String(e),
            },
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey, timeframeKey, nonce]);

  // ── 기업정보 (순차, 24시간 서버 캐시) ────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    setFundamentals((prev) => {
      const next: Record<string, Fundamentals | null> = {};
      for (const symbol of symbols) {
        next[symbol] = fundamentalsCache.current.get(symbol) ?? prev[symbol] ?? null;
      }
      return next;
    });

    (async () => {
      for (const symbol of symbols) {
        if (cancelled) return;
        if (fundamentalsCache.current.has(symbol)) continue;

        try {
          const data = await fetchFundamentals(symbol, controller.signal);
          if (cancelled) return;
          fundamentalsCache.current.set(symbol, data);
          setFundamentals((prev) => ({ ...prev, [symbol]: data }));
        } catch (e) {
          if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
          // 한 종목이 없어도 나머지는 그대로 보여 준다 — 그 열만 '—' 가 된다.
          fundamentalsCache.current.set(symbol, null);
          setFundamentals((prev) => ({ ...prev, [symbol]: null }));
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey, nonce]);

  /** 수동 갱신 — 비교 화면은 폴링하지 않으므로 이 버튼이 유일한 갱신 경로다 */
  const refresh = useCallback(() => {
    candleCache.current.clear();
    fundamentalsCache.current.clear();
    setNonce((v) => v + 1);
  }, []);

  return { charts, fundamentals, summaries, summariesLoading, summariesError, refresh };
}
