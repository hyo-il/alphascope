/**
 * 초보자 목표 수익률 설정 저장 (v2.29.0) — `app_settings` 'swing.goal' 한 키, `GET|PUT /api/swing/goal`.
 *
 * - 분석 조건이라 기기가 달라도 같아야 해서 서버에 둔다(CLAUDE.md 「기기 간에 같아야 하는 것은 서버」).
 * - 검사 범위는 `TARGET_LIMITS`(가능성 분석과 같은 값 — 두 벌로 두지 않는다). 기간은 정수 거래일.
 * - 자동 손절(`stopAuto`)이면 손절 = 목표의 절반을 **저장할 때 여기서** 계산한다(화면·서버가 따로 계산하지 않게).
 * - ⚠️ 스윙 판정값과 무관하다 — 이 값은 「목표 도달 가능성 분석」의 조건일 뿐이다.
 */
import { getDb } from './db';
import { TARGET_LIMITS } from './gemini/targetAnalysis';
import { autoStop, DEFAULT_SWING_GOAL, type SwingGoal } from '../src/types/swingGoal';

const KEY = 'swing.goal';

export class SwingGoalError extends Error {}

export function getSwingGoal(): SwingGoal {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_SWING_GOAL;
  try {
    return { ...DEFAULT_SWING_GOAL, ...(JSON.parse(row.value) as Partial<SwingGoal>) };
  } catch {
    return DEFAULT_SWING_GOAL;
  }
}

export function saveSwingGoal(body: unknown): SwingGoal {
  const b = (body ?? {}) as Record<string, unknown>;
  const num = (key: 'targetPct' | 'stopPct' | 'days', label: string) => {
    const v = Number(b[key]);
    const [lo, hi] = TARGET_LIMITS[key];
    if (!Number.isFinite(v) || v < lo || v > hi) throw new SwingGoalError(`${label}은(는) ${lo}~${hi} 사이여야 합니다.`);
    return v;
  };
  const stopAuto = b.stopAuto !== false;
  const targetPct = num('targetPct', '목표 수익률(%)');
  const days = num('days', '기간(거래일)');
  if (!Number.isInteger(days)) throw new SwingGoalError('기간(거래일)은 정수여야 합니다.');
  const stopPct = stopAuto ? autoStop(targetPct) : num('stopPct', '손절(%)');
  if (stopAuto && stopPct > TARGET_LIMITS.stopPct[1]) throw new SwingGoalError(`자동 손절(${stopPct}%)이 ${TARGET_LIMITS.stopPct[1]}% 를 넘습니다.`);
  const goal: SwingGoal = { targetPct, stopPct, days, stopAuto };
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(KEY, JSON.stringify(goal));
  return goal;
}
