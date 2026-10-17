/**
 * 시험 스크립트는 **사본 DB 로만** 돈다 — 각 시험 스크립트의 **맨 첫 import** 로 둔다.
 *
 * - 명령 앞에 직접 준 `DB_PATH` 로 판정한다. ESM 의 import 는 순서대로 실행되므로, 이 파일이 `dotenv/config` 보다 먼저 돌면
 *   `.env` 의 값이 아직 들어오지 않았다(dotenv 는 이미 있는 값을 덮지 않는다 — 직접 준 값은 그대로 남는다).
 * - `DB_PATH` 가 없거나, 사용자 DB(`.env` 의 `DB_PATH` 또는 기본 `./db/alphascope.db`)와 같은 파일이면 멈춘다(종료 코드 1).
 * - 우회 옵션은 두지 않는다. `DB_PATH` 없이 돌리면 사용자 DB 에 임시 계좌·규칙이 생긴다.
 * - 운영 도구(`auth:set-password` · `diagnose` · `db:init` · `universe:update` · `smoke` · `probe`)는 실제 DB 에서 도는 것이 목적이라 쓰지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const MESSAGE = '시험은 사본 DB 로만 돌립니다. DB_PATH=<사본 경로> 를 붙여 다시 실행하세요.';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 있으면 실제 경로(링크를 푼 것), 없으면 절대 경로 */
function real(p: string): string {
  const abs = path.resolve(root, p);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

/** 사용자 DB — `.env` 의 DB_PATH, 없으면 기본 경로 */
function userDbPath(): string {
  let fromEnv: string | undefined;
  try {
    fromEnv = parse(fs.readFileSync(path.join(root, '.env')))['DB_PATH'];
  } catch {
    fromEnv = undefined;
  }
  return real(fromEnv?.trim() || './db/alphascope.db');
}

/** 판정만 한다 — 시험용으로 내보낸다. 막아야 하면 이유 문자열, 괜찮으면 null */
export function copyDbProblem(given: string | undefined): string | null {
  if (!given?.trim()) return MESSAGE;
  if (real(given.trim()) === userDbPath()) return MESSAGE;
  return null;
}

const problem = copyDbProblem(process.env.DB_PATH);
if (problem) {
  console.error(problem);
  process.exit(1);
}
