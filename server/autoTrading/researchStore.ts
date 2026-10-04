/**
 * 3년 백테스트 결과 저장 — `backtest_reports` (db/schema.sql, v2.37.0). `diagnose/store.ts` 와 같은 모양.
 * 웹 실행과 `npm run research:rule` 이 같은 표에 쌓는다. 화면만 읽는다(자동매매·판정은 읽지 않는다).
 */
import { getDb } from '../db';
import type { BacktestListItem, BacktestReport, BacktestSummary } from '../../src/types/backtest';

const KEEP = 20;

export function summaryOf(report: BacktestReport): BacktestSummary {
  return {
    createdAt: report.computedAt,
    universeAsOf: report.universeAsOf,
    symbols: report.symbols.filter((s) => !s.error).length,
    methods: report.methods.map((m) => ({ id: m.id, title: m.title, verdict: m.verdict })),
  };
}

export function saveBacktest(server: string, report: BacktestReport): number {
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO backtest_reports (created_at, server, summary_json, detail_json) VALUES (?, ?, ?, ?)`)
    .run(report.computedAt, server, JSON.stringify(summaryOf(report)), JSON.stringify(report));
  db.prepare(`DELETE FROM backtest_reports WHERE id NOT IN (SELECT id FROM backtest_reports ORDER BY id DESC LIMIT ?)`).run(KEEP);
  return Number(info.lastInsertRowid);
}

interface Row {
  id: number;
  created_at: string;
  server: string;
  summary_json: string;
  detail_json?: string;
}

export function listBacktests(): BacktestListItem[] {
  const rows = getDb().prepare(`SELECT id, created_at, server, summary_json FROM backtest_reports ORDER BY id DESC`).all() as Row[];
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, server: r.server, summary: JSON.parse(r.summary_json) as BacktestSummary }));
}

export function getBacktest(id: number): (BacktestListItem & { detail: BacktestReport }) | null {
  const r = getDb().prepare(`SELECT id, created_at, server, summary_json, detail_json FROM backtest_reports WHERE id = ?`).get(id) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    server: r.server,
    summary: JSON.parse(r.summary_json) as BacktestSummary,
    detail: JSON.parse(r.detail_json ?? 'null') as BacktestReport,
  };
}

export function deleteBacktest(id: number): boolean {
  return getDb().prepare(`DELETE FROM backtest_reports WHERE id = ?`).run(id).changes > 0;
}
