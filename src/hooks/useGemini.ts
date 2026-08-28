import { useCallback, useEffect, useState } from 'react';
import type { AutoAnalysisSettings, AutoAnalysisStatus } from '../types/gemini';

interface GeminiState {
  /** 키가 있어 기능을 쓸 수 있는지 */
  enabled: boolean;
  model: string;
  settings: AutoAnalysisSettings | null;
  status: AutoAnalysisStatus | null;
}

/** 자동 분석 설정·상태. 상태는 실행 중일 때만 짧게 폴링한다. */
export function useGeminiStatus(pollMs = 15_000) {
  const [state, setState] = useState<GeminiState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/gemini/status');
      if (!response.ok) throw new Error(`상태 조회 실패 (${response.status})`);
      setState(await response.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const save = useCallback(
    async (patch: Partial<AutoAnalysisSettings>) => {
      const response = await fetch('/api/gemini/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? '설정 저장 실패');
      }
      await refresh();
    },
    [refresh],
  );

  return { state, error, refresh, save };
}
