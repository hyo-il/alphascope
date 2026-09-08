import { MA_LINES, type IndicatorSeries, type IndicatorToggles } from '../../types/chart';
import type { Candle } from '../../types/toss';
import { formatChartDateTime, isIntraday } from './chartTheme';

/**
 * 차트 위쪽 정보 바 — OHLCV + 이동평균 범례.
 *
 * **차트 영역 밖에 둔다.** 예전에는 캔들 위에 absolute 오버레이로 띄우고 배경을 지운 뒤
 * text-shadow 로 읽히게 했는데, 배경을 없애도 **글자 자체가 캔들을 가린다** — 특히
 * 좌상단은 확대해서 보면 값이 가장 궁금한 자리다. 한 줄을 통째로 차트 밖으로 뺐다.
 *
 * 메인 차트와 캡처 팝업이 같은 컴포넌트를 쓴다. 캡처 그림에도 같은 줄이 찍혀야
 * 붙여넣은 쪽에서 "언제 어느 봉인지" 를 알 수 있다.
 */

export interface HoverInfo {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 크로스헤어 위치의 이동평균 값 (범례용) */
  ma: Record<string, number | null>;
}

/** 크로스헤어가 없을 때 쓰는 마지막 봉 값 (빈 칸보다 유용하다) */
export function lastAsHover(
  candles: Candle[],
  indicators: IndicatorSeries | null,
): HoverInfo | null {
  const last = candles.at(-1);
  if (!last) return null;

  // 각 이동평균의 마지막 유효 값 (워밍업 구간의 null 은 건너뛴다)
  const ma: Record<string, number | null> = {};
  if (indicators) {
    for (const line of MA_LINES) {
      const series = indicators[line.series];
      ma[line.label] = series?.filter((v): v is number => v != null).at(-1) ?? null;
    }
  }

  return {
    time: last.timestamp,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
    ma,
  };
}

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <span className="text-text-secondary">
      {label} <span className={`tabular-nums ${className || 'text-text-primary'}`}>{value}</span>
    </span>
  );
}

export default function ChartInfoBar({
  legend,
  candles,
  toggles,
}: {
  legend: HoverInfo | null;
  candles: Candle[];
  toggles?: IndicatorToggles;
}) {
  const activeMa = MA_LINES.filter((ma) => toggles?.overlays[ma.key]);

  /*
   * 값이 없어도 자리는 잡아 둔다 (min-h). 크로스헤어가 차트 밖으로 나갈 때마다 줄이
   * 사라졌다 나타나면 그 아래 차트 높이가 흔들린다.
   */
  return (
    <div className="shrink-0 border-b border-border bg-bg-secondary px-3 py-1 text-[11px] leading-relaxed">
      <div className="flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-0.5">
        {legend && (
          <>
            <span className="tabular-nums text-text-secondary">
              {formatChartDateTime(legend.time, isIntraday(candles))}
            </span>
            <Field label="시" value={legend.open.toFixed(2)} />
            <Field label="고" value={legend.high.toFixed(2)} />
            <Field label="저" value={legend.low.toFixed(2)} />
            <Field
              label="종"
              value={legend.close.toFixed(2)}
              // 종가만 등락 색을 준다 — 넷 다 칠하면 어느 것이 등락인지 알 수 없다.
              className={`font-medium ${legend.close >= legend.open ? 'text-bullish' : 'text-bearish'}`}
            />
            <Field
              label="거래량"
              value={
                legend.volume > 0
                  ? Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(legend.volume)
                  : '—'
              }
              className="text-text-secondary"
            />
          </>
        )}
      </div>

      {activeMa.length > 0 && (
        <div className="flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-0.5">
          {activeMa.map((ma) => {
            const value = legend?.ma?.[ma.label];
            return (
              <span key={ma.key} className="flex items-center gap-1" style={{ color: ma.color }}>
                {/* 선 색과 같은 점 — 이름만으로는 차트의 어느 선인지 바로 이어지지 않는다 */}
                <span aria-hidden>●</span>
                {ma.label}
                <span className="tabular-nums">{value != null ? value.toFixed(2) : '—'}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
