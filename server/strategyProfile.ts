/**
 * 스윙 판정 기준 프로파일 저장소 (v2.7.0).
 *
 * ⚠️ **표준은 저장하지 않는다.** `STANDARD_SWING` 은 코드 상수이고, DB 에는 활성 프로파일과
 * 사용자가 고친 공격·수비 값만 둔다. 표준까지 저장하면 언젠가 저장된 값이 코드값을 덮어
 * "표준을 골랐는데 예전과 다른 결과" 가 나온다 — 회귀를 원천적으로 막기 위한 구조다.
 *
 * 저장 위치는 `app_settings` 테이블의 `strategyProfile` 키 하나다.
 * (`surge_settings` 에 얹지 않는다 — 이름이 급등 전용이라 다음 세션이 찾지 못한다.)
 */

import { getDb } from './db';
import {
  CUSTOM_PROFILES,
  PARAM_LIMITS,
  STANDARD_SWING,
  cloneSwingParams,
  type CustomProfileId,
  type ProfileId,
  type ProfileState,
  type SwingParams,
} from '../src/types/strategyProfile';

const KEY = 'strategyProfile';

interface StoredState {
  active: ProfileId;
  custom: Record<CustomProfileId, SwingParams>;
}

function defaults(): StoredState {
  return {
    active: 'standard',
    // 공격·수비의 출발점은 표준과 같다 — 근거 없는 숫자를 미리 넣지 않는다 (types 주석 참고).
    custom: {
      aggressive: cloneSwingParams(STANDARD_SWING),
      defensive: cloneSwingParams(STANDARD_SWING),
    },
  };
}

const isProfileId = (v: unknown): v is ProfileId =>
  v === 'standard' || v === 'aggressive' || v === 'defensive';

/** 저장값이 깨졌거나 일부만 있어도 표준으로 메운다 — 화면이 빈 값으로 판정하게 두지 않는다 */
function coerceParams(raw: unknown): SwingParams {
  const base = cloneSwingParams(STANDARD_SWING);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SwingParams>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    grades: {
      strong: num(r.grades?.strong, base.grades.strong),
      buy: num(r.grades?.buy, base.grades.buy),
      watch: num(r.grades?.watch, base.grades.watch),
      hold: num(r.grades?.hold, base.grades.hold),
    },
    rrDemoteBelow: num(r.rrDemoteBelow, base.rrDemoteBelow),
    rsiBand: {
      low: num(r.rsiBand?.low, base.rsiBand.low),
      high: num(r.rsiBand?.high, base.rsiBand.high),
    },
    risk: {
      lowVol: num(r.risk?.lowVol, base.risk.lowVol),
      midVol: num(r.risk?.midVol, base.risk.midVol),
      highVol: num(r.risk?.highVol, base.risk.highVol),
    },
  };
}

function read(): StoredState {
  try {
    const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as
      | { value: string }
      | undefined;
    if (!row) return defaults();
    const parsed = JSON.parse(row.value) as Partial<StoredState>;
    return {
      active: isProfileId(parsed.active) ? parsed.active : 'standard',
      custom: {
        aggressive: coerceParams(parsed.custom?.aggressive),
        defensive: coerceParams(parsed.custom?.defensive),
      },
    };
  } catch {
    // 손상된 값이면 표준으로 돌아간다 (판정이 멈추는 것보다 낫다).
    return defaults();
  }
}

function write(state: StoredState): void {
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(KEY, JSON.stringify(state));
}

/**
 * 값 검증 — 어긋난 항목을 **왜 틀렸는지와 함께** 돌려준다.
 * 조용히 조이지 않는다: 사용자가 정한 숫자가 말없이 바뀌면 화면과 판정이 달라진다
 * (자동매매 설정은 서버가 조이지만, 저기는 화면이 저장 응답을 그대로 되그린다).
 */
