import { useCallback, useEffect, useState } from 'react';
import { CONDITION_LABELS, MAX_CONDITIONS, type BacktestRequest, type BacktestYears, type ConditionLabel } from '../types/backtest';

/**
 * 백테스트 ①②③ 의 고른 값 — **이 기기 localStorage `alphascope.backtestDraft`** 에 남겨 화면을 나갔다 와도 그대로.
 * v2.44.0: 방법 = 매매 규칙 하나(`ruleId`). 예전 초안(규칙 숫자를 펼친 모양)의 방법은 읽지 않고 빈 방법 하나로 시작한다(종목·기간은 남긴다).
 */
const KEY = 'alphascope.backtestDraft';

export interface DraftMethod {
  label: ConditionLabel;
  ruleId: number | null;
}

export interface BacktestDraft {
  /** 고른 종목(순서 = 고른 순서) */
  symbols: string[];
  /** 「직접 추가한 종목」 묶음 — 목록 밖에서 검색해 넣은 것 */
  added: string[];
  years: BacktestYears;
  /** 방법 1~3개 — 이름은 늘 순서대로 A·B·C */
  conditions: DraftMethod[];
}

export const EMPTY_DRAFT: BacktestDraft = { symbols: [], added: [], years: 1, conditions: [{ label: 'A', ruleId: null }] };

/** 이름을 순서대로 다시 붙인다(지운 뒤 B·C → A·B) */
export const relabel = (list: DraftMethod[]): DraftMethod[] => list.map((c, i) => ({ ...c, label: CONDITION_LABELS[i] }));

function read(): BacktestDraft {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<BacktestDraft> | null;
    if (!raw || typeof raw !== 'object') return EMPTY_DRAFT;
    const strs = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
    const methods = Array.isArray(raw.conditions)
      ? relabel(
          raw.conditions
            .slice(0, MAX_CONDITIONS)
            .map((c) => ({ label: 'A' as ConditionLabel, ruleId: typeof (c as { ruleId?: unknown })?.ruleId === 'number' ? (c as { ruleId: number }).ruleId : null })),
        )
      : [];
    return {
      symbols: strs(raw.symbols),
      added: strs(raw.added),
      years: ([1, 2, 3] as const).find((y) => y === raw.years) ?? 1,
      conditions: methods.length ? methods : EMPTY_DRAFT.conditions,
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
  /** 방법 하나의 규칙 고르기 */
  const setMethodRule = useCallback(
    (label: ConditionLabel, ruleId: number | null) => setDraft((d) => ({ ...d, conditions: d.conditions.map((c) => (c.label === label ? { ...c, ruleId } : c)) })),
    [],
  );
  /** [비교할 방법 추가] — 빈 방법 하나를 더한다 */
  const addMethod = useCallback(
    () =>
      setDraft((d) => (d.conditions.length >= MAX_CONDITIONS ? d : { ...d, conditions: relabel([...d.conditions, { label: 'A', ruleId: null }]) })),
    [],
  );
  const removeMethod = useCallback(
    (label: ConditionLabel) =>
      setDraft((d) => (d.conditions.length <= 1 ? d : { ...d, conditions: relabel(d.conditions.filter((c) => c.label !== label)) })),
    [],
  );

  return { draft, setDraft, patch, setMethodRule, addMethod, removeMethod };
}

/** 고른 값 → 서버 요청 (규칙을 고르지 않은 방법은 검사가 막는다) */
export function draftRequest(d: BacktestDraft): Omit<BacktestRequest, 'conditions'> & { conditions: DraftMethod[] } {
  return { symbols: d.symbols, years: d.years, conditions: d.conditions };
}
