import type { Verdict } from '../types/buyJudge';

/**
 * 매수 판단 히스토리 날짜 하나의 순서 (v2.48.1 — 사용자 결정) — **날짜 줄 제목과 펼친 목록이 이 파일 하나를 쓴다.**
 * - 펼친 목록: 「사도 됨」 → 「손익비 부족」 → 「거름망에 걸림」(v2.50.0) → 「기준 미달」, 각각 총점 높은 순 → 같으면 티커 순.
 * - 날짜 줄 제목(「애플 외 4개」): 그날 「사도 됨」 이 있으면 그중 첫 종목(위 순서), 없으면 티커 순 첫 종목.
 * 서버(`buyJudge/judge.historyDays`)가 목록을 이 순서로 보내고, 화면은 제목을 `daySymbols` 로 만든다.
 */
const RANK: Record<Verdict, number> = { buy: 0, rr_block: 1, gate_block: 2, below: 3 };

const byTicker = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortDayRows<T extends { symbol: string; verdict: Verdict; score: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || b.score - a.score || byTicker(a.symbol, b.symbol));
}

/** 제목용 종목 목록(겹침 없이) — 맨 앞이 날짜 줄에 이름이 보이는 종목 */
export function daySymbols(rows: readonly { symbol: string; verdict: Verdict; score: number }[]): string[] {
  const sorted = sortDayRows(rows);
  const unique = [...new Set(sorted.map((r) => r.symbol))];
  if (sorted.some((r) => r.verdict === 'buy')) return unique;
  const first = [...unique].sort(byTicker)[0];
  return first == null ? [] : [first, ...unique.filter((s) => s !== first)];
}
