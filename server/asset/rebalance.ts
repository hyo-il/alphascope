/**
 * 비율 조정 계산(v2.63.0 · 자산 관리 4단계) — **순수 함수**(시험이 가짜 값으로 부른다).
 *
 * - 금액은 `computeAssetTotals`(summary.ts) 결과를 **그대로** 쓴다 — 새 합계 길을 만들지 않는다(총 자산 탭 원형 차트와 같은 숫자).
 * - 자산 표 기준 금액 = 현금 + 채권 + 금 + 주식. 「연금 포함」 이 켜졌을 때 연금으로 볼 계좌 금액은 이미 각 분류에 들어 있다.
 *   **미지정 · 퇴직 연금 · 가격 못 받은 종목은 빼고** 「계산에서 빠짐」 줄로 돌려준다(0원 · 0줄이면 줄 없음 — 사용자 결정 3 · 7).
 * - 주식 안 표 기준 = 주식 금액 · 코어 / 위성은 `totals.core` · `totals.satellite`(위성 = `asset.satelliteSymbols`).
 * - 상태: |목표 − 지금(%p)| ≤ 비율 조정 범위 → 「괜찮음」(경계값 포함) · 아니면 「조정 필요」. 목표 칸이 비었거나 기준이 0 이면 상태 없음.
 * - 시트 목표 칸 「투자」 = 화면 「주식」.
 * ⚠️ 금액 · 비율을 로그에 찍지 않는다.
 */
import { ASSET_GROUP_LABEL, type AssetRebalance, type AssetTargetRatio, type AssetTotals, type RebalanceExcluded, type RebalanceRow, type RebalanceTable } from '../../src/types/asset';

/** 부동소수 오차로 경계값(정확히 band)이 「조정 필요」 가 되지 않게 */
const EPS = 1e-9;

type RowInput = { key: RebalanceRow['key']; label: string; amount: number; target: number | null };

function table(base: number, inputs: RowInput[], band: number): RebalanceTable {
  const rows = inputs.map(({ key, label, amount, target }): RebalanceRow => {
    const nowPct = base > 0 ? (amount / base) * 100 : null;
    const targetAmount = target != null && base > 0 ? (base * target) / 100 : null;
    const diffPp = target != null && nowPct != null ? target - nowPct : null;
    return {
      key,
      label,
      targetPct: target,
      nowPct,
      targetAmount,
      nowAmount: amount,
      diffAmount: targetAmount != null ? Math.round(targetAmount - amount) : null,
      diffPp,
      status: diffPp == null ? null : Math.abs(diffPp) <= band + EPS ? 'ok' : 'adjust',
    };
  });
  const known = inputs.flatMap((r) => (r.target != null ? [r.target] : []));
  return {
    base,
    rows,
    targetSum: known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) * 10_000) / 10_000 : null,
    targetMissing: known.length < inputs.length,
  };
}

export function computeRebalance(totals: AssetTotals, target: AssetTargetRatio, band: number): AssetRebalance {
  const amount = (key: string) => totals.groups.find((g) => g.key === key)?.amount ?? 0;
  const cash = amount('cash');
  const bond = amount('bond');
  const gold = amount('gold');
  const stock = amount('stock');

  const assets = table(
    cash + bond + gold + stock,
    [
      { key: 'cash', label: ASSET_GROUP_LABEL.cash, amount: cash, target: target.cash },
      { key: 'bond', label: ASSET_GROUP_LABEL.bond, amount: bond, target: target.bond },
      { key: 'gold', label: ASSET_GROUP_LABEL.gold, amount: gold, target: target.gold },
      { key: 'stock', label: ASSET_GROUP_LABEL.stock, amount: stock, target: target.invest },
    ],
    band,
  );
  const stocks = table(
    stock,
    [
      { key: 'core', label: '코어', amount: totals.core, target: target.core },
      { key: 'satellite', label: '위성', amount: totals.satellite, target: target.satellite },
    ],
    band,
  );

  const excluded: RebalanceExcluded[] = [];
  const none = amount('none');
  const retirement = amount('retirement');
  if (none > 0) excluded.push({ key: 'none', label: ASSET_GROUP_LABEL.none, amount: none, count: null });
  if (retirement > 0) excluded.push({ key: 'retirement', label: ASSET_GROUP_LABEL.retirement, amount: retirement, count: null });
  if (totals.missing > 0) excluded.push({ key: 'missing', label: '가격 못 받은 종목', amount: null, count: totals.missing });

  return { band, assets, stocks, excluded };
}
