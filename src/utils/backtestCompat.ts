/**
 * 20차(v2.38.0) 백테스트 기록 읽기 (v2.39.0) — 그때는 조건이 하나라 `input` 이 펼친 모양이고 결과도 조건 하나였다.
 * 서버가 기록을 내보낼 때 이 함수로 **새 모양(조건 A 하나)** 으로 바꾼다 — 화면·AI 설명은 새 모양만 다룬다.
 * 옛 기록에는 MDD·Profit Factor·청산 이유가 없다(null → 화면 「—」). 계산을 다시 하지 않는다.
 */
import { normalizeBacktestInput } from './backtestInput';
import type { BacktestCustomReport, BacktestCustomSummary, BacktestExplain } from '../types/backtest';

type Loose = Record<string, unknown>;

function normalizeExplain(raw: unknown): BacktestExplain | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Loose;
  if (Array.isArray(e.byCondition)) return raw as BacktestExplain;
  // 20차 한 벌(good/bad) → 조건 A
  return {
    summary: (e.summary as string[]) ?? [],
    byCondition: [{ label: 'A', good: (e.good as string[]) ?? [], bad: (e.bad as string[]) ?? [] }],
    cautions: (e.cautions as string[]) ?? [],
    removed: (e.removed as number) ?? 0,
    promptVersion: (e.promptVersion as string) ?? '',
    model: (e.model as string) ?? '',
    createdAt: (e.createdAt as string) ?? '',
  };
}

export function normalizeCustomReport(raw: unknown): BacktestCustomReport {
  const r = raw as Loose;
  if (Array.isArray(r.conditions)) {
    const ex = normalizeExplain(r.explain);
    return { ...(raw as BacktestCustomReport), ...(ex ? { explain: ex } : {}) };
  }
  const input = normalizeBacktestInput(r.input);
  const summary = r.summary as BacktestCustomReport['conditions'][number]['summary'];
  const ex = normalizeExplain(r.explain);
  return {
    kind: 'custom',
    input,
    segments: (r.segments as BacktestCustomReport['segments']) ?? [],
    conditions: [
      {
        label: 'A',
        condition: input.conditions[0],
        summary,
        segmentRows: (r.segmentRows as BacktestCustomReport['conditions'][number]['segmentRows']) ?? [],
        symbols: (r.symbols as BacktestCustomReport['conditions'][number]['symbols']) ?? [],
      },
    ],
    hold: { rule: summary?.hold ?? null, mdd: null, mddWorst: null },
    excluded: (r.excluded as BacktestCustomReport['excluded']) ?? [],
    leakCheck: r.leakCheck as BacktestCustomReport['leakCheck'],
    measure: r.measure as BacktestCustomReport['measure'],
    computedAt: r.computedAt as string,
    ...(ex ? { explain: ex } : {}),
  };
}

/** 목록 요약도 옛 `input` 을 조건 배열로 */
export function normalizeCustomSummary(s: BacktestCustomSummary): BacktestCustomSummary {
  return Array.isArray((s.input as unknown as Loose)?.conditions) ? s : { ...s, input: normalizeBacktestInput(s.input) };
}
