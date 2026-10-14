/**
 * 백테스트 입력 검사 — 서버 `POST /api/backtest/run`(400)과 화면이 **같은 함수**를 쓴다.
 * v2.44.0: 방법 하나 = 매매 규칙 하나(`ruleId`). 방법은 1~3개(A·B·C), 방법이 2개 이상이면 종목은 20개까지.
 * 규칙이 실제로 있는지는 서버가 규칙 저장소에서 확인한다(여기는 모양만).
 */
import {
  BACKTEST_YEARS,
  CONDITION_LABELS,
  MAX_COMPARE_SYMBOLS,
  MAX_CONDITIONS,
  methodName,
  type BacktestConditionRequest,
  type BacktestRequest,
} from '../types/backtest';

/** 토스 symbol 규칙 — 계좌 설정의 `cleanSymbols` 와 같다 */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

/** 입력 전체의 첫 오류 문구(없으면 null) — 종목·기간·방법 수·방법마다 규칙 */
export function backtestInputError(input: Partial<Omit<BacktestRequest, 'conditions'>> & { conditions?: { label: string; ruleId: number | null }[] }): string | null {
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
    if (!(typeof c.ruleId === 'number' && Number.isInteger(c.ruleId) && c.ruleId > 0)) {
      return conditions.length > 1 ? `${methodName(c.label)}: 매매 규칙을 고르세요.` : '매매 규칙을 고르세요.';
    }
  }
  return null;
}

/** 서버용 — 몸을 읽어 요청을 만들거나 첫 오류 문구를 돌려준다. 방법 이름은 입력 순서대로 A·B·C 로 다시 붙인다 */
export function parseBacktestInput(raw: unknown): { input: BacktestRequest } | { error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  const symbols = Array.isArray(b.symbols) ? [...new Set(b.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean))] : [];
  const list = Array.isArray(b.conditions) ? (b.conditions as Record<string, unknown>[]) : [];
  const conditions: BacktestConditionRequest[] = list.map((c, i) => ({
    label: CONDITION_LABELS[i] ?? 'C',
    ruleId: typeof c?.ruleId === 'number' ? c.ruleId : Number.NaN,
  }));
  const input = { symbols, years: Number(b.years) as BacktestRequest['years'], conditions };
  const error = backtestInputError(input);
  return error ? { error } : { input };
}
