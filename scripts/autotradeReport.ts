/**
 * 계좌 자동매매 테스트 결과 보고 — `npm run -s autotrade:report [-- --from YYYY-MM-DD --to YYYY-MM-DD]`
 * (오라클 안에서: `cd ~/projects/alphascope/app && npm run -s autotrade:report`). 기간을 주지 않으면 계좌를 만든 날부터 오늘까지.
 * 앱 DB(`.env` 의 `DB_PATH`)를 **읽기 전용**으로 연다 — 표를 만들거나 바꾸지 않는다. 토스 · Gemini 를 부르지 않고 주문을 내지 않는다.
 * 금액 · 수량 · 가격은 출력하지 않는다(손익은 %). 글은 `scripts/lib/autotradeReport.ts`(시험 `oraclereport:test` 와 같은 함수).
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { buildAutotradeReport } from './lib/autotradeReport';
import { periodArgs } from './lib/briefScoreReport';

const file = path.resolve(process.env.DB_PATH ?? './db/alphascope.db');
if (!fs.existsSync(file)) {
  console.log(`DB 가 없습니다: ${file}`);
  process.exit(1);
}
const db = new Database(file, { readonly: true, fileMustExist: true });
try {
  console.log(buildAutotradeReport(db, periodArgs(process.argv)));
} finally {
  db.close();
}
