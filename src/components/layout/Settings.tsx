import { useEffect, useState } from 'react';

interface Props {
  isMock: boolean;
  engineDown: boolean;
}

interface Health {
  ok: boolean;
  mock: boolean;
  indicatorEngine: boolean;
  time: string;
}

/** 설정 · 상태 확인 화면 — 무엇이 연결돼 있고 무엇이 저장돼 있는지 한눈에 보여 준다. */
export default function Settings({ isMock, engineDown }: Props) {
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

  const clearStorage = (key: string, label: string) => {
    localStorage.removeItem(key);
    setCleared(`${label}을(를) 비웠습니다. 새로고침하면 반영됩니다.`);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-4 text-base font-semibold">설정 · 연결 상태</h2>

      <section className="mb-6 max-w-2xl">
        <h3 className="mb-1 text-xs font-medium text-text-secondary">데이터 연결</h3>
        {row(
          '토스증권 API',
          !isMock,
          isMock ? '모의 데이터 (.env 에 키를 넣으세요)' : '실시간 연결됨',
        )}
        {row(
          '지표 엔진 (Python)',
          !engineDown && (health?.indicatorEngine ?? false),
          health?.indicatorEngine ? '실행 중 (5001)' : '중지됨 — npm run dev:py',
        )}
        {row('API 서버', health?.ok ?? false, health?.ok ? '실행 중 (4000)' : '응답 없음')}
        {health && (
          <p className="pt-2 text-[11px] text-text-muted">
            마지막 확인: {new Date(health.time).toLocaleString('ko-KR')}
          </p>
        )}
      </section>

      <section className="mb-6 max-w-2xl">
        <h3 className="mb-1.5 text-xs font-medium text-text-secondary">저장된 데이터</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => clearStorage('alphascope.watchlist', '관심 목록')}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            관심 목록 비우기
          </button>
          <button
            type="button"
            onClick={() => clearStorage('alphascope.recent', '최근 조회')}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            최근 조회 비우기
          </button>
        </div>
        {cleared && <p className="mt-2 text-[11px] text-text-muted">{cleared}</p>}
        <p className="mt-2 text-[11px] text-text-muted">
          관심 목록과 최근 조회는 이 브라우저에만 저장됩니다. 캔들·기업정보 캐시와 분석 기록은
          SQLite(`db/alphascope.db`)에 있습니다.
        </p>
      </section>

      <section className="max-w-2xl">
        <h3 className="mb-1.5 text-xs font-medium text-text-secondary">단축키 · 조작</h3>
        <ul className="space-y-1 text-xs text-text-muted">
          <li>· 휠: 커서 위치 기준 확대/축소</li>
          <li>· 드래그: 차트 좌우 이동</li>
          <li>· Esc: 드로잉 도구 해제 · Delete: 선택한 드로잉 삭제</li>
          <li>· 드로잉 우클릭: 삭제 메뉴 · 드로잉 클릭: ✕ 버튼</li>
          <li>· 관심 목록 우클릭: 종목 삭제</li>
        </ul>
      </section>

      <p className="mt-6 text-[11px] text-text-muted">
        ⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 투자 조언이 아닙니다.
      </p>
    </div>
  );
}
