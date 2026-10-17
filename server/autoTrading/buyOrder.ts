/**
 * 같은 판단에서 「사도 됨」 이 여럿일 때 **사는 순서** (사용자 결정 A-1) — 한 곳.
 * 규칙 총점 높은 순 → 같으면 최근 60거래일 수익률 높은 순 → 같으면 티커 순. 일부만 고르는 것이 아니라 단순 정렬이다.
 * ⚠️ 판단(`judgeOnClose` · `evaluateRule`)은 바꾸지 않는다 — 판단을 모두 마친 뒤 사는 순서만 정한다.
 * 줄 세우기는 **같은 판단(같은 틱)에 들어온 종목끼리**다 — 종목마다 그 시장이 열린 뒤 첫 판단에서 보므로 보통 같은 시장끼리.
 */
import type { Candle } from '../../src/types/toss';

/** 수익률을 재는 거래일 수 */
export const RETURN_DAYS = 60;

/**
 * 최근 60거래일 수익률 — 판단에 쓴 같은 끝난 봉으로 `종가[i] / 종가[i-60] − 1`(i = 마지막 끝난 봉).
 * 봉이 61개보다 적거나 값이 이상하면 null(줄 세울 때 가장 낮은 순위).
 */
export function recentReturn(completed: readonly Candle[], days = RETURN_DAYS): number | null {
  const i = completed.length - 1;
  if (i - days < 0) return null;
  const now = completed[i].close;
  const then = completed[i - days].close;
  if (!(now > 0) || !(then > 0)) return null;
  return now / then - 1;
}

export interface BuyCandidate {
  symbol: string;
  score: number;
  /** `recentReturn` — null 이면 가장 낮은 순위 */
  ret60: number | null;
}

const byTicker = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function rankBuyCandidates<T extends BuyCandidate>(candidates: readonly T[]): T[] {
  const ret = (x: BuyCandidate) => x.ret60 ?? -Infinity;
  return [...candidates].sort((a, b) => b.score - a.score || (ret(b) === ret(a) ? 0 : ret(b) > ret(a) ? 1 : -1) || byTicker(a.symbol, b.symbol));
}
