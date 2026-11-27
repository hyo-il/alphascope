import { SkeletonCards, SkeletonTable } from '../common/SkeletonLoader';
import PortfolioSummaryBar from './PortfolioSummary';
import { useExchangeRate, usePortfolio } from '../../hooks/useCompany';
import { changeColor, formatPercent, formatUsd, formatSignedMoney } from '../../utils/formatters';
import ScrollTable from '../ui/ScrollTable';
import { TABLE_NAME_CELL_TOUCH, TABLE_ONE_LINE_TOUCH } from '../ui/tokens';
import { useState } from 'react';
import Button from '../ui/Button';
import DataCard, { DataCardList, DataCardRow, DataCardSkeleton } from '../ui/DataCard';
import StockName from '../common/StockName';
import { useLayoutMode } from '../../hooks/useLayoutMode';

interface Props {
  /** 종목 클릭 시 차트를 그 종목으로 바꾼다. */
  onSelectSymbol: (symbol: string) => void;
}

/** [다시 시도] 는 안을 새로 그려 다시 받는다(받기 훅 `usePortfolio` 는 주소가 같으면 다시 받지 않는다) */
export default function Holdings({ onSelectSymbol }: Props) {
  const [attempt, setAttempt] = useState(0);
  return <HoldingsBody key={attempt} onSelectSymbol={onSelectSymbol} onRetry={() => setAttempt((n) => n + 1)} />;
}

