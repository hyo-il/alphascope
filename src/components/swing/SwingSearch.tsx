import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import { InlineSpinner } from '../common/LoadingOverlay';
import { useSwingEvaluation } from '../../hooks/useSwing';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import SwingRecommendationCard from './SwingRecommendationCard';
import { GRADE_STYLE } from './gradeStyle';

/** 관심 목록에 없는 종목도 같은 5가지 조건으로 평가한다 */
export default function SwingSearch({
  onSelectSymbol,
  onAnalyze,
}: {
  onSelectSymbol: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const { recommendation, loading, error, evaluate } = useSwingEvaluation();
  const paperBuy = usePaperQuickBuy();
  const [queried, setQueried] = useState<string | null>(null);

  const submit = (symbol: string) => {
    const next = symbol.trim().toUpperCase();
    if (!next) return;
    setQueried(next);
    void evaluate(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SymbolSearch symbol={queried ?? ''} onSubmit={submit} />
        {loading && <InlineSpinner />}
      </div>

      {!queried && !loading && (
        <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
          종목을 검색하면 추세 · 타이밍 · 모멘텀 · 거래량 · 리스크/리워드 5가지 조건으로 채점하고
          매수가 · 목표가 · 손절가를 제시합니다.
        </p>
      )}

      {error && (
        <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
          {error}
        </p>
      )}

      {recommendation && !loading && (
        <>
          {recommendation.rejection && (
            <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
              {GRADE_STYLE[recommendation.grade].icon} 매수 추천 구간이 아닙니다 —{' '}
              {recommendation.rejection}
            </p>
          )}
          <SwingRecommendationCard
            recommendation={recommendation}
            onSelectSymbol={onSelectSymbol}
            onPaperBuy={paperBuy}
            onAnalyze={onAnalyze}
          />
        </>
      )}
    </div>
  );
}
