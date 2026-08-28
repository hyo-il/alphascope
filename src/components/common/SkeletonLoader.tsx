/**
 * 스켈레톤 로더.
 *
 * 스피너 대신 **실제 레이아웃과 같은 모양의 회색 박스**를 먼저 그린다.
 * 데이터가 도착했을 때 화면이 튀지 않아야 하므로, 쓰는 쪽에서 실제 요소와
 * 같은 높이·너비를 주는 것이 중요하다 (그래서 className 을 받는다).
 *
 * shimmer 애니메이션은 `index.css` 의 `.skeleton` 에 있다.
 */

/** 회색 박스 하나 — 가장 기본 단위 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} aria-hidden />;
}

/** 문단 — 마지막 줄은 짧게 해서 실제 글처럼 보이게 한다 */
export function SkeletonText({
  lines = 3,
  className = '',
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          key={index}
          className={`h-3 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/** 숫자 카드 그리드 (모의투자 요약, 시황 카드 등) */
export function SkeletonCards({
  count = 4,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={`grid gap-3 ${className}`} aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-bg-secondary p-4">
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

/** 표 — 헤더 한 줄 + 본문 N줄 */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border" aria-hidden>
      <div className="flex gap-4 border-b border-border bg-bg-secondary px-3 py-2">
        {Array.from({ length: columns }).map((_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="flex gap-4 border-b border-border/50 px-3 py-2.5 last:border-0">
          {Array.from({ length: columns }).map((_, column) => (
            <Skeleton key={column} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** 목록 카드 (분석 결과 타임라인, 보유 종목 등) */
export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-border bg-bg-secondary p-3">
          <div className="mb-2 flex items-center gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
            <Skeleton className="ml-auto h-3 w-24" />
          </div>
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}
