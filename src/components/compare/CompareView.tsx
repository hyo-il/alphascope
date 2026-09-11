import { useState } from 'react';
import CompareChart from './CompareChart';
import CompareTable from './CompareTable';
import CompareAIPrompt from './CompareAIPrompt';
import SymbolSearch from '../common/SymbolSearch';
import { useCompareData } from '../../hooks/useCompareData';
import { useStockNames } from '../../hooks/useStockNames';
import {
  COMPARE_TIMEFRAMES,
  MAX_COMPARE_SYMBOLS,
  type CompareTimeframe,
} from '../../types/compare';
import { toast } from '../../store/uiStore';

/**
 * 기업 비교 — 최대 4개 종목의 차트·기업정보·AI 비교 평가를 한 화면에서 본다.
 *
 * 메인 차트와 규칙이 다르다: **이 화면을 나가면 차트를 언마운트한다.**
 * 캡처 대상이 아니라 살려 둘 이유가 없고, 네 개를 화면 밖에 띄워 두는 비용이 크다.
 * 그래서 선택한 종목도 남지 않는다 — 돌아오면 종목 선택부터 다시 한다 (의도된 동작).
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
  const [symbols, setSymbols] = useState<string[]>(initialSymbol ? [initialSymbol] : []);
  const [timeframes, setTimeframes] = useState<Record<string, CompareTimeframe>>({});
  const [chartsVisible, setChartsVisible] = useState(true);

  const { charts, fundamentals, summaries, summariesLoading, refresh } = useCompareData(
    symbols,
    timeframes,
  );
  const names = useStockNames(symbols);

  const add = (next: string) => {
    const symbol = next.trim().toUpperCase();
    if (!symbol) return;
    if (symbols.includes(symbol)) return toast.info('이미 비교 중인 종목입니다', symbol);
    if (symbols.length >= MAX_COMPARE_SYMBOLS) {
      return toast.warning(`비교는 최대 ${MAX_COMPARE_SYMBOLS}개까지입니다`, '하나를 빼고 담으세요');
    }
    setSymbols((prev) => [...prev, symbol]);
  };

  const remove = (symbol: string) => setSymbols((prev) => prev.filter((s) => s !== symbol));

  /** 전체 일괄 변경 — 개별 설정을 모두 덮어쓴다 (이후 개별 변경은 그 차트만 바뀐다) */
  const setAllTimeframes = (timeframe: CompareTimeframe) =>
    setTimeframes(Object.fromEntries(symbols.map((s) => [s, timeframe])));

  const full = symbols.length >= MAX_COMPARE_SYMBOLS;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">기업 비교</h2>
          <span className="text-[11px] text-text-muted">
            최대 {MAX_COMPARE_SYMBOLS}개 · 2개부터 비교됩니다
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
          {/* 관심 목록과 같은 검색 컴포넌트를 쓴다 — 여기만 평범한 입력창이면 한글이 안 먹는다 */}
          <div className="w-64">
            <SymbolSearch
              symbol=""
              onSubmit={add}
              placeholder={full ? `최대 ${MAX_COMPARE_SYMBOLS}개` : '종목명 또는 심볼'}
              submitLabel="추가"
              compact
              clearOnSubmit
              isAdded={(s) => symbols.includes(s)}
            />
          </div>

          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => remove(symbol)}
              title="비교에서 빼기"
              className="rounded bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-bearish"
            >
              {names(symbol) || symbol} <span className="text-text-muted">{symbol}</span> ✕
            </button>
          ))}

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

      {symbols.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-text-muted">
          비교할 종목을 2개 이상 추가하세요.
        </div>
      ) : (
        <>
          {/*
            차트는 숨겨도 인스턴스를 남긴다 — 다시 볼 때 캔들을 새로 받지 않는다.
            (`hidden` 이면 컨테이너가 0 이 되지만 autoSize 의 ResizeObserver 가
            다시 보이는 순간 원래 크기로 되돌린다.)
          */}
          <div
            className={`grid gap-2 ${GRID[symbols.length] ?? 'grid-cols-1 lg:grid-cols-2'} ${
              chartsVisible ? '' : 'hidden'
            }`}
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
                    onRemove={() => remove(symbol)}
                    currency={fundamentals[symbol]?.profile.currency === 'KRW' ? 'KRW' : 'USD'}
                  />
                </div>
              );
            })}
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
