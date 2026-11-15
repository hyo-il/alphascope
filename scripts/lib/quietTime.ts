/**
 * 시험 고정 시계가 고르는 「고요한 때」 — 순수 함수만(전역 `Date` 를 바꾸지 않는다 · `testclock:test` 가 직접 부른다).
 * 뜻과 까닭은 `fixedClock.ts` 머리 글.
 */

const H = 3_600_000;
const M = 60_000;

/** 고요한 때의 한국 시각(그날 0시부터 ms) */
export const QUIET_KST = { morningFrom: 6.5 * H, morningTo: 7.5 * H, evening: 20 * H + 15 * M } as const;

/** 실제 지금(ms) → 시험이 쓸 「지금」(ms). 같거나 뒤의 가장 가까운 고요한 때 */
export function fixedNow(real: number): number {
  const k = new Date(real + 9 * H);
  const midnight = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * H; // 그날 한국 0시
  const t = real - midnight;
  if (t < QUIET_KST.morningFrom) return midnight + QUIET_KST.morningFrom;
  if (t < QUIET_KST.morningTo) return real;
  if (t <= QUIET_KST.evening) return midnight + QUIET_KST.evening;
  return midnight + 24 * H + QUIET_KST.morningFrom;
}
