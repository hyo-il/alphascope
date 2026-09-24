import { useCallback, useEffect, useRef, useState } from 'react';
import ManualAnalysis from './components/analysis/ManualAnalysis';
import AnalysisHistory from './components/analysis/AnalysisHistory';
import AIAnalysisView from './components/analysis/AIAnalysisView';
import CompareView from './components/compare/CompareView';
import PortfolioView from './components/portfolio/PortfolioView';
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
import VersionMismatchBanner from './components/common/VersionMismatchBanner';
import WatchlistSyncModal from './components/common/WatchlistSyncModal';
import SyncIndicator from './components/common/SyncIndicator';
import SideNav from './components/layout/SideNav';
import WatchPanel from './components/layout/WatchPanel';
import Settings from './components/layout/Settings';
import Changelog from './components/settings/Changelog';
import { useCandleData } from './hooks/useCandleData';
import { useOrderbook } from './hooks/useOrderbook';
import { useIndicators } from './hooks/useIndicators';
import { useRangeStats } from './hooks/useRangeStats';
import { useRealtimePrice } from './hooks/useRealtimePrice';
import { useRecentSymbols, useWatchlist } from './hooks/useWatchlist';
import { useStockInfo } from './hooks/useStockInfo';
import { DEFAULT_TOGGLES, type IndicatorToggles } from './types/chart';
import { useAppStore } from './store/appStore';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { pageMeta } from './types/nav';
import { toast } from './store/uiStore';
import { changeColor, currencyOf, formatPercent, formatPrice } from './utils/formatters';
import LoginScreen from './components/auth/LoginScreen';
import { useAuth } from './hooks/useAuth';

/**
 * 앱 본체. **로그인한 뒤에만 마운트된다** (아래 `App` 참고).
 */
