import WarnIcon from '../ui/WarnIcon';
import Badge from '../ui/Badge';
import type { ReactNode } from 'react';
import type { SwingRecommendation } from '../../types/swing';
import StockName from '../common/StockName';
import ConditionGauge from './ConditionGauge';
import TradePlan from './TradePlan';
import { GRADE_STYLE } from './gradeStyle';
import { currencyOfSymbol } from '../../utils/market';

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
  pick,
  extra,
}: {
  recommendation: SwingRecommendation;
  onSelectSymbol: (symbol: string) => void;
  onPaperBuy: (symbol: string, price: number | null, percent?: number) => void;
  onAnalyze: (symbol: string) => void;
  /** 머리줄 맨 앞 — 목표 도달 가능성 분석 체크(v2.29.0). 카드의 기존 내용은 바꾸지 않는다 */
  pick?: ReactNode;
  /** 카드 맨 아래 — 목표 도달 가능성 결과 한 줄(v2.29.0) */
  extra?: ReactNode;
}) {
  const grade = GRADE_STYLE[recommendation.grade];
  const currency = currencyOfSymbol(recommendation.symbol);
  const { conditions } = recommendation;

  return (
    <article
      className="min-w-[400px] rounded-xl bg-bg-secondary p-4 break-keep"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        {pick}
        <Badge tone={grade.tone}>{grade.label}</Badge>
        <StockName symbol={recommendation.symbol} name={recommendation.name} wrap className="text-sm font-semibold" />
        <span className="text-caption text-text-secondary">
          {currency === 'KRW'
            ? `₩${Math.round(recommendation.currentPrice).toLocaleString('ko-KR')}`
            : `$${recommendation.currentPrice.toFixed(2)}`}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums">
          점수 {recommendation.score}/100
        </span>
      </header>

      {/*
        세로로 쌓는다. 조건 게이지와 매매 계획을 가로로 나란히 두면 카드가 좁아질 때
        양쪽이 서로를 밀어 값이 겹쳤다 (실제로 "2차 목표" 와 가격이 포개졌다).
      */}
      <div className="mt-3 space-y-4">
        <section>
          <h4 className="mb-1.5 text-caption font-semibold text-text-secondary">5가지 조건</h4>
          <ConditionGauge
            conditions={{
              trend: conditions.trend,
              timing: conditions.timing,
              momentum: conditions.momentum,
              volume: conditions.volume,
              riskReward: conditions.riskReward,
            }}
          />

        </section>

        <section>
          <h4 className="mb-1.5 text-caption font-semibold text-text-secondary">
            매매 계획 · {ENTRY_LABEL[recommendation.entry.type]}
          </h4>
          <TradePlan plan={recommendation} currency={currency} />

          {/* 값이 잘리면 매매 계획이 아니게 된다 — 줄임표 대신 줄바꿈으로 다 보여 준다 */}
          <dl className="mt-3 space-y-1.5 rounded-lg bg-bg-tertiary/40 p-2.5 text-caption text-text-secondary">
            <Row label="리스크/리워드" value={`1 : ${conditions.riskReward.ratio}`} />
            <Row label="권장 비중" value={`총자산의 ${recommendation.position.recommendedPercent}%`} />
            <Row
              label="예상 보유"
              value={`${recommendation.holdingPeriod.min}~${recommendation.holdingPeriod.max}일`}
            />
            <Row label="손절 근거" value={recommendation.stopLoss.reason} />
          </dl>
          <p className="mt-1.5 text-caption leading-relaxed text-text-muted">
            {recommendation.position.reason}
          </p>
        </section>

        <section>
          <h4 className="mb-1.5 text-caption font-semibold text-text-secondary">매수 이유</h4>
          {/* 두세 줄까지 자리를 미리 잡아 둔다 — 카드마다 높이가 들쭉날쭉하면 훑기 어렵다 */}
          <div className="min-h-[3rem] space-y-1">
            <p className="text-caption leading-relaxed text-text-primary">
              {recommendation.entry.reason}
            </p>
            <p className="text-caption leading-relaxed text-text-muted">
              {recommendation.entry.detailedReason}
            </p>
          </div>
        </section>
      </div>

      <div className="mt-3 space-y-1.5">
        {recommendation.warnings.map((warning) => (
          <p key={warning} className="text-caption leading-relaxed text-warning">
            <WarnIcon />{warning}
          </p>
        ))}
        <p className="text-caption leading-relaxed text-text-secondary">
          무효 조건: {recommendation.invalidation}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
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
          AI 추가 분석
        </button>
      </div>
      {extra && <div className="mt-3">{extra}</div>}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 text-right text-text-primary">{value}</dd>
    </div>
  );
}

const BUTTON =
  'rounded bg-bg-tertiary px-2 py-1 text-caption text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary';
