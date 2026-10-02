import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import { InlineSpinner } from '../common/LoadingOverlay';
import { useSwingEvaluation } from '../../hooks/useSwing';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import SwingRecommendationCard from './SwingRecommendationCard';
import { GRADE_STYLE } from './gradeStyle';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { TargetAnalyzeButton, TargetProgressBox, TargetSummaryLine, latestFor, useConfirmDelete } from './TargetAnalysisParts';
import type { SwingGoal } from '../../types/swingGoal';

/** 관심 목록에 없는 종목도 같은 5가지 조건으로 평가한다 */
export default function SwingSearch({
  onSelectSymbol,
  onAnalyze,
  goal,
}: {
  onSelectSymbol: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
  /** 초보자 목표 설정 — 목표 도달 가능성 분석의 조건 (v2.29.0) */
  goal: SwingGoal;
}) {
  const target = useTargetAnalysis();
  const confirmTargetDelete = useConfirmDelete(target.remove);
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
        <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[14px] text-bearish">
          {error}
        </p>
      )}

      {recommendation && !loading && (
        <>
          {/*
            목표 도달 가능성 분석 — 결과 **위쪽 도구줄** (v2.33.0, 「추천 종목」 탭과 같은 자리). 예전에는 카드 아래에 있어 스크롤해야 보였다.
            지금 목표 조건과 같은 최근 기록 요약도 여기에 붙인다.
          */}
          <div className="space-y-2 rounded-lg border border-border bg-bg-secondary px-3 py-2">
            <TargetAnalyzeButton
              symbols={[recommendation.symbol]}
              goal={goal}
              label="이 종목 목표 도달 가능성 분석"
              running={target.progress?.running ?? false}
              geminiOff={target.geminiOff}
              onStart={target.start}
            />
            <TargetProgressBox progress={target.progress} />
            {(() => {
              const latest = latestFor(target.records, recommendation.symbol, goal);
              return latest ? <TargetSummaryLine record={latest} onDelete={confirmTargetDelete} /> : null;
            })()}
          </div>
          {recommendation.rejection && (
            <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[14px] text-warning">
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
