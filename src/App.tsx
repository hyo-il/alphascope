import { useCallback, useRef, useState } from 'react';
import ManualAnalysis from './components/analysis/ManualAnalysis';
import AnalysisHistory from './components/analysis/AnalysisHistory';
import AIAnalysisView from './components/analysis/AIAnalysisView';
import CompanyInfo from './components/company/CompanyInfo';
import Holdings from './components/portfolio/Holdings';
import PaperTradingDashboard from './components/paper-trading/PaperTradingDashboard';
import SurgeDashboard from './components/surge/SurgeDashboard';
import SwingDashboard from './components/swing/SwingDashboard';
import QuickOrderPanel from './components/chart/QuickOrderPanel';
import StockExplorer from './components/common/StockExplorer';
import CandleChart, { type CandleChartHandle } from './components/chart/CandleChart';
import ChartToolbar from './components/chart/ChartToolbar';
import ChartBottomTabs from './components/chart/ChartBottomTabs';
import { guideFor, type DrawingToolType } from './components/chart/DrawingTools';
import OrderbookPanel from './components/chart/OrderbookPanel';
import LoadingSpinner from './components/common/LoadingSpinner';
import ModalHost from './components/common/Modal';
import ToastHost from './components/common/Toast';
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
import { useAnalysisTargets } from './hooks/useGemini';
import { useStockInfo } from './hooks/useStockInfo';
import { DEFAULT_TOGGLES, type IndicatorToggles } from './types/chart';
import { useAppStore } from './store/appStore';
import { toast } from './store/uiStore';
import { changeColor, currencyOf, formatPercent, formatPrice } from './utils/formatters';

