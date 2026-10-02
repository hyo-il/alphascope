/**
 * 초보자 목표 수익률 설정 (v2.29.0) — 서버 `server/swingGoal.ts` 와 화면이 함께 쓴다.
 *
 * ⚠️ **스윙 판정값을 바꾸지 않는다.** 이 값은 「목표 도달 가능성 분석」(Gemini)의 조건(목표·손절·기간)일 뿐이다.
 * 판정값(`types/strategyProfile.ts` — 등급 컷·RSI 구간·리스크 %·손익비 하한)에는 목표 수익률·보유 기간이 없고,
 * "지금 사면 N일 안에 X%" 선별은 검증을 통과하지 못했다(CLAUDE.md 연구 기록).
 */
export interface SwingGoal {
  targetPct: number;
  stopPct: number;
  /** 거래일 */
  days: number;
  /** true 면 손절 = 목표의 절반(서버가 저장할 때 계산) */
  stopAuto: boolean;
}

/** 기본값 — 목표 5%(예전 「목표 도달 분석」 탭의 기본값) · 손절 자동 · 1달 */
export const DEFAULT_SWING_GOAL: SwingGoal = { targetPct: 5, stopPct: 2.5, days: 21, stopAuto: true };

/** 1층 버튼 */
export const GOAL_TARGET_CHOICES = [3, 5, 10, 15, 20] as const;
/** 1·2·3달 = 21·42·63 거래일 (종목 지도의 1개월 21 · 3개월 63 과 같은 환산) */
export const GOAL_PERIOD_CHOICES = [
  { days: 21, label: '1달' },
  { days: 42, label: '2달' },
  { days: 63, label: '3달' },
] as const;

/** 자동 손절 = 목표의 절반, 소수 1자리, 최소 0.5 — 서버가 이 함수로 계산한다(화면은 미리보기에만 쓴다) */
export function autoStop(targetPct: number): number {
  return Math.max(0.5, Math.round((targetPct / 2) * 10) / 10);
}

/** `🎯 목표 +5% · 1달 · 손절 −2.5%` 의 기간 부분 */
export function periodLabel(days: number): string {
  return GOAL_PERIOD_CHOICES.find((p) => p.days === days)?.label ?? `${days}거래일`;
}

const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}`;
export const goalPct = (v: number) => `${fmt(v)}%`;

/** 같은 조건인가 — 카드에 결과를 붙일 때 (목표·손절·기간) 셋을 비교한다 */
export function sameCondition(a: { targetPct: number; stopPct: number; days: number }, b: { targetPct: number; stopPct: number; days: number }): boolean {
  return Math.abs(a.targetPct - b.targetPct) < 1e-9 && Math.abs(a.stopPct - b.stopPct) < 1e-9 && a.days === b.days;
}