function AppBody({ onLogout }: { onLogout: () => void }) {
  /*
   * ⚠️ `useAppStore()` 를 인자 없이 부르면 **스토어의 모든 변화**를 구독한다.
   * App 은 차트를 들고 있는 최상위라, 비교 화면에서 슬롯을 하나 바꿀 때마다
   * 화면 전체가 다시 렌더됐다. 쓰는 값만 골라 구독한다.
   */
  const symbol = useAppStore((s) => s.symbol);
  const timeframe = useAppStore((s) => s.timeframe);
  const isMock = useAppStore((s) => s.isMock);
  const setSymbol = useAppStore((s) => s.setSymbol);
  const setTimeframe = useAppStore((s) => s.setTimeframe);
  const clearSymbol = useAppStore((s) => s.clearSymbol);

  // 탭 제목에 종목을 적어 여러 탭을 구분한다 (가격은 넣지 않는다 — 매초 바뀐다)
  useDocumentTitle(symbol);
  /** 비교 화면의 4칸 — 관심 목록 패널이 여기에 담고 뺀다 (빈 칸은 null) */
  const compareSlots = useAppStore((s) => s.compareSlots);
  const toggleCompareSymbol = useAppStore((s) => s.toggleCompareSymbol);
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
  /** 화면 위치는 스토어에 있다 — 사이드 메뉴가 대메뉴/소메뉴 두 값을 함께 쓴다 */
  const nav = useAppStore((s) => s.nav);
  const setPage = useAppStore((s) => s.setPage);
  const setGroup = useAppStore((s) => s.setGroup);
  const view = nav.page;
  /** 포트폴리오를 모의투자 계좌로 열지 (빠른주문의 '모의투자로 가기') */
  const [portfolioAccount, setPortfolioAccount] = useState<'real' | 'paper'>('paper');
  /*
   * 차트는 캡처 대상이라 다른 화면에서도 언마운트하지 않고 화면 밖으로 보낸다.
   * 하지만 보이지 않는 호가·주문 패널까지 계속 폴링할 이유는 없다.
   * 현재가는 헤더에 늘 표시되므로 화면과 무관하게 계속 받는다.
   */
  const chartVisible = view === 'chart';
  /** 비교 화면에서는 관심 목록이 종목을 고르는 자리다 — 접혀 있으면 아무것도 고를 수 없다 */
  const compareMode = view === 'compare';

  const livePrice = useRealtimePrice(symbol);
  /** 52주 고저 — 차트 정보 바의 "고점 대비" 에 쓴다 */
  const week52 = useRangeStats(symbol);
  const orderbook = useOrderbook(symbol, chartVisible);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [drawingCount, setDrawingCount] = useState(0);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [toggles, setToggles] = useState<IndicatorToggles>(DEFAULT_TOGGLES);
  // 히스토리 화면에서 '방금 쓴 프롬프트'를 함께 저장하기 위해 App 이 들고 있는다.
  const [lastPrompt, setLastPrompt] = useState({ mode: 'multi', text: '' });

  useEffect(() => {
    if (compareMode) setPanelCollapsed(false);
  }, [compareMode]);

  const watch = useWatchlist();
  const { watchlist, add, toggle } = watch;
  const { recent, remove: removeRecent, clear: clearRecent } = useRecentSymbols(symbol ?? '');
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
              week52={week52}
              currency={currency}
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
              onGoToPaperTrading={() => {
                setPortfolioAccount('paper');
                setPage('portfolio');
              }}
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
          onOpenFullView={setPage}
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

  /**
   * 종목이 있어야 의미가 있는 화면들 — 미선택 상태에서 빈 화면을 보여 주지 않는다.
   *
   * ⚠️ **차트로 보내지 않는다.** 예전에는 '🏠 홈에서 종목 고르기' 버튼으로 차트에 들렀다
   * 오게 했는데, 바로 위에 같은 검색창이 떠 있는데도 다른 화면으로 가라고 하는 셈이었다.
   * 분석은 차트를 거치지 않고 바로 시작할 수 있다 — 종목만 정해지면 된다.
   */
  const needSymbol = (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm space-y-2 text-center">
        <p className="text-sm font-medium text-text-secondary">분석할 종목을 먼저 고르세요.</p>
        <p className="text-xs leading-relaxed text-text-muted">
          ⬆️ 화면 <span className="text-text-secondary">왼쪽 위 검색창</span>에 종목명이나 티커를
          입력하면 바로 분석할 수 있습니다. 한글로도 찾습니다 — 예: 애플, 엔비디아, AAPL
        </p>
      </div>
    </div>
  );

  const mainContent = () => {
    /*
     * 종목을 골라야 의미가 있는 화면인지는 메뉴 정의(`types/nav.ts`)가 안다 —
     * 여기에 화면 이름을 하나씩 나열하면 새 화면이 생길 때마다 빠뜨린다.
     * (급등 탐지·비교는 오히려 여기서 종목을 고른다.)
     */
    if (!symbol && pageMeta(view)?.needsSymbol) return needSymbol;

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
              setPage('chart');
            }}
            onWatch={add}
            onAnalyze={(next) => {
              setSymbol(next);
              setPage('analysis');
            }}
          />
        );
      case 'swing':
        return (
          <SwingDashboard
            watchlist={watchlist}
            onSelectSymbol={(next) => {
              setSymbol(next);
              setPage('chart');
            }}
            onAnalyze={(next) => {
              setSymbol(next);
              setPage('analysis');
            }}
          />
        );
      /*
       * 비교 화면은 차트를 직접 들고 언마운트한다 (메인 차트와 규칙이 다르다 —
       * 캡처 대상이 아니라 화면 밖에 살려 둘 이유가 없다).
       */
      case 'compare':
        return <CompareView initialSymbol={symbol} />;
      case 'portfolio':
        return (
          <PortfolioView
            onSelectSymbol={setSymbol}
            initialAccount={portfolioAccount}
            /* 'paper' 는 빠른주문에서 넘어온 일회성 의도다 — 다음 진입은 실제 계좌로 연다 */
            onMounted={() => setPortfolioAccount('paper')}
          />
        );
      case 'settings-account':
        return <Settings isMock={isMock} engineDown={engineDown} section="account" />;
      case 'settings-app':
        return <Settings isMock={isMock} engineDown={engineDown} section="app" />;
      case 'settings-changelog':
        return <Changelog />;
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
      {/* 관심 목록 서버 동기화 — 첫 확인 팝업과 저장 대기 표시 */}
      <WatchlistSyncModal />
      <SyncIndicator />

      {/* 서버가 옛 코드로 떠 있으면 무엇보다 먼저 알린다 — 그 아래 화면들이 전부 거짓말을 한다 */}
      <VersionMismatchBanner />

      <MarketOverview />

      <div className="flex min-h-0 flex-1">
      <SideNav
        page={nav.page}
        group={nav.group}
        onSelectPage={setPage}
        onSelectGroup={setGroup}
        /*
          홈 = 차트 화면 + 종목 미선택 (= 종목 탐색 홈). 앱을 처음 열었을 때와 같은 상태다.
          ⚠️ 차트는 언마운트하지 않는 원칙이라 `symbol` 만 비운다 — 시작 시와 같은 상태이므로
          차트 쪽에서 빈 요청이 나가지 않는다.
        */
        onGoHome={() => {
          setPage('chart');
          clearSymbol();
        }}
        onLogout={onLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          종목 헤더 — 차트·분석·급등·스윙·비교에서는 늘 떠 있다.
          ⚠️ 종목과 무관한 화면(계좌·설정)에서는 감춘다 — 계좌는 자체 헤더가 있어 겹치고,
          설정은 종목을 쓰지 않는다. **어느 화면인지는 `types/nav.ts` 가 안다** —
          여기에 화면 이름을 나열하면 새 화면이 생길 때마다 빠뜨린다 (needsSymbol 과 같은 이유).
        */}
        {!pageMeta(view)?.hidesSymbolHeader && (
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
          {/*
            검색 입력은 주어진 폭을 채운다 — 헤더에서는 이 래퍼가 폭을 잡는다.
            ⚠️ 키울 때는 **가로로** 키운다. 헤더 높이는 h-12(48px) 고정이라 세로에는 자리가 없고,
            정작 읽기 어려운 것은 긴 종목명이다. 안쪽 입력이 `min-w-0 flex-1` 이라
            래퍼 폭만 바꾸면 입력·버튼이 함께 늘어난다.
          */}
          <div className="w-72 shrink-0 lg:w-96">
            <SymbolSearch symbol={symbol ?? ''} onSubmit={setSymbol} />
          </div>

          {symbol ? (
            <>
              {/* 종목 해제 — 홈의 탐색 화면으로 돌아간다 */}
              <button
                type="button"
                onClick={() => {
                  clearSymbol();
                  setPage('chart');
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
        )}

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
            <StockExplorer
              onSelect={setSymbol}
              watchlist={watchlist}
              recent={recent}
              /* 패널과 **같은 함수**를 넘긴다 — 삭제 로직을 화면마다 만들면 갈라진다 */
              onRemoveWatch={watch.remove}
              onRemoveRecent={removeRecent}
              onClearRecent={clearRecent}
            />
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
        compareMode={compareMode}
        compareSymbols={compareSlots.filter((s): s is string => Boolean(s))}
        /*
          비교 화면에서는 클릭이 차트 전환이 아니라 '비교에 담기/빼기' 다.
          팝업으로 한 번 더 묻지 않는다 — 원클릭으로 담기는 것이 이 화면의 기본 동작이다.
        */
        onSelect={
          compareMode
            ? (next) => {
                const result = toggleCompareSymbol(next);
                if (result === 'full') {
                  toast.warning('최대 4개까지 비교 가능합니다', '하나를 빼고 담으세요');
                }
              }
            : setSymbol
        }
        onRemoveRecent={removeRecent}
        onClearRecent={clearRecent}
        /* 계좌 탭에서 계좌가 없을 때 — 계좌 관리 화면으로 보낸다 */
        onGoToAccounts={() => setPage('portfolio')}
        collapsed={panelCollapsed}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />
      </div>
    </div>
  );
}

/**
 * 로그인 문지기.
 *
 * ⚠️ **로그인 전에는 앱 본체를 마운트하지 않는다.** 마운트해 두면 시세·계좌·관심 목록
 * 폴링이 돌면서 401 만 쏟아진다.
 * ⚠️ 그래서 **"차트는 언마운트하지 않는다" 원칙의 유일한 예외**가 여기다 —
 * 그 원칙은 *로그인한 상태 안에서* 화면을 옮길 때의 이야기다.
 * 보던 종목·메뉴는 `appStore` 에 남아 있으므로 다시 로그인하면 그대로 돌아온다.
 */
export default function App() {
  const { state, notConfigured, onLoggedIn, logout } = useAuth();

  if (state === 'checking') {
    // 잠깐이지만 빈 화면보다 낫다 — 로그인 화면이 번쩍이는 것도 막는다.
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-xs text-text-muted">확인 중…</p>
      </div>
    );
  }

  if (state === 'out') {
    return (
      <div className="h-full bg-bg-primary">
        {notConfigured && (
          <div className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-center text-xs text-warning">
            서버에 비밀번호가 아직 설정되지 않았습니다 — 서버에서{' '}
            <code className="rounded bg-warning/15 px-1">npm run auth:set-password</code> 를 먼저 실행하세요.
          </div>
        )}
        <LoginScreen onSuccess={onLoggedIn} />
      </div>
    );
  }

  return <AppBody onLogout={logout} />;
}
