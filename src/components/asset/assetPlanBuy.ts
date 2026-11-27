/**
 * 이번 달 구매 살 종목 [매수 입력](v2.80.0) — 보유 줄 찾기 · 채울 값 · 막힘 안내(순수 · DOM 없음 — 화면 `AssetDashboard` · 시험이 함께 쓴다).
 * ⚠️ 금액을 콘솔 · 로컬 저장소에 남기지 않는다.
 */
import { formatAssetQty, formatAssetWon } from '../../utils/assetFormat';
import { TRADE_DIGITS, roundTo } from '../../utils/assetTrade';
import type { AssetCurrency, AssetHolding, AssetSection, AssetSheetData, MonthlyPlanRow } from '../../types/asset';

/** 막힘 안내(지금 용어 그대로) */
export const PLAN_BUY_TIP = {
  many: '이 계좌에 같은 종목이 두 줄 — 자산 현황에서 줄을 골라 입력',
  notTradable: '이 줄은 평균가 · 수량 칸 모양이 달라 입력할 수 없습니다',
  writeOff: '이 서버에서는 시트 쓰기가 꺼져 있습니다',
  stale: '시트가 바뀌었어요 — 다시 읽은 뒤 입력해 주세요',
} as const;

/**
 * [매수 입력] 이 열 보유 줄 찾기(v2.80.0 — 화면 한 곳) — 서버가 준 줄 번호(`holdingRow` — 그 계좌에 이 종목 줄이 하나일 때만)를
 * 자산 현황과 같은 시트 응답(`/api/asset/sheet`)에서 찾는다. 줄 번호 · 종목이 둘 다 맞아야 한다(사이에 시트가 바뀌었으면 막음).
 */
export function planBuyTarget(data: AssetSheetData, section: string, r: MonthlyPlanRow): { section: AssetSection; holding: AssetHolding } | { tip: string } {
  if (r.holdingProblem === 'many') return { tip: PLAN_BUY_TIP.many };
  if (r.holdingProblem === 'not-tradable') return { tip: PLAN_BUY_TIP.notTradable };
  const s = data.sections.find((x) => !x.combined && x.key === section);
  const h = s?.holdings.find((x) => x.row === r.holdingRow && x.symbol === r.symbol);
  if (!s || !h || r.holdingRow == null) return { tip: PLAN_BUY_TIP.stale };
  if (!h.tradable) return { tip: PLAN_BUY_TIP.notTradable };
  return { section: s, holding: h };
}

/** 채울 값 — 수량 = 살 주(0 · 「—」 면 빈칸) · 가격 = 지금 가격(그 종목 통화 · 입력 칸 자릿수) · 머리 아래 「이번 달 구매(○ 차례) — 계획 N주 · ₩…」 */
export function planBuyInitial(r: MonthlyPlanRow, currency: AssetCurrency, cycleText: string): { qty: string; price: string; note: string } {
  return {
    qty: r.shares != null && r.shares > 0 ? String(r.shares) : '',
    price: r.price != null && r.price > 0 ? String(roundTo(r.price, TRADE_DIGITS[currency].price)) : '',
    note: `이번 달 구매(${cycleText} 차례) — 계획 ${formatAssetQty(r.shares)} · ${formatAssetWon(r.amount)}`,
  };
}