function HoldingsBody({ onSelectSymbol, onRetry }: Props & { onRetry: () => void }) {
  const { data: portfolio, loading, error } = usePortfolio(true);
  const { data: rate } = useExchangeRate(true);
  const phone = useLayoutMode() === 'phone';

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <SkeletonCards count={3} className="grid-cols-3" />
        {phone ? <DataCardSkeleton count={3} /> : <SkeletonTable rows={5} columns={6} />}
      </div>
    );
  }

  // 실패는 오류 + [다시 시도] — 빈 목록으로 바꾸지 않는다(`CLAUDE.md` 2-3)
  if (error) {
    return (
      <div className="p-4">
        <p data-tone="error" className="text-sm text-danger">보유 주식을 불러오지 못했습니다</p>
        <p className="mt-1 text-xs text-text-secondary">{error}</p>
        <Button variant="secondary" size="md" className="mt-3" onClick={onRetry}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (!portfolio) return null;

  /*
   * 폰(테마 4-1 · 사용자 결정 2026-11-26) — 표 대신 카드. 값 · 글은 아래 표와 **같은 함수**(카드와 표가 늘 같은 값).
   * 3줄 오른쪽 = 당일손익. 카드를 누르면 표 줄을 누른 것과 같은 일(그 종목 차트). 패드 · 1280 이상은 표 그대로(148차 미는 표).
   */
  if (phone) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PortfolioSummaryBar summary={portfolio.summary} exchangeRate={rate} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2" data-testid="holding-cards">
          {portfolio.holdings.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">보유 중인 해외주식이 없습니다.</p>
          ) : (
            <DataCardList>
              {portfolio.holdings.map((holding) => (
                <DataCard key={holding.symbol} label={`${holding.symbol} 차트 보기`} onOpen={() => onSelectSymbol(holding.symbol)}>
                  <DataCardRow
                    left={<StockName symbol={holding.symbol} name={holding.name || holding.symbol} keepTicker className="max-w-full text-sm font-semibold text-text-primary" />}
                    right={<span className="text-sm font-semibold text-text-primary">{formatUsd(holding.evaluationAmount)}</span>}
                  />
                  <DataCardRow
                    left={
                      <span className="text-caption text-text-secondary">
                        {holding.quantity}주 · 평균 {formatUsd(holding.averagePrice)}
                      </span>
                    }
                    right={
                      <span className={`text-xs ${changeColor(holding.profitLoss)}`}>
                        {formatSignedMoney(holding.profitLoss, 'USD')} ({formatPercent(holding.profitLossRate)})
                      </span>
                    }
                  />
                  <DataCardRow
                    left={<span className="text-caption text-text-secondary">현재가 {formatUsd(holding.currentPrice)}</span>}
                    right={
                      <span className="text-xs">
                        <span className="text-caption text-text-secondary">당일 </span>
                        <span className={changeColor(holding.dailyProfitLoss)}>{formatSignedMoney(holding.dailyProfitLoss, 'USD')}</span>
                      </span>
                    }
                  />
                </DataCard>
              ))}
            </DataCardList>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PortfolioSummaryBar summary={portfolio.summary} exchangeRate={rate} />

      <ScrollTable className="min-h-0 flex-1 overflow-auto pb-4">
        {/* 좌우 여백을 스크롤 영역이 아니라 첫·마지막 열에 둔다 — 그래야 sticky 헤더 배경이 본문 양 끝까지 닿는다 */}
        {portfolio.holdings.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-muted">보유 중인 해외주식이 없습니다.</p>
        ) : (
          <table className="w-full min-w-[592px] text-xs tabular-nums">
            <thead className="sticky top-0 bg-bg-secondary text-text-muted">
              <tr>
                <th className="py-1.5 pl-4 pr-2 text-left font-normal">종목</th>
                <th className="py-1.5 px-2 text-right font-normal">수량</th>
                <th className="py-1.5 px-2 text-right font-normal">평균단가</th>
                <th className="py-1.5 px-2 text-right font-normal">현재가</th>
                <th className="py-1.5 px-2 text-right font-normal">평가금액</th>
                <th className="py-1.5 px-2 text-right font-normal">평가손익</th>
                <th className="py-1.5 pl-2 pr-4 text-right font-normal">당일손익</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.holdings.map((holding) => (
                <tr
                  key={holding.symbol}
                  onClick={() => onSelectSymbol(holding.symbol)}
                  className="cursor-pointer border-t border-border/60 hover:bg-bg-tertiary/60"
                  data-tip={`${holding.symbol} 차트 보기`}
                >
                  <td className={`py-1.5 pl-4 pr-2 ${TABLE_NAME_CELL_TOUCH}`}>
                    {/* 패드 — 긴 이름만 말줄임(코드는 늘 보임 · 칸 최대 160 안에 이름 112 + 코드) */}
                    <span className="font-medium text-text-primary pad:inline-block pad:max-w-28 pad:truncate pad:align-bottom" data-tip-clip={holding.name || holding.symbol}>
                      {holding.name || holding.symbol}
                    </span>
                    {holding.name && (
                      <span className="ml-1.5 text-caption text-text-secondary">{holding.symbol}</span>
                    )}
                  </td>
                  <td className={`py-1.5 px-2 text-right ${TABLE_ONE_LINE_TOUCH}`}>{holding.quantity}</td>
                  <td className={`py-1.5 px-2 text-right ${TABLE_ONE_LINE_TOUCH}`}>{formatUsd(holding.averagePrice)}</td>
                  <td className={`py-1.5 px-2 text-right ${TABLE_ONE_LINE_TOUCH}`}>{formatUsd(holding.currentPrice)}</td>
                  <td className={`py-1.5 px-2 text-right ${TABLE_ONE_LINE_TOUCH}`}>{formatUsd(holding.evaluationAmount)}</td>
                  <td className={`py-1.5 px-2 text-right ${changeColor(holding.profitLoss)} ${TABLE_ONE_LINE_TOUCH}`}>
                    {formatSignedMoney(holding.profitLoss, 'USD')}
                    <span className="ml-1">({formatPercent(holding.profitLossRate)})</span>
                  </td>
                  <td className={`py-1.5 pl-2 pr-4 text-right ${changeColor(holding.dailyProfitLoss)} ${TABLE_ONE_LINE_TOUCH}`}>
                    {formatSignedMoney(holding.dailyProfitLoss, 'USD')}
                    <span className="ml-1">({formatPercent(holding.dailyProfitLossRate)})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollTable>
    </div>
  );
}