export function validateSwingParams(p: SwingParams): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  const { grade, rrDemoteBelow, rsi, risk } = PARAM_LIMITS;

  const inRange = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;

  for (const key of ['strong', 'buy', 'watch', 'hold'] as const) {
    const value = p.grades[key];
    if (!Number.isInteger(value) || !inRange(value, grade.min, grade.max)) {
      errors.push({ field: `grades.${key}`, message: `${grade.min}~${grade.max} 사이의 정수여야 합니다.` });
    }
  }
  if (!(p.grades.strong > p.grades.buy)) {
    errors.push({ field: 'grades.strong', message: 'STRONG 컷은 BUY 컷보다 커야 합니다.' });
  }
  if (!(p.grades.buy > p.grades.watch)) {
    errors.push({ field: 'grades.buy', message: 'BUY 컷은 WATCH 컷보다 커야 합니다.' });
  }
  if (!(p.grades.watch > p.grades.hold)) {
    errors.push({ field: 'grades.watch', message: 'WATCH 컷은 HOLD 컷보다 커야 합니다.' });
  }

  if (!inRange(p.rrDemoteBelow, rrDemoteBelow.min, rrDemoteBelow.max)) {
    errors.push({
      field: 'rrDemoteBelow',
      message: `${rrDemoteBelow.min}~${rrDemoteBelow.max} 사이여야 합니다. 손익비 1 미만은 잃을 금액이 더 큰 거래라 어떤 성향에서도 추천하지 않습니다.`,
    });
  }

  if (!inRange(p.rsiBand.low, rsi.min, rsi.max) || !inRange(p.rsiBand.high, rsi.min, rsi.max)) {
    errors.push({ field: 'rsiBand', message: `RSI 값은 ${rsi.min}~${rsi.max} 사이여야 합니다.` });
  }
  if (!(p.rsiBand.low < p.rsiBand.high)) {
    errors.push({ field: 'rsiBand.low', message: '아래값이 위값보다 작아야 합니다.' });
  }

  for (const key of ['lowVol', 'midVol', 'highVol'] as const) {
    if (!inRange(p.risk[key], risk.min, risk.max)) {
      errors.push({ field: `risk.${key}`, message: `${risk.min}~${risk.max}% 사이여야 합니다.` });
    }
  }
  // 변동성이 클수록 적게 잡는다 — 뒤집히면 위험한 종목에 더 크게 들어간다.
  if (!(p.risk.highVol <= p.risk.midVol && p.risk.midVol <= p.risk.lowVol)) {
    errors.push({
      field: 'risk.highVol',
      message: '고변동 ≤ 중변동 ≤ 저변동 이어야 합니다 (변동성이 클수록 작게).',
    });
  }

  return errors;
}

export function getProfileState(): ProfileState {
  const stored = read();
  return {
    active: stored.active,
    standard: cloneSwingParams(STANDARD_SWING),
    custom: stored.custom,
  };
}

/** 지금 판정에 쓸 기준 — 표준이면 **코드 상수**를 그대로 쓴다 */
export function getActiveSwingParams(): { id: ProfileId; params: SwingParams } {
  const stored = read();
  if (stored.active === 'standard') return { id: 'standard', params: cloneSwingParams(STANDARD_SWING) };
  return { id: stored.active, params: stored.custom[stored.active] };
}

export class ProfileValidationError extends Error {
  constructor(readonly fields: { field: string; message: string }[]) {
    super('기준 값이 올바르지 않습니다.');
    this.name = 'ProfileValidationError';
  }
}

export function saveProfileState(patch: {
  active?: unknown;
  custom?: Partial<Record<CustomProfileId, unknown>>;
}): ProfileState {
  const current = read();
  const next: StoredState = {
    active: isProfileId(patch.active) ? patch.active : current.active,
    custom: { ...current.custom },
  };

  const errors: { field: string; message: string }[] = [];
  for (const id of CUSTOM_PROFILES) {
    const incoming = patch.custom?.[id];
    if (incoming === undefined) continue;
    const params = coerceParams(incoming);
    const found = validateSwingParams(params);
    errors.push(...found.map((e) => ({ ...e, field: `${id}.${e.field}` })));
    next.custom[id] = params;
  }

  if (errors.length) throw new ProfileValidationError(errors);

  write(next);
  return { active: next.active, standard: cloneSwingParams(STANDARD_SWING), custom: next.custom };
}
