/**
 * 입출금을 뺀 평가액 곡선 — 모의 계좌 성적의 최대 낙폭(`server/paperPerformanceService.ts`)과 성과 그래프의 구간 수익률 · 낙폭
 * (`PerformanceChart.tsx`)이 **같은 함수**를 쓴다.
 *
 * 평가액(totalValue)을 그대로 이으면 입금한 날은 오르고 출금한 날은 떨어진 것처럼 보인다(손익이 아닌데).
 * 그래서 점마다 「앞 점 + 그 사이 입출금」 을 기준으로 오른 비율만 이어 붙인다(첫 점 = 첫 평가액).
 * 입출금이 하나도 없으면 평가액을 **그대로** 돌려준다(곱셈 반올림으로 옛 계좌 값이 달라지지 않게).
 */
export function flowNeutralValues(points: { totalValue: number; cashFlow?: number }[]): number[] {
  if (!points.some((p) => p.cashFlow)) return points.map((p) => p.totalValue);
  const out: number[] = [];
  points.forEach((p, i) => {
    if (i === 0) {
      out.push(p.totalValue);
      return;
    }
    const base = points[i - 1].totalValue + (p.cashFlow ?? 0);
    out.push(base > 0 ? out[i - 1] * (p.totalValue / base) : out[i - 1]);
  });
  return out;
}
