import { useState } from 'react';
import { UNKNOWN_OLD, useServerVersion } from '../../hooks/useServerVersion';

/**
 * 서버가 옛 버전으로 떠 있으면 앱 맨 위에 알린다 (시황 카드 위).
 *
 * 이 배너가 없던 동안, 옛 서버 때문에 난 오류를 사용자가 "계좌가 사라졌다" 로 읽었다.
 * 데이터는 멀쩡했고 서버만 재시작하면 되는 상황이었다 — 화면이 그렇게 말해 줘야 한다.
 */
export default function VersionMismatchBanner() {
  const { serverVersion, appVersion, mismatch, dismiss } = useServerVersion();
  const [open, setOpen] = useState(false);

  if (!mismatch) return null;

  return (
    <div className="shrink-0 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">⚠️</span>
        <span>
          서버가 옛 버전(
          <b>{serverVersion === UNKNOWN_OLD ? UNKNOWN_OLD : serverVersion}</b>)으로 실행 중입니다
          <span className="mx-1.5 text-warning/50">·</span>
          화면은 <b>{appVersion}</b> — 서버를 다시 시작하세요
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-warning/40 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-warning/15"
        >
          자세히
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="닫기"
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] transition-colors hover:bg-warning/15"
        >
          ✕
        </button>
      </div>

      {open && (
        <div className="mt-1.5 space-y-0.5 pl-7 text-[11px] text-warning/90">
          <p>
            맥: 실행 창을 닫고 <code className="rounded bg-warning/15 px-1">start.command</code> 를
            다시 실행
          </p>
          <p>
            오라클:{' '}
            <code className="rounded bg-warning/15 px-1">
              git pull &amp;&amp; npm install &amp;&amp; npm run build &amp;&amp; pm2 restart all
            </code>
          </p>
        </div>
      )}
    </div>
  );
}
