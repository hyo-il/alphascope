import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SurgeDetection,
  SurgeEvaluation,
  SurgeProgress,
  SurgeSettings,
} from '../types/surge';
import { toast } from '../store/uiStore';

/**
 * 급등 탐지 화면용 훅.
 *
 * 탐지 실행은 1분을 넘길 수 있어 서버가 시작만 하고 끝낸다.
 * 여기서는 실행 중일 때만 진행률을 폴링하고, 끝나면 결과를 한 번 다시 읽는다.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

const PROGRESS_POLL_MS = 1500;

export function useSurgeDetection(watchlist: string[]) {
  const [results, setResults] = useState<SurgeDetection[]>([]);
  const [detectedAt, setDetectedAt] = useState<string | null>(null);
  const [progress, setProgress] = useState<SurgeProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const loadResults = useCallback(async () => {
    try {
      const data = await json<{
        detectedAt: string | null;
        results: SurgeDetection[];
        progress: SurgeProgress;
      }>('/api/surge/results');
      setResults(data.results);
      setDetectedAt(data.detectedAt);
      setProgress(data.progress);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  // 실행 중일 때만 폴링한다 — 가만히 두고 보는 화면에서 요청을 계속 보내지 않는다.
  useEffect(() => {
    if (!progress?.running) {
      // 방금 끝났다면 결과를 한 번 다시 읽는다.
      if (wasRunning.current) {
        wasRunning.current = false;
        void loadResults();
      }
      return;
    }
    wasRunning.current = true;

    const timer = setInterval(async () => {
      try {
        const data = await json<{ progress: SurgeProgress }>('/api/surge/progress');
        setProgress(data.progress);
      } catch {
        // 다음 주기에 다시 시도한다.
      }
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [progress?.running, loadResults]);

  const detect = useCallback(async () => {
    try {
      const data = await json<{ progress: SurgeProgress }>('/api/surge/detect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ watchlist }),
      });
      setProgress(data.progress);
      if (data.progress.error) toast.warning('탐지를 시작하지 못했습니다', data.progress.error);
    } catch (e) {
      toast.error('탐지 실행 실패', (e as Error).message);
    }
  }, [watchlist]);

  return { results, detectedAt, progress, loading, error, detect, reload: loadResults };
}

export function useSurgeSettings() {
  const [settings, setSettings] = useState<SurgeSettings | null>(null);
  /** 랭킹 캐시 갱신 시각 — "언제 기준 종목 풀인가" 를 화면이 알려 준다 */
  const [rankingUpdatedAt, setRankingUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await json<{ settings: SurgeSettings; rankingUpdatedAt?: string | null }>(
        '/api/surge/settings',
      );
      setSettings(data.settings);
      setRankingUpdatedAt(data.rankingUpdatedAt ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (patch: Partial<SurgeSettings>) => {
    const data = await json<{ settings: SurgeSettings }>('/api/surge/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSettings(data.settings);
    return data.settings;
  }, []);

  return { settings, rankingUpdatedAt, error, save, reload: load };
}

export function useSurgeEvaluation() {
  const [evaluation, setEvaluation] = useState<SurgeEvaluation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 늦게 도착한 이전 요청이 새 결과를 덮어쓰지 않도록 순번을 센다 */
  const sequence = useRef(0);

  const evaluate = useCallback(async (symbol: string) => {
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await json<{ evaluation: SurgeEvaluation }>('/api/surge/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      if (mine !== sequence.current) return;
      setEvaluation(data.evaluation);
    } catch (e) {
      if (mine !== sequence.current) return;
      setError((e as Error).message);
      setEvaluation(null);
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, []);

  return { evaluation, loading, error, evaluate };
}

export function useSurgeHistory(enabled: boolean) {
  const [detections, setDetections] = useState<SurgeDetection[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void json<{ detections: SurgeDetection[] }>('/api/surge/history')
      .then((data) => {
        if (!cancelled) setDetections(data.detections);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { detections, loading };
}
