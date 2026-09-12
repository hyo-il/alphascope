import { useEffect, useState } from 'react';
import CompareChart from './CompareChart';
import CompareTable from './CompareTable';
import CompareAIPrompt from './CompareAIPrompt';
import SymbolSearch from '../common/SymbolSearch';
import { useCompareData } from '../../hooks/useCompareData';
import { useStockNames } from '../../hooks/useStockNames';
import {
  COMPARE_DRAG_TYPE,
  COMPARE_TIMEFRAMES,
  MAX_COMPARE_SYMBOLS,
  type CompareTimeframe,
} from '../../types/compare';
import { useAppStore } from '../../store/appStore';
import { toast } from '../../store/uiStore';

/**
 * 기업 비교 — 최대 4개 종목의 차트·기업정보·AI 비교 평가를 한 화면에서 본다.
 *
 * **종목은 오른쪽 관심 목록에서 고르는 것이 기본이다** (클릭 = 담기/빼기, 드래그 = 여기에 놓기).
 * 검색 팝업은 관심 목록에 없는 종목을 위한 보조 수단이다. 그래서 선택 목록은
 * `appStore` 에 있다 — 관심 목록 패널은 이 화면 바깥(App)에서 그려지기 때문이다.
 *
 * 메인 차트와 규칙이 다르다: **이 화면을 나가면 차트를 언마운트하고 선택도 비운다.**
 * 캡처 대상이 아니라 살려 둘 이유가 없고, 넷을 화면 밖에 띄워 두는 비용이 크다.
 */
interface Props {
  /** 차트에서 보던 종목 — 비교를 열면 첫 칸에 들어가 있다 */
  initialSymbol?: string | null;
}

/** 차트 개수별 그리드. 좁은 화면에서는 전부 세로로 쌓인다. */
const GRID: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 lg:grid-cols-2',
  3: 'grid-cols-1 lg:grid-cols-3',
  4: 'grid-cols-1 lg:grid-cols-2',
};

