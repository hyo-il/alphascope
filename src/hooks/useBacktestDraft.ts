import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_RULE, defaultStrategy } from '../types/autoTrading';
import { CONDITION_LABELS, MAX_CONDITIONS, type BacktestCondition, type BacktestInput, type BacktestYears, type ConditionLabel } from '../types/backtest';

/**
 * 백테스트 ①② 의 고른 값 (v2.38.0 → v2.39.0 조건 A·B·C) — **이 기기 localStorage `alphascope.backtestDraft`** 에 남겨 화면을 나갔다 와도 그대로.
 * 기기에 딸린 작업 중 값이라 서버에 두지 않는다. 옛 초안(조건 하나를 펼친 모양)은 조건 A 하나로 읽는다.
 */
const KEY = 'alphascope.backtestDraft';

export interface BacktestDraft {
  /** 고른 종목(순서 = 고른 순서) */
  symbols: string[];
  /** 「직접 추가한 종목」 묶음 — 목록 밖에서 검색해 넣은 것 */
  added: string[];
  years: BacktestYears;
  /** 조건 1~3개 — 이름은 늘 순서대로 A·B·C */
  conditions: BacktestCondition[];
  /** 지금 고치는 조건 카드 */
  active: ConditionLabel;
}

const base = defaultStrategy(0);
export const DEFAULT_CONDITION: BacktestCondition = {
  label: 'A',
  rule: { ...DEFAULT_RULE },
  hardStopLossPercent: base.hardStopLossPercent,
  trailingStopEnabled: base.trailingStopEnabled,
  trailingStopPercent: base.trailingStopPercent,
  takeProfitEnabled: base.takeProfitEnabled,
  takeProfitPercent: base.takeProfitPercent,
};
export const EMPTY_DRAFT: BacktestDraft = { symbols: [], added: [], years: 1, conditions: [DEFAULT_CONDITION], active: 'A' };

/** 이름을 순서대로 다시 붙인다(지운 뒤 B·C → A·B) */
export const relabel = (list: BacktestCondition[]): BacktestCondition[] => list.map((c, i) => ({ ...c, label: CONDITION_LABELS[i] }));

function readCondition(raw: Partial<BacktestCondition> | undefined, label: ConditionLabel): BacktestCondition {
  return { ...DEFAULT_CONDITION, ...(raw ?? {}), label, rule: { ...DEFAULT_RULE, ...(raw?.rule ?? {}) } };
}

function read(): BacktestDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as (Partial<BacktestDraft> & Partial<BacktestCondition>) | null;
    if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
    const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
    const conditions = Array.isArray(raw.conditions) && raw.conditions.length
      ? relabel(raw.conditions.slice(0, MAX_CONDITIONS).map((c, i) => readCondition(c, CONDITION_LABELS[i])))
      : [readCondition(raw, 'A')]; // 20차 초안 — 조건 하나를 펼친 모양
    const active = conditions.find((c) => c.label === raw.active)?.label ?? 'A';
    return {
      symbols: strs(raw.symbols),
      added: strs(raw.added),
      years: ([1, 2, 3] as const).find((y) => y === raw.years) ?? 1,
      conditions,
      active,
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function useBacktestDraft() {
  const [draft, setDraft] = useState<BacktestDraft>(read);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      /* 저장하지 못해도 화면은 동작한다 */
    }
  }, [draft]);

  const patch = useCallback((p: Partial<BacktestDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  /** 조건 하나 고치기 */
  const patchCondition = useCallback(
    (label: ConditionLabel, p: Partial<BacktestCondition>) =>
      setDraft((d) => ({ ...d, conditions: d.conditions.map((c) => (c.label === label ? { ...c, ...p, label } : c)) })),
    [],
  );
  /** [조건 추가] — 바로 앞(마지막) 조건을 복사해 새 카드로, 그 카드를 연다 */
  const addCondition = useCallback(
    () =>
      setDraft((d) => {
        if (d.conditions.length >= MAX_CONDITIONS) return d;
        const conditions = relabel([...d.conditions, { ...d.conditions[d.conditions.length - 1], rule: { ...d.conditions[d.conditions.length - 1].rule } }]);
        return { ...d, conditions, active: conditions[conditions.length - 1].label };
      }),
    [],
  );
  const removeCondition = useCallback(
    (label: ConditionLabel) =>
      setDraft((d) => {
        if (d.conditions.length <= 1) return d;
        const conditions = relabel(d.conditions.filter((c) => c.label !== label));
        return { ...d, conditions, active: 'A' };
      }),
    [],
  );
  const toggle = useCallback(
    (symbol: string) => setDraft((d) => ({ ...d, symbols: d.symbols.includes(symbol) ? d.symbols.filter((s) => s !== symbol) : [...d.symbols, symbol] })),
    [],
  );
  const addMany = useCallback((list: string[]) => setDraft((d) => ({ ...d, symbols: [...d.symbols, ...list.filter((s) => !d.symbols.includes(s))] })), []);
  const removeMany = useCallback((list: string[]) => setDraft((d) => ({ ...d, symbols: d.symbols.filter((s) => !list.includes(s)) })), []);

  return { draft, setDraft, patch, patchCondition, addCondition, removeCondition, toggle, addMany, removeMany };
}

/** 고른 값 → 서버 입력 */
export function draftInput(d: BacktestDraft): BacktestInput {
  return { symbols: d.symbols, years: d.years, conditions: d.conditions };
}
