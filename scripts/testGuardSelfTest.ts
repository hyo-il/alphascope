/**
 * 시험 도구 점검 — `npm run testguard:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * `lib/requireTossKeys`(모의 모드면 시험을 맨 처음에 멈춤 · v2.60.8)를 확인한다:
 * 1. 토스 키가 없으면(모의 모드) 종료 코드 1 + 안내 글 · 키가 있으면 그대로 지나감(토스를 부르지 않는다 — 키 모양만 본다)
 * 2. 넣은 시험 6개는 `requireCopyDb` 바로 다음 줄에 이 import 가 있고, 뺀 시험에는 없다(목록 = 결정 기록 · 이유는 `docs/rules/workflow.md`)
 * 3. 넣은 시험 하나(`cashflow:test`)를 키 없이 실제로 돌리면 시험이 시작되기 전에 멈춘다
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const tsx = path.join(root, 'node_modules/.bin/tsx');
const MESSAGE = '토스 키가 없습니다(.env 없음 · 모의 모드)';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

/** `.env` 가 없는 빈 폴더에서 돌린다 — dotenv 가 저장소 `.env` 를 읽지 않게 */
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'as-testguard-'));
const run = (file: string, env: Record<string, string>) =>
  spawnSync(tsx, [file], { cwd: empty, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });

// 1. 검사 파일만
const guard = path.join(here, 'lib/requireTossKeys.ts');
const noKey = run(guard, { TOSS_CLIENT_ID: '', TOSS_CLIENT_SECRET: '' });
check('키 없음 → 종료 1 · 안내 글', noKey.status === 1 && noKey.stderr.includes(MESSAGE), `${noKey.status} ${noKey.stderr.slice(0, 200)}`);
const placeholder = run(guard, { TOSS_CLIENT_ID: 'your_client_id', TOSS_CLIENT_SECRET: 'your_secret' });
check('your_ 자리표시 → 종료 1', placeholder.status === 1 && placeholder.stderr.includes(MESSAGE));
const withKey = run(guard, { TOSS_CLIENT_ID: 'test-id-not-real', TOSS_CLIENT_SECRET: 'test-secret-not-real' });
check('키 있음 → 지나감(종료 0)', withKey.status === 0, `${withKey.status} ${withKey.stderr.slice(0, 200)}`);

// 2. 넣은 곳 / 뺀 곳
const WITH = ['autoTradingSelfTest', 'buyJudgeSelfTest', 'cashFlowSelfTest', 'recheckSelfTest', 'heatmapSessionSelfTest', 'prevCloseSelfTest'];
const all = fs.readdirSync(here).filter((f) => /SelfTest\.ts$/.test(f)).map((f) => f.replace(/\.ts$/, ''));
for (const name of all) {
  const lines = fs.readFileSync(path.join(here, `${name}.ts`), 'utf8').split('\n');
  const copyAt = lines.findIndex((l) => l.startsWith("import './lib/requireCopyDb'"));
  const has = lines.some((l) => l.startsWith("import './lib/requireTossKeys'"));
  if (WITH.includes(name)) check(`넣음 — ${name}: requireCopyDb 바로 다음 줄`, copyAt >= 0 && lines[copyAt + 1]?.startsWith("import './lib/requireTossKeys'"));
  else check(`뺌 — ${name}: 검사 없음`, !has);
}
check('넣은 시험이 모두 있음', WITH.every((n) => all.includes(n)), WITH.filter((n) => !all.includes(n)).join(', '));

// 3. 실제 시험 하나를 키 없이 — 시험 줄(PASS · FAIL)이 하나도 나오기 전에 멈춘다
const cash = spawnSync(tsx, [path.join(here, 'cashFlowSelfTest.ts')], {
  cwd: empty,
  encoding: 'utf8',
  env: { ...process.env, TOSS_CLIENT_ID: '', TOSS_CLIENT_SECRET: '' },
  timeout: 120_000,
});
check('cashflow:test 를 키 없이 → 맨 처음에 멈춤(종료 1 · 안내 · 시험 줄 0)', cash.status === 1 && cash.stderr.includes(MESSAGE) && !/^(PASS|FAIL) /m.test(cash.stdout), `${cash.status} ${cash.stdout.slice(0, 200)}`);

fs.rmSync(empty, { recursive: true, force: true });
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
