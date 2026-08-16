import { useCallback, useRef, useState } from 'react';
import ManualAnalysis from './components/analysis/ManualAnalysis';
import CompanyInfo from './components/company/CompanyInfo';
import Holdings from './components/portfolio/Holdings';
import CandleChart, { type CandleChartHandle } from './components/chart/CandleChart';
import ChartControls from './components/chart/ChartControls';
import DrawingTools, { type DrawingToolType } from './components/chart/DrawingTools';
import IndicatorToggleBar from './components/chart/IndicatorToggles';
import OrderbookPanel from './components/chart/OrderbookPanel';
import LoadingSpinner from './components/common/LoadingSpinner';
import SymbolSearch from './components/common/SymbolSearch';
import TabMenu, { TABS, type TabId } from './components/common/TabMenu';
import { useCandleData } from './hooks/useCandleData';
import { useOrderbook } from './hooks/useOrderbook';
import { useIndicators } from './hooks/useIndicators';
import { useRealtimePrice } from './hooks/useRealtimePrice';

import { DEFAULT_TOGGLES, type IndicatorToggles } from './types/chart';
import { useAppStore } from './store/appStore';
import { changeColor, formatPercent, formatUsd } from './utils/formatters';

export default function App() {
  const { symbol, timeframe, isMock, setSymbol, setTimeframe } = useAppStore();
  const { candles, loading, error } = useCandleData(symbol, timeframe);
  const livePrice = useRealtimePrice(symbol);
  const orderbook = useOrderbook(symbol);

  const chartRef = useRef<CandleChartHandle>(null);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>('manual');
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);

  // 켜진 지표가 하나도 없으면 엔진을 부르지 않는다.
  const anyIndicatorOn =
    Object.values(toggles.overlays).some(Boolean) || Object.values(toggles.panels).some(Boolean);
  const {
    indicators,
    loading: indicatorsLoading,
    engineDown,
    error: indicatorError,
  } = useIndicators(symbol, timeframe, anyIndicatorOn);

  // 폴링 현재가가 아직 없으면 마지막 캔들 종가로 대체한다.
  const displayPrice = livePrice?.close ?? candles.at(-1)?.close ?? null;

  const getChartElement = useCallback(() => chartRef.current?.getElement() ?? null, []);

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

      <div className="flex items-center justify-between border-b border-border px-5 py-2">
        {/* 차트 캡처는 아래 '수동분석' 탭에서 요약 텍스트와 함께 처리한다. */}
        <DrawingTools
          activeTool={activeTool}
          onSelect={setActiveTool}
          onClearAll={() => chartRef.current?.clearDrawings()}
          onDeleteSelected={() => chartRef.current?.deleteSelectedDrawing()}
          hasDrawings={drawingCount > 0}
        />
        <IndicatorToggleBar
          toggles={toggles}
          onChange={setToggles}
          loading={indicatorsLoading}
        />
      </div>

      {indicatorError && (
        <div className="border-b border-warning/30 bg-warning/10 px-5 py-2 text-xs text-warning">
          {engineDown ? '⚠️ 지표 엔진이 꺼져 있습니다. ' : '⚠️ 지표 계산 실패: '}
          {indicatorError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
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
            <CandleChart
              ref={chartRef}
              candles={candles}
              livePrice={livePrice}
              activeTool={activeTool}
              onDrawingCountChange={setDrawingCount}
              onToolConsumed={() => setActiveTool(null)}
              indicators={indicators}
              toggles={toggles}
            />
          )}
        </main>

        <OrderbookPanel orderbook={orderbook} currentPrice={displayPrice} />
      </div>

      <TabMenu
        active={activeTab}
        onChange={setActiveTab}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />

      {!panelCollapsed && (
        <section className="h-72 shrink-0 overflow-hidden bg-bg-secondary">
          {activeTab === 'manual' ? (
            <ManualAnalysis
              symbol={symbol}
              timeframe={timeframe}
              candles={candles}
              currentPrice={displayPrice}
              getChartElement={getChartElement}
            />
          ) : activeTab === 'company' ? (
            <CompanyInfo symbol={symbol} />
          ) : activeTab === 'holdings' ? (
            <Holdings onSelectSymbol={setSymbol} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              {TABS.find((t) => t.id === activeTab)?.label} 탭은 Step{' '}
              {TABS.find((t) => t.id === activeTab)?.pendingStep} 에서 구현됩니다.
            </div>
          )}
        </section>
      )}

      <footer className="border-t border-border px-5 py-2 text-xs text-text-muted">
        {activeTool
          ? '차트를 클릭/드래그해 그리기 · Esc: 드로잉 해제 · Delete: 선택 항목 삭제'
          : '드래그: 확대/축소 · Shift + 드래그: 좌우 이동 · 휠: 확대/축소'}
      </footer>
    </div>
  );
}