export default function CompareView({ initialSymbol }: Props) {
  const symbols = useAppStore((s) => s.compareSymbols);
  const addSymbol = useAppStore((s) => s.addCompareSymbol);
  const removeSymbol = useAppStore((s) => s.removeCompareSymbol);
  const clearSymbols = useAppStore((s) => s.clearCompareSymbols);

  const [timeframes, setTimeframes] = useState<Record<string, CompareTimeframe>>({});
  const [chartsVisible, setChartsVisible] = useState(true);
  const [searching, setSearching] = useState(false);
  /** 관심 목록에서 끌어온 종목이 이 위에 있는지 — 점선 가이드를 띄운다 */
  const [dragOver, setDragOver] = useState(false);

  const { charts, fundamentals, summaries, summariesLoading, refresh } = useCompareData(
    symbols,
    timeframes,
  );
  const names = useStockNames(symbols);

  // 보던 종목을 첫 칸에 넣어 둔다. 화면을 나가면 선택을 비운다 (의도된 동작).
  useEffect(() => {
    if (initialSymbol) addSymbol(initialSymbol);
    return () => clearSymbols();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const full = symbols.length >= MAX_COMPARE_SYMBOLS;

  const add = (next: string) => {
    if (symbols.includes(next.trim().toUpperCase())) {
      return toast.info('이미 비교 중인 종목입니다', next.trim().toUpperCase());
    }
    if (addSymbol(next) === 'full') {
      toast.warning(`최대 ${MAX_COMPARE_SYMBOLS}개까지 비교 가능합니다`, '하나를 빼고 담으세요');
      return;
    }
    setSearching(false);
  };

  /** 전체 일괄 변경 — 개별 설정을 모두 덮어쓴다 (이후 개별 변경은 그 차트만 바뀐다) */
  const setAllTimeframes = (timeframe: CompareTimeframe) =>
    setTimeframes(Object.fromEntries(symbols.map((s) => [s, timeframe])));

  /** 관심 목록에서 끌어온 종목만 받는다 — 바깥의 아무 텍스트나 종목으로 보지 않는다 */
  const canAccept = (e: React.DragEvent) => e.dataTransfer.types.includes(COMPARE_DRAG_TYPE);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const symbol = e.dataTransfer.getData(COMPARE_DRAG_TYPE);
    if (symbol) add(symbol);
  };

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!canAccept(e)) return;
      e.preventDefault();
      // 가득 찼으면 받지 않는다 — 커서로도 알려 준다.
      e.dataTransfer.dropEffect = full ? 'none' : 'copy';
      setDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragOver(false);
    },
    onDrop,
  };

  const label = (symbol: string) =>
    names(symbol) ? `${names(symbol)} (${symbol})` : symbol;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">⚖️ 기업 비교</h2>
          <span className="text-[11px] text-text-muted">
            최대 {MAX_COMPARE_SYMBOLS}개 · 2개부터 비교됩니다 · 오른쪽 관심 목록에서 클릭·드래그
          </span>

          <button
            type="button"
            onClick={refresh}
            disabled={!symbols.length}
            title="비교 화면은 실시간 폴링하지 않습니다 — 이 버튼으로 갱신하세요"
            className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
          >
            🔄 새로고침
          </button>
          <button
            type="button"
            onClick={() => setChartsVisible((v) => !v)}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            {chartsVisible ? '차트 숨기기' : '차트 보기'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 칩 — 티커만 적지 않는다. 사람은 "애플" 로 기억하지 "AAPL" 로 기억하지 않는다. */}
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => removeSymbol(symbol)}
              title={`${label(symbol)} 비교에서 빼기`}
              className="rounded bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-bearish"
            >
              {label(symbol)} ✕
            </button>
          ))}

          <button
            type="button"
            onClick={() => setSearching((v) => !v)}
            disabled={full}
            title={full ? `최대 ${MAX_COMPARE_SYMBOLS}개입니다` : '관심 목록에 없는 종목 검색'}
            className="rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
          >
            + 종목 추가
          </button>

          {chartsVisible && symbols.length > 0 && (
            <label className="ml-auto flex w-fit items-center gap-1.5 text-[11px] text-text-secondary">
              전체
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setAllTimeframes(e.target.value as CompareTimeframe);
                }}
                className="rounded border border-border px-1 py-0.5 text-[11px]"
              >
                <option value="">일괄 변경…</option>
                {COMPARE_TIMEFRAMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {searching && <SearchPopup onAdd={add} onClose={() => setSearching(false)} added={symbols} />}

      {symbols.length === 0 ? (
        <div
          {...dropProps}
          className={`flex flex-1 items-center justify-center rounded-md border-2 border-dashed text-xs transition-colors ${
            dragOver ? 'border-accent bg-accent/5 text-accent' : 'border-border text-text-muted'
          }`}
        >
          {dragOver
            ? '여기에 놓으세요'
            : '오른쪽 관심 목록에서 종목을 클릭하거나 이곳으로 끌어다 놓으세요 (2개 이상).'}
        </div>
      ) : (
        <>
          {/*
            차트는 숨겨도 인스턴스를 남긴다 — 다시 볼 때 캔들을 새로 받지 않는다.
            (`hidden` 이면 컨테이너가 0 이 되지만 autoSize 의 ResizeObserver 가
            다시 보이는 순간 원래 크기로 되돌린다.)
          */}
          <div
            {...dropProps}
            className={`grid gap-2 rounded-md ${GRID[symbols.length] ?? 'grid-cols-1 lg:grid-cols-2'} ${
              chartsVisible ? '' : 'hidden'
            } ${dragOver ? 'outline-dashed outline-2 outline-offset-2 outline-accent' : ''}`}
          >
            {symbols.map((symbol) => {
              const chart = charts[symbol];
              const timeframe = timeframes[symbol] ?? '1d';
              return (
                <div key={symbol} className="h-[280px]">
                  <CompareChart
                    symbol={symbol}
                    name={names(symbol)}
                    candles={chart?.candles ?? []}
                    loading={chart?.loading ?? true}
                    error={chart?.error ?? null}
                    timeframe={timeframe}
                    onTimeframeChange={(next) =>
                      setTimeframes((prev) => ({ ...prev, [symbol]: next }))
                    }
                    onRemove={() => removeSymbol(symbol)}
                    currency={fundamentals[symbol]?.profile.currency === 'KRW' ? 'KRW' : 'USD'}
                  />
                </div>
              );
            })}

            {dragOver && !full && (
              <div className="flex h-[280px] items-center justify-center rounded-md border-2 border-dashed border-accent bg-accent/5 text-xs text-accent">
                여기에 놓으세요
              </div>
            )}
          </div>

          <CompareTable
            symbols={symbols}
            names={names}
            fundamentals={fundamentals}
            summaries={summaries}
            loading={summariesLoading}
          />

          <CompareAIPrompt summaries={summaries} loading={summariesLoading} />
        </>
      )}
    </div>
  );
}

/**
 * [+ 종목 추가] 팝업 — **관심 목록에 없는 종목**을 위한 보조 수단이다.
 * 기본 방법은 오른쪽 관심 목록 클릭이라, 이 입력은 늘 펼쳐 두지 않는다.
 */
function SearchPopup({
  onAdd,
  onClose,
  added,
}: {
  onAdd: (symbol: string) => void;
  onClose: () => void;
  added: string[];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-6 pt-24"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-bg-secondary p-3 shadow-xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-secondary">종목 검색해 비교에 담기</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm leading-none text-text-muted transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <SymbolSearch
          symbol=""
          onSubmit={onAdd}
          placeholder="종목명 또는 티커 (엔비디아, NVDA…)"
          submitLabel="담기"
          clearOnSubmit
          autoFocus
          isAdded={(s) => added.includes(s)}
        />

        <p className="mt-2 text-[11px] text-text-muted">
          미국 주식이 먼저 나옵니다. 관심 목록에 있는 종목은 오른쪽 패널에서 바로 클릭하세요.
        </p>
      </div>
    </div>
  );
}
