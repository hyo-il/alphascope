import { useCallback, useEffect, useRef, useState } from 'react';
import type { SwingRecommendation, SwingRecord, SwingRunResult } from '../types/swing';

/**
 * 스윙 추천 훅.
 *
 * 급등 탐지와 달리 분석이 동기다 — 관심 종목 십여 개는 캔들·지표 모두 로컬 캐시를 타서
 * 몇 초면 끝난다. 진행률 폴링을 두면 화면만 복잡해진다.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  }
  return payload as T;
}

export function useSwingAnalysis(symbols: string[]) {
  const [result, setResult] = useState<SwingRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 저장된 마지막 추천 — 화면을 다시 열었을 때 빈 화면을 보여 주지 않는다 */
  const [saved, setSaved] = useState<{ analyzedAt: string | null; records: SwingRecord[] }>({
    analyzedAt: null,
    records: [],
  });

  useEffect(() => {
    void json<{ analyzedAt: string | null; records: SwingRecord[] }>(
      '/api/swing/recommendations',
    )
      .then(setSaved)
      .catch(() => undefined);
  }, []);

  const analyze = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await json<SwingRunResult>('/api/swing/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [symbols]);

  return { result, saved, loading, error, analyze };
}

export function useSwingEvaluation() {
  const [recommendation, setRecommendation] = useState<SwingRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 늦게 도착한 이전 요청이 새 결과를 덮어쓰지 않도록 순번을 센다 */
  const sequence = useRef(0);

  const evaluate = useCallback(async (symbol: string) => {
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await json<{ recommendation: SwingRecommendation }>('/api/swing/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (mine !== sequence.current) return;
      setRecommendation(data.recommendation);
    } catch (e) {
      if (mine !== sequence.current) return;
      setError((e as Error).message);
      setRecommendation(null);
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, []);

  return { recommendation, loading, error, evaluate };
}

export function useSwingHistory(enabled: boolean) {
  const [records, setRecords] = useState<SwingRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void json<{ records: SwingRecord[] }>('/api/swing/history')
      .then((data) => {
        if (!cancelled) setRecords(data.records);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { records, loading };
}
