/**
 * 오늘 시황 「예상 방향」 채점 보고 — `npm run -s brief:score-report [-- --from YYYY-MM-DD --to YYYY-MM-DD]`
 * (오라클 안에서: `cd ~/projects/alphascope/app && npm run -s brief:score-report`). 기간을 주지 않으면 기록이 있는 전체.
 * 앱 DB(`.env` 의 `DB_PATH`)를 **읽기 전용**으로 연다 — 표를 만들거나 바꾸지 않는다. 토스 · 지표 엔진 · Gemini 를 부르지 않는다.
 * 글은 `scripts/lib/briefScoreReport.ts`(시험 `oraclereport:test` 와 같은 함수).
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { buildBriefScoreReport, periodArgs } from './lib/briefScoreReport';

const file = path.resolve(process.env.DB_PATH ?? './db/alphascope.db');
if (!fs.existsSync(file)) {
  console.log(`DB 가 없습니다: ${file}`);
  process.exit(1);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
try {
  console.log(await buildBriefScoreReport(db, periodArgs(process.argv)));
} finally {
  db.close();
}
