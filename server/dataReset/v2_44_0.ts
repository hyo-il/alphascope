/**
 * 데이터 정리(새 매매 규칙 구조로 바꿀 때) — **새 버전 서버가 처음 켜질 때 한 번만** (사용자 결정 A-9, 오라클·맥 같다).
 *
 * 계좌·백테스트의 판단이 매매 규칙 엔진으로 넘어갈 때, 그전 계산기로 만든 기록을 지우고 계좌를 처음부터 시작한다.
 *  1. `app_settings` 'dataReset.v2.44.0' 이 있으면 아무것도 하지 않는다.
 *  2. **백업**: `VACUUM INTO` → `<DB 폴더>/backup/alphascope-before-v2.44.0-<YYYYMMDD-HHmmss>.db`. 파일이 생겼고 크기 > 0 인지 확인한다.
 *     ⚠️ 확인에 실패하면 **정리하지 않고** 오류만 남긴다(표시도 남기지 않아 다음 시작 때 다시 시도한다).
 *  3. **진단 결과 파일 옮기기**(지우지 않는다): 진단이 쓰는 폴더(`diagnose/report.outputDir` 한 곳 — 맥 관리 루트 docs/analysis ·
 *     오라클 ~/alphascope/reports)의 안 내용 전부 → `<DB 폴더>/backup/reports-before-v2.44.0-<같은 시각>/`. 폴더 자체는 빈 채로 남긴다.
 *     같은 디스크면 rename, 아니면 복사 → 크기 확인 → 원본 삭제. 실패해도 DB 정리는 계속한다(파일은 화면에 쓰이지 않는다) — 실패 수를 표시에 남긴다.
 *  4. 한 트랜잭션 안에서 지우기 · 바꾸기(아래 표).
 *  5. 표시 { at, backupPath, counts, reportsMoved, reportsFailed, reportsBackupPath } 를 남기고, 로그에 백업 경로와 표마다 지운 건수를 적는다.
 *
 * | 지움 | gemini_analysis(AI 분석 기록, 있으면) · analysis_history(Claude 수동 분석 기록) · swing_recommendations · backtest_reports ·
 * |      | diagnose_reports · target_analysis(있으면) |
 * | 계좌 초기화 | paper_orders · paper_positions · paper_trades · paper_snapshots 전부, paper_accounts.current_cash = initial_balance |
 * | 설정 키(gemini_settings) | autoTrading.trailingPeaks · autoTrading.lastNotes · autoTrading.dailyLoss(초기화 전 평가액이 기준으로 남으면 하루 손실 한도가 거짓으로 걸린다) ·
 * |                         | autoAnalysis · autoTrading.migratedFromGlobal(쓰는 코드가 없는 옛 키) |
 * | 바꿈 | autoTrading.strategies — 계좌마다 새 모양, ruleId = 「기본 규칙」(없으면 id 가 가장 작은 규칙, 하나도 없으면 null), enabled = false.
 * |      | 종목 · 비중 · 최대 보유 · 실적 발표 전 · 하루 손실 한도는 남긴다 |
 * | 남김 | 계좌 자체(이름·초기 자금·통화·수수료) · trading_rules · news_sentiment · user_data · 그 밖의 설정 · surge_* · 캐시 표 · auth_sessions |
 */
import fs from 'node:fs';
import path from 'node:path';
import { dbFilePath, getDb } from '../db';
import { ensureSeeded } from '../rules/store';
import { normalizeStrategy, STRATEGIES_KEY } from '../autoTrading/store';
import { outputDir } from '../diagnose/report';
import { DEFAULT_RULE_NAME } from '../../src/types/tradingRule';

export const RESET_KEY = 'dataReset.v2.44.0';

// gemini_analysis 는 다른 표가 가리키지 않는다(외래 키 없음) — 순서와 무관
const DELETE_TABLES = ['gemini_analysis', 'analysis_history', 'swing_recommendations', 'backtest_reports', 'diagnose_reports', 'target_analysis'] as const;
// 자식 표부터(paper_trades 가 paper_orders 를 가리킨다 — 외래 키)
const PAPER_TABLES = ['paper_trades', 'paper_positions', 'paper_snapshots', 'paper_orders'] as const;
const DELETE_SETTING_KEYS = [
  'autoTrading.trailingPeaks',
  'autoTrading.lastNotes',
  'autoTrading.dailyLoss',
  'autoAnalysis',
  'autoTrading.migratedFromGlobal',
] as const;

export interface ResetRecord {
  at: string;
  backupPath: string;
  counts: Record<string, number>;
  /** 진단 결과 파일 — 옮긴 수 · 실패 수 · 옮긴 곳(폴더가 없었으면 null) */
  reportsMoved?: number;
  reportsFailed?: number;
  reportsBackupPath?: string | null;
}

/** 폴더 안 내용 전부를 다른 폴더로 옮긴다 — rename, 다른 디스크면 복사 → 크기 확인 → 원본 삭제. 폴더 자체는 남긴다 */
function moveReports(from: string, to: string): { moved: number; failed: number; path: string | null } {
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) return { moved: 0, failed: 0, path: null };
  const entries = fs.readdirSync(from);
  if (!entries.length) return { moved: 0, failed: 0, path: null };
  fs.mkdirSync(to, { recursive: true });
  const sizeOf = (p: string): number =>
    fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((n, e) => n + sizeOf(path.join(p, e)), 0) : fs.statSync(p).size;
  let moved = 0;
  let failed = 0;
  for (const name of entries) {
    const src = path.join(from, name);
    const dst = path.join(to, name);
    try {
      try {
        fs.renameSync(src, dst);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
        fs.cpSync(src, dst, { recursive: true });
        if (sizeOf(dst) !== sizeOf(src)) throw new Error('복사한 크기가 다릅니다');
        fs.rmSync(src, { recursive: true, force: true });
      }
      moved++;
    } catch (e) {
      failed++;
      console.error(`[data-reset v2.44.0] 보고서 파일을 옮기지 못했습니다(${name}): ${(e as Error).message}`);
    }
  }
  return { moved, failed, path: to };
}

