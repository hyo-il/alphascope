import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_RULE, defaultStrategy, type RuleConfig } from '../types/autoTrading';
import type { BacktestInput, BacktestYears } from '../types/backtest';

/**
 * 백테스트 ①② 의 고른 값 (v2.38.0) — **이 기기 localStorage `alphascope.backtestDraft`** 에 남겨 화면을 나갔다 와도 그대로.
 * 기기에 딸린 작업 중 값이라 서버에 두지 않는다(CLAUDE.md 「기기 간에 같아야 하는 것은 서버」 — 이것은 아니다).
 */
const KEY = 'alphascope.backtestDraft';

export interface BacktestDraft {
  /** 고른 종목(순서 = 고른 순서) */
  symbols: string[];
  /** 「직접 추가한 종목」 묶음 — 목록 밖에서 검색해 넣은 것 */
  added: string[];
  rule: RuleConfig;
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  years: BacktestYears;
}

const base = defaultStrategy(0);
export const EMPTY_DRAFT: BacktestDraft = {
  symbols: [],
  added: [],
  rule: { ...DEFAULT_RULE },
  hardStopLossPercent: base.hardStopLossPercent,
  trailingStopEnabled: base.trailingStopEnabled,
  trailingStopPercent: base.trailingStopPercent,
  years: 1,
};

function read(): BacktestDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<BacktestDraft> | null;
    if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
    const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
    return {
      ...EMPTY_DRAFT,
      ...raw,
      symbols: strs(raw.symbols),
      added: strs(raw.added),
      rule: { ...EMPTY_DRAFT.rule, ...(raw.rule ?? {}) },
      years: ([1, 2, 3] as const).find((y) => y === raw.years) ?? 1,
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
  const toggle = useCallback(
    (symbol: string) => setDraft((d) => ({ ...d, symbols: d.symbols.includes(symbol) ? d.symbols.filter((s) => s !== symbol) : [...d.symbols, symbol] })),
    [],
  );
  const addMany = useCallback((list: string[]) => setDraft((d) => ({ ...d, symbols: [...d.symbols, ...list.filter((s) => !d.symbols.includes(s))] })), []);
  const removeMany = useCallback((list: string[]) => setDraft((d) => ({ ...d, symbols: d.symbols.filter((s) => !list.includes(s)) })), []);

  return { draft, setDraft, patch, toggle, addMany, removeMany };
}

/** 고른 값 → 서버 입력 */
export function draftInput(d: BacktestDraft): BacktestInput {
  return {
    symbols: d.symbols,
    rule: d.rule,
    hardStopLossPercent: d.hardStopLossPercent,
    trailingStopEnabled: d.trailingStopEnabled,
    trailingStopPercent: d.trailingStopPercent,
    years: d.years,
  };
}
