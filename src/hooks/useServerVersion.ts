import { useCallback, useEffect, useState } from 'react';
import { CHANGELOG } from '../data/changelog';

/**
 * 서버·화면 **버전 불일치** 감지.
 *
 * 화면에서 수정이 안 보이거나 없던 라우트가 404·400 을 내는 원인은 거의 항상
 * **서버 재시작·배포 누락**이다. 사용자는 그 오류를 "계좌가 없어졌다" 로 읽는다
 * (2026-09-23 실제 신고). 그래서 앱이 스스로 알려 준다.
 *
 * ⚠️ **폴링하지 않는다.** 서버 버전은 프로세스가 다시 뜰 때만 바뀌므로,
 * 앱 시작 시 한 번과 **탭이 다시 보일 때** 한 번이면 충분하다.
 * ⚠️ **네트워크 오류는 대상이 아니다.** 서버가 아예 안 뜬 것은 다른 문제이고,
 * 각 화면의 "불러오지 못했습니다" 안내가 맡는다 — 원인이 다른데 같은 말을 하면 안 된다.
 */

/** 화면이 가진 버전 — changelog 의 맨 앞이 단일 출처다 */
export const APP_VERSION = CHANGELOG[0]?.version ?? 'unknown';

/** 404 = 라우트 자체가 없는 옛 서버. 버전을 알 수 없으니 그렇게 적는다. */
export const UNKNOWN_OLD = '확인 불가(옛 버전)';

export interface ServerVersionState {
  /** 서버 버전, 또는 `UNKNOWN_OLD`. 네트워크 오류·미확인이면 null */
  serverVersion: string | null;
  appVersion: string;
  /** 배너를 띄워야 하는가 (불일치 + 닫지 않음) */
  mismatch: boolean;
  dismiss: () => void;
}

/** 닫은 상태는 **그 버전 조합에 대해서만** 세션 동안 유지한다 */
const keyFor = (server: string) => `alphascope.versionBannerDismissed.${server}→${APP_VERSION}`;

function isDismissed(server: string): boolean {
  try {
    return sessionStorage.getItem(keyFor(server)) === '1';
  } catch {
    // 사생활 보호 모드 등에서 접근이 막힐 수 있다 — 그때는 그냥 띄운다.
    return false;
  }
}

export function useServerVersion(): ServerVersionState {
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const check = useCallback(async () => {
    let version: string;
    try {
      const res = await fetch('/api/version');
      if (res.status === 404) {
        // 라우트가 없다 = 이 기능보다 오래된 서버다. 그 자체가 답이다.
        version = UNKNOWN_OLD;
      } else if (!res.ok) {
        return;
      } else {
        const body = (await res.json()) as { version?: string };
        if (!body.version) return;
        version = body.version;
      }
    } catch {
      // 네트워크 오류 — 서버가 안 떠 있는 것이다. 배너 대상이 아니다.
      return;
    }
    setServerVersion(version);
    setDismissed(isDismissed(version));
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [check]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (!serverVersion) return;
    try {
      sessionStorage.setItem(keyFor(serverVersion), '1');
    } catch {
      /* 저장이 막혀도 이번 화면에서는 닫힌다 */
    }
  }, [serverVersion]);

  return {
    serverVersion,
    appVersion: APP_VERSION,
    mismatch: serverVersion !== null && serverVersion !== APP_VERSION && !dismissed,
    dismiss,
  };
}
