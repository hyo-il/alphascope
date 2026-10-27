/**
 * 미국 매수 판단 다시 계산 결과 보기 — `npm run -s recheck:report` (오라클 안에서: `cd ~/alphascope && npm run -s recheck:report`).
 * 앱 DB(`.env` 의 `DB_PATH`)를 **읽기 전용**으로 연다 — 표를 만들거나 바꾸지 않는다. 토스도 부르지 않는다.
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { renderRecheckReport } from './lib/recheckReport';
import type { RecheckDay, RecheckRow } from '../server/buyJudge/recheck';

const file = path.resolve(process.env.DB_PATH ?? './db/alphascope.db');
if (!fs.existsSync(file)) {
  console.log(`DB 가 없습니다: ${file}`);
  process.exit(1);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
const has = (t: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t));
if (!has('buy_judgment_rechecks') || !has('buy_judgment_recheck_days')) {
  console.log('다시 계산 표가 아직 없습니다(v2.58.0 서버를 켠 뒤 생긴다).');
} else {
  const rows = db.prepare(`SELECT * FROM buy_judgment_rechecks ORDER BY market_date, source DESC, symbol, rule_id`).all() as RecheckRow[];
  const days = db.prepare(`SELECT * FROM buy_judgment_recheck_days ORDER BY market_date`).all() as RecheckDay[];
  console.log(renderRecheckReport(rows, days));
}
db.close();
