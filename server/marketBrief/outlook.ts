/**
 * 오늘 시황 — 「오늘 예상 방향」(v2.60.0, 사용자 결정 2026-10-30). AI 가 입력 숫자로 쓴 참고 예상을 판에 맞게 거른다.
 *
 * - 대상: 오전판 = 오늘 코스피 + 오늘 밤 미국(S&P500) · 오후판 = 오늘 밤 미국(`OUTLOOK_TARGETS`). 판에 맞지 않는 대상 · 같은 대상 두 번째는 뺀다.
 * - 방향 · 확신은 정해진 말(enum)만 — 다르면 그 줄을 뺀다(지어낸 값을 그대로 보이지 않는다). 근거는 1~3줄 · 뒤집힐 조건 1줄.
 * - 「보합」 = 전일 종가 대비 ±`FLAT_PCT`% 안 — 문장 검사(`directionCheck.ts`)와 같은 상수(A-11). 채점(`outlookScore.ts`)도 같은 값.
 * ⚠️ 참고 예상이다 — 매수 판단 · 자동매매 · 주문에 쓰지 않는다(모의투자 · 자동매매 모듈을 import 하지 않는다).
 */

import { FLAT_PCT } from './directionCheck';
import {
  OUTLOOK_CONFIDENCES,
  OUTLOOK_DIRECTIONS,
  OUTLOOK_TARGETS,
  type BriefEdition,
  type BriefOutlook,
  type OutlookConfidence,
  type OutlookDirection,
  type OutlookTarget,
} from '../../src/types/marketBrief';

export { FLAT_PCT };

/** 근거 줄 수 상한 */
export const OUTLOOK_REASONS_MAX = 3;

/** 응답 → 판에 맞는 예상만(대상 순서는 `OUTLOOK_TARGETS` 순서) */
export function normalizeOutlook(raw: unknown, edition: BriefEdition, krClosed = false): BriefOutlook[] {
  // 오늘 국내 휴장이면 오전판도 코스피 예상을 받지 않는다(프롬프트 `outlookTargets` 와 같은 규칙)
  const allowed = OUTLOOK_TARGETS[edition].filter((t) => !(krClosed && t === 'KOSPI'));
  const items = Array.isArray(raw) ? raw : [];
  const byTarget = new Map<OutlookTarget, BriefOutlook>();
  for (const r of items) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const target = String(o.target ?? '').trim().toUpperCase() as OutlookTarget;
    const direction = String(o.direction ?? '').trim() as OutlookDirection;
    const confidence = String(o.confidence ?? '').trim() as OutlookConfidence;
    if (!allowed.includes(target) || byTarget.has(target)) continue;
    if (!OUTLOOK_DIRECTIONS.includes(direction) || !OUTLOOK_CONFIDENCES.includes(confidence)) continue;
    const reasons = (Array.isArray(o.reasons) ? o.reasons : [])
      .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      .map((x) => x.trim())
      .slice(0, OUTLOOK_REASONS_MAX);
    byTarget.set(target, { target, direction, confidence, reasons, watch: String(o.watch ?? '').trim() });
  }
  return allowed.flatMap((t) => (byTarget.has(t) ? [byTarget.get(t)!] : []));
}

/** 등락률(%) → 방향 — |x| < FLAT_PCT 면 보합(±0.3% 미만 — 문장 검사와 같은 경계: 0.29 보합 · 0.30 은 상승/하락) */
export function directionOfPct(pct: number): OutlookDirection {
  if (Math.abs(pct) < FLAT_PCT) return '보합';
  return pct > 0 ? '상승' : '하락';
}
