import Button from '../ui/Button';
import { useState } from 'react';
import SingleSymbolSearch from '../common/SingleSymbolSearch';
import { useSwingEvaluation } from '../../hooks/useSwing';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import SwingRecommendationCard from './SwingRecommendationCard';
import { GRADE_STYLE } from './gradeStyle';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { TargetRefLine, latestFor } from './TargetAnalysisParts';
import type { SwingGoal } from '../../types/swingGoal';
import NotProvenLine from './NotProvenLine';

/** 관심 목록에 없는 종목도 같은 5가지 조건으로 평가한다 */
export default function SwingSearch({
  onSelectSymbol,
  onAnalyze,
  goal,
  onGoTarget,
}: {
  onSelectSymbol: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
  /** 초보자 목표 설정 — 목표 도달 가능성 분석의 조건 (v2.29.0) */
  goal: SwingGoal;
  /** 「목표 수익 가능성」 탭으로 — 그 종목을 체크만 해 두고 실행하지 않는다 (v2.35.0) */
  onGoTarget: (symbol: string) => void;
}) {
  /** 기록만 읽는다(참고 줄) — 분석 실행은 「목표 수익 가능성」 탭 한 곳 */
  const target = useTargetAnalysis();
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
    <SingleSymbolSearch
      intro="관심 목록에 없는 종목 하나를 「지금 살 만한가」 와 같은 5가지 질문으로 점검합니다."
      queried={queried}
      loading={loading}
      error={error}
      emptyText="종목을 검색하면 추세 · 타이밍 · 모멘텀 · 거래량 · 리스크/리워드 5가지 조건으로 채점하고 매수가 · 목표가 · 손절가를 제시합니다."
      onSubmit={submit}
      footer={<NotProvenLine />}
    >
      {recommendation && (
        <>
          {/* 목표 수익 가능성 — 여기서 실행하지 않고 그 탭으로 보낸다(종목만 체크). 같은 조건의 최근 결과가 있으면 참고 줄 */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-secondary px-3 py-2">
            <Button variant="secondary" size="sm"
              onClick={() => onGoTarget(recommendation.symbol)}>
              목표 수익 가능성에서 분석
            </Button>
            <span className="text-caption text-text-muted">그 탭에서 이 종목을 골라 둡니다. 분석은 그 탭의 버튼을 눌러야 시작합니다.</span>
            {(() => {
              const latest = latestFor(target.records, recommendation.symbol, goal);
              return latest ? <div className="w-full"><TargetRefLine record={latest} onMore={() => onGoTarget(recommendation.symbol)} /></div> : null;
            })()}
          </div>
          {recommendation.rejection && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-caption text-warning">
              {GRADE_STYLE[recommendation.grade].label} — 매수 추천 구간이 아닙니다 —{' '}
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
    </SingleSymbolSearch>
  );
}
