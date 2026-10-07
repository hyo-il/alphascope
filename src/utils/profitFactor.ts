/**
 * Profit Factor = 번 돈 ÷ 잃은 돈 — 백테스트(`server/autoTrading/ruleResearch.ts`, 거래 수익률 %)와
 * 모의 계좌 성적(`server/paperPerformanceService.ts`, 청산 거래 실현손익)이 **같은 함수**를 쓴다 (v2.41.0, 두 벌 금지).
 * (+ 값의 합) ÷ |(− 값의 합)|. 값이 없거나 손실이 없으면 null 과 이유.
 * ⚠️ 합하는 순서를 바꾸지 않는다 — 백테스트 결과가 바이트 단위로 같아야 한다.
 */
export type ProfitFactorNote = '손실 거래 없음' | '거래 없음' | '청산 거래 없음';

export function profitFactor(
  values: number[],
  emptyNote: '거래 없음' | '청산 거래 없음' = '거래 없음',
): { value: number | null; note: ProfitFactorNote | null } {
  const gain = values.filter((v) => v > 0).reduce((a, v) => a + v, 0);
  const loss = Math.abs(values.filter((v) => v < 0).reduce((a, v) => a + v, 0));
  return {
    value: values.length && loss > 0 ? gain / loss : null,
    note: !values.length ? emptyNote : loss === 0 ? '손실 거래 없음' : null,
  };
}
