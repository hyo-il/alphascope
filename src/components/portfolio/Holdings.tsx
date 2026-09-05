import { SkeletonCards, SkeletonTable } from '../common/SkeletonLoader';
import PortfolioSummaryBar from './PortfolioSummary';
import { useExchangeRate, usePortfolio } from '../../hooks/useCompany';
import { changeColor, formatPercent, formatUsd } from '../../utils/formatters';

interface Props {
  /** 종목 클릭 시 차트를 그 종목으로 바꾼다. */
  onSelectSymbol: (symbol: string) => void;
}

export default function Holdings({ onSelectSymbol }: Props) {
  const { data: portfolio, loading, error } = usePortfolio(true);
  const { data: rate } = useExchangeRate(true);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <SkeletonCards count={3} className="grid-cols-3" />
        <SkeletonTable rows={5} columns={6} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-bearish">보유 주식을 불러오지 못했습니다</p>
        <p className="mt-1 text-xs text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!portfolio) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PortfolioSummaryBar summary={portfolio.summary} exchangeRate={rate} />

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {portfolio.holdings.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">보유 중인 해외주식이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[560px] text-xs tabular-nums">
            <thead className="sticky top-0 bg-bg-secondary text-text-muted">
              <tr>
                <th className="py-1.5 pr-2 text-left font-normal">종목</th>
                <th className="py-1.5 px-2 text-right font-normal">수량</th>
                <th className="py-1.5 px-2 text-right font-normal">평균단가</th>
                <th className="py-1.5 px-2 text-right font-normal">현재가</th>
                <th className="py-1.5 px-2 text-right font-normal">평가금액</th>
                <th className="py-1.5 px-2 text-right font-normal">평가손익</th>
                <th className="py-1.5 pl-2 text-right font-normal">당일손익</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.holdings.map((holding) => (
                <tr
                  key={holding.symbol}
                  onClick={() => onSelectSymbol(holding.symbol)}
                  className="cursor-pointer border-t border-border/60 hover:bg-bg-tertiary/60"
                  title={`${holding.symbol} 차트 보기`}
                >
                  <td className="py-1.5 pr-2">
                    <span className="font-medium text-text-primary">
                      {holding.name || holding.symbol}
                    </span>
                    {holding.name && (
                      <span className="ml-1.5 text-[11px] text-accent">{holding.symbol}</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right">{holding.quantity}</td>
                  <td className="py-1.5 px-2 text-right">{formatUsd(holding.averagePrice)}</td>
                  <td className="py-1.5 px-2 text-right">{formatUsd(holding.currentPrice)}</td>
                  <td className="py-1.5 px-2 text-right">{formatUsd(holding.evaluationAmount)}</td>
                  <td className={`py-1.5 px-2 text-right ${changeColor(holding.profitLoss)}`}>
                    {formatUsd(holding.profitLoss)}
                    <span className="ml-1">({formatPercent(holding.profitLossRate)})</span>
                  </td>
                  <td className={`py-1.5 pl-2 text-right ${changeColor(holding.dailyProfitLoss)}`}>
                    {formatUsd(holding.dailyProfitLoss)}
                    <span className="ml-1">({formatPercent(holding.dailyProfitLossRate)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
