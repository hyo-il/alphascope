/**
 * 화면 전체를 덮는 로딩 표시.
 *
 * 스켈레톤으로 대신할 수 없을 때만 쓴다 — 이미 내용이 있는 화면 위에서
 * 무거운 작업(전체 재조회 등)이 돌 때다. 처음 그리는 화면에는
 * SkeletonLoader 쪽이 낫다 (레이아웃을 미리 보여 주므로).
 */
export default function LoadingOverlay({
  label = '불러오는 중…',
  /** 부모에 relative 를 주고 그 안만 덮을지 (기본은 화면 전체) */
  contained = false,
}: {
  label?: string;
  contained?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${contained ? 'absolute' : 'fixed'} inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-bg-primary/70 backdrop-blur-[1px]`}
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
      <p className="text-sm text-text-secondary">{label}</p>
    </div>
  );
}

/** 버튼·입력창 안에 넣는 작은 스피너 */
export function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent ${className}`}
    />
  );
}
