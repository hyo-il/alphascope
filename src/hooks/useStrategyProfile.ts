import { useCallback, useEffect, useState } from 'react';
import type { CustomProfileId, ProfileId, ProfileState, SwingParams } from '../types/strategyProfile';

/**
 * 스윙 판정 기준 프로파일 — 서버가 단일 출처다.
 *
 * ⚠️ **폴링하지 않고 localStorage 에 캐시하지도 않는다** (계좌별 자동매매 설정과 같은 이유).
 * 편집 중에 서버 값이 덮어쓰면 사용자가 방금 친 숫자가 사라지고, 캐시를 두면 어느 쪽이
 * 진짜 기준인지 화면과 판정이 갈라진다.
 */

export interface ProfileFieldError {
  field: string;
  message: string;
}

export class ProfileSaveError extends Error {
  constructor(
    message: string,
    readonly fields: ProfileFieldError[],
  ) {
    super(message);
    this.name = 'ProfileSaveError';
  }
}

export function useStrategyProfile() {
  const [state, setState] = useState<ProfileState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/strategy-profile');
      const body = (await res.json()) as ProfileState & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `조회 실패 (${res.status})`);
      setState(body);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (patch: { active?: ProfileId; custom?: Partial<Record<CustomProfileId, SwingParams>> }) => {
      const res = await fetch('/api/strategy-profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json()) as ProfileState & { error?: string; fields?: ProfileFieldError[] };
      if (!res.ok || body.error) {
        throw new ProfileSaveError(body.error ?? `저장 실패 (${res.status})`, body.fields ?? []);
      }
      setState(body);
      setError(null);
      return body;
    },
    [],
  );

  return { state, error, refresh, save };
}
