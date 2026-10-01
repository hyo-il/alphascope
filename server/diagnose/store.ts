/**
 * 진단 리포트 저장 — `diagnose_reports` (db/schema.sql).
 *
 * 파일 출력(맥 `docs/analysis/` · 오라클 `reports/`)은 그대로 두고, 웹에서 보기 위해 DB 에도 남긴다.
 * `npm run diagnose` 로 돌린 것도 여기에 쌓여 웹에서 보인다.
 */

import { getDb } from '../db';
import type { DiagnoseListItem, DiagnoseSummary } from '../../src/types/diagnose';

/** 최근 몇 개만 남기나 — 상세 JSON 이 한 건에 100KB 안팎이다 */
const KEEP = 20;

export function saveReport(server: string, summary: DiagnoseSummary, detail: unknown): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO diagnose_reports (created_at, server, summary_json, detail_json) VALUES (?, ?, ?, ?)`,
    )
    .run(summary.createdAt, server, JSON.stringify(summary), JSON.stringify(detail));
  db.prepare(
    `DELETE FROM diagnose_reports WHERE id NOT IN (SELECT id FROM diagnose_reports ORDER BY id DESC LIMIT ?)`,
  ).run(KEEP);
  return Number(info.lastInsertRowid);
}

interface Row {
  id: number;
  created_at: string;
  server: string;
  summary_json: string;
  detail_json?: string;
}

export function listReports(): DiagnoseListItem[] {
  const rows = getDb()
    .prepare(`SELECT id, created_at, server, summary_json FROM diagnose_reports ORDER BY id DESC`)
    .all() as Row[];
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    server: row.server,
    summary: JSON.parse(row.summary_json) as DiagnoseSummary,
  }));
}

export function getReport(id: number): (DiagnoseListItem & { detail: unknown }) | null {
  const row = getDb()
    .prepare(`SELECT id, created_at, server, summary_json, detail_json FROM diagnose_reports WHERE id = ?`)
    .get(id) as Row | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    server: row.server,
    summary: JSON.parse(row.summary_json) as DiagnoseSummary,
    detail: JSON.parse(row.detail_json ?? 'null'),
  };
}

/**
 * 리포트 한 건 삭제 (v2.22.0) — `diagnose_reports` 의 그 행만 지운다.
 * 파일 출력(맥 `docs/analysis/` · 오라클 `reports/`)은 건드리지 않는다 — 웹 목록에서만 사라진다.
 * 저장된 리포트는 이 화면만 읽는다— AI·자동매매·채점은 읽지 않는다 — 지워도 다른 기능에 영향이 없다.
 */
export function deleteReport(id: number): boolean {
  return getDb().prepare(`DELETE FROM diagnose_reports WHERE id = ?`).run(id).changes > 0;
}
