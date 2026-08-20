import { useCallback, useRef, useState } from 'react';
import ManualAnalysis from './components/analysis/ManualAnalysis';
import AnalysisHistory from './components/analysis/AnalysisHistory';
import CompanyInfo from './components/company/CompanyInfo';
import Holdings from './components/portfolio/Holdings';
import CandleChart, { type CandleChartHandle } from './components/chart/CandleChart';
import ChartToolbar from './components/chart/ChartToolbar';
import { guideFor, type DrawingToolType } from './components/chart/DrawingTools';
import OrderbookPanel from './components/chart/OrderbookPanel';
import LoadingSpinner from './components/common/LoadingSpinner';
import SymbolSearch from './components/common/SymbolSearch';
import MarketOverview from './components/market/MarketOverview';
import SideNav, { type ViewId } from './components/layout/SideNav';
import WatchPanel from './components/layout/WatchPanel';
import Settings from './components/layout/Settings';
import { useCandleData } from './hooks/useCandleData';
import { useOrderbook } from './hooks/useOrderbook';
import { useIndicators } from './hooks/useIndicators';
import { useRealtimePrice } from './hooks/useRealtimePrice';
import { useRecentSymbols, useWatchlist } from './hooks/useWatchlist';
import { useStockInfo } from './hooks/useStockInfo';
import { DEFAULT_TOGGLES, type IndicatorToggles } from './types/chart';
import { useAppStore } from './store/appStore';
import { changeColor, currencyOf, formatPercent, formatPrice } from './utils/formatters';

