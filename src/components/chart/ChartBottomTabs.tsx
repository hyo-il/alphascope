import { PANEL_X, ScrollRow, Tabs } from '../ui';
import { PAD_CHART_TABS_MIN_PX, PHONE_TAB_ROW_H } from '../ui/tokens';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import Button from '../ui/Button';
import { ICON_SM } from '../ui/icon';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import type { Candle, Timeframe } from '../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../types/chart';
import ManualAnalysis from '../analysis/ManualAnalysis';
import CompanySummary from './tabs/CompanySummary';
import IndicatorSummaryPanel from './tabs/IndicatorSummaryPanel';
import ChartAiPanel from './tabs/ChartAiPanel';
import NewsPanel from './tabs/NewsPanel';
import InvestorFlowPanel from './tabs/InvestorFlowPanel';
import { useAppStore } from '../../store/appStore';

/**
 * 차트 하단 탭 — 차트를 보면서 기업정보·AI 분석을 함께 본다.
 *
 * 사이드 메뉴의 AI 분석은 그대로 둔다 (전체 화면 상세용). 기업정보는 별도 메뉴가 없고
 * **이 탭이 전부다** — 같은 종목을 보며 읽는 자리라 차트 옆이 맞다.
 * 여기는 **차트를 보다가 바로 확인하는 요약** 자리다 — 공간이 좁으므로
 * 같은 화면을 그대로 옮겨 붙이지 않고 핵심만 추린다.
 *
 * ⚠️ 내용은 차트 화면일 때만 렌더한다. 차트는 캡처 대상이라 다른 화면에서도
 * 언마운트하지 않고 화면 밖으로 보내는데(App 참고), 그때 이 탭들까지 살아 있으면
 * 보이지도 않는 기업정보·분석 결과를 계속 불러온다.
 */

const STORAGE_KEY = 'alphascope.chartTabsHeight';
/** 접었을 때 남는 높이 = 탭 헤더만 */
const HEADER_HEIGHT = 38;
/** 펼친 상태의 최소 높이 — 이보다 작으면 기업정보 카드 한 줄도 못 보여 준다 */
const MIN_EXPANDED = 200;
/**
 * 기본 높이를 정할 때 위 차트 줄에 남기는 최소 높이 — **가격 칸 300px** 가 되는 차트 줄 높이.
 * 차트 줄 = 정보 줄(약 73px) + 가격 칸 + 거래량 칸(가격 칸의 약 27%) + 날짜 축(30px). 실측: 차트 줄 425px → 가격 칸 253px · 324 → 173.
 * 300 ÷ 0.787 + 73 + 31 ≈ 490.
 */
const CHART_MIN_HEIGHT = 490;

type TabId = 'indicators' | 'company' | 'flow' | 'news' | 'ai';

const TABS: { id: TabId; label: string }[] = [
  { id: 'indicators', label: '차트 지표' },
  { id: 'company', label: '기업정보' },
  // 국내 종목만 내용이 있다(미국은 안내만, 요청 0건)
  { id: 'flow', label: '투자자 동향' },
  { id: 'news', label: '뉴스' },
  { id: 'ai', label: 'AI 분석' },
];

function maxHeight(): number {
  return Math.round(window.innerHeight * 0.6);
}

/** 기본 높이 = 화면의 35% (최소 300px). 기업정보 지표 카드 두 줄이 들어가는 높이다. */
function defaultHeight(): number {
  return Math.min(maxHeight(), Math.max(300, Math.round(window.innerHeight * 0.35)));
}

/** 사용자가 끌어서 정한 높이가 저장돼 있는가 — 있으면 그 값을 존중하고, 없으면 기본 높이를 화면에 맞춰 계산한다 */
function hasSavedHeight(): boolean {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0;
  } catch {
    return false;
  }
}

/**
 * 화면에 맞춘 기본 높이 — 기본(창의 35%, 최소 300px)에서 시작하되 **가격 칸이 300px 가 되도록(차트 줄 `CHART_MIN_HEIGHT`)** 줄인다
 * (아래 탭 펼친 최소 200px 까지). 1440×900 처럼 낮은 창에서 가격 차트가 약 170px 로 눌렸다.
 * `columnH` = 차트 + 아래 탭 + 바닥줄이 들어 있는 세로 열의 높이, `otherH` = 그 열의 바닥줄 등 나머지.
 */
