import type { ReactNode } from 'react';

/**
 * 로딩·오류·빈 상태를 한자리에서 처리한다.
 *
 * 컴포넌트마다 `if (loading) … if (error) …` 를 반복하면 빠뜨리는 곳이 생기고,
 * 오류 화면에 재시도 버튼이 없는 곳도 생긴다.
 */
export default function AsyncBoundary({
  isLoading,
  error,
  onRetry,
  /** 로딩 중에 보여 줄 스켈레톤 */
  skeleton,
  /** 데이터가 비었을 때 (null 이면 판단하지 않는다) */
  isEmpty,
  emptyMessage = '표시할 내용이 없습니다.',
  children,
}: {
  isLoading: boolean;
  error?: string | null;
  onRetry?: () => void;
  skeleton: ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (isLoading) return <>{skeleton}</>;

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-bg-secondary p-6 text-center">
        <p className="text-sm text-bearish">{error}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-3 rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-tertiary"
          >
            다시 시도
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <p className="rounded-lg border border-border bg-bg-secondary p-6 text-center text-sm text-text-muted">
        {emptyMessage}
      </p>
    );
  }

  return <>{children}</>;
}
