import { useCallback, useEffect, useState } from 'react';

/**
 * Gemini 를 쓸 수 있는지 — **키 가용성만** 본다.
 *
 * ⚠️ 예전에는 전역 자동 분석의 설정·실행 상태까지 함께 들고 있었다. 자동매매가
 * **계좌별로 일원화**되면서(Step 12 · v2.4.0) 그 설정 자체가 사라졌다.
 * 계좌별 설정·상태는 `useAutoTrading` 이 맡는다 — 여기에 다시 들이지 말 것.
 *
 * 지금 이 값을 쓰는 곳은 두 군데다:
 *   - 계좌 자동매매 설정: "AI형을 고를 수 있는가"
 *   - 차트 AI 탭: "이 종목 분석 버튼을 켤 수 있는가"
 */
interface GeminiAvailability {
  /** 키가 있어 기능을 쓸 수 있는지 */
  enabled: boolean;
  model: string;
}

export function useGeminiStatus(pollMs = 60_000) {
  const [state, setState] = useState<GeminiAvailability | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/gemini/status');
      if (!response.ok) throw new Error(`상태 조회 실패 (${response.status})`);
      setState((await response.json()) as GeminiAvailability);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    /*
     * 키 유무는 서버를 다시 띄워야 바뀐다 — 자주 물을 이유가 없다.
     * (예전엔 실행 상태를 함께 받느라 15초였다.)
     */
    if (!pollMs) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { state, error, refresh };
}