function fittedDefault(columnH: number | null, otherH: number): number {
  const base = defaultHeight();
  if (!columnH) return base;
  return Math.max(MIN_EXPANDED, Math.min(base, columnH - otherH - CHART_MIN_HEIGHT));
}

function readHeight(): number {
  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (!Number.isFinite(saved) || saved <= 0) return defaultHeight();
    // 접힌 상태(헤더만)는 그대로 두고, 펼친 상태는 최소 높이를 보장한다.
    if (saved <= HEADER_HEIGHT + 8) return HEADER_HEIGHT;
    return Math.min(maxHeight(), Math.max(MIN_EXPANDED, saved));
  } catch {
    return defaultHeight();
  }
}

export interface ChartBottomTabsProps {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  /** 캔들을 받는 중 — 차트 지표 탭이 "캔들이 없습니다" 대신 불러오는 중을 보인다 */
  candlesLoading?: boolean;
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  toggles: IndicatorToggles;
  getChartSnapshot: ComponentProps<typeof ManualAnalysis>['getChartSnapshot'];
  /** 차트 화면이 실제로 보이는 중인지 */
  active: boolean;
  /**
   * 폰 모양(v2.82.0 · 테마 5-2) — 탭 일곱([호가] [빠른 주문] + 지금 다섯) · 탭 줄 44 · 글 16 · 넘치면 가로 밀기 + 끝 흐림 · 위에 붙음.
   * 호가 · 빠른 주문은 차트 오른쪽 열과 **같은 부품**을 받아 그린다. `onOhlcTarget` = [차트 지표] 탭 맨 위 OHLC 묶음 자리(차트가 거기에 정보 줄을 그림).
   * 넘기지 않으면 지금 모양(패드 · 1280 — 탭 다섯 · 끌어서 높이).
   */
  phone?: { orderbook: ReactNode; quickOrder: ReactNode; onOhlcTarget: (el: HTMLElement | null) => void };
}

/** 탭 내용 — 폰 · 큰 화면이 같이 쓴다 */
function TabBody({ tab, ...props }: ChartBottomTabsProps & { tab: TabId }) {
  return (
    <>
      {tab === 'indicators' && (
        <IndicatorSummaryPanel
          symbol={props.symbol}
          candles={props.candles}
          loading={props.candlesLoading}
          timeframe={props.timeframe}
          indicators={props.indicators}
          currentPrice={props.currentPrice}
        />
      )}
      {tab === 'company' && <CompanySummary symbol={props.symbol} candles={props.candles} />}
      {tab === 'flow' && <InvestorFlowPanel symbol={props.symbol} />}
      {tab === 'news' && <NewsPanel symbol={props.symbol} />}
      {tab === 'ai' && (
        <ChartAiPanel
          symbol={props.symbol}
          timeframe={props.timeframe}
          candles={props.candles}
          currentPrice={props.currentPrice}
          indicators={props.indicators}
          toggles={props.toggles}
          getChartSnapshot={props.getChartSnapshot}
        />
      )}
    </>
  );
}

type PhoneTabId = 'orderbook' | 'order' | TabId;
const PHONE_TABS: { id: PhoneTabId; label: string }[] = [
  { id: 'orderbook', label: '호가' },
  { id: 'order', label: '빠른 주문' },
  ...TABS,
];
/** 폰에서 고른 탭 — 이 기기에 기억(폰 따로 · 패드 · 1280 은 읽지 않음 — 그쪽은 지금처럼 처음 탭) */
const PHONE_TAB_KEY = 'alphascope.chartTabPhone';
function readPhoneTab(): PhoneTabId {
  try {
    const v = localStorage.getItem(PHONE_TAB_KEY);
    return PHONE_TABS.some((t) => t.id === v) ? (v as PhoneTabId) : 'orderbook';
  } catch {
    return 'orderbook';
  }
}

