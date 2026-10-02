import { useCallback, useEffect, useRef, useState } from 'react';
import type { TargetAnalysisRecord, TargetProgress, TargetStats } from '../types/targetAnalysis';

/**
 * 목표 도달 가능성 분석 (v2.24.0 — v2.29.0 부터 스윙 「추천 종목」·「종목 검색」·「추천 이력」 이 쓴다).
 *
 * 실행은 서버가 시작만 하고 돌려준다(5종목이면 1분 안팎). **실행 중일 때만** 진행률을 1.5초마다 보고,
 * 끝나면 기록을 다시 읽는다 — 급등 탐지·진단 리포트와 같은 방식이다. 평소에는 폴링하지 않는다.
 * 채점은 서버가 기록을 읽을 때 한다.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

const POLL_MS = 1500;

export function useTargetAnalysis() {
  const [records, setRecords] = useState<TargetAnalysisRecord[] | null>(null);
  const [stats, setStats] = useState<TargetStats | null>(null);
  const [progress, setProgress] = useState<TargetProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geminiOff, setGeminiOff] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const reload = useCallback(async () => {
    try {
      const data = await json<{ records: TargetAnalysisRecord[]; stats: TargetStats; progress: TargetProgress }>(
        '/api/target-analysis?limit=200',
      );
      setRecords(data.records);
      setStats(data.stats);
      setProgress(data.progress);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
    void json<{ enabled?: boolean; reason?: string | null }>('/api/gemini/status')
      .then((s) => setGeminiOff(s.enabled ? null : (s.reason ?? 'Gemini 를 쓸 수 없습니다')))
      .catch(() => undefined);
  }, [reload]);

  useEffect(() => {
    if (!progress?.running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        void reload();
      }
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(async () => {
      try {
        const data = await json<{ progress: TargetProgress }>('/api/target-analysis/progress');
        setProgress(data.progress);
      } catch {
        // 다음 주기에 다시 본다
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [progress?.running, reload]);

  /** 실패는 throw — 화면이 토스트로 알린다 */
  const start = useCallback(async (body: { symbols: string[]; targetPct: number; stopPct: number; days: number }) => {
    const data = await json<{ progress: TargetProgress }>('/api/target-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    setProgress(data.progress);
  }, []);

  const remove = useCallback(
    async (id: number) => {
      await json(`/api/target-analysis/${id}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  return { records, stats, progress, error, geminiOff, reload, start, remove };
}
