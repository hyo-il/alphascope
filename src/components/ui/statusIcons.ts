import { Circle, CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX, TriangleAlert } from 'lucide-react';

/**
 * 상태 아이콘 한 곳 (v2.36.0) — **색만으로 구분하지 않는다**: 상태마다 모양이 다른 아이콘을 쓰고 글자와 함께 둔다.
 * 예전 글자 기호 ●◐⚠○ · 🟢🔴⚪ · ✅⬜ 를 대신한다.
 */
/** 자동매매 네 상태 (`utils/autoTradeStatus.ts` 의 kind) */
export const AUTO_TRADE_ICON = {
  running: CircleDot, // 가동 중
  waiting: CircleDashed, // 대기(장 닫힘)
  blocked: TriangleAlert, // 멈춤(사람이 고쳐야 한다)
  off: Circle, // 꺼짐
} as const;

/** 진단 리포트 판정 배지 */
export const VERDICT_ICON = {
  good: CircleCheck, // 기준선보다 좋음
  bad: CircleX, // 기준선 이하
  hold: CircleMinus, // 판단 보류
} as const;

/** 단계 표시(복사 단계 등) — 끝남 / 아직 */
export const STEP_ICON = { done: CircleCheck, todo: Circle } as const;
