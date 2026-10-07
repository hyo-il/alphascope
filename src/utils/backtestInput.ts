/**
 * 백테스트 입력 검사 (v2.38.0 → v2.39.0 조건 비교) — 서버 `POST /api/backtest/run`(400)과 화면(칸 아래 빨간 글자)이 **같은 함수**를 쓴다.
 * 범위는 계좌 설정과 같은 `RULE_LIMITS`, 이동평균은 엔진이 가진 `ENGINE_MA_PERIODS` 만(다른 값은 실제로 다른 일수로 계산되므로 받지 않는다).
 * 조건은 1~3개(A·B·C), 조건이 2개 이상이면 종목은 20개까지. 옛 몸·옛 기록(조건 하나를 펼친 모양)은 조건 A 하나로 읽는다.
 */
import { DEFAULT_RULE, ENGINE_MA_PERIODS, RULE_LIMITS, defaultStrategy, type RuleConfig } from '../types/autoTrading';
import {
  BACKTEST_YEARS,
  CONDITION_LABELS,
  MAX_COMPARE_SYMBOLS,
  MAX_CONDITIONS,
  methodName,
  type BacktestCondition,
  type BacktestInput,
} from '../types/backtest';

/** 토스 symbol 규칙 — 계좌 설정의 `cleanSymbols` 와 같다 */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

export type ConditionField =
  | 'maShort'
  | 'maLong'
  | 'rsiBuyBelow'
  | 'rsiSellAbove'
  | 'useAny'
  | 'hardStopLossPercent'
  | 'trailingStopPercent'
  | 'takeProfitPercent';