export default function App() {
  const { symbol, timeframe, isMock, setSymbol, setTimeframe } = useAppStore();
  const { candles, loading, error, loadingMore, reachedEnd, loadMore } = useCandleData(
    symbol,
    timeframe,
  );
  const livePrice = useRealtimePrice(symbol);
  const orderbook = useOrderbook(symbol);

  const chartRef = useRef<CandleChartHandle>(null);
  const [view, setView] = useState<ViewId>('chart');
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);
  // 히스토리 화면에서 '방금 쓴 프롬프트'를 함께 저장하기 위해 App 이 들고 있는다.
  const [lastPrompt, setLastPrompt] = useState({ mode: 'multi', text: '' });

  const { watchlist, add, remove, toggle } = useWatchlist();
  const { recent, remove: removeRecent } = useRecentSymbols(symbol);
  const stockInfo = useStockInfo(symbol);
  const currency = currencyOf(stockInfo?.market);

  // 거래량은 캔들만으로 그리므로 지표 엔진 호출 대상에서 제외한다.
  const needsEngine =
    Object.values(toggles.overlays).some(Boolean) ||
    (Object.entries(toggles.panels) as [string, boolean][]).some(
      ([key, on]) => on && key !== 'volume',
    );

  const {
    indicators,
    loading: indicatorsLoading,
    engineDown,
    error: indicatorError,
  } = useIndicators(symbol, timeframe, needsEngine);

  const displayPrice = livePrice?.close ?? candles.at(-1)?.close ?? null;
  // 호가의 등락률 기준 — 서버가 계산해 준 변동액에서 역산한다.
  const previousClose =
    livePrice && Number.isFinite(livePrice.change) && livePrice.change !== 0
      ? livePrice.close - livePrice.change
      : (candles.at(-2)?.close ?? null);
  /** 캡처 팝업이 메인 차트와 같은 구간·같은 드로잉으로 열리도록 현재 상태를 떠 준다 (수정 3). */
  const getChartSnapshot = useCallback(
    () => ({
      range: chartRef.current?.getVisibleRange() ?? null,
      drawings: chartRef.current?.getDrawings() ?? [],
    }),
    [],
  );
  const isWatched = watchlist.includes(symbol);

  const chartView = (
    <>
      <ChartToolbar
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        toggles={toggles}
        onTogglesChange={setToggles}
        indicatorsLoading={indicatorsLoading}
        activeTool={activeTool}
        onToolSelect={setActiveTool}
        onClearDrawings={() => chartRef.current?.clearDrawings()}
        onDeleteSelected={() => chartRef.current?.deleteSelectedDrawing()}
        hasDrawings={drawingCount > 0}
      />

      {indicatorError && (
        <div className="border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
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
              onReachPast={loadMore}
              indicators={indicators}
              toggles={toggles}
            />
          )}
        </main>

        <OrderbookPanel
          orderbook={orderbook}
          currentPrice={displayPrice}
          previousClose={previousClose}
          currency={currency}
        />
      </div>

      <footer className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-text-muted">
        {activeTool ? (
          <>
            <span className="text-accent">{guideFor(activeTool)}</span>
            <span className="ml-2">· 하나 그리면 커서로 돌아옵니다 · Esc: 해제</span>
          </>
        ) : (
          '휠: 커서 기준 확대/축소 · 드래그: 좌우 이동 · 드로잉 클릭 또는 우클릭: 삭제'
        )}
        {loadingMore && <span className="ml-2 text-accent">과거 데이터 불러오는 중…</span>}
        {reachedEnd && candles.length > 0 && (
          <span className="ml-2">· 가장 오래된 데이터까지 표시 중</span>
        )}
      </footer>
    </>
  );

  const mainContent = () => {
    switch (view) {
      case 'analysis':
        return (
          <ManualAnalysis
            symbol={symbol}
            timeframe={timeframe}
            candles={candles}
            currentPrice={displayPrice}
            indicators={indicators}
            toggles={toggles}
            getChartSnapshot={getChartSnapshot}
            onPromptChange={setLastPrompt}
          />
        );
      case 'company':
        return <CompanyInfo symbol={symbol} />;
      case 'portfolio':
        return <Holdings onSelectSymbol={setSymbol} />;
      case 'history':
        return (
          <AnalysisHistory
            symbol={symbol}
            timeframe={timeframe}
            currentPrice={displayPrice}
            mode={lastPrompt.mode}
            prompt={lastPrompt.text}
          />
        );
      case 'settings':
        return <Settings isMock={isMock} engineDown={engineDown} />;
      case 'chart':
      default:
        return null; // 차트는 항상 마운트해 두고 아래에서 따로 배치한다.
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <MarketOverview />

      <div className="flex min-h-0 flex-1">
      <SideNav view={view} onChange={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 종목 헤더 — 어느 화면에서든 현재 종목이 보이게 유지한다 */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          <SymbolSearch symbol={symbol} onSubmit={setSymbol} />

          <button
            type="button"
            onClick={() => toggle(symbol)}
            title={isWatched ? '관심 목록에서 빼기' : '관심 목록에 담기'}
            className={`text-lg leading-none transition-colors ${
              isWatched ? 'text-warning' : 'text-text-muted hover:text-warning'
            }`}
          >
            {isWatched ? '★' : '☆'}
          </button>

          <span className="text-base font-semibold">{symbol}</span>
          {stockInfo?.name && (
            <span className="text-sm text-text-secondary">{stockInfo.name}</span>
          )}
          <span className="text-lg font-bold tabular-nums">
            {formatPrice(displayPrice, currency)}
          </span>
          {livePrice && (
            <span className={`text-xs tabular-nums ${changeColor(livePrice.change)}`}>
              {livePrice.change > 0 ? '+' : ''}
              {currency === 'KRW'
                ? Math.round(livePrice.change).toLocaleString('ko-KR')
                : livePrice.change.toFixed(2)}{' '}
              ({formatPercent(livePrice.changeRate)})
            </span>
          )}

          {isMock && (
            <span className="ml-auto rounded bg-warning/15 px-2 py-1 text-[11px] text-warning">
              ⚠️ 모의 데이터 — .env 에 토스 API 키를 넣으면 실시간으로 전환됩니다
            </span>
          )}
        </header>

        {/*
          차트는 어느 화면에서도 언마운트하지 않는다.
          AI 분석 화면의 '차트 이미지 복사'가 캡처할 대상이 필요하고,
          화면을 오갈 때마다 차트를 다시 만드는 비용도 사라진다.
          숨길 때는 display:none 대신 화면 밖으로 보낸다 — html2canvas 는
          display:none 요소를 캡처하지 못한다.
        */}
        <div
          className={
            view === 'chart'
              ? 'flex min-h-0 flex-1 flex-col'
              : 'pointer-events-none fixed left-[-200vw] top-0 flex h-[640px] w-[960px] flex-col'
          }
          aria-hidden={view !== 'chart'}
        >
          {chartView}
        </div>

        {view !== 'chart' && (
          <div className="flex min-h-0 flex-1 flex-col">{mainContent()}</div>
        )}
      </div>

      <WatchPanel
        currentSymbol={symbol}
        watchlist={watchlist}
        recent={recent}
        onSelect={setSymbol}
        onAdd={add}
        onRemove={remove}
        onRemoveRecent={removeRecent}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />
      </div>
    </div>
  );
}
