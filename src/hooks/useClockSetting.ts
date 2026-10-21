import { useEffect } from 'react';
import { create } from 'zustand';
import { toast } from '../store/uiStore';
import { DEFAULT_CLOCK, type ClockSetting } from '../types/clock';

/**
 * 떠 있는 한국 시간 시계의 자리 · 고정 상태(`GET|PUT /api/settings/clock`) — 서버 저장(기기가 달라도 같은 자리).
 * 시계(`common/KstClock`)와 설정의 「시계 위치 초기화」 가 이 스토어 하나를 쓴다.
 *
 * - 받기 전에는 기본 자리(`DEFAULT_CLOCK`)에 보인다 — 시계는 받기와 상관없이 시각을 보인다(받는 중 표시 없음).
 * - 받기 전에 사용자가 이미 옮겼거나 핀을 눌렀으면 받은 값으로 덮지 않는다(손으로 한 것이 이긴다).
 * - 저장은 **화면 먼저** 바꾸고 서버에 보낸다. 실패해도 화면의 자리는 그대로 두고 오류 토스트 한 번(앱은 멈추지 않는다).
 */
interface ClockState {
  clock: ClockSetting;
  /** 사용자가 옮기거나 핀을 눌렀다 — 늦게 온 받기 결과로 덮지 않는다 */
  touched: boolean;
}

export const useClockStore = create<ClockState>(() => ({ clock: DEFAULT_CLOCK, touched: false }));

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

/** 저장 요청을 차례로 보낸다 — 빨리 두 번 옮겨도 늦게 도착한 앞 요청이 뒤 값을 덮지 않게 */
let saving: Promise<unknown> = Promise.resolve();

/** 화면의 자리를 바꾸고 서버에 저장한다. 성공하면 true */
export function saveClock(next: ClockSetting): Promise<boolean> {
  useClockStore.setState({ clock: next, touched: true });
  const request = saving.then(() =>
    json<{ clock: ClockSetting }>('/api/settings/clock', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clock: next }),
    }).then(
      () => true,
      (e) => {
        toast.error('시계 자리를 저장하지 못했습니다', `화면에서는 그 자리에 둡니다 — ${e instanceof Error ? e.message : String(e)}`);
        return false;
      },
    ),
  );
  saving = request;
  return request;
}

/** 받는 중인 요청 — 다시 마운트돼도(개발 StrictMode) 두 번 받지 않는다 */
let inflight: Promise<void> | null = null;

/** 로그인한 앱이 처음 뜰 때 한 번 받는다. 실패하면 기본 자리 그대로(토스트 한 번) */
export function useLoadClockSetting(): void {
  useEffect(() => {
    if (inflight) return;
    useClockStore.setState({ touched: false });
    inflight = json<{ clock: ClockSetting }>('/api/settings/clock')
      .then((r) => {
        if (!useClockStore.getState().touched) useClockStore.setState({ clock: r.clock });
      })
      .catch((e) => {
        toast.error('시계 자리를 불러오지 못했습니다', `기본 자리에 둡니다 — ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        inflight = null;
      });
  }, []);
}
