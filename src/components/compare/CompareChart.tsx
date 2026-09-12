import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  BASE_CHART_OPTIONS,
  CANDLE_SERIES_OPTIONS,
  COLORS,
  PRICE_SCALE_MARGINS,
  VOLUME_SCALE_MARGINS,
  toChartTime,
} from '../chart/chartTheme';
import { InlineSpinner } from '../common/LoadingOverlay';
import { COMPARE_TIMEFRAMES, type CompareTimeframe } from '../../types/compare';
import { MA_LINES } from '../../types/chart';
import type { Candle } from '../../types/toss';
import { changeColor, formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 비교 화면 전용 경량 캔들 차트.
 *
 * 메인 `CandleChart.tsx` 를 쓰지 않는다 — 드로잉 매니저·지표 패널·실시간 폴링·캡처가
 * 전부 붙어 있어서, 네 개를 동시에 띄우면 그 무게가 그대로 네 배가 된다.
 * 여기는 캔들 + 거래량 + MA(5·20·60) 만 그리고, 화면을 나가면 언마운트한다.
 */

/** 이동평균은 비교용이라 프런트에서 낸다 — 지표 엔진(5001)을 네 번 부르지 않는다. */
function maPoints(candles: Candle[], period: number) {
  const points: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      points.push({ time: toChartTime(candles[i].timestamp), value: sum / period });
    }
  }

  return points;
}

/** 비교 차트에 그리는 이동평균 — 메인 차트와 같은 색을 쓴다 */
const COMPARE_MAS = MA_LINES.filter((ma) => ma.key !== 'ma120');
const PERIODS: Record<string, number> = { ma5: 5, ma20: 20, ma60: 60 };

interface Props {
  symbol: string;
  name?: string | null;
  candles: Candle[];
  loading: boolean;
  error: string | null;
  timeframe: CompareTimeframe;
  onTimeframeChange: (timeframe: CompareTimeframe) => void;
  onRemove: () => void;
  /** 표기 통화 — 국내 종목을 $ 로 적지 않는다 */
  currency: 'KRW' | 'USD';
}

export default function CompareChart({
  symbol,
  name,
  candles,
  loading,
  error,
  timeframe,
  onTimeframeChange,
  onRemove,
  currency,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);

  // 차트 생성 (한 번만)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, barSpacing: 5, rightOffset: 2 },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);
    candleSeries.priceScale().applyOptions({ scaleMargins: PRICE_SCALE_MARGINS });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    volumeSeries.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS });

    maSeriesRef.current = COMPARE_MAS.map((ma) =>
      chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        pointMarkersVisible: false,
      }),
    );

    // 가격 6 : 거래량 1.6 — 메인 차트와 같은 비율이라 나란히 둬도 낯설지 않다.
    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(1.6);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = [];
    };
  }, []);

  // 데이터 갱신
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: toChartTime(c.timestamp),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: toChartTime(c.timestamp),
        value: c.volume,
        color: c.close >= c.open ? `${COLORS.bullish}66` : `${COLORS.bearish}66`,
      })),
    );
    maSeriesRef.current.forEach((series, index) => {
      series.setData(maPoints(candles, PERIODS[COMPARE_MAS[index].key] ?? 20));
    });

    if (candles.length) chart.timeScale().fitContent();
  }, [candles]);

  const last = candles.at(-1);
  const previous = candles.at(-2);
  const changeRate =
    last && previous?.close ? ((last.close - previous.close) / previous.close) * 100 : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-md border border-border bg-bg-secondary">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        {/* 이름이 먼저, 티커가 괄호로 뒤에 — 티커만 단독으로 적지 않는다 */}
        <span className="truncate text-sm font-semibold">
          {name ? `${name} (${symbol})` : symbol}
        </span>

        {last && (
          <span className="shrink-0 text-xs tabular-nums">{formatPrice(last.close, currency)}</span>
        )}
        {changeRate != null && (
          <span className={`shrink-0 text-[11px] tabular-nums ${changeColor(changeRate)}`}>
            {formatPercent(changeRate)}
          </span>
        )}

        <select
          value={timeframe}
          onChange={(e) => onTimeframeChange(e.target.value as CompareTimeframe)}
          className="ml-auto shrink-0 rounded border border-border px-1 py-0.5 text-[11px]"
        >
          {COMPARE_TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRemove}
          title="비교에서 빼기"
          className="shrink-0 text-xs leading-none text-text-muted transition-colors hover:text-bearish"
        >
          ✕
        </button>
      </div>

      {/* MA 범례 — 색만 봐도 어느 선인지 알 수 있게 (메인 차트와 같은 색) */}
      <div className="flex shrink-0 gap-2 px-2 pt-1 text-[10px]">
        {COMPARE_MAS.map((ma) => (
          <span key={ma.key} style={{ color: ma.color }}>
            {ma.label}
          </span>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/70 text-xs text-text-secondary">
            <InlineSpinner /> <span className="ml-1.5">{symbol} 불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-bearish">
            {error}
          </div>
        )}
        {!loading && !error && !candles.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-text-muted">
            캔들 데이터가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