function PhoneChartTabs(props: ChartBottomTabsProps & { phone: NonNullable<ChartBottomTabsProps['phone']> }) {
  const { active, phone } = props;
  const [tab, setTabState] = useState<PhoneTabId>(readPhoneTab);
  const setTab = (next: PhoneTabId) => {
    setTabState(next);
    try {
      localStorage.setItem(PHONE_TAB_KEY, next);
    } catch {
      // 기억하지 못해도 이번 화면에서는 동작한다
    }
  };
  // 「AI 분석」 탭을 열어 달라는 요청(옛 주소 #/analysis · 급등 탐지 [분석]) — 큰 화면과 같다
  const chartAiRequest = useAppStore((s) => s.chartAiRequest);
  const seenAiRequest = useRef(chartAiRequest);
  useEffect(() => {
    if (chartAiRequest === seenAiRequest.current) return;
    seenAiRequest.current = chartAiRequest;
    setTabState('ai');
  }, [chartAiRequest]);

  return (
    <div data-testid="phone-chart-tabs" className="flex flex-col">
      {/* 탭 줄 — 위에 붙음(본문을 밀어 내려도 탭을 바꿀 수 있게) · 넘치면 옆으로 밀기 + 끝 흐림(R7) */}
      <ScrollRow className={`sticky top-0 z-10 ${PHONE_TAB_ROW_H} shrink-0 border-b border-border/60 bg-bg-primary`} innerClassName={`flex h-full items-end ${PANEL_X}`} testId="phone-tab-row">
        <Tabs label="차트 아래 탭" line={false} items={PHONE_TABS} value={tab} onChange={setTab} />
      </ScrollRow>
      {active && (
        <div data-testid="phone-tab-body" className="pb-4 pt-2">
          {/* 바탕이 있는 호가 · OHLC 상자도 탭 줄 글자와 같은 왼쪽 끝(PANEL_X) */}
          {tab === 'orderbook' && <div className={PANEL_X}>{phone.orderbook}</div>}
          {tab === 'order' && phone.quickOrder}
          {tab === 'indicators' && <div ref={phone.onOhlcTarget} data-testid="phone-ohlc" className={PANEL_X} />}
          {tab !== 'orderbook' && tab !== 'order' && <TabBody {...props} tab={tab} />}
        </div>
      )}
    </div>
  );
}

export default function ChartBottomTabs(props: ChartBottomTabsProps) {
  return props.phone ? <PhoneChartTabs {...props} phone={props.phone} /> : <DeskChartTabs {...props} />;
}

