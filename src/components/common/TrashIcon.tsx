/**
 * 휴지통 아이콘 — 목록에서 제거.
 *
 * 관심 목록(`WatchFolderView`)과 최근 조회(`WatchPanel`)가 같은 자리에서 같은 동작을 하므로
 * 아이콘도 같아야 한다. 두 곳에 각자 그려 두면 한쪽만 손대는 순간 갈라진다.
 */
export default function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
      <path d="M3.5 5.5h13" strokeLinecap="round" />
      <path d="M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5" strokeLinecap="round" />
      <path d="M5.5 5.5l.7 10a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-10" strokeLinejoin="round" />
      <path d="M8.5 8.5v5M11.5 8.5v5" strokeLinecap="round" />
    </svg>
  );
}
