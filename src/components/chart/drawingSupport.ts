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
      if (logical === null) return timeScale.timeToCoordinate(time);
      // `logicalToCoordinate` 는 정수 자리만 받는다(소수면 0) — 정수 칸 x + 나머지 × 봉 간격
      const whole = Math.floor(logical);
      const x = timeScale.logicalToCoordinate(whole as never);
      return x === null ? null : x + (logical - whole) * timeScale.options().barSpacing;
    },
    coordinateToTime(x) {
      if (x < 0 || x > timeScale.width()) return null;
      // 논리 자리(소수) — `coordinateToLogical` 은 정수(올림)라 빈 곳 점이 반 칸 어긋난다. 봉 0 의 x 와 봉 간격으로 센다
      const origin = timeScale.logicalToCoordinate(0 as never);
      const time = origin === null ? null : current().logicalToTime((x - origin) / timeScale.options().barSpacing);
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

/** 안쪽을 눌러도 고르는 상자 모양 — 자 · 박스 · 피보나치(라이브러리 피보나치는 선 위만 맞는다) */
const BOX_TYPES = new Set(['date-price-range', 'rectangle', 'fib-retracement']);

type Point = { x: number; y: number };
type ManagedDrawing = DrawingLike & { id: string; options: { visible?: boolean } };
type ManagerLike = {
  hitTest(point: Point): ManagedDrawing | null;
  getAllDrawings(): ManagedDrawing[];
  getViewport(): Viewport | null;
};

/** 두 끝점의 화면 자리(뷰포트 = `withBarTime` 을 거친 것) */
function anchorPixels(drawing: DrawingLike, viewport: Viewport) {
  const [a, b] = drawing.anchors.map((anchor) => drawing.anchorToPixel(anchor, viewport));
  return a && b ? { a, b } : null;
}

/**
 * 드로잉 관리자의 누르기 판정 — 라이브러리 판정(선 · 테두리)에 **상자 모양 안쪽**을 더한다.
 * 앱의 누르기 · 오른쪽 클릭과 라이브러리의 차트 click 선택이 모두 `hitTest` 를 부르므로 여기 하나로 같아진다
 * (라이브러리만 바꾸면 안쪽을 누른 직후 차트 click 이 「못 맞힘」 으로 보고 선택을 풀었다).
 */
export function withShapeHit<T extends object>(manager: T): T {
  const m = manager as unknown as ManagerLike;
  const base = m.hitTest.bind(m);
  m.hitTest = (point) => {
    const hit = base(point);
    if (hit) return hit;
    const viewport = m.getViewport();
    if (!viewport) return null;
    for (const drawing of [...m.getAllDrawings()].reverse()) {
      if (drawing.options.visible === false || !BOX_TYPES.has(drawing.type)) continue;
      const p = anchorPixels(drawing, viewport);
      if (!p) continue;
      const inX = point.x >= Math.min(p.a.x, p.b.x) && point.x <= Math.max(p.a.x, p.b.x);
      const inY = point.y >= Math.min(p.a.y, p.b.y) && point.y <= Math.max(p.a.y, p.b.y);
      if (inX && inY) return drawing;
    }
    return null;
  };
  return manager;
}

/**
 * 고른 모양의 「삭제」 버튼 자리 — 모양 **위쪽 가장자리**(차트 칸 좌표). 수평선은 누른 x 의 선 위, 추세선은 높은 끝점,
 * 상자 모양은 위 테두리 가운데. 버튼은 이 점 바로 위에 놓는다(`CandleChart` 의 placeAboveShape).
 */
export function shapeTopOf(drawing: object, pointerX: number | null): Point | null {
  const d = drawing as DrawingLike;
  const viewport = d.getViewport();
  if (!viewport) return null;
  if (d.type === 'horizontal-line') {
    const y = (viewport as unknown as { priceScale: { priceToCoordinate(p: number): number | null } }).priceScale.priceToCoordinate(d.anchors[0]?.price ?? NaN);
    return y === null ? null : { x: pointerX ?? 0, y };
  }
  const p = anchorPixels(d, viewport);
  if (!p) return null;
  const top = Math.min(p.a.y, p.b.y);
  if (d.type === 'trend-line') return p.a.y <= p.b.y ? p.a : p.b;
  return { x: (p.a.x + p.b.x) / 2, y: top };
}