export default function App() {
  const { symbol, timeframe, isMock, setSymbol, setTimeframe, clearSymbol } = useAppStore();
  /*
   * 종목을 아직 고르지 않았으면(symbol === null) 홈은 탐색 화면을 보여 준다.
   * 심볼에 기대는 훅들은 전부 enabled 가드로 아무것도 부르지 않게 둔다 —
   * 빈 심볼로 API 를 때리면 서버 로그가 오류로 뒤덮인다.
   */
  const hasSymbol = Boolean(symbol);
  const { candles, loading, error, loadingMore, reachedEnd, loadMore } = useCandleData(
    symbol ?? '',
    timeframe,
    hasSymbol,
  );
  const chartRef = useRef<CandleChartHandle>(null);
  const [view, setView] = useState<ViewId>('chart');
  /*
   * 차트는 캡처 대상이라 다른 화면에서도 언마운트하지 않고 화면 밖으로 보낸다.
   * 하지만 보이지 않는 호가·주문 패널까지 계속 폴링할 이유는 없다.
   * 현재가는 헤더에 늘 표시되므로 화면과 무관하게 계속 받는다.
   */
  const chartVisible = view === 'chart';

  const livePrice = useRealtimePrice(symbol);
  const orderbook = useOrderbook(symbol, chartVisible);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);
  // 히스토리 화면에서 '방금 쓴 프롬프트'를 함께 저장하기 위해 App 이 들고 있는다.
  const [lastPrompt, setLastPrompt] = useState({ mode: 'multi', text: '' });

  const watch = useWatchlist();
  const { watchlist, add, toggle } = watch;
  const { recent, remove: removeRecent } = useRecentSymbols(symbol ?? '');
  const stockInfo = useStockInfo(symbol);
  /** 헤더의 [+분석] — 지금 보는 종목을 자동 분석 대상에 담는다 */
  const analysisTargets = useAnalysisTargets();
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
  } = useIndicators(symbol ?? '', timeframe, hasSymbol && needsEngine);

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
  const isWatched = symbol ? watchlist.includes(symbol) : false;

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

        {/*
          하단 탭이 생기면서 이 열이 세로로 짧아졌다. min-h-0 + overflow-y-auto 가 없으면
          호가·빠른주문이 아래 탭 위로 흘러넘쳐 겹친다.
        */}
        <div className="flex min-h-0 shrink-0 flex-col overflow-y-auto">
          <OrderbookPanel
            orderbook={orderbook}
            currentPrice={displayPrice}
            previousClose={previousClose}
            currency={currency}
          />
          {/* 토스 WTS 처럼 호가창 바로 아래에 둔다 — 시세를 보다 그대로 주문으로 이어진다 */}
          {symbol && (
            <QuickOrderPanel
              symbol={symbol}
              price={displayPrice}
              currency={currency}
              active={chartVisible}
              onGoToPaperTrading={() => setView('paper')}
            />
          )}
        </div>
      </div>

      {/*
        차트 하단 탭 — 차트를 보면서 기업정보·AI 분석을 함께 본다.
        사이드 메뉴의 전체 화면은 그대로 두고(옵션 B), 여기는 요약 자리다.
        `active` 로 차트 화면일 때만 내용을 렌더한다 — 차트는 캡처 때문에
        화면 밖에서도 마운트를 유지하므로, 그때 탭까지 살아 있으면 보이지 않는
        기업정보·분석 결과를 계속 불러온다.
      */}
      {symbol && (
        <ChartBottomTabs
          symbol={symbol}
          timeframe={timeframe}
          candles={candles}
          currentPrice={displayPrice}
          indicators={indicators}
          toggles={toggles}
          getChartSnapshot={getChartSnapshot}
          onPromptChange={setLastPrompt}
          active={chartVisible}
          onOpenFullView={setView}
        />
      )}

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

  /** 종목이 있어야 의미가 있는 화면들 — 미선택 상태에서 빈 화면을 보여 주지 않는다 */
  const needSymbol = (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-3 text-center">
        <p className="text-xs text-text-muted">종목을 먼저 선택하세요.</p>
        <button
          type="button"
          onClick={() => setView('chart')}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
        >
          🏠 홈에서 종목 고르기
        </button>
      </div>
    </div>
  );

  const mainContent = () => {
    // 급등 탐지는 종목을 고르기 전에도 의미가 있다 — 오히려 여기서 종목을 고른다.
    if (
      !symbol &&
      view !== 'paper' &&
      view !== 'settings' &&
      view !== 'portfolio' &&
      view !== 'surge' &&
      view !== 'swing'
    ) {
      return needSymbol;
    }

    switch (view) {
      case 'analysis':
        return (
          <AIAnalysisView
            symbol={symbol}
            currentPrice={displayPrice}
            manual={
              // Claude 수동 분석: 프롬프트를 만드는 화면과, 받은 답변을 저장하는 화면을
              // 한자리에 둔다 (복사 → 붙여넣기 → 답변 저장이 한 흐름이다).
              <div className="space-y-4">
                <ManualAnalysis
                  symbol={symbol!}
                  timeframe={timeframe}
                  candles={candles}
                  currentPrice={displayPrice}
                  indicators={indicators}
                  toggles={toggles}
                  getChartSnapshot={getChartSnapshot}
                  onPromptChange={setLastPrompt}
                />
                <AnalysisHistory
                  symbol={symbol!}
                  timeframe={timeframe}
                  currentPrice={displayPrice}
                  mode={lastPrompt.mode}
                  prompt={lastPrompt.text}
                />
              </div>
            }
          />
        );
      case 'surge':
        return (
          <SurgeDashboard
            watchlist={watchlist}
            onSelectSymbol={(next) => {
              setSymbol(next);
              setView('chart');
            }}
            onWatch={add}
            onAnalyze={(next) => {
              setSymbol(next);
              setView('analysis');
            }}
          />
        );
      case 'swing':
        return (
          <SwingDashboard
            watchlist={watchlist}
            onSelectSymbol={(next) => {
              setSymbol(next);
              setView('chart');
            }}
            onAnalyze={(next) => {
              setSymbol(next);
              setView('analysis');
            }}
          />
        );
      case 'company':
        return <CompanyInfo symbol={symbol!} />;
      case 'portfolio':
        return <Holdings onSelectSymbol={setSymbol} />;
      case 'paper':
        return <PaperTradingDashboard symbol={symbol ?? 'AAPL'} onSelectSymbol={setSymbol} />;
      case 'settings':
        return <Settings isMock={isMock} engineDown={engineDown} />;
      case 'chart':
      default:
        return null; // 차트는 항상 마운트해 두고 아래에서 따로 배치한다.
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* 공통 팝업은 앱 루트에 한 번만 둔다 — 어디서든 스토어로 호출한다 */}
      <ModalHost />
      <ToastHost />

      <MarketOverview />

      <div className="flex min-h-0 flex-1">
      <SideNav view={view} onChange={setView} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 종목 헤더 — 어느 화면에서든 현재 종목이 보이게 유지한다 */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          <SymbolSearch symbol={symbol ?? ''} onSubmit={setSymbol} />

          {symbol ? (
            <>
              {/* 종목 해제 — 홈의 탐색 화면으로 돌아간다 */}
              <button
                type="button"
                onClick={() => {
                  clearSymbol();
                  setView('chart');
                }}
                title="종목 선택 해제"
                className="text-sm leading-none text-text-muted transition-colors hover:text-text-primary"
              >
                ✕
              </button>

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

              {/* 종목명이 먼저다 — 헤더에서 가장 먼저 읽히는 값이어야 한다 */}
              <span className="text-base font-semibold">{stockInfo?.name || symbol}</span>
              {stockInfo?.name && <span className="text-xs text-text-secondary">{symbol}</span>}

              {/*
                차트를 보다가 "이 종목도 자동 분석에 넣자" 가 되는 흐름을 한 번에 잇는다.
                Gemini 키가 없으면 자동 분석 자체가 없으므로 버튼도 띄우지 않는다.
              */}
              {analysisTargets.enabled &&
                (analysisTargets.symbols.includes(symbol) ? (
                  <span
                    title="자동 분석 대상입니다"
                    className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent"
                  >
                    분석중 🔵
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await analysisTargets.add(symbol);
                        toast.success(`${symbol} 을(를) 분석 대상에 추가했습니다`);
                      } catch (e) {
                        toast.error('추가하지 못했습니다', (e as Error).message);
                      }
                    }}
                    title="자동 분석 대상에 추가"
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
                  >
                    + 분석
                  </button>
                ))}
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
            </>
          ) : (
            <span className="text-xs text-text-muted">종목을 검색해 선택하세요</span>
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
        {/*
          종목을 고르기 전에는 차트 자체를 만들지 않는다. 캡처 대상이 필요해서 유지하는
          것이므로, 볼 종목이 없으면 유지할 이유도 없다.
        */}
        {symbol && (
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
        )}

        {view === 'chart' && !symbol && (
          <div className="flex min-h-0 flex-1 flex-col">
            <StockExplorer onSelect={setSymbol} watchlist={watchlist} recent={recent} />
          </div>
        )}

        {view !== 'chart' && (
          <div className="flex min-h-0 flex-1 flex-col">{mainContent()}</div>
        )}
      </div>

      <WatchPanel
        currentSymbol={symbol ?? ''}
        watch={watch}
        recent={recent}
        onSelect={setSymbol}
        onRemoveRecent={removeRecent}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />
      </div>
    </div>
  );
}
