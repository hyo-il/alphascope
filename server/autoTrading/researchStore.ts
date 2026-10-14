/**
 * 백테스트 결과 저장 — `backtest_reports` (db/schema.sql, v2.37.0). `diagnose/store.ts` 와 같은 모양.
 * 화면만 읽는다(자동매매·판정은 읽지 않는다). **최근 20개**.
 * v2.44.0 에 예전 「미리 정한 시험」(kind fixed) 기록과 옛 모양 읽기(`backtestCompat`)를 지웠다 — 그 기록은 데이터 정리 때 지웠다.
 */
import { getDb } from '../db';
import { customInputKey } from './ruleResearch';
import type { BacktestCustomReport, BacktestExplain, BacktestListItem, BacktestSummary } from '../../src/types/backtest';

const KEEP = 20;

function summaryOf(report: BacktestCustomReport): BacktestSummary {
  return {
    kind: 'custom',
    createdAt: report.computedAt,
    symbols: report.conditions[0]?.summary.symbols ?? 0,
    requested: report.input.symbols.length,
    years: report.input.years,
    input: report.input,
    inputKey: customInputKey(report.input),
    rule: report.conditions[0]?.summary.rule ?? null,
    hold: report.hold.rule,
  };
}

function prune(): void {
  getDb().prepare(`DELETE FROM backtest_reports WHERE id NOT IN (SELECT id FROM backtest_reports ORDER BY id DESC LIMIT ?)`).run(KEEP);
}

export function saveBacktest(server: string, report: BacktestCustomReport): number {
  const info = getDb()
    .prepare(`INSERT INTO backtest_reports (created_at, server, summary_json, detail_json) VALUES (?, ?, ?, ?)`)
    .run(report.computedAt, server, JSON.stringify(summaryOf(report)), JSON.stringify(report));
  prune();
  return Number(info.lastInsertRowid);
}

interface Row {
  id: number;
  created_at: string;
  server: string;
  summary_json: string;
  detail_json?: string;
}

/** 이 버전의 모양(방법 = 규칙)인 기록만 — 혹시 남은 옛 기록은 읽지 않는다 */
const isCurrent = (s: { kind?: string; input?: { conditions?: { ruleId?: unknown }[] } }) =>
  s?.kind === 'custom' && Array.isArray(s.input?.conditions) && s.input!.conditions!.every((c) => typeof c.ruleId === 'number');

export function listBacktests(): BacktestListItem[] {
  const rows = getDb().prepare(`SELECT id, created_at, server, summary_json FROM backtest_reports ORDER BY id DESC`).all() as Row[];
  return rows
    .map((r) => ({ id: r.id, createdAt: r.created_at, server: r.server, summary: JSON.parse(r.summary_json) as BacktestSummary }))
    .filter((r) => isCurrent(r.summary));
}

export function getBacktest(id: number): (BacktestListItem & { detail: BacktestCustomReport }) | null {
  const r = getDb().prepare(`SELECT id, created_at, server, summary_json, detail_json FROM backtest_reports WHERE id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  const summary = JSON.parse(r.summary_json) as BacktestSummary;
  if (!isCurrent(summary)) return null;
  return { id: r.id, createdAt: r.created_at, server: r.server, summary, detail: JSON.parse(r.detail_json ?? 'null') as BacktestCustomReport };
}

/** 「AI에게 결과 설명 듣기」 결과를 그 기록에 넣는다 — 다시 열 때 Gemini 를 부르지 않는다 */
export function saveExplain(id: number, explain: BacktestExplain): boolean {
  const found = getBacktest(id);
  if (!found) return false;
  const detail: BacktestCustomReport = { ...found.detail, explain };
  return getDb().prepare(`UPDATE backtest_reports SET detail_json = ? WHERE id = ?`).run(JSON.stringify(detail), id).changes > 0;
}

export function deleteBacktest(id: number): boolean {
  return getDb().prepare(`DELETE FROM backtest_reports WHERE id = ?`).run(id).changes > 0;
}
