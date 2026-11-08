import { useCallback, useEffect, useRef } from 'react';

/**
 * 자산 화면 잠금 시간(v2.65.4) — 화면 쪽 타이머 · 「화면을 쓴 것」 알리기.
 * - 사용자 입력(클릭 · 키 · 스크롤 · 터치 — 돌려주는 `onInput` 을 자산 화면 바깥 틀에 단다)이 있으면 `POST /api/asset/touch` 를
 *   **1분에 한 번 이하**로 보낸다(1분 안에 또 입력이 있으면 1분이 찼을 때 한 번 — 마지막 입력을 놓치지 않게).
 * - 서버와 같은 시간 타이머: 마지막으로 touch 를 보낸 때(처음은 서버가 준 남은 시간)부터 `lockMinutes` 분이 지나면
 *   **서버 응답을 기다리지 않고** `onIdle(분)`(잠금 화면 — 안내 글자의 시간은 이 타이머가 쓴 값). 0 = 끄기 — 타이머 없음(touch 는 보낸다 — 서버가 시간을 셀 일이 없어 무해).
 * - touch 응답이 `asset-locked`(서버 시각으로 이미 지남) → `onLocked`(잠금 화면 — 서버가 준 상태로).
 * ⚠️ 10초 summary 폴링은 입력이 아니다 — 여기서 보내지 않는다.
 */
export const TOUCH_EVERY_MS = 60_000;
const CHECK_MS = 1_000;

export function useAssetIdleLock({ lockMinutes, remainingMs, onIdle, onLocked }: { lockMinutes: number; remainingMs: number | null; onIdle: (minutes: number) => void; onLocked: () => void }) {
  /** 마지막으로 화면을 쓴 시각(서버 `lastActiveAt` 과 같은 뜻) — 처음은 서버가 준 남은 시간에서 거꾸로 */
  const lastActive = useRef<number | null>(null);
  const lastSent = useRef(-Infinity);
  const trailing = useRef<number | null>(null);
  const onIdleRef = useRef(onIdle);
  const onLockedRef = useRef(onLocked);
  useEffect(() => {
    onIdleRef.current = onIdle;
    onLockedRef.current = onLocked;
  });
  const startRemaining = useRef(remainingMs);
  const startMinutes = useRef(lockMinutes);

  useEffect(() => {
    const m = startMinutes.current;
    const r = startRemaining.current;
    lastActive.current = Date.now() - (m > 0 && r != null ? Math.max(0, m * 60_000 - r) : 0);
    return () => {
      if (trailing.current != null) window.clearTimeout(trailing.current);
    };
  }, []);

  const send = useCallback(() => {
    const now = Date.now();
    lastSent.current = now;
    lastActive.current = now;
    fetch('/api/asset/touch', { method: 'POST' })
      .then((res) => res.json().catch(() => ({})))
      .then((body: { code?: string }) => {
        if (body.code === 'asset-locked') onLockedRef.current();
      })
      .catch(() => {
        /* 연결 실패 — 다음 입력 때 다시(화면 타이머는 그대로 센다) */
      });
  }, []);

  useEffect(() => {
    if (lockMinutes <= 0) return;
    const id = window.setInterval(() => {
      if (lastActive.current != null && Date.now() - lastActive.current > lockMinutes * 60_000) onIdleRef.current(lockMinutes);
    }, CHECK_MS);
    return () => window.clearInterval(id);
  }, [lockMinutes]);

  /** 사용자 입력 — 1분에 한 번 이하로 touch */
  return useCallback(() => {
    const wait = lastSent.current + TOUCH_EVERY_MS - Date.now();
    if (wait <= 0) {
      send();
      return;
    }
    if (trailing.current == null) {
      trailing.current = window.setTimeout(() => {
        trailing.current = null;
        send();
      }, wait);
    }
  }, [send]);
}