function DeskChartTabs(props: ChartBottomTabsProps) {
  const { active } = props;
  /** 패드(테마 5-3 · 점검 53) — 펼친 탭 내용 칸이 약 180 으로 좁았다. 펼친 높이 최소를 두고 모자라면 본문을 밀어 본다 */
  const pad = useLayoutMode() === 'pad';
  const [tab, setTab] = useState<TabId>('indicators');
  const [height, setHeight] = useState(readHeight);
  /** 저장된(사용자가 정한) 높이가 있는가 — 없으면 열 높이가 바뀔 때마다 기본 높이를 다시 맞춘다 */
  const userSet = useRef(hasSavedHeight());
  const rootRef = useRef<HTMLDivElement>(null);
  /** 지금 열 크기에 맞춘 기본 높이 */
  const fitDefault = useCallback(() => {
    const root = rootRef.current;
    const col = root?.parentElement;
    if (!root || !col) return defaultHeight();
    const otherH = [...col.children]
      .filter((c) => c !== root && c !== root.previousElementSibling)
      .reduce((sum, c) => sum + c.getBoundingClientRect().height, 0);
    return fittedDefault(col.getBoundingClientRect().height, otherH);
  }, []);
  /** 드래그 중인지 — 경계선을 강조해 어디를 잡고 있는지 보이게 한다 */
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const collapsed = height <= HEADER_HEIGHT + 8;

  // 「AI 분석」 탭을 열어 달라는 요청(옛 주소 #/analysis · 급등 탐지 [분석]). 처음 값(마운트 때 번호)은 무시한다
  const chartAiRequest = useAppStore((s) => s.chartAiRequest);
  const seenAiRequest = useRef(chartAiRequest);

  const persist = useCallback((next: number) => {
    userSet.current = true;
    setHeight(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // 저장 실패(용량 초과 등)해도 이번 세션 동안은 그대로 쓴다.
    }
  }, []);

  /*
   * 위쪽 경계를 잡고 끌어 높이를 바꾼다.
   * pointer capture 를 쓰면 커서가 차트 위로 넘어가도 드래그가 끊기지 않는다 —
   * 차트는 자기 마우스 이벤트를 잡아 드로잉을 만들기 때문에 이 처리가 없으면
   * 끌던 도중 선이 그어진다.
   */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    dragState.current = { startY: event.clientY, startHeight: height };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    const delta = dragState.current.startY - event.clientY;
    const next = dragState.current.startHeight + delta;
    /*
     * 아래로 끝까지 내리면 헤더만 남기고 접는다. 그 사이 구간(38~200px)은
     * 기업정보 카드 한 줄도 안 들어가 쓸모가 없어 건너뛴다.
     */
    setHeight(
      next < MIN_EXPANDED - 40
        ? HEADER_HEIGHT
        : Math.min(maxHeight(), Math.max(MIN_EXPANDED, next)),
    );
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current) return;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    dragState.current = null;
    setDragging(false);
    persist(height);
  };

  // 창을 줄이면 저장된 높이가 화면보다 커질 수 있다.
  useEffect(() => {
    /*
     * 접힌 상태는 그대로 둔다. 펼친 상태는 MIN_EXPANDED 하한을 지켜야 한다 —
     * 없으면 작은 창에서 드래그가 일부러 건너뛴 38~200px 구간에 갇힌다.
     */
    const onResize = () =>
      setHeight((current) =>
        current <= HEADER_HEIGHT + 8
          ? current
          : Math.min(maxHeight(), Math.max(MIN_EXPANDED, current)),
      );
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** 기본 높이로 — 저장값을 지우고 화면에 맞춘 기본 높이(더블클릭 · 접힌 상태에서 펼치기) */
  const resetDefault = useCallback(() => {
    userSet.current = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* 무시 */
    }
    setHeight(fitDefault());
  }, [fitDefault]);

  useEffect(() => {
    if (chartAiRequest === seenAiRequest.current) return;
    seenAiRequest.current = chartAiRequest;
    setTab('ai');
    if (collapsed) resetDefault();
  }, [chartAiRequest, collapsed, resetDefault]);

  // 저장값이 없으면 열 높이(창 크기·시황 카드 접기)에 맞춰 기본 높이를 다시 정한다
  useEffect(() => {
    const col = rootRef.current?.parentElement;
    if (!col || typeof ResizeObserver === 'undefined') return;
    const apply = () => {
      if (!userSet.current) setHeight(fitDefault());
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(col);
    return () => ro.disconnect();
  }, [fitDefault]);

  const toggleCollapse = () => (collapsed ? resetDefault() : persist(HEADER_HEIGHT));

  return (
    <div ref={rootRef} className="flex shrink-0 flex-col border-t border-border" style={{ height: pad && !collapsed ? Math.max(height, PAD_CHART_TABS_MIN_PX) : height }}>
      {/* 드래그 손잡이 — 얇지만 잡을 수 있게 위아래 여유를 둔다 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        /* 더블클릭하면 기본 높이로 돌아온다 — 잘못 끌었을 때 되돌리는 가장 빠른 길 */
        onDoubleClick={resetDefault}
        data-tip="드래그: 높이 조절 · 더블클릭: 기본 높이"
        className={`h-1 shrink-0 cursor-row-resize transition-colors ${
          dragging ? 'bg-accent' : 'bg-transparent hover:bg-accent/40'
        }`}
      />

      {/* 탭 줄 — 탭 글자·내용의 왼쪽 끝이 같은 선(PANEL_X). 접힌 상태에서는 고른 탭 밑줄을 그리지 않는다 */}
      <div className={`flex shrink-0 items-center border-b border-border/60 ${PANEL_X}`}>
        <Tabs
          label="차트 아래 탭"
          line={false}
          size="sm"
          items={TABS}
          value={collapsed ? ('' as TabId) : tab}
          onChange={(id) => {
            setTab(id);
            if (collapsed) resetDefault();
          }}
        />

        <Button variant="ghost" size="sm"
          onClick={toggleCollapse}
          title={collapsed ? '펼치기' : '접기'}
          aria-label={collapsed ? '펼치기' : '접기'}
          className="ml-auto">
          {collapsed ? <ChevronUp {...ICON_SM} /> : <ChevronDown {...ICON_SM} />}
        </Button>
      </div>

      {/* 손가락 화면 — 탭 줄 누르는 칸(44)과 내용 첫 줄 누르는 칸이 겹치지 않게 위 8 */}
      {!collapsed && active && (
        <div className="min-h-0 flex-1 overflow-auto touch:pt-2">
          <TabBody {...props} tab={tab} />
        </div>
      )}
    </div>
  );
}