/** 로컬 시각 YYYYMMDD-HHmmss */
function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const tableExists = (name: string) =>
  Boolean(getDb().prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name));

/** 이미 했는가 */
export function resetDone(): ResetRecord | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(RESET_KEY) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as ResetRecord) : null;
}

/**
 * 한 번 실행. 이미 했으면 null, 백업 실패면 null(정리하지 않음), 했으면 기록.
 * `backupDir` 은 시험용(쓸 수 없는 폴더로 실패를 만들어 본다) — 서버는 넘기지 않는다.
 */
export function runDataResetV2440(options: { backupDir?: string; reportsDir?: string; log?: (msg: string) => void } = {}): ResetRecord | null {
  const log = options.log ?? ((m: string) => console.log(m));
  if (resetDone()) return null;
  const db = getDb();

  // 2) 백업
  const dir = options.backupDir ?? path.join(path.dirname(dbFilePath()), 'backup');
  const at = stamp();
  const backupPath = path.join(dir, `alphascope-before-v2.44.0-${at}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    db.prepare('VACUUM INTO ?').run(backupPath);
    const size = fs.statSync(backupPath).size;
    if (!(size > 0)) throw new Error(`백업 파일 크기가 ${size} 입니다`);
  } catch (e) {
    console.error(`[data-reset v2.44.0] ⚠️ 백업에 실패해 데이터 정리를 하지 않았습니다 — 다음 시작 때 다시 시도합니다: ${(e as Error).message}`);
    return null;
  }

  // 3) 진단 결과 파일 — 지우지 않고 백업 폴더로 옮긴다. 실패해도 DB 정리는 계속한다
  let reports: { moved: number; failed: number; path: string | null } = { moved: 0, failed: 0, path: null };
  try {
    reports = moveReports(options.reportsDir ?? outputDir().dir, path.join(dir, `reports-before-v2.44.0-${at}`));
  } catch (e) {
    reports = { moved: 0, failed: 1, path: null };
    console.error(`[data-reset v2.44.0] 보고서 폴더를 옮기지 못했습니다 — DB 정리는 계속합니다: ${(e as Error).message}`);
  }

  // 기본 규칙이 먼저 있어야 계좌에 넣을 수 있다
  ensureSeeded();

  // 3) 한 트랜잭션
  const counts: Record<string, number> = {};
  db.transaction(() => {
    for (const t of [...DELETE_TABLES, ...PAPER_TABLES]) {
      if (!tableExists(t)) continue; // 코드가 만드는 표가 아직 없으면 건너뛴다(target_analysis 등)
      counts[t] = db.prepare(`DELETE FROM ${t}`).run().changes;
    }
    counts.paper_accounts_cash_reset = db.prepare(`UPDATE paper_accounts SET current_cash = initial_balance`).run().changes;

    if (tableExists('gemini_settings')) {
      for (const key of DELETE_SETTING_KEYS) {
        counts[`setting:${key}`] = db.prepare(`DELETE FROM gemini_settings WHERE key = ?`).run(key).changes;
      }
      const byName = db.prepare(`SELECT id FROM trading_rules WHERE name = ? ORDER BY id LIMIT 1`).get(DEFAULT_RULE_NAME) as { id: number } | undefined;
      const first = db.prepare(`SELECT id FROM trading_rules ORDER BY id LIMIT 1`).get() as { id: number } | undefined;
      const ruleId = byName?.id ?? first?.id ?? null;
      const row = db.prepare(`SELECT value FROM gemini_settings WHERE key = ?`).get(STRATEGIES_KEY) as { value: string } | undefined;
      const old = row ? (JSON.parse(row.value) as Record<string, Record<string, unknown>>) : {};
      const accounts = db.prepare(`SELECT id FROM paper_accounts ORDER BY id`).all() as { id: number }[];
      const next: Record<string, unknown> = {};
      for (const { id } of accounts) {
        next[String(id)] = { ...normalizeStrategy(id, { ...(old[String(id)] ?? {}), ruleId, enabled: false }), ruleId, enabled: false };
      }
      db.prepare(`INSERT INTO gemini_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
        STRATEGIES_KEY,
        JSON.stringify(next),
      );
      counts.strategies_reset = accounts.length;
    }

    counts.reports_moved = reports.moved;
    counts.reports_failed = reports.failed;
    const record: ResetRecord = {
      at: new Date().toISOString(),
      backupPath,
      counts,
      reportsMoved: reports.moved,
      reportsFailed: reports.failed,
      reportsBackupPath: reports.path,
    };
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(RESET_KEY, JSON.stringify(record));
  })();

  const record = resetDone()!;
  log(`[data-reset v2.44.0] 백업 ${backupPath}`);
  log(`[data-reset v2.44.0] 지운 건수 ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`[data-reset v2.44.0] 진단 결과 파일 ${reports.moved}개 옮김${reports.failed ? ` · 실패 ${reports.failed}개` : ''}${reports.path ? ` → ${reports.path}` : ' (옮길 파일 없음)'}`);
  return record;
}
