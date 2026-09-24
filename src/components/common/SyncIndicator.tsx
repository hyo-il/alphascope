import { useEffect, useState } from 'react';
import { getSyncState, subscribeSyncState, type SyncState } from '../../services/watchlistSync';

/**
 * 관심 목록의 **서버 저장 상태** — 화면 왼쪽 아래 구석에 작게.
 *
 * ⚠️ 조용히 두지 않는다. 서버에 올라가지 않은 채로 다른 기기를 열면 목록이 어긋나는데,
 * 아무 표시가 없으면 그 사실을 모른다.
 * 저장이 끝난 평소에는 아무것도 그리지 않는다 — 늘 떠 있으면 배경이 된다.
 */
export default function SyncIndicator() {
  const [state, setState] = useState<SyncState>(getSyncState);

  useEffect(() => subscribeSyncState(setState), []);

  if (state === 'idle') return null;

  const offline = state === 'offline';
  return (
    <div
      role="status"
      className={`pointer-events-none fixed bottom-3 left-3 z-40 rounded-md border px-2 py-1 text-[10px] ${
        offline
          ? 'border-warning/50 bg-warning/15 text-warning'
          : 'border-border bg-bg-secondary text-text-muted'
      }`}
    >
      {offline ? '⚠ 관심 목록 서버 저장 대기' : '관심 목록 저장 중…'}
    </div>
  );
}
