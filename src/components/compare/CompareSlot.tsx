import { useEffect, useState } from 'react';
import CompareChart from './CompareChart';
import SymbolSearch from '../common/SymbolSearch';
import { COMPARE_DRAG_TYPE, type CompareChartData, type CompareTimeframe } from '../../types/compare';
import type { Fundamentals } from '../../types/company';

/** 슬롯 번호 — 빈 칸에도 "몇 번 칸" 인지 보여야 드래그로 자리를 고를 수 있다 */
const NUMERALS = ['①', '②', '③', '④'];

/**
 * 4분할 그리드의 한 칸.
 *
 * 종목이 있으면 경량 차트, 없으면 안내와 검색 진입점이다. **빈 칸을 없애지 않는 이유**는
 * 자리 자체가 드롭 목표이기 때문이다 — "② 번 칸에 이 종목" 을 고를 수 있어야 한다.
 */
interface Props {
  index: number;
  symbol: string | null;
  name?: string | null;
  chart?: CompareChartData;
  fundamentals?: Fundamentals | null;
  timeframe: CompareTimeframe;
  onTimeframeChange: (timeframe: CompareTimeframe) => void;
  onRemove: () => void;
  /** 이 칸에 종목을 놓는다 (드롭·검색). 차 있으면 교체된다 */
  onPlace: (symbol: string) => void;
  /** 이미 다른 칸에 있는 종목인지 — 검색 드롭다운에 '추가됨' 을 붙인다 */
  isAdded: (symbol: string) => boolean;
}

export default function CompareSlot({
  index,
  symbol,
  name,
  chart,
  fundamentals,
  timeframe,
  onTimeframeChange,
  onRemove,
  onPlace,
  isAdded,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [searching, setSearching] = useState(false);

  // 칸이 비면 열려 있던 검색도 닫는다 (다른 칸을 지웠을 때 유령 입력창이 남지 않게).
  useEffect(() => {
    if (symbol) setSearching(false);
  }, [symbol]);

  /** 관심 목록에서 끌어온 것만 받는다 — 바깥의 아무 텍스트나 종목으로 보지 않는다 */
  const canAccept = (e: React.DragEvent) => e.dataTransfer.types.includes(COMPARE_DRAG_TYPE);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!canAccept(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy' as const;
      setDragOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      setDragOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.getData(COMPARE_DRAG_TYPE);
      if (dropped) onPlace(dropped);
    },
  };

  /*
   * 드래그 중 테두리 색으로 결과를 미리 알린다 —
   * 빈 칸은 초록(담긴다), 찬 칸은 주황(바뀐다). 놓고 나서 알면 늦다.
   */
  const ring = !dragOver
    ? ''
    : symbol
      ? 'ring-2 ring-warning'
      : 'ring-2 ring-bullish';

  if (symbol) {
    return (
      <div {...dropProps} className={`h-full rounded-md ${ring}`}>
        <CompareChart
          symbol={symbol}
          name={name}
          slotLabel={NUMERALS[index]}
          candles={chart?.candles ?? []}
          loading={chart?.loading ?? true}
          error={chart?.error ?? null}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          onRemove={onRemove}
          currency={fundamentals?.profile.currency === 'KRW' ? 'KRW' : 'USD'}
        />
        {dragOver && (
          <p className="pointer-events-none -mt-6 text-center text-[11px] text-warning">
            놓으면 이 칸이 교체됩니다
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      {...dropProps}
      className={`relative flex h-full flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-3 text-center transition-colors ${
        dragOver ? 'border-bullish bg-bullish/5' : 'border-border'
      }`}
    >
      <span className="absolute left-2 top-1.5 text-xs text-text-muted">{NUMERALS[index]}</span>

      {searching ? (
        <div className="w-full max-w-xs space-y-2">
          <SymbolSearch
            symbol=""
            onSubmit={onPlace}
            placeholder="종목명 또는 티커 (엔비디아, NVDA…)"
            submitLabel="담기"
            compact
            clearOnSubmit
            autoFocus
            /* 칸은 좁지만 화면 위쪽에 있다 — 위로 열면 1위가 화면 밖으로 잘린다 */
            dropUp={false}
            isAdded={isAdded}
          />
          <button
            type="button"
            onClick={() => setSearching(false)}
            className="text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            닫기
          </button>
        </div>
      ) : (
        <>
          <p className="text-[11px] leading-relaxed text-text-muted">
            {dragOver ? (
              <span className="text-bullish">여기에 놓으세요</span>
            ) : (
              <>
                종목을 드래그하거나
                <br />
                관심 목록에서 클릭하세요
              </>
            )}
          </p>
          {!dragOver && (
            <button
              type="button"
              onClick={() => setSearching(true)}
              className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              종목 검색
            </button>
          )}
        </>
      )}
    </div>
  );
}
