import { MA_LINES, type IndicatorSeries, type IndicatorToggles } from '../../types/chart';
import type { Candle } from '../../types/toss';
import type { RangeStats } from '../../hooks/useRangeStats';
import { formatPrice } from '../../utils/formatters';
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

/** 화면에 보이는 구간의 최고·최저 (줌·스크롤할 때마다 다시 잰다) */
export interface VisibleExtent {
  high: number;
  low: number;
  /** 고·저를 찍은 봉의 인덱스 — 마커를 그 자리에 찍고, 가장자리인지 판단한다 */
  highIndex: number;
  lowIndex: number;
  /** 지금 보이는 구간의 인덱스 범위 */
  start: number;
  end: number;
}

/**
 * 기준가 대비 현재가의 위치.
 *
 * 고점 대비는 음수(얼마나 빠졌나), 저점 대비는 양수(얼마나 올랐나)가 정상이다.
 * 부호를 그대로 색으로 옮기면 둘 다 같은 뜻처럼 보이므로, **역할로 색을 고정한다** —
 * 고점 줄은 빨강, 저점 줄은 초록. 신고가/신저가만 예외로 표시를 바꾼다.
 */
function Extreme({
  label,
  price,
  current,
  kind,
  currency,
}: {
  label: string;
  price: number;
  current: number | null;
  kind: 'high' | 'low';
  currency: 'KRW' | 'USD';
}) {
  const gap = current != null && price > 0 ? ((current - price) / price) * 100 : null;
  // 부동소수 비교라 0.05% 안쪽이면 같은 값으로 본다 (장중 갱신 중인 값이다).
  const atExtreme = gap != null && Math.abs(gap) < 0.05;

  return (
    <span className="text-text-secondary">
      {label}{' '}
      <span className="tabular-nums text-text-primary">{formatPrice(price, currency)}</span>{' '}
      <span className={`tabular-nums ${kind === 'high' ? 'text-bearish' : 'text-bullish'}`}>
        {gap == null
          ? '—'
          : atExtreme
            ? kind === 'high'
              ? '신고가'
              : '신저가'
            : `${gap > 0 ? '+' : ''}${gap.toFixed(1)}%`}
      </span>
    </span>
  );
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
  week52,
  visible,
  price,
  currency = 'USD',
}: {
  legend: HoverInfo | null;
  candles: Candle[];
  toggles?: IndicatorToggles;
  /** 52주 고저 — 없으면 그 자리만 빈다 */
  week52?: RangeStats | null;
  /** 지금 화면에 보이는 구간의 고저 (차트 마커와 같은 값) */
  visible?: VisibleExtent | null;
  /** 비교 기준이 되는 현재가 (실시간 값이 없으면 마지막 종가) */
  price?: number | null;
  /** 국내 종목은 원화로 적는다 — ₩274,500 처럼 소수점 없이 */
  currency?: 'KRW' | 'USD';
}) {
  const activeMa = MA_LINES.filter((ma) => toggles?.overlays[ma.key]);
  /*
   * 비교 기준은 **현재가**다 (크로스헤어가 짚은 봉이 아니다). 크로스헤어를 따라 바뀌면
   * "지금 고점에서 얼마나 빠져 있나" 라는 질문에 답하지 못한다.
   */
  const current = price ?? candles.at(-1)?.close ?? null;

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
            <Field label="시" value={formatPrice(legend.open, currency)} />
            <Field label="고" value={formatPrice(legend.high, currency)} />
            <Field label="저" value={formatPrice(legend.low, currency)} />
            <Field
              label="종"
              value={formatPrice(legend.close, currency)}
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

      {/*
        구간 고저는 차트에 마커로도 찍히지만 여기에도 남긴다 — 마커 글자는 고·저가
        화면 가장자리에 있으면 잘려서 붙이지 못한다. 이 줄은 언제나 읽을 수 있다.
      */}
      {(week52 || visible) && (
        <div className="flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-0.5">
          {week52 && (
            <>
              <Extreme label="52주↑" price={week52.high} current={current} kind="high" currency={currency} />
              <Extreme label="52주↓" price={week52.low} current={current} kind="low" currency={currency} />
            </>
          )}
          {week52 && visible && <span className="text-border">│</span>}
          {visible && (
            <>
              <Extreme label="구간↑" price={visible.high} current={current} kind="high" currency={currency} />
              <Extreme label="구간↓" price={visible.low} current={current} kind="low" currency={currency} />
            </>
          )}
        </div>
      )}

      {activeMa.length > 0 && (
        <div className="flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-0.5">
          {activeMa.map((ma) => {
            const value = legend?.ma?.[ma.label];
            return (
              <span key={ma.key} className="flex items-center gap-1" style={{ color: ma.color }}>
                {/* 선 색과 같은 점 — 이름만으로는 차트의 어느 선인지 바로 이어지지 않는다 */}
                <span aria-hidden>●</span>
                {ma.label}
                <span className="tabular-nums">
                  {value != null ? formatPrice(value, currency) : '—'}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