const inRange = (v: unknown, lim: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= lim.min && v <= lim.max;
const isMa = (v: unknown) => (ENGINE_MA_PERIODS as readonly number[]).includes(v as number);

/**
 * 이동평균 일수 검사 — 백테스트 입력과 자동매매 설정 저장(v2.41.0)이 **같은 함수**를 쓴다.
 * 엔진은 5·20·60·120일만 계산한다(그 밖의 값은 가까운 값으로 바뀌어 계산된다 — `pickMa`).
 */
export function maPeriodErrors(r: Partial<Pick<RuleConfig, 'maShort' | 'maLong'>>): { maShort?: string; maLong?: string } {
  const e: { maShort?: string; maLong?: string } = {};
  if (!isMa(r.maShort)) e.maShort = `단기 이동평균은 ${ENGINE_MA_PERIODS.join('·')}일 중에서 고릅니다.`;
  if (!isMa(r.maLong)) e.maLong = `장기 이동평균은 ${ENGINE_MA_PERIODS.join('·')}일 중에서 고릅니다.`;
  if (isMa(r.maShort) && isMa(r.maLong) && (r.maShort as number) >= (r.maLong as number)) e.maLong = '장기는 단기보다 길어야 합니다.';
  return e;
}

/** 조건 하나의 칸별 오류 문구(없으면 빈 객체) */
export function conditionErrors(c: Partial<BacktestCondition> & { rule?: Partial<RuleConfig> }): Partial<Record<ConditionField, string>> {
  const e: Partial<Record<ConditionField, string>> = {};
  const r: Partial<RuleConfig> = c.rule ?? {};
  if (r.useMaCross) Object.assign(e, maPeriodErrors(r));
  if (r.useRsi) {
    const b = RULE_LIMITS.rsiBuyBelow;
    const s = RULE_LIMITS.rsiSellAbove;
    if (!inRange(r.rsiBuyBelow, b)) e.rsiBuyBelow = `${b.min}~${b.max} 사이로 적어 주세요.`;
    if (!inRange(r.rsiSellAbove, s)) e.rsiSellAbove = `${s.min}~${s.max} 사이로 적어 주세요.`;
  }
  if (!r.useMaCross && !r.useRsi) e.useAny = '이동평균과 RSI 중 하나는 써야 매수·매도할 수 있습니다.';
  const st = RULE_LIMITS.hardStopLossPercent;
  if (!inRange(c.hardStopLossPercent, st)) e.hardStopLossPercent = `${st.min}~${st.max} 사이로 적어 주세요.`;
  const tr = RULE_LIMITS.trailingStopPercent;
  if (c.trailingStopEnabled && !inRange(c.trailingStopPercent, tr)) e.trailingStopPercent = `${tr.min}~${tr.max} 사이로 적어 주세요.`;
  const tp = RULE_LIMITS.takeProfitPercent;
  if (c.takeProfitEnabled && !inRange(c.takeProfitPercent, tp)) e.takeProfitPercent = `${tp.min}~${tp.max} 사이로 적어 주세요.`;
  return e;
}

/** 입력 전체의 첫 오류 문구(없으면 null) — 종목·기간·조건 수·조건별 칸 */
export function backtestInputError(input: Partial<BacktestInput>): string | null {
  const symbols = input.symbols;
  const conditions = input.conditions ?? [];
  if (!Array.isArray(symbols) || symbols.length === 0) return '종목을 하나 이상 골라 주세요.';
  if (symbols.some((s) => typeof s !== 'string' || !SYMBOL_PATTERN.test(s))) return '티커가 올바르지 않습니다(영문·숫자만).';
  if (!(BACKTEST_YEARS as number[]).includes(input.years as number)) return '기간은 1·2·3년 중에서 고릅니다.';
  if (conditions.length < 1 || conditions.length > MAX_CONDITIONS) return `방법은 1~${MAX_CONDITIONS}개입니다.`;
  if (conditions.length >= 2 && symbols.length > MAX_COMPARE_SYMBOLS) {
    return `방법을 비교할 때는 종목을 ${MAX_COMPARE_SYMBOLS}개까지 고를 수 있습니다 — 지금 ${symbols.length}개`;
  }
  for (const c of conditions) {
    const first = Object.values(conditionErrors(c))[0];
    if (first) return conditions.length > 1 ? `${methodName(c.label)}: ${first}` : first;
  }
  return null;
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const fill = (v: number, d: number) => (Number.isFinite(v) ? v : d);

/** 몸 하나(새 조건 또는 옛 펼친 모양)를 조건으로 — 검사 전이라 숫자가 NaN 일 수 있다 */
function readCondition(raw: Record<string, unknown>, label: BacktestCondition['label']): BacktestCondition {
  const rr = (raw.rule ?? {}) as Record<string, unknown>;
  return {
    label,
    rule: {
      maShort: num(rr.maShort),
      maLong: num(rr.maLong),
      rsiBuyBelow: num(rr.rsiBuyBelow),
      rsiSellAbove: num(rr.rsiSellAbove),
      useMaCross: rr.useMaCross === true,
      useRsi: rr.useRsi === true,
    },
    hardStopLossPercent: num(raw.hardStopLossPercent),
    trailingStopEnabled: raw.trailingStopEnabled === true,
    trailingStopPercent: num(raw.trailingStopPercent),
    takeProfitEnabled: raw.takeProfitEnabled === true,
    // 옛 몸에는 없다 — 꺼짐으로 읽고 % 는 기본값
    takeProfitPercent: raw.takeProfitPercent === undefined ? defaultStrategy(0).takeProfitPercent : num(raw.takeProfitPercent),
  };
}

/** 끈 조건의 칸이 비어 있으면 기본값으로 채운다(판정에는 쓰이지 않지만 기록·[다시 시험]에 NaN 이 남지 않게) */
function fillUnused(c: BacktestCondition): BacktestCondition {
  const d = defaultStrategy(0);
  return {
    ...c,
    rule: {
      ...c.rule,
      maShort: fill(c.rule.maShort, DEFAULT_RULE.maShort),
      maLong: fill(c.rule.maLong, DEFAULT_RULE.maLong),
      rsiBuyBelow: fill(c.rule.rsiBuyBelow, DEFAULT_RULE.rsiBuyBelow),
      rsiSellAbove: fill(c.rule.rsiSellAbove, DEFAULT_RULE.rsiSellAbove),
    },
    trailingStopPercent: fill(c.trailingStopPercent, d.trailingStopPercent),
    takeProfitPercent: fill(c.takeProfitPercent, d.takeProfitPercent),
  };
}

/**
 * 몸 → 입력 (검사 없이 모양만) — `conditions` 배열이 없으면 옛 몸(조건 하나를 펼친 모양, v2.38.0)으로 보고 조건 A 하나로 읽는다.
 * 저장된 옛 기록의 `input` 도 이 함수로 읽는다.
 */
export function normalizeBacktestInput(raw: unknown): BacktestInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const symbols = Array.isArray(b.symbols) ? [...new Set(b.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : [];
  const list = Array.isArray(b.conditions)
    ? (b.conditions as Record<string, unknown>[]).map((c, i) => readCondition(c ?? {}, CONDITION_LABELS[i] ?? 'C'))
    : [readCondition(b, 'A')];
  return { symbols, years: num(b.years) as BacktestInput['years'], conditions: list };
}

/** 서버용 — 몸을 읽어 입력을 만들거나 첫 오류 문구를 돌려준다. 조건 이름은 입력 순서대로 A·B·C 로 다시 붙인다 */
export function parseBacktestInput(raw: unknown): { input: BacktestInput } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(b.conditions) && (b.conditions.length < 1 || b.conditions.length > MAX_CONDITIONS)) {
    return { error: `방법은 1~${MAX_CONDITIONS}개입니다.` };
  }
  const input = normalizeBacktestInput(raw);
  const error = backtestInputError(input);
  if (error) return { error };
  return { input: { ...input, conditions: input.conditions.map(fillUnused) } };
}
