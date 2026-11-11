/**
 * 드로잉 보조 — 메인 차트(`CandleChart`)와 캡처 팝업(`CaptureChart`)이 같이 쓴다(133차).
 *
 * 드로잉 라이브러리(lightweight-charts-drawing 0.1.1)는 고치지 않고, 드로잉 · 관리자 객체마다 이 파일의 함수를 거쳐
 * ① 빈 곳(마지막 봉 오른쪽)의 점을 그 자리에 남기고 ② 자(Measure)의 정보 글을 앱 규칙(통화 · 「n봉 · n일」)으로 그린다.
 */
import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';
import type { Anchor } from 'lightweight-charts-drawing';
import { formatSigned, formatSignedMoney } from '../../utils/formatters';
import { COLORS, FONT_FAMILY, keepOutOfAutoscale } from './chartTheme';
import { barTimeAxis, type BarTimeAxis } from './barTimeAxis';

export type ChartCurrency = 'KRW' | 'USD';

/** 차트 하나의 시간 ↔ 화면 x — 봉 시간축을 쓰므로 빈 곳에서도 null 이 아니다(차트 칸 밖 x 는 null) */
export interface ChartTimeCoords {
  timeToCoordinate(time: Time): number | null;
  coordinateToTime(x: number): Time | null;
  /** 두 시간 사이 봉 수(빈 곳은 봉 간격으로 센 칸 수) */
  barsBetween(a: Time, b: Time): number;
}

export function chartTimeCoords(chart: IChartApi, series: ISeriesApi<SeriesType>): ChartTimeCoords {
  // 봉 시간 목록은 데이터가 바뀔 때만 다시 만든다(그릴 때마다 부르므로)
  let axis: BarTimeAxis | null = null;
  series.subscribeDataChanged(() => {
    axis = null;
  });
  const current = () => (axis ??= barTimeAxis(series.data().map((d) => d.time as number)));
  const timeScale = chart.timeScale();
  return {
    timeToCoordinate(time) {
      const logical = typeof time === 'number' ? current().timeToLogical(time) : null;
      return logical === null ? timeScale.timeToCoordinate(time) : timeScale.logicalToCoordinate(logical as never);
    },
    coordinateToTime(x) {
      if (x < 0 || x > timeScale.width()) return null;
      const logical = timeScale.coordinateToLogical(x);
      const time = logical === null ? null : current().logicalToTime(logical);
      return time === null ? timeScale.coordinateToTime(x) : (time as Time);
    },
    barsBetween(a, b) {
      if (typeof a !== 'number' || typeof b !== 'number') return 0;
      const la = current().timeToLogical(a);
      const lb = current().timeToLogical(b);
      return la === null || lb === null ? 0 : Math.round(Math.abs(lb - la));
    },
  };
}

/** 자 정보 — 그리는 중(미리보기 상자) · 그린 뒤(차트 위 글)가 같은 함수. 가격 차는 그 종목 통화 규칙(원화 ₩ 소수 없음 · 달러 $ 소수 둘째) */
export function measureLines(start: Anchor, end: Anchor, coords: ChartTimeCoords, currency: ChartCurrency) {
  const diff = end.price - start.price;
  const percent = start.price ? (diff / start.price) * 100 : 0;
  const days =
    typeof start.time === 'number' && typeof end.time === 'number' ? Math.round(Math.abs(end.time - start.time) / 86_400) : 0;
  return {
    isUp: diff >= 0,
    money: formatSignedMoney(diff, currency),
    percent: formatSigned(percent, 2, '%'),
    span: `${coords.barsBetween(start.time, end.time)}봉 · ${days}일`,
  };
}

/** 자 정보 글을 띄우는 거리(끝점 · 커서에서) */
export const MEASURE_INFO_GAP = 12;

