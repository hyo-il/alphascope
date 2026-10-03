import type { ReactNode } from 'react';
import type { SwingRecord } from '../../types/swing';
import StockName from '../common/StockName';
import { formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 마지막으로 **저장된** 추천 (65점 이상만 저장된다).
 *
 * 화면을 다시 열었을 때 빈 화면을 보여 주지 않기 위한 자리다 — 예전에는
 * `saved` 를 받아 놓고 헤더의 "(저장된 추천 N건)" 문구에만 쓰고 있었다.
 *
 * ⚠️ 추천 카드(`SwingRecommendationCard`)를 그대로 쓰지 않는다. 저장 레코드에는
 * 조건별 채점·경고·보유 기간이 없어서, 카드를 채우려면 없는 값을 지어내야 한다.
 * **저장된 값만** 적고 나머지는 「관심 종목 N개 점검하기」 로 다시 내게 한다.
 * v2.35.0: 방금 받은 결과와 **같은 자리·같은 참고 줄**(`extraFor` — 목표 수익 가능성 한 줄)을 붙인다. 카드 본문은 저장된 값만이라 다르다.
 */
const GRADE: Record<string, { label: string; className: string }> = {
  STRONG: { label: '강력 추천', className: 'text-bullish' },
  BUY: { label: '추천', className: 'text-bullish' },
  WATCH: { label: '관심', className: 'text-warning' },
  HOLD: { label: '보류', className: 'text-text-muted' },
  AVOID: { label: '회피', className: 'text-bearish' },
};

const ENTRY: Record<string, string> = {
  NOW: '즉시 진입',
  PULLBACK: '눌림 대기',
  BREAKOUT: '돌파 대기',
};

export default function SavedRecommendations({
  records,
  analyzedAt,
  onSelectSymbol,
  extraFor,
}: {
  records: SwingRecord[];
  analyzedAt: string | null;
  onSelectSymbol: (symbol: string) => void;
  /** 카드 아래 참고 줄 — 방금 받은 결과의 카드와 같은 것 */
  extraFor?: (symbol: string) => ReactNode;
}) {
  if (!records.length) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-text-secondary">
        {analyzedAt ? `${new Date(analyzedAt).toLocaleString('ko-KR')}에 점검한 결과` : '마지막으로 점검한 결과'} · {records.length}개
      </h3>
      <p className="text-[13px] text-text-muted">
        저장 당시의 계획입니다(점수가 높은 종목만 저장됩니다). 지금 가격 기준의 채점·경고를 보려면 「관심 종목 점검하기」 를 누르세요.
      </p>

      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
        {records.map((record) => {
          const grade = GRADE[record.grade] ?? GRADE.HOLD;
          return (
            <div key={record.id} className="space-y-1.5">
            <button
              type="button"
              onClick={() => onSelectSymbol(record.symbol)}
              title={`${record.symbol} 차트로 이동`}
              className="space-y-1.5 rounded-xl bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:border-accent"
            >
              <div className="flex items-baseline gap-2">
                <StockName symbol={record.symbol} name={record.name} className="min-w-0 text-sm font-semibold" />
                <span className={`ml-auto shrink-0 text-[13px] ${grade.className}`}>
                  {grade.label}
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">{record.score}점</span>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[13px]">
                <Row label="분석 시점가" value={formatPrice(record.priceAtAnalysis)} />
                <Row
                  label="진입"
                  value={`${formatPrice(record.entryPrice)}${
                    record.entryType ? ` (${ENTRY[record.entryType] ?? record.entryType})` : ''
                  }`}
                />
                <Row label="1차 목표" value={formatPrice(record.target1Price)} tone="text-bullish" />
                <Row label="2차 목표" value={formatPrice(record.target2Price)} tone="text-bullish" />
                <Row label="손절" value={formatPrice(record.stopLossPrice)} tone="text-bearish" />
                <Row
                  label="손익비"
                  value={record.riskRewardRatio == null ? '—' : `1:${record.riskRewardRatio.toFixed(2)}`}
                />
                <Row
                  label="비중"
                  value={
                    record.recommendedPercent == null ? '—' : `${record.recommendedPercent.toFixed(1)}%`
                  }
                />
                <Row
                  label="현재 성과"
                  value={record.actualReturn == null ? '집계 전' : formatPercent(record.actualReturn)}
                  tone={
                    record.actualReturn == null
                      ? undefined
                      : record.actualReturn > 0
                        ? 'text-bullish'
                        : 'text-bearish'
                  }
                />
              </dl>
            </button>
            {extraFor?.(record.symbol)}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-text-muted">{label}</dt>
      <dd className={`tabular-nums ${tone ?? 'text-text-secondary'}`}>{value}</dd>
    </div>
  );
}
