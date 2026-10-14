/**
 * v2.44.0 데이터 정리 — **새 버전 서버가 처음 켜질 때 한 번만** (사용자 결정 A-9, 오라클·맥 같다).
 *
 * 퀀트 다시 만들기 2단계로 계좌·백테스트의 판단이 새 엔진으로 넘어가, 예전 계산기로 만든 기록을 지우고 계좌를 처음부터 시작한다.
 *  1. `app_settings` 'dataReset.v2.44.0' 이 있으면 아무것도 하지 않는다.
 *  2. **백업**: `VACUUM INTO` → `<DB 폴더>/backup/alphascope-before-v2.44.0-<YYYYMMDD-HHmmss>.db`. 파일이 생겼고 크기 > 0 인지 확인한다.
 *     ⚠️ 확인에 실패하면 **정리하지 않고** 오류만 남긴다(표시도 남기지 않아 다음 시작 때 다시 시도한다).
 *  3. 한 트랜잭션 안에서 지우기 · 바꾸기(아래 표).
 *  4. 표시 { at, backupPath, counts } 를 남기고, 로그에 백업 경로와 표마다 지운 건수를 적는다.
 *
 * | 지움 | analysis_history · swing_recommendations · backtest_reports · diagnose_reports · target_analysis(있으면) |
 * | 계좌 초기화 | paper_orders · paper_positions · paper_trades · paper_snapshots 전부, paper_accounts.current_cash = initial_balance |
 * | 설정 키(gemini_settings) | autoTrading.trailingPeaks · autoTrading.lastNotes · autoTrading.dailyLoss(초기화 전 평가액이 기준으로 남으면 하루 손실 한도가 거짓으로 걸린다) |
 * | 바꿈 | autoTrading.strategies — 계좌마다 새 모양, ruleId = 「기본 규칙」(없으면 id 가 가장 작은 규칙, 하나도 없으면 null), enabled = false.
 * |      | 종목 · 비중 · 최대 보유 · 실적 발표 전 · 하루 손실 한도는 남긴다 |
 * | 남김 | 계좌 자체(이름·초기 자금·통화·수수료) · trading_rules · news_sentiment · user_data · 그 밖의 설정 · surge_* · 캐시 표 · auth_sessions |
 */
import fs from 'node:fs';
import path from 'node:path';
import { dbFilePath, getDb } from '../db';
import { ensureSeeded } from '../rules/store';
import { normalizeStrategy, STRATEGIES_KEY } from '../autoTrading/store';
import { DEFAULT_RULE_NAME } from '../../src/types/tradingRule';

export const RESET_KEY = 'dataReset.v2.44.0';

const DELETE_TABLES = ['analysis_history', 'swing_recommendations', 'backtest_reports', 'diagnose_reports', 'target_analysis'] as const;
// 자식 표부터(paper_trades 가 paper_orders 를 가리킨다 — 외래 키)
const PAPER_TABLES = ['paper_trades', 'paper_positions', 'paper_snapshots', 'paper_orders'] as const;
const DELETE_SETTING_KEYS = ['autoTrading.trailingPeaks', 'autoTrading.lastNotes', 'autoTrading.dailyLoss'] as const;

export interface ResetRecord {
  at: string;
  backupPath: string;
  counts: Record<string, number>;
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
export function runDataResetV2440(options: { backupDir?: string; log?: (msg: string) => void } = {}): ResetRecord | null {
  const log = options.log ?? ((m: string) => console.log(m));
  if (resetDone()) return null;
  const db = getDb();

  // 2) 백업
  const dir = options.backupDir ?? path.join(path.dirname(dbFilePath()), 'backup');
  const backupPath = path.join(dir, `alphascope-before-v2.44.0-${stamp()}.db`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    db.prepare('VACUUM INTO ?').run(backupPath);
    const size = fs.statSync(backupPath).size;
    if (!(size > 0)) throw new Error(`백업 파일 크기가 ${size} 입니다`);
  } catch (e) {
    console.error(`[data-reset v2.44.0] ⚠️ 백업에 실패해 데이터 정리를 하지 않았습니다 — 다음 시작 때 다시 시도합니다: ${(e as Error).message}`);
    return null;
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

    const record: ResetRecord = { at: new Date().toISOString(), backupPath, counts };
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(RESET_KEY, JSON.stringify(record));
  })();

  const record = resetDone()!;
  log(`[data-reset v2.44.0] 백업 ${backupPath}`);
  log(`[data-reset v2.44.0] 지운 건수 ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  return record;
}
