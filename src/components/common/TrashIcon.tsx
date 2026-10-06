import { Trash2 } from 'lucide-react';

/**
 * 휴지통 아이콘 — **저장한 것을 삭제**(되돌릴 수 없음, v2.40.0 공통 동작 규칙 — 확인 창 규칙은 v2.34.1 그대로).
 * 목록에서만 빼는 삭제(데이터는 남는다)는 이 아이콘이 아니라 `ui/ListRemoveButton`(×) 이다.
 *
 * 관심 목록(`WatchFolderView`)과 최근 조회(`WatchPanel`)가 같은 자리에서 같은 동작을 하므로
 * 아이콘도 같아야 한다. 두 곳에 각자 그려 두면 한쪽만 손대는 순간 갈라진다.
 * v2.36.0 부터 직접 그린 SVG 대신 lucide `Trash2`(앱 아이콘은 lucide 하나 — 선 굵기 1.75 통일).
 */
export default function TrashIcon({ className = '' }: { className?: string }) {
  return <Trash2 strokeWidth={1.75} className={className} aria-hidden />;
}
