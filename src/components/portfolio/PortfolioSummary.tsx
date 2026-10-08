import type { ExchangeRate, PortfolioSummary } from '../../types/toss';
import { changeColor, formatPercent, formatUsd, formatSignedMoney } from '../../utils/formatters';

interface Props {
  summary: PortfolioSummary | null;
  exchangeRate: ExchangeRate | null;
}

function krw(usd: number, rate: number | undefined): string {
  if (!rate || !Number.isFinite(usd)) return '';
  return `≈ ₩${Math.round(usd * rate).toLocaleString('ko-KR')}`;
}

export default function PortfolioSummaryBar({ summary, exchangeRate }: Props) {
  if (!summary) return null;

  const rate = exchangeRate?.rate;

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-border px-4 py-3">
      <div>
        <p className="text-caption text-text-muted">평가금액</p>
        <p className="text-sm font-semibold tabular-nums">
          {formatUsd(summary.evaluationAmountUsd)}
        </p>
        <p className="text-caption text-text-muted">{krw(summary.evaluationAmountUsd, rate)}</p>
      </div>

      <div>
        <p className="text-caption text-text-muted">매수 금액</p>
        <p className="text-sm tabular-nums">{formatUsd(summary.purchaseAmountUsd)}</p>
      </div>

      <div>
        <p className="text-caption text-text-muted">총 평가손익</p>
        <p className={`text-sm tabular-nums ${changeColor(summary.profitLossUsd)}`}>
          {formatSignedMoney(summary.profitLossUsd, 'USD')} ({formatPercent(summary.profitLossRate)})
        </p>
      </div>

      <div>
        <p className="text-caption text-text-muted">당일 손익</p>
        <p className={`text-sm tabular-nums ${changeColor(summary.dailyProfitLossUsd)}`}>
          {formatSignedMoney(summary.dailyProfitLossUsd, 'USD')} ({formatPercent(summary.dailyProfitLossRate)})
        </p>
      </div>

      {rate && (
        <div className="ml-auto text-right">
          <p className="text-caption text-text-muted">
            {exchangeRate?.baseCurrency}/{exchangeRate?.quoteCurrency}
          </p>
          <p className="text-sm tabular-nums">₩{rate.toLocaleString('ko-KR')}</p>
        </div>
      )}
    </div>
  );
}
