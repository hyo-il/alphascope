import { useCallback, useEffect, useState } from 'react';
// 키 문자열을 여기에 다시 적지 않는다 — 옛 키만 지워 '비우기' 가 동작하지 않던 원인이다.
import { RECENT_KEY, WATCHLIST_KEYS } from '../../hooks/useWatchlist';
import { CHANGELOG } from '../../data/changelog';
import { modal } from '../../store/uiStore';
import { AUTH_REQUIRED_EVENT } from '../../hooks/useAuth';

interface Props {
  isMock: boolean;
  engineDown: boolean;
  /**
   * 어느 설정 화면인지.
   * - `account` 계좌 연결(토스 API·모의투자)
   * - `app` 앱 기능(지표 엔진·저장 데이터·조작)
   *
   * 한 화면에 다 두면 "어디서 키를 넣더라" 를 스크롤로 찾게 된다.
   */
  section: 'account' | 'app';
}

interface Health {
  ok: boolean;
  mock: boolean;
  /** 토스 API 에 실제로 닿는지 — 키가 있어도 IP 차단이면 false */
  toss?: boolean;
  tossError?: string | null;
  indicatorEngine: boolean;
  time: string;
}

/** 설정 · 상태 확인 화면 — 무엇이 연결돼 있고 무엇이 저장돼 있는지 한눈에 보여 준다. */
export default function Settings({ isMock, engineDown, section }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [cleared, setCleared] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const row = (label: string, ok: boolean, detail: string) => (
    <div className="flex items-center justify-between border-b border-border/60 py-2">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-xs ${ok ? 'text-bullish' : 'text-warning'}`}>
        {ok ? '✅' : '⚠️'} {detail}
      </span>
    </div>
  );

  const clearStorage = (keys: readonly string[], label: string) => {
    for (const key of keys) localStorage.removeItem(key);
    setCleared(`${label}을(를) 비웠습니다. 새로고침하면 반영됩니다.`);
  };

  const updatedAt = health && (
    <p className="pt-2 text-[11px] text-text-muted">
      마지막 확인: {new Date(health.time).toLocaleString('ko-KR')}
    </p>
  );

  if (section === 'account') {
    return (
      <div className="h-full overflow-y-auto p-6">
        <h2 className="mb-4 text-base font-semibold">계좌 설정</h2>

        <section className="mb-6 max-w-2xl">
          <h3 className="mb-1 text-xs font-medium text-text-secondary">증권사 연결</h3>
          {/* 키가 있다고 연결된 것은 아니다 — 실제 토큰 발급 결과로 판정한다. */}
          {row(
            '토스증권 API',
            !isMock && (health?.toss ?? false),
            isMock
              ? '모의 데이터 (.env 에 키를 넣으세요)'
              : health?.toss
                ? '실시간 연결됨'
                : `연결 실패 — 캐시된 데이터로 동작 중${health?.tossError ? ` (${health.tossError})` : ''}`,
          )}
          {updatedAt}
          <p className="mt-2 text-[11px] leading-relaxed text-text-muted">
            토스 `CLIENT_ID` · `CLIENT_SECRET` 은 서버의 `.env` 에서만 읽습니다. 브라우저에는
            키가 내려가지 않으므로 이 화면에서 입력받지 않습니다.
          </p>
        </section>

        <section className="max-w-2xl">
          <h3 className="mb-1.5 text-xs font-medium text-text-secondary">모의투자 계좌</h3>
          <p className="text-[11px] leading-relaxed text-text-muted">
            계좌 만들기·초기 자금·초기화는 <b>계좌 &gt; 포트폴리오</b> 에서 계좌를 「모의투자
            계좌」로 바꾸면 그 화면 안에 있습니다. 설정에 또 두면 같은 조작이 두 곳이 됩니다.
          </p>
        </section>

        <p className="mt-6 text-[11px] text-text-muted">
          ⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 투자 조언이 아닙니다.
        </p>
        <AppVersion />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-4 text-base font-semibold">앱 기능 설정</h2>

      <section className="mb-6 max-w-2xl">
        <h3 className="mb-1 text-xs font-medium text-text-secondary">서비스 상태</h3>
        {row(
          '지표 엔진 (Python)',
          !engineDown && (health?.indicatorEngine ?? false),
          health?.indicatorEngine ? '실행 중 (5001)' : '중지됨 — npm run dev:py',
        )}
        {row('API 서버', health?.ok ?? false, health?.ok ? '실행 중 (4000)' : '응답 없음')}
        {updatedAt}
      </section>

      <section className="mb-6 max-w-2xl">
        <h3 className="mb-1.5 text-xs font-medium text-text-secondary">저장된 데이터</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => clearStorage(WATCHLIST_KEYS, '관심 목록')}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            관심 목록 비우기
          </button>
          <button
            type="button"
            onClick={() => clearStorage([RECENT_KEY], '최근 조회')}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            최근 조회 비우기
          </button>
        </div>
        {cleared && <p className="mt-2 text-[11px] text-text-muted">{cleared}</p>}
        <p className="mt-2 text-[11px] text-text-muted">
          관심 목록과 최근 조회는 **서버에 저장**되고 이 브라우저에는 캐시만 남습니다 —
          위 버튼은 이 브라우저의 캐시를 비웁니다(서버 목록은 그대로). 캔들·기업정보 캐시와
          분석 기록은 SQLite(`db/alphascope.db`)에 있습니다.
        </p>
      </section>

      <section className="mb-6 max-w-2xl">
        <h3 className="mb-1.5 text-xs font-medium text-text-secondary">로그인</h3>
        <AuthSection />
      </section>

      <section className="max-w-2xl">
        <h3 className="mb-1.5 text-xs font-medium text-text-secondary">단축키 · 조작</h3>
        <ul className="space-y-1 text-xs text-text-muted">
          <li>· 휠: 커서 위치 기준 확대/축소</li>
          <li>· 드래그: 차트 좌우 이동</li>
          <li>· Esc: 드로잉 도구 해제 · Delete: 선택한 드로잉 삭제</li>
          <li>· 드로잉 우클릭: 삭제 메뉴 · 드로잉 클릭: ✕ 버튼</li>
          <li>· 관심 목록 ⚙️: 폴더 · 순서 · 삭제 관리</li>
          <li>· 차트 하단 탭 경계 드래그: 높이 조절 · 더블클릭: 기본 높이</li>
        </ul>
      </section>

      <p className="mt-6 text-[11px] text-text-muted">
        ⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 투자 조언이 아닙니다.
      </p>
      <AppVersion />
    </div>
  );
}

/** 지금 돌고 있는 버전 — 업데이트 내역의 맨 앞 항목이 곧 현재 버전이다 */
function AppVersion() {
  return (
    <p className="mt-2 text-[10px] text-text-muted">
      AlphaScope {CHANGELOG[0]?.version ?? ''}
    </p>
  );
}

/**
 * 로그인 상태 — 지금 몇 대에서 로그인돼 있는지 보여 주고, 한 번에 끊을 수 있게 한다.
 *
 * 비밀번호를 바꾸는 명령(`npm run auth:set-password`)도 세션을 전부 끊지만,
 * 서버에 들어가지 않고 끊고 싶을 때가 있다 (PC 방에서 쓴 것 같을 때 등).
 */
function AuthSection() {
  const [sessions, setSessions] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const body = (await res.json()) as { sessions?: number };
      setSessions(body.sessions ?? null);
    } catch {
      /* 못 읽으면 개수를 감춘다 — 틀린 수를 보여 주지 않는다 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const logoutAll = () =>
    modal.confirm({
      title: '모든 기기에서 로그아웃',
      message:
        '지금 로그인된 모든 기기의 세션을 끊습니다.\n이 창도 로그인 화면으로 돌아갑니다.',
      confirmText: '로그아웃',
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await fetch('/api/auth/logout-all', { method: 'POST' });
          // 다음 요청이 401 을 받으면 fetch 래퍼가 로그인 화면으로 돌린다.
          window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
        } finally {
          setBusy(false);
        }
      },
    });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs text-text-muted">
        현재 로그인된 기기 {sessions === null ? '—' : `${sessions}개`}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={logoutAll}
        className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-bearish hover:text-bearish disabled:opacity-40"
      >
        모든 기기에서 로그아웃
      </button>
      <p className="w-full text-[11px] text-text-muted">
        비밀번호는 서버에서 <code className="rounded bg-bg-tertiary px-1">npm run auth:set-password</code>{' '}
        로만 바꿉니다. 바꾸면 모든 기기의 로그인이 끊깁니다.
      </p>
    </div>
  );
}
