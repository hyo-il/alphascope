import CandleChart from './components/chart/CandleChart';
import ChartControls from './components/chart/ChartControls';
import LoadingSpinner from './components/common/LoadingSpinner';
import SymbolSearch from './components/common/SymbolSearch';
import { useCandleData } from './hooks/useCandleData';
import { useRealtimePrice } from './hooks/useRealtimePrice';
import { useAppStore } from './store/appStore';
import { changeColor, formatPercent, formatUsd } from './utils/formatters';

export default function App() {
  const { symbol, timeframe, isMock, setSymbol, setTimeframe } = useAppStore();
  const { candles, loading, error } = useCandleData(symbol, timeframe);
  const livePrice = useRealtimePrice(symbol);

  // 폴링 현재가가 아직 없으면 마지막 캔들 종가로 대체한다.
  const displayPrice = livePrice?.close ?? candles.at(-1)?.close ?? null;

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <header className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-accent">AlphaScope</h1>
          <span className="text-sm text-text-muted">해외주식 차트 분석</span>
        </div>
        <SymbolSearch symbol={symbol} onSubmit={setSymbol} />
      </header>

      {isMock && (
        <div className="border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm text-warning">
          ⚠️ 모의 데이터 표시 중 — 실제 시세가 아닙니다. <code>.env</code> 에 토스증권 API 키를
          입력하면 실시간 데이터로 전환됩니다.
        </div>
      )}

      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-semibold">{symbol}</span>
          <span className="text-2xl font-bold tabular-nums">{formatUsd(displayPrice)}</span>
          {livePrice && (
            <span className={`text-sm tabular-nums ${changeColor(livePrice.change)}`}>
              {livePrice.change > 0 ? '+' : ''}
              {livePrice.change.toFixed(2)} ({formatPercent(livePrice.changeRate)})
            </span>
          )}
        </div>
        <ChartControls timeframe={timeframe} onChange={setTimeframe} />
      </div>

      <main className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center px-8">
            <div className="max-w-lg rounded-lg border border-bearish/40 bg-bg-secondary p-5">
              <p className="font-medium text-bearish">데이터를 불러오지 못했습니다</p>
              <p className="mt-2 text-sm text-text-secondary">{error}</p>
            </div>
          </div>
        ) : loading ? (
          <LoadingSpinner label={`${symbol} 캔들 불러오는 중…`} />
        ) : (
          <CandleChart candles={candles} livePrice={livePrice} />
        )}
      </main>

      <footer className="border-t border-border px-5 py-2 text-xs text-text-muted">
        드래그: 확대/축소 · Shift + 드래그: 좌우 이동 · 휠: 확대/축소
      </footer>
    </div>
  );
}
