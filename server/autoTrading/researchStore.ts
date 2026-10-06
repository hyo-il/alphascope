/**
 * 백테스트 결과 저장 — `backtest_reports` (db/schema.sql, v2.37.0). `diagnose/store.ts` 와 같은 모양.
 * 화면만 읽는다(자동매매·판정은 읽지 않는다).
 *
 * 두 종류가 같은 표에 쌓인다 (v2.38.0, `summary_json.kind`):
 * - `custom` — 「실험실 > 백테스트」 사용자 시험. **최근 20개**.
 * - `fixed` — `npm run research:rule` 의 미리 정한 시험. 옛 행(kind 없음)도 이것. **따로 최근 5개** —
 *   사용자 시험이 쌓여도 고정 시험 결과가 밀려 사라지지 않게.
 */
import { getDb } from '../db';
import { customInputKey } from './ruleResearch';
import type {
  BacktestAnyReport,
  BacktestCustomReport,
  BacktestExplain,
  BacktestFixedSummary,
  BacktestListItem,
  BacktestReport,
  BacktestSummary,
} from '../../src/types/backtest';

const KEEP_CUSTOM = 20;
const KEEP_FIXED = 5;

export function summaryOf(report: BacktestReport): BacktestFixedSummary {
  return {
    kind: 'fixed',
    createdAt: report.computedAt,
    universeAsOf: report.universeAsOf,
    symbols: report.symbols.filter((s) => !s.error).length,
    methods: report.methods.map((m) => ({ id: m.id, title: m.title, verdict: m.verdict })),
  };
}

function customSummaryOf(report: BacktestCustomReport): BacktestSummary {
  return {
    kind: 'custom',
    createdAt: report.computedAt,
    symbols: report.summary.symbols,
    requested: report.input.symbols.length,
    years: report.input.years,
    input: report.input,
    inputKey: customInputKey(report.input),
    rule: report.summary.rule,
    hold: report.summary.hold,
  };
}

/** kind 별로 오래된 것을 지운다 — kind 가 없는 옛 행은 fixed */
function prune(): void {
  const kindSql = `COALESCE(json_extract(summary_json, '$.kind'), 'fixed')`;
  const db = getDb();
  for (const [kind, keep] of [['custom', KEEP_CUSTOM], ['fixed', KEEP_FIXED]] as const) {
    db.prepare(
      `DELETE FROM backtest_reports WHERE ${kindSql} = ? AND id NOT IN (SELECT id FROM backtest_reports WHERE ${kindSql} = ? ORDER BY id DESC LIMIT ?)`,
    ).run(kind, kind, keep);
  }
}

export function saveBacktest(server: string, report: BacktestAnyReport): number {
  const summary = report.kind === 'custom' ? customSummaryOf(report) : summaryOf(report);
  const info = getDb()
    .prepare(`INSERT INTO backtest_reports (created_at, server, summary_json, detail_json) VALUES (?, ?, ?, ?)`)
    .run(report.computedAt, server, JSON.stringify(summary), JSON.stringify(report));
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

const parseSummary = (json: string): BacktestSummary => {
  const s = JSON.parse(json) as BacktestSummary;
  return s.kind === 'custom' ? s : { ...s, kind: 'fixed' };
};

export function listBacktests(): BacktestListItem[] {
  const rows = getDb().prepare(`SELECT id, created_at, server, summary_json FROM backtest_reports ORDER BY id DESC`).all() as Row[];
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, server: r.server, summary: parseSummary(r.summary_json) }));
}

export function getBacktest(id: number): (BacktestListItem & { detail: BacktestAnyReport }) | null {
  const r = getDb().prepare(`SELECT id, created_at, server, summary_json, detail_json FROM backtest_reports WHERE id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    server: r.server,
    summary: parseSummary(r.summary_json),
    detail: JSON.parse(r.detail_json ?? 'null') as BacktestAnyReport,
  };
}

/** 「AI에게 결과 설명 듣기」 결과를 그 기록에 넣는다 — 다시 열 때 Gemini 를 부르지 않는다 */
export function saveExplain(id: number, explain: BacktestExplain): boolean {
  const found = getBacktest(id);
  if (!found || found.detail.kind !== 'custom') return false;
  const detail: BacktestCustomReport = { ...found.detail, explain };
  return getDb().prepare(`UPDATE backtest_reports SET detail_json = ? WHERE id = ?`).run(JSON.stringify(detail), id).changes > 0;
}

export function deleteBacktest(id: number): boolean {
  return getDb().prepare(`DELETE FROM backtest_reports WHERE id = ?`).run(id).changes > 0;
}
