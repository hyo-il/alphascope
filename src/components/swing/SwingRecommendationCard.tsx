import type { SwingRecommendation } from '../../types/swing';
import SymbolLabel from '../common/SymbolLabel';
import ConditionGauge from './ConditionGauge';
import TradePlan from './TradePlan';
import { GRADE_STYLE } from './gradeStyle';

const ENTRY_LABEL: Record<string, string> = {
  NOW: '즉시 매수',
  PULLBACK: '눌림 대기',
  BREAKOUT: '돌파 대기',
};

/** 추천 종목 한 장 — 조건 게이지 · 매수 이유 · 매매 계획 · 경고를 한 화면에 */
export default function SwingRecommendationCard({
  recommendation,
  onSelectSymbol,
  onPaperBuy,
  onAnalyze,
}: {
  recommendation: SwingRecommendation;
  onSelectSymbol: (symbol: string) => void;
  onPaperBuy: (symbol: string, price: number | null, percent?: number) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const grade = GRADE_STYLE[recommendation.grade];
  const currency: 'KRW' | 'USD' = /^\d{6}$/.test(recommendation.symbol) ? 'KRW' : 'USD';
  const { conditions } = recommendation;

  return (
    <article className={`rounded-lg border bg-bg-secondary p-3 ${grade.className}`}>
      <header className="flex flex-wrap items-baseline gap-2">
        <span>{grade.icon}</span>
        <SymbolLabel symbol={recommendation.symbol} name={recommendation.name} className="text-sm" />
        <span className="text-[11px] text-text-secondary">
          {currency === 'KRW'
            ? `₩${Math.round(recommendation.currentPrice).toLocaleString('ko-KR')}`
            : `$${recommendation.currentPrice.toFixed(2)}`}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          점수 {recommendation.score}/100
        </span>
      </header>

      <div className="mt-2.5 grid gap-3 lg:grid-cols-2">
        <section>
          <h4 className="mb-1 text-[11px] font-semibold text-text-secondary">5가지 조건</h4>
          <ConditionGauge
            conditions={{
              trend: conditions.trend,
              timing: conditions.timing,
              momentum: conditions.momentum,
              volume: conditions.volume,
              riskReward: conditions.riskReward,
            }}
          />

          <h4 className="mb-1 mt-3 text-[11px] font-semibold text-text-secondary">💡 매수 이유</h4>
          <p className="text-[11px] leading-relaxed text-text-primary">
            {recommendation.entry.reason}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
            {recommendation.entry.detailedReason}
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[11px] font-semibold text-text-secondary">
            📋 매매 계획 · {ENTRY_LABEL[recommendation.entry.type]}
          </h4>
          <TradePlan plan={recommendation} currency={currency} />

          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-text-secondary">
            <Row label="리스크/리워드" value={`1 : ${conditions.riskReward.ratio}`} />
            <Row label="권장 비중" value={`총자산의 ${recommendation.position.recommendedPercent}%`} />
            <Row
              label="예상 보유"
              value={`${recommendation.holdingPeriod.min}~${recommendation.holdingPeriod.max}일`}
            />
            <Row label="손절 근거" value={recommendation.stopLoss.reason} />
          </dl>
          <p className="mt-1 text-[11px] text-text-muted">{recommendation.position.reason}</p>
        </section>
      </div>

      {recommendation.warnings.map((warning) => (
        <p key={warning} className="mt-1.5 text-[11px] text-warning">
          ⚠️ {warning}
        </p>
      ))}
      <p className="mt-1.5 text-[11px] text-text-secondary">
        🚫 무효 조건: {recommendation.invalidation}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onSelectSymbol(recommendation.symbol)} className={BUTTON}>
          차트 보기
        </button>
        <button
          type="button"
          onClick={() =>
            onPaperBuy(
              recommendation.symbol,
              recommendation.entry.type === 'NOW'
                ? recommendation.currentPrice
                : recommendation.entry.price,
              recommendation.position.recommendedPercent,
            )
          }
          className={BUTTON}
        >
          모의 매수
        </button>
        <button type="button" onClick={() => onAnalyze(recommendation.symbol)} className={BUTTON}>
          🤖 AI 추가 분석
        </button>
      </div>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 truncate text-text-primary" title={value}>
        {value}
      </dd>
    </div>
  );
}

const BUTTON =
  'rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent';
