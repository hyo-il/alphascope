import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import type { Candle, Timeframe } from '../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../types/chart';
import ManualAnalysis from '../analysis/ManualAnalysis';
import CompanySummary from './tabs/CompanySummary';
import IndicatorSummaryPanel from './tabs/IndicatorSummaryPanel';
import ChartAiPanel from './tabs/ChartAiPanel';

/**
 * 차트 하단 탭 — 차트를 보면서 기업정보·AI 분석을 함께 본다.
 *
 * 사이드 메뉴의 기업정보·AI 분석은 그대로 둔다 (전체 화면 상세용).
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

type TabId = 'indicators' | 'company' | 'ai';

const TABS: { id: TabId; label: string }[] = [
  { id: 'indicators', label: '차트 지표' },
  { id: 'company', label: '기업정보' },
  { id: 'ai', label: 'AI 분석' },
];

function maxHeight(): number {
  return Math.round(window.innerHeight * 0.6);
}

/** 기본 높이 = 화면의 35% (최소 300px). 기업정보 지표 카드 두 줄이 들어가는 높이다. */
function defaultHeight(): number {
  return Math.min(maxHeight(), Math.max(300, Math.round(window.innerHeight * 0.35)));
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
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  toggles: IndicatorToggles;
  getChartSnapshot: ComponentProps<typeof ManualAnalysis>['getChartSnapshot'];
  onPromptChange?: ComponentProps<typeof ManualAnalysis>['onPromptChange'];
  /** 차트 화면이 실제로 보이는 중인지 */
  active: boolean;
  /** 사이드 메뉴의 전체 화면으로 이동 */
  onOpenFullView: (view: 'company' | 'analysis') => void;
}

export default function ChartBottomTabs(props: ChartBottomTabsProps) {
  const { active } = props;
  const [tab, setTab] = useState<TabId>('indicators');
  const [height, setHeight] = useState(readHeight);
  /** 드래그 중인지 — 경계선을 강조해 어디를 잡고 있는지 보이게 한다 */
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const collapsed = height <= HEADER_HEIGHT + 8;

  const persist = useCallback((next: number) => {
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
    const onResize = () => setHeight((current) => Math.min(maxHeight(), current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleCollapse = () => persist(collapsed ? defaultHeight() : HEADER_HEIGHT);

  return (
    <div className="flex shrink-0 flex-col border-t border-border" style={{ height }}>
      {/* 드래그 손잡이 — 얇지만 잡을 수 있게 위아래 여유를 둔다 */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        /* 더블클릭하면 기본 높이로 돌아온다 — 잘못 끌었을 때 되돌리는 가장 빠른 길 */
        onDoubleClick={() => persist(defaultHeight())}
        title="드래그: 높이 조절 · 더블클릭: 기본 높이"
        className={`h-1 shrink-0 cursor-row-resize transition-colors ${
          dragging ? 'bg-accent' : 'bg-transparent hover:bg-accent/40'
        }`}
      />

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setTab(item.id);
              if (collapsed) persist(defaultHeight());
            }}
            className={`border-b-2 px-3 py-1.5 text-xs transition-colors ${
              tab === item.id && !collapsed
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}

        <button
          type="button"
          onClick={toggleCollapse}
          title={collapsed ? '펼치기' : '접기'}
          className="ml-auto px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          {collapsed ? '▲' : '▼'}
        </button>
      </div>

      {!collapsed && active && (
        <div className="min-h-0 flex-1 overflow-auto">
          {tab === 'indicators' && (
            <IndicatorSummaryPanel
              candles={props.candles}
              timeframe={props.timeframe}
              indicators={props.indicators}
              currentPrice={props.currentPrice}
            />
          )}
          {tab === 'company' && (
            <CompanySummary
              symbol={props.symbol}
              candles={props.candles}
              onOpenFullView={() => props.onOpenFullView('company')}
            />
          )}
          {tab === 'ai' && (
            <ChartAiPanel
              symbol={props.symbol}
              timeframe={props.timeframe}
              candles={props.candles}
              currentPrice={props.currentPrice}
              indicators={props.indicators}
              toggles={props.toggles}
              getChartSnapshot={props.getChartSnapshot}
              onPromptChange={props.onPromptChange}
              onOpenFullView={() => props.onOpenFullView('analysis')}
            />
          )}
        </div>
      )}
    </div>
  );
}
