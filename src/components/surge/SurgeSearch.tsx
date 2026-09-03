import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import { InlineSpinner } from '../common/LoadingOverlay';
import { useSurgeEvaluation } from '../../hooks/useSurge';
import SurgeEvaluationView from './SurgeEvaluation';

/**
 * 종목 검색 → 급등 가능성 평가.
 *
 * 탐지 목록과 달리 결과를 저장하지 않는다 — 사용자가 궁금해서 한 번 본 종목까지
 * 이력에 쌓이면 성과 추적의 표본이 오염된다.
 */
export default function SurgeSearch({
  watchlist,
  onSelectSymbol,
  onWatch,
  onAnalyze,
}: {
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onWatch: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const { evaluation, loading, error, evaluate } = useSurgeEvaluation();
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
          종목을 검색하면 과거 급등 패턴을 분석하고 현재 급등 가능성을 점수로 평가합니다.
        </p>
      )}

      {error && (
        <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
          {error}
        </p>
      )}

      {evaluation && !loading && (
        <SurgeEvaluationView
          evaluation={evaluation}
          watched={watchlist.includes(evaluation.symbol)}
          onSelectSymbol={onSelectSymbol}
          onWatch={onWatch}
          onAnalyze={onAnalyze}
        />
      )}
    </div>
  );
}
