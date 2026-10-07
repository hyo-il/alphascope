import type { ReactNode } from 'react';
import SymbolSearch from './SymbolSearch';
import { InlineSpinner } from './LoadingOverlay';
import { SkeletonCards } from './SkeletonLoader';

/**
 * 한 종목 검색 화면의 틀 (v2.41.0) — 매수 판단 도우미 「종목 검색」 과 급등 탐지 「종목 검색」 이 같은 배치를 쓴다.
 * 설명 한 줄 → 검색칸(폭 고정) + 처리 중 표시 → 빈 화면 문구 / 오류 / 결과. 평가 계산·저장 여부는 각 화면 그대로다.
 */
export default function SingleSymbolSearch({
  intro,
  queried,
  loading,
  error,
  emptyText,
  onSubmit,
  children,
  footer,
}: {
  intro: ReactNode;
  queried: string | null;
  loading: boolean;
  error: string | null;
  emptyText: ReactNode;
  onSubmit: (symbol: string) => void;
  /** 결과(받은 뒤에만 그린다) */
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-text-secondary">{intro}</p>
      <div className="flex items-center gap-2">
        <div className="w-96 max-w-full">
          <SymbolSearch symbol={queried ?? ''} onSubmit={onSubmit} />
        </div>
        {loading && <InlineSpinner />}
      </div>

      {!queried && !loading && <p className="rounded-xl bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">{emptyText}</p>}
      {/* 받기 전에는 결과 자리를 미리 그린다 — 「없음」 을 먼저 그리지 않는다(로딩 표시 규칙) */}
      {loading && queried && <SkeletonCards count={1} />}
      {error && !loading && <p className="rounded-lg bg-bearish/10 px-3 py-2 text-[13px] text-bearish">{error}</p>}
      {!loading && children}
      {footer}
    </div>
  );
}