type Viewport = { timeScale: { timeToCoordinate(t: Time): number | null; coordinateToTime(x: number): Time | null } } & Record<string, unknown>;
type DrawingLike = {
  type: string;
  anchors: Anchor[];
  getViewport(): Viewport | null;
  anchorToPixel(anchor: Anchor, viewport: Viewport): { x: number; y: number } | null;
  paneViews(): unknown[];
  setMeasureOptions?(options: Record<string, boolean>): void;
};

/**
 * 드로잉 · 드로잉 관리자의 시간 ↔ 화면 x 를 봉 시간축으로 바꾼다 — 라이브러리의 그리기 · 누르기 판정 · 끝점 끌기가 모두
 * `getViewport().timeScale` 을 거치므로 여기 하나로 빈 곳의 점이 그 자리에 그려지고 · 눌리고 · 끌린다.
 */
export function withBarTime<T extends object>(target: T, coords: ChartTimeCoords): T {
  const t = target as unknown as { getViewport(): Viewport | null };
  const base = t.getViewport.bind(t);
  t.getViewport = () => {
    const viewport = base();
    return viewport && {
      ...viewport,
      timeScale: { ...viewport.timeScale, timeToCoordinate: coords.timeToCoordinate, coordinateToTime: coords.coordinateToTime },
    };
  };
  return target;
}

/** 자 위에 앱이 그리는 정보 글 — 끝점(놓은 자리) 오른쪽, 모자라면 왼쪽 */
function measureLabelView(drawing: DrawingLike, coords: ChartTimeCoords, currency: () => ChartCurrency) {
  const renderer = {
    draw(target: { useMediaCoordinateSpace(fn: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void): void }) {
      target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
        const [start, end] = drawing.anchors;
        const viewport = drawing.getViewport();
        const at = start && end && viewport ? drawing.anchorToPixel(end, viewport) : null;
        if (!at) return;
        const info = measureLines(start, end, coords, currency());
        const lines = [info.money, info.percent, info.span];
        const color = info.isUp ? COLORS.bullish : COLORS.bearish;
        ctx.save();
        ctx.font = `600 12px ${FONT_FAMILY}`;
        const pad = 6;
        const lineH = 16;
        const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + pad * 2;
        const h = lines.length * lineH + pad * 2 - 4;
        let x = at.x + MEASURE_INFO_GAP;
        if (x + w > mediaSize.width - 4) x = at.x - MEASURE_INFO_GAP - w;
        x = Math.max(4, x);
        const y = Math.max(4, Math.min(at.y - h / 2, mediaSize.height - h - 4));
        ctx.fillStyle = COLORS.tooltipBg;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 0.5, y + 0.5, w, h, 4);
        ctx.fill();
        ctx.stroke();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        lines.forEach((line, i) => {
          ctx.fillStyle = i === 2 ? COLORS.label : color;
          ctx.fillText(line, x + pad, y + pad - 2 + lineH * (i + 0.5));
        });
        ctx.restore();
      });
    },
  };
  return { zOrder: () => 'top' as const, renderer: () => renderer };
}

/**
 * 차트에 넣는 드로잉마다 거친다 — 메인 차트 · 캡처 팝업 같은 모양.
 * ① 가격 축 자동 맞춤에서 뺀다(`keepOutOfAutoscale`) ② 자는 라이브러리 기본 글(영어 「bars · days」 · 「$」)을 끄고 앱이 그린다
 * ③ 빈 곳(마지막 봉 오른쪽)의 점을 그 자리에(`withBarTime`). 드로잉 관리자도 `withBarTime` 을 거친다(누르기 판정 · 끝점 끌기).
 */
export function prepareDrawing<T extends object>(drawing: T, coords: ChartTimeCoords, currency: () => ChartCurrency): T {
  const d = drawing as unknown as DrawingLike;
  if (d.type === 'date-price-range') {
    d.setMeasureOptions?.({ showPrices: false, showPercentage: false, showBars: false, showDays: false });
    const views = d.paneViews.bind(d);
    const label = measureLabelView(d, coords, currency);
    d.paneViews = () => [...views(), label];
  }
  return keepOutOfAutoscale(withBarTime(drawing, coords));
}
