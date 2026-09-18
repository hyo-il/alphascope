import { useEffect, useState } from 'react';
import CompareSlot from './CompareSlot';
import CompareTable from './CompareTable';
import CompareAIPrompt from './CompareAIPrompt';
import { useCompareData } from '../../hooks/useCompareData';
import { useStockNames } from '../../hooks/useStockNames';
import { COMPARE_TIMEFRAMES, type CompareTimeframe } from '../../types/compare';
import { useAppStore } from '../../store/appStore';

/**
 * 기업 비교 — **항상 2×2 = 4칸**의 고정 그리드다.
 *
 * 종목 수에 따라 칸 수를 바꾸지 않는다. 빈 칸이 그대로 남아 있어야 "② 번 자리에 이 종목"
 * 처럼 자리를 고를 수 있고, 빈 칸 자체가 드롭 목표이자 검색 진입점이 된다.
 *
 * **종목은 오른쪽 관심 목록에서 고르는 것이 기본이다** (클릭 = 빈 칸에 차례로 담기/빼기,
 * 드래그 = 원하는 칸에 직접 놓기). 빈 칸의 [종목 검색]은 관심 목록에 없는 종목용 보조 수단이다.
 * 그래서 슬롯은 `appStore` 에 있다 — 관심 목록 패널은 이 화면 바깥(App)에서 그려지기 때문이다.
 *
 * 메인 차트와 규칙이 다르다: **이 화면을 나가면 차트를 언마운트하고 선택도 비운다.**
 * 캡처 대상이 아니라 살려 둘 이유가 없고, 넷을 화면 밖에 띄워 두는 비용이 크다.
 */
interface Props {
  /** 차트에서 보던 종목 — 비교를 열면 첫 칸에 들어가 있다 */
  initialSymbol?: string | null;
}

export default function CompareView({ initialSymbol }: Props) {
  const slots = useAppStore((s) => s.compareSlots);
  const addSymbol = useAppStore((s) => s.addCompareSymbol);
  const setSlot = useAppStore((s) => s.setCompareSlot);
  const removeSlot = useAppStore((s) => s.removeCompareSlot);
  const clearSymbols = useAppStore((s) => s.clearCompareSymbols);

  const [timeframes, setTimeframes] = useState<Record<string, CompareTimeframe>>({});
  const [chartsVisible, setChartsVisible] = useState(true);

  /** 데이터 조회는 실제로 담긴 종목만 (빈 칸은 부르지 않는다) */
  const symbols = slots.filter((s): s is string => Boolean(s));

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

  /** 전체 일괄 변경 — 개별 설정을 모두 덮어쓴다 (이후 개별 변경은 그 차트만 바뀐다) */
  const setAllTimeframes = (timeframe: CompareTimeframe) =>
    setTimeframes(Object.fromEntries(symbols.map((s) => [s, timeframe])));

  /** 비교 자체가 2종목부터 성립한다 — 한 종목의 표는 '비교' 가 아니다 */
  const ready = symbols.length >= 2;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">⚖️ 기업 비교</h2>
        <span className="text-[11px] text-text-muted">
          4칸 · 2개부터 비교됩니다 · 오른쪽 관심 목록에서 클릭하거나 원하는 칸으로 드래그
        </span>

        {chartsVisible && (
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

        <button
          type="button"
          onClick={refresh}
          disabled={!symbols.length}
          title="비교 화면은 실시간 폴링하지 않습니다 — 이 버튼으로 갱신하세요"
          className={`rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40 ${
            chartsVisible ? '' : 'ml-auto'
          }`}
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
      </header>

      {/*
        차트는 숨겨도 인스턴스를 남긴다 — 다시 볼 때 캔들을 새로 받지 않는다.
        (`hidden` 이면 컨테이너가 0 이 되지만 autoSize 의 ResizeObserver 가
        다시 보이는 순간 원래 크기로 되돌린다.)
      */}
      <div
        className={`grid grid-cols-1 gap-2 lg:grid-cols-2 ${chartsVisible ? '' : 'hidden'}`}
      >
        {slots.map((symbol, index) => (
          <div key={index} className="h-[280px]">
            <CompareSlot
              index={index}
              symbol={symbol}
              name={symbol ? names(symbol) : null}
              chart={symbol ? charts[symbol] : undefined}
              fundamentals={symbol ? fundamentals[symbol] : null}
              timeframe={(symbol && timeframes[symbol]) || '1d'}
              onTimeframeChange={(next) =>
                symbol && setTimeframes((prev) => ({ ...prev, [symbol]: next }))
              }
              onRemove={() => {
                // 뺀 종목의 타임프레임 설정도 함께 버린다 — 남겨 두면 다시 담았을 때
                // 예전에 고른 값이 되살아나, 나가면 선택을 비우는 이 화면의 규칙과 어긋난다.
                if (symbol) setTimeframes(({ [symbol]: _removed, ...rest }) => rest);
                removeSlot(index);
              }}
              onPlace={(next) => setSlot(index, next)}
              isAdded={(candidate) => slots.includes(candidate)}
            />
          </div>
        ))}
      </div>

      {ready ? (
        <>
          <CompareTable
            symbols={symbols}
            names={names}
            fundamentals={fundamentals}
            summaries={summaries}
            loading={summariesLoading}
          />
          <CompareAIPrompt summaries={summaries} loading={summariesLoading} />
        </>
      ) : (
        <>
          <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted">
            📋 기업정보 비교 — 2개 이상 종목을 추가하면 활성화됩니다
          </p>
          <p className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted">
            🤖 AI 비교 평가 — 2개 이상 종목을 추가하면 활성화됩니다
          </p>
        </>
      )}
    </div>
  );
}
