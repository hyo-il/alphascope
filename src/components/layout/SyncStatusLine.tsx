import { useEffect, useState } from 'react';
import {
  getLastError,
  getLastSavedAt,
  getRevision,
  getSyncState,
  retrySave,
  subscribeSyncState,
  type SyncState,
} from '../../services/watchlistSync';
import { resyncWatchlist } from '../../hooks/useWatchlist';

/**
 * 관심 목록 관리 팝업 하단의 **동기화 상태 한 줄**.
 *
 * 다음에 비슷한 일이 생겼을 때 **콘솔을 열지 않고** 상태를 보고 다시 맞출 수 있게 한다 —
 * 이번 버그(서버는 비었는데 화면은 저장됐다고 말함)를 찾는 데 콘솔 진단이 필요했다.
 */
export default function SyncStatusLine() {
  const [state, setState] = useState<SyncState>(getSyncState);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeSyncState(setState), []);

  const savedAt = getLastSavedAt();
  const time = savedAt
    ? new Date(savedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const label =
    state === 'failed'
      ? `⚠ 서버 저장 실패 — ${getLastError() ?? '알 수 없는 오류'}`
      : state === 'offline'
        ? '⚠ 서버 저장 대기 — 연결되면 올립니다'
        : state === 'saving'
          ? '서버에 저장 중…'
          : `서버 동기화: 저장됨 · r${getRevision()}${time ? ` · ${time}` : ''}`;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-1.5 text-[10px]">
      <span className={state === 'failed' ? 'text-bearish' : 'text-text-muted'}>{label}</span>

      {(state === 'failed' || state === 'offline') && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void retrySave().finally(() => setBusy(false));
          }}
          className="rounded border border-current px-1.5 py-0.5 text-bearish transition-opacity hover:opacity-70 disabled:opacity-40"
        >
          다시 시도
        </button>
      )}

      <button
        type="button"
        onClick={resyncWatchlist}
        title="완료 표시를 지우고 서버와 처음처럼 다시 맞춥니다 (다르면 선택 팝업이 뜹니다)"
        className="ml-auto rounded border border-border px-1.5 py-0.5 text-text-muted transition-colors hover:border-accent hover:text-accent"
      >
        서버와 다시 맞추기
      </button>
    </div>
  );
}
