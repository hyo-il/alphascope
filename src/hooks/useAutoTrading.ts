import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountStrategy, AccountStrategyStatus } from '../types/autoTrading';

/**
 * 계좌별 자동매매 — 1단계 백엔드 API 를 그대로 부른다.
 *
 * ⚠️ **프론트에 설정 저장소를 따로 두지 않는다.** 값은 서버(`autoTrading.strategies`)가
 * 단일 출처다. 여기서 localStorage 에 캐시하면 자동 분석 화면의 기존 설정 UI 와
 * 값이 갈라진다 (둘은 아직 공존한다 — 3단계에서 정리).
 */

const STATUS_POLL_MS = 15_000;

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  }
  return payload as T;
}

export function useAutoTrading(accountId: number | null) {
  const [strategy, setStrategy] = useState<AccountStrategy | null>(null);
  const [status, setStatus] = useState<AccountStrategyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 늦게 도착한 이전 계좌의 응답이 새 계좌를 덮어쓰지 않도록 */
  const sequence = useRef(0);

  const load = useCallback(async () => {
    if (!accountId) {
      setStrategy(null);
      setStatus(null);
      return;
    }
    const mine = ++sequence.current;
    setLoading(true);
    try {
      const data = await json<{ strategy: AccountStrategy; status: AccountStrategyStatus }>(
        `/api/auto-trading/strategies/${accountId}`,
      );
      if (mine !== sequence.current) return;
      setStrategy(data.strategy);
      setStatus(data.status);
      setError(null);
    } catch (e) {
      if (mine !== sequence.current) return;
      setError((e as Error).message);
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * 상태만 완만하게 갱신한다 (15초).
   * ⚠️ 설정까지 폴링하면 사용자가 패널에서 고치는 중에 서버 값이 덮어쓴다.
   * 스케줄러 틱이 1분이라 이보다 촘촘히 물어볼 이유도 없다.
   */
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;

    const tick = async () => {
      if (document.hidden) return;
      try {
        const data = await json<{ status: AccountStrategyStatus }>(
          `/api/auto-trading/status/${accountId}`,
        );
        if (!cancelled) setStatus(data.status);
      } catch {
        // 다음 주기에 다시 시도한다 — 상태 조회 실패로 화면을 깨뜨리지 않는다.
      }
    };

    const timer = setInterval(() => void tick(), STATUS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId]);

  /** 설정 저장 — 서버가 값을 조여서 돌려주므로 응답을 그대로 반영한다 */
  const save = useCallback(
    async (patch: Partial<AccountStrategy>) => {
      if (!accountId) throw new Error('계좌를 먼저 고르세요');
      const data = await json<{ strategy: AccountStrategy }>(
        `/api/auto-trading/strategies/${accountId}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      setStrategy(data.strategy);
      // 켜고 끈 직후의 상태(다음 실행 시각·차단 사유)는 서버가 다시 계산한다.
      void load();
      return data.strategy;
    },
    [accountId, load],
  );

  /** 지금 한 바퀴 (주기·정규장 무시) */
  const runNow = useCallback(async () => {
    if (!accountId) throw new Error('계좌를 먼저 고르세요');
    const data = await json<{ result: unknown }>(`/api/auto-trading/run/${accountId}`, {
      method: 'POST',
    });
    void load();
    return data.result;
  }, [accountId, load]);

  return { strategy, status, loading, error, save, runNow, reload: load };
}
