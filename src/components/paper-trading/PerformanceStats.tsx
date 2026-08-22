import type { Currency, PaperPerformance } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';

interface Props {
  performance: PaperPerformance;
  currency: Currency;
}

const pct = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;

const tone = (value: number | null | undefined) =>
  value == null ? 'text-text-primary' : value > 0 ? 'text-bullish' : value < 0 ? 'text-bearish' : 'text-text-primary';

/** 성과 지표 카드 그리드 */
export default function PerformanceStats({ performance: p, currency }: Props) {
  const card = (label: string, value: string, valueTone = 'text-text-primary', hint?: string) => (
    <div key={label} className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
      <p className="text-[11px] text-text-muted">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-[10px] text-text-muted">{hint}</p>}
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      {card('총 수익률', pct(p.totalReturn), tone(p.totalReturn), formatPrice(p.totalPnl, currency))}
      {card(
        'MDD',
        p.mdd == null ? '—' : `${p.mdd.toFixed(2)}%`,
        p.mdd == null ? 'text-text-muted' : 'text-bearish',
        p.mdd == null ? '스냅샷 2일 이상 필요' : '고점 대비 최대 낙폭',
      )}
      {card(
        '승률',
        p.winRate == null ? '—' : `${p.winRate.toFixed(1)}%`,
        'text-text-primary',
        `${p.winCount}승 ${p.lossCount}패`,
      )}
      {card(
        '손익비',
        p.profitFactor == null ? '—' : p.profitFactor.toFixed(2),
        'text-text-primary',
        '평균수익 / 평균손실',
      )}
      {card('총 거래', `${p.tradeCount}회`, 'text-text-primary', `청산 ${p.closedCount}회`)}
      {card(
        '평균 수익',
        p.avgWin == null ? '—' : formatPrice(p.avgWin, currency),
        p.avgWin == null ? 'text-text-muted' : 'text-bullish',
      )}
      {card(
        '평균 손실',
        p.avgLoss == null ? '—' : formatPrice(p.avgLoss, currency),
        p.avgLoss == null ? 'text-text-muted' : 'text-bearish',
      )}
      {card(
        '최대 연승 / 연패',
        `${p.maxWinStreak} / ${p.maxLossStreak}`,
        'text-text-primary',
        p.volatility != null ? `변동성 ${p.volatility.toFixed(1)}%` : undefined,
      )}
    </div>
  );
}
