import { useState } from 'react';
import { useSwingAnalysis } from '../../hooks/useSwing';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import SwingRecommendationCard from './SwingRecommendationCard';
import SwingSearch from './SwingSearch';
import SwingHistory from './SwingHistory';
import StockName from '../common/StockName';
import type { SwingGrade, SwingRecommendation } from '../../types/swing';

type Tab = 'list' | 'search' | 'history';

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '추천 종목' },
  { id: 'search', label: '종목 검색' },
  { id: 'history', label: '추천 이력' },
];

const SECTIONS: { grades: SwingGrade[]; title: string }[] = [
  { grades: ['STRONG'], title: '⭐ 강력 추천 (80점 이상)' },
  { grades: ['BUY'], title: '🟢 추천 (65~79점)' },
  { grades: ['WATCH'], title: '🟡 관심 (50~64점) — 아직 매수 시점은 아닙니다' },
];

/**
 * 📈 스윙 투자 추천.
 *
 * 관심 목록을 5가지 조건으로 채점하고, 추천마다 **팔 자리(목표·손절)와 비중**을 함께 낸다.
 * ⚠️ 실제 주문은 내지 않는다 — [모의 매수] 는 모의투자 계좌만 건드린다.
 */
export default function SwingDashboard({
  watchlist,
  onSelectSymbol,
  onAnalyze,
}: {
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('list');
  const { result, saved, loading, error, analyze } = useSwingAnalysis(watchlist);
  const paperBuy = usePaperQuickBuy();

  const recommendations = result?.recommendations ?? [];
  const rejected = recommendations.filter((r) => r.grade === 'HOLD' || r.grade === 'AVOID');

  const card = (recommendation: SwingRecommendation) => (
    <SwingRecommendationCard
      key={recommendation.symbol}
      recommendation={recommendation}
      onSelectSymbol={onSelectSymbol}
      onPaperBuy={paperBuy}
      onAnalyze={onAnalyze}
    />
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === item.id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'list' && (
          <div className="space-y-4">
            <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">
              <span>
                분석 대상: 관심 목록{' '}
                <span className="text-text-primary">{watchlist.length}개 종목</span>
              </span>
              <span>
                마지막 분석:{' '}
                <span className="text-text-primary">
                  {result
                    ? new Date(result.analyzedAt).toLocaleString('ko-KR')
                    : saved.analyzedAt
                      ? `${new Date(saved.analyzedAt).toLocaleString('ko-KR')} (저장된 추천 ${saved.records.length}건)`
                      : '없음'}
                </span>
              </span>
              <button
                type="button"
                onClick={analyze}
                disabled={loading || !watchlist.length}
                className="ml-auto rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {loading ? '분석 중…' : '🔄 다시 분석'}
              </button>
            </header>

            {!watchlist.length && (
              <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
                관심 목록이 비어 있습니다. 오른쪽 관심 목록에 종목을 담거나 [종목 검색] 탭에서 개별
                평가를 해 보세요.
              </p>
            )}

            {error && (
              <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
                {error}
              </p>
            )}

            {result?.failures.length ? (
              <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                분석하지 못한 종목:{' '}
                {result.failures.map((f) => `${f.symbol}(${f.error})`).join(' · ')}
              </p>
            ) : null}

            {!result && !loading && watchlist.length > 0 && (
              <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
                [🔄 다시 분석] 을 누르면 관심 종목을 5가지 조건으로 채점합니다.
              </p>
            )}

            {SECTIONS.map((section) => {
              const items = recommendations.filter((r) => section.grades.includes(r.grade));
              if (!result) return null;
              return (
                <section key={section.title} className="space-y-4">
                  <h3 className="text-xs font-semibold text-text-secondary">
                    {section.title} · {items.length}개
                  </h3>
                  {items.length ? (
                    /* 카드 안은 세로 배치라 420px 면 충분하다 — 넓은 화면에서는 여러 열로 늘어선다 */
                    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(420px,1fr))]">
                      {items.map(card)}
                    </div>
                  ) : (
                    <p className="text-[11px] text-text-muted">해당하는 종목이 없습니다.</p>
                  )}
                </section>
              );
            })}

            {rejected.length > 0 && (
              <details className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
                <summary className="text-xs font-semibold text-text-secondary">
                  ⚪ 부적합 ({rejected.length}개) — 왜 추천하지 않는지
                </summary>
                <ul className="mt-2 space-y-1 text-[11px]">
                  {rejected.map((r) => (
                    <li key={r.symbol} className="flex gap-2">
                      <StockName symbol={r.symbol} name={r.name} />
                      <span className="tabular-nums text-text-muted">({r.score}점)</span>
                      <span className="min-w-0 text-text-secondary">{r.rejection}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="text-[11px] text-text-muted">
              ⚠️ 이 추천은 지표 조건을 기계적으로 채점한 결과이며 투자 조언이 아닙니다. 목표가·손절가는
              계획을 세우기 위한 기준일 뿐 가격을 보장하지 않습니다.
            </p>
          </div>
        )}

        {tab === 'search' && <SwingSearch onSelectSymbol={onSelectSymbol} onAnalyze={onAnalyze} />}
        {tab === 'history' && <SwingHistory />}
      </div>
    </div>
  );
}
