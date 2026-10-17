import { useCallback, useEffect, useState } from 'react';

/**
 * Gemini 를 쓸 수 있는지 — **키 가용성만** 본다.
 *
 * ⚠️ 키 가용성만 든다(전역 자동 분석 설정은 없다).
 * 계좌별 설정·상태는 `useAutoTrading` 이 맡는다 — 여기에 다시 들이지 말 것.
 *
 * 지금 이 값을 쓰는 곳은 두 군데다:
 *   - 계좌 자동매매 설정: 「AI 검증」 을 켜도 AI 를 쓸 수 있는가(꺼져 있으면 경고 한 줄)
 *   - 차트 AI 탭: "이 종목 분석 버튼을 켤 수 있는가"
 */
interface GeminiAvailability {
  /** 키가 있어 기능을 쓸 수 있는지 */
  enabled: boolean;
  model: string;
  /** 꺼진 이유 (켜져 있으면 null) — 키 없음 / GEMINI_ENABLED=false */
  reason?: string | null;
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
     */
    if (!pollMs) return;
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { state, error, refresh };
}
