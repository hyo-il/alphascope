import { useEffect, useState, type RefObject } from 'react';
import { PHONE_CHART_MIN_PX, PHONE_CHART_RATIO, PHONE_CHIP_ROW_PX, PHONE_PRICE_ROW_PX } from '../ui/tokens';

/**
 * 폰 차트 높이 — **계산은 이 함수 하나**(v2.82.0 · 테마 5-2).
 * - 세로: (보이는 높이 − 위쪽 막대 − 가격 줄 − 칩 줄) × 0.55 · 최소 240(폰 402 × 874 에서 약 397).
 * - 가로(높이 < 500): 칩 줄은 가격 줄 오른쪽이라 빠지고, 차트 = **남는 높이**(본문 맨 위로 밀었을 때 차트 위쪽부터 보이는 화면 아래 끝까지 — 시황 띠 · 본문 위 여백도 뺀다).
 *   테마 식(보이는 높이 − 위쪽 막대 − 가격 줄)대로 두면 시황 띠 40 만큼 차트 아래가 화면 밖으로 나간다. 최소 240 은 같음.
 */
export function phoneChartHeight(o: { viewportH: number; topBarH: number; landscape: boolean; chartTopAtRest: number }): number {
  const h = o.landscape
    ? o.viewportH - o.chartTopAtRest
    : (o.viewportH - o.topBarH - PHONE_PRICE_ROW_PX - PHONE_CHIP_ROW_PX) * PHONE_CHART_RATIO;
  return Math.max(PHONE_CHART_MIN_PX, Math.round(h));
}

/**
 * 폰 차트 높이 훅 — 화면 크기 · 방향이 바뀌면(`resize` · `visualViewport`) 다시 센다.
 * `chartRef` = 차트 칸(가격 칸 줄) · 위쪽 막대는 `[data-testid="top-bar"]` 를 잰다(위 안전 여백 포함).
 */
export function usePhoneChartHeight(chartRef: RefObject<HTMLElement | null>, enabled: boolean, landscape: boolean): number {
  const [height, setHeight] = useState(PHONE_CHART_MIN_PX);
  useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const el = chartRef.current;
      const viewportH = window.innerHeight;
      const topBarH = document.querySelector('[data-testid="top-bar"]')?.getBoundingClientRect().height ?? 0;
      // 본문 맨 위로 밀었을 때의 차트 위쪽 = 지금 위쪽 + 그 위 스크롤 상자들이 민 만큼
      let chartTopAtRest = 0;
      if (el) {
        chartTopAtRest = el.getBoundingClientRect().top;
        for (let n = el.parentElement; n; n = n.parentElement) chartTopAtRest += n.scrollTop;
      }
      setHeight(phoneChartHeight({ viewportH, topBarH, landscape, chartTopAtRest }));
    };
    measure();
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [chartRef, enabled, landscape]);
  return height;
}
