import { useEffect, useState } from 'react';
import {
  getLastError,
  getSyncState,
  retrySave,
  subscribeSyncState,
  type SyncState,
} from '../../services/watchlistSync';

/**
 * 관심 목록의 **서버 저장 상태** — 화면 왼쪽 아래 구석에.
 *
 * ⚠️ 조용히 두지 않는다. 서버에 올라가지 않은 채로 다른 기기를 열면 목록이 어긋나는데,
 * 아무 표시가 없으면 그 사실을 모른다 — 실제로 v2.11.0 이 400 을 조용히 버려
 * **다른 기기에서 관심 목록이 비어 보였다** (2026-09-24 신고).
 * 저장이 끝난 평소에는 아무것도 그리지 않는다 — 늘 떠 있으면 배경이 된다.
 *
 * ⚠️ 왼쪽 여백(`left-[168px]`)은 **펼친 사이드 메뉴(156px)를 피하려는 것**이다.
 * `left-3` 에 두었더니 맨 아래 「설정」 메뉴를 덮었다.
 */
export default function SyncIndicator() {
  const [state, setState] = useState<SyncState>(getSyncState);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeSyncState(setState), []);

  if (state === 'idle') return null;

  if (state === 'saving') {
    return (
      <div
        role="status"
        className="pointer-events-none fixed bottom-3 left-[168px] z-40 rounded-md border border-border bg-bg-secondary px-2 py-1 text-[10px] text-text-muted"
      >
        관심 목록 저장 중…
      </div>
    );
  }

  const failed = state === 'failed';
  return (
    <div
      role="status"
      className={`fixed bottom-3 left-[168px] z-40 max-w-[320px] rounded-md border px-2.5 py-1.5 text-[10px] leading-snug ${
        failed
          ? 'border-bearish/50 bg-bearish/15 text-bearish'
          : 'border-warning/50 bg-warning/15 text-warning'
      }`}
    >
      <p>
        {failed ? '⚠ 관심 목록 서버 저장 실패' : '⚠ 관심 목록 서버 저장 대기'}
        {/* 서버가 준 문구를 그대로 보여 준다 — 짐작한 말로 바꾸면 원인을 못 찾는다 */}
        {failed && getLastError() && (
          <span className="block text-text-secondary">{getLastError()}</span>
        )}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void retrySave().finally(() => setBusy(false));
        }}
        className="mt-1 rounded border border-current px-1.5 py-0.5 transition-opacity hover:opacity-70 disabled:opacity-40"
      >
        {busy ? '보내는 중…' : '다시 시도'}
      </button>
    </div>
  );
}
