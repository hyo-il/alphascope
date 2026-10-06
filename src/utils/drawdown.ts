/**
 * 최대 낙폭(MDD) — 모의 계좌 성적(`server/paperPerformanceService.ts`)과 백테스트(`server/autoTrading/ruleResearch.ts`)가 **같은 함수**를 쓴다
 * (v2.39.0 에 서버 파일에서 옮겼다 — 몸은 그대로, 두 벌 금지).
 * 자산 곡선에서 고점 대비 가장 크게 떨어진 비율(%, 0 이하). 값이 2개 미만이면 null.
 */
export function maxDrawdown(series: number[]): number | null {
  if (series.length < 2) return null;
  let peak = series[0];
  let worst = 0;
  for (const value of series) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  }
  return worst * 100;
}
