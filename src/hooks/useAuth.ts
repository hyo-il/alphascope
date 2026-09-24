import { useCallback, useEffect, useState } from 'react';

/**
 * 로그인 상태 — 앱을 그리기 **전에** 확인한다.
 *
 * ⚠️ 로그인 전에는 앱 본체를 마운트하지 않는다. 마운트해 두면 시세·계좌 폴링이 돌면서
 * 401 만 쏟아진다.
 */
export type AuthState = 'checking' | 'in' | 'out';

/** 세션이 중간에 끊겼을 때 `main.tsx` 의 fetch 래퍼가 쏘는 이벤트 */
export const AUTH_REQUIRED_EVENT = 'alphascope:auth-required';

export function useAuth() {
  const [state, setState] = useState<AuthState>('checking');
  const [notConfigured, setNotConfigured] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        setNotConfigured(false);
        setState('in');
        return;
      }
      // 503 = 서버에 비밀번호가 아직 없다. 로그인 화면이 그 안내를 대신 띄운다.
      setNotConfigured(res.status === 503);
      setState('out');
    } catch {
      /*
        서버에 닿지 못했다. 로그인 화면을 보여 준다 — 앱을 띄워 봐야 모든 요청이 실패한다.
        (서버가 다시 뜨면 로그인 버튼을 누르는 순간 이어진다.)
      */
      setState('out');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // 쓰는 도중 세션이 끝나면 로그인 화면으로 돌아간다.
  useEffect(() => {
    const onRequired = () => setState('out');
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, []);

  return {
    state,
    notConfigured,
    /** 로그인 성공 직후 — 세션 수까지 다시 받아 온다 */
    onLoggedIn: check,
    logout: useCallback(async () => {
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
      setState('out');
    }, []),
  };
}
