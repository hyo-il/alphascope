/**
 * 백테스트 입력 검사 (v2.38.0) — 서버 `POST /api/backtest/run`(400)과 화면(칸 아래 빨간 글자)이 **같은 함수**를 쓴다.
 * 범위는 계좌 설정과 같은 `RULE_LIMITS`, 이동평균은 엔진이 가진 `ENGINE_MA_PERIODS` 만(다른 값은 실제로 다른 일수로 계산되므로 받지 않는다).
 */
import { DEFAULT_RULE, ENGINE_MA_PERIODS, RULE_LIMITS, defaultStrategy, type RuleConfig } from '../types/autoTrading';
import { BACKTEST_YEARS, type BacktestInput } from '../types/backtest';

/** 토스 symbol 규칙 — 계좌 설정의 `cleanSymbols` 와 같다 */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

export type BacktestField =
  | 'symbols'
  | 'maShort'
  | 'maLong'
  | 'rsiBuyBelow'
  | 'rsiSellAbove'
  | 'useAny'
  | 'hardStopLossPercent'
  | 'trailingStopPercent'
  | 'years';

const inRange = (v: unknown, lim: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= lim.min && v <= lim.max;
const isMa = (v: unknown) => (ENGINE_MA_PERIODS as readonly number[]).includes(v as number);

/** 칸별 오류 문구(없으면 빈 객체) */
export function backtestInputErrors(input: Partial<BacktestInput> & { rule?: Partial<RuleConfig> }): Partial<Record<BacktestField, string>> {
  const e: Partial<Record<BacktestField, string>> = {};
  const r: Partial<RuleConfig> = input.rule ?? {};
  if (!Array.isArray(input.symbols) || input.symbols.length === 0) e.symbols = '종목을 하나 이상 골라 주세요.';
  else if (input.symbols.some((s) => typeof s !== 'string' || !SYMBOL_PATTERN.test(s))) e.symbols = '종목 코드가 올바르지 않습니다(영문·숫자만).';
  if (r.useMaCross) {
    if (!isMa(r.maShort)) e.maShort = `단기 이동평균은 ${ENGINE_MA_PERIODS.join('·')}일 중에서 고릅니다.`;
    if (!isMa(r.maLong)) e.maLong = `장기 이동평균은 ${ENGINE_MA_PERIODS.join('·')}일 중에서 고릅니다.`;
    if (isMa(r.maShort) && isMa(r.maLong) && (r.maShort as number) >= (r.maLong as number)) e.maLong = '장기는 단기보다 길어야 합니다.';
  }
  if (r.useRsi) {
    const b = RULE_LIMITS.rsiBuyBelow;
    const s = RULE_LIMITS.rsiSellAbove;
    if (!inRange(r.rsiBuyBelow, b)) e.rsiBuyBelow = `${b.min}~${b.max} 사이로 적어 주세요.`;
    if (!inRange(r.rsiSellAbove, s)) e.rsiSellAbove = `${s.min}~${s.max} 사이로 적어 주세요.`;
  }
  if (!r.useMaCross && !r.useRsi) e.useAny = '이동평균과 RSI 중 하나는 써야 사고팔 수 있습니다.';
  const st = RULE_LIMITS.hardStopLossPercent;
  if (!inRange(input.hardStopLossPercent, st)) e.hardStopLossPercent = `${st.min}~${st.max} 사이로 적어 주세요.`;
  const tr = RULE_LIMITS.trailingStopPercent;
  if (input.trailingStopEnabled && !inRange(input.trailingStopPercent, tr)) e.trailingStopPercent = `${tr.min}~${tr.max} 사이로 적어 주세요.`;
  if (!(BACKTEST_YEARS as number[]).includes(input.years as number)) e.years = '기간은 1·2·3년 중에서 고릅니다.';
  return e;
}

/**
 * 서버용 — 몸을 읽어 입력을 만들거나 첫 오류 문구를 돌려준다.
 * 끈 조건의 숫자(예: RSI 를 안 쓸 때의 기준)는 검사하지 않지만 판정에도 쓰이지 않는다. 트레일링을 끄면 % 는 저장값 그대로 둔다.
 */
export function parseBacktestInput(raw: unknown): { input: BacktestInput } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const rr = (b.rule ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const symbols = Array.isArray(b.symbols)
    ? [...new Set(b.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))]
    : [];
  const input: BacktestInput = {
    symbols,
    rule: {
      maShort: num(rr.maShort),
      maLong: num(rr.maLong),
      rsiBuyBelow: num(rr.rsiBuyBelow),
      rsiSellAbove: num(rr.rsiSellAbove),
      useMaCross: rr.useMaCross === true,
      useRsi: rr.useRsi === true,
    },
    hardStopLossPercent: num(b.hardStopLossPercent),
    trailingStopEnabled: b.trailingStopEnabled === true,
    trailingStopPercent: num(b.trailingStopPercent),
    years: num(b.years) as BacktestInput['years'],
  };
  const errors = backtestInputErrors(input);
  const first = Object.values(errors)[0];
  if (first) return { error: first };
  // 끈 조건의 칸이 비어 있으면 기본값으로 채운다(판정에는 쓰이지 않지만 기록·[다시 시험]에 NaN 이 남지 않게)
  const fill = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  input.rule.maShort = fill(input.rule.maShort, DEFAULT_RULE.maShort);
  input.rule.maLong = fill(input.rule.maLong, DEFAULT_RULE.maLong);
  input.rule.rsiBuyBelow = fill(input.rule.rsiBuyBelow, DEFAULT_RULE.rsiBuyBelow);
  input.rule.rsiSellAbove = fill(input.rule.rsiSellAbove, DEFAULT_RULE.rsiSellAbove);
  input.trailingStopPercent = fill(input.trailingStopPercent, defaultStrategy(0).trailingStopPercent);
  return { input };
}
