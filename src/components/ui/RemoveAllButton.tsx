/**
 * 「모두 삭제」 글자 버튼 (v2.40.0 공통 동작 규칙) — 빨간 글자, 어디서나 같은 모양.
 * 0개면 쓰는 쪽에서 감춘다. 확인 창은 쓰는 쪽이 정한다: 저장한 것이면 `modal.confirm`, 목록에서만 빼는 것이면 확인 창 없음
 * (있던 확인 창을 없애거나 없던 확인 창을 새로 만들지 않는다 — v2.34.1 규칙).
 */
export default function RemoveAllButton({ onClick, label = '모두 삭제', className = '' }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[13px] text-bearish transition-colors hover:bg-bearish/10 ${className}`}
    >
      {label}
    </button>
  );
}
