/**
 * 계좌 모아보기 보기(카드 · 목록) 저장 점검 — `npm run accountsview:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * `auth:test` 와 같은 방식 — 사본 DB 로 **시험 서버를 따로 띄워**(포트 4102 · 스케줄러 스위치 셋 끔) 실제 HTTP 로 확인한다.
 * - 사본 DB 의 비밀번호를 시험용으로 바꾸고 세션을 모두 지운다 · 'paper.accountsView' 를 지우고 시작한다(사본만).
 * - 없음 → card · list 저장 → 다시 읽으면 list · 잘못된 값 400 · 로그인 안 하면 401 · 계좌 주소(`/accounts/:id`)에 잡히지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';

const PORT = 4102;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-accountsview-0001';
const URL_VIEW = `${BASE}/api/paper/accounts-view`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await setPassword(TEST_PW);
getDb().prepare(`DELETE FROM auth_sessions`).run();
getDb().prepare(`DELETE FROM app_settings WHERE key = 'paper.accountsView'`).run();

// npx 를 거치지 않고 tsx 를 바로 띄우고 프로세스 그룹째 끈다 — npx 만 끄면 tsx 자식이 포트에 남을 수 있다
const server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
  detached: true,
  env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false', US_HALTS_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitReady() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/version`)).ok) return;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`시험 서버가 뜨지 않았습니다\n${serverLog.slice(-2000)}`);
}

const put = (view: unknown, cookie?: string) =>
  fetch(URL_VIEW, { method: 'PUT', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ view }) });
const get = (cookie?: string) => fetch(URL_VIEW, { headers: cookie ? { cookie } : {} });

try {
  await waitReady();
  check('로그인하지 않은 요청 — 읽기 401', (await get()).status === 401);
  check('로그인하지 않은 요청 — 저장 401', (await put('list')).status === 401);

  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  if (!login.ok) throw new Error(`로그인 실패 ${login.status}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  const first = await get(cookie);
  const firstBody = (await first.json()) as Record<string, unknown>;
  // 계좌 주소에 잡혔다면 { error: 'accountId 가 필요합니다.' } 나 계좌 모양이 온다
  check('없음 → card · 응답 칸은 view 하나(계좌 주소에 잡히지 않음)', first.status === 200 && JSON.stringify(firstBody) === '{"view":"card"}', JSON.stringify(firstBody));

  const saved = await put('list', cookie);
  check('list 저장 → 200 · { view: list }', saved.status === 200 && ((await saved.json()) as { view?: string }).view === 'list');
  check('다시 읽으면 list', ((await (await get(cookie)).json()) as { view?: string }).view === 'list');
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = 'paper.accountsView'`).get() as { value: string } | undefined;
  check("DB 키 'paper.accountsView' = list", row?.value === 'list');

  for (const bad of ['grid', '', null, 1, ['list'], { view: 'list' }]) {
    const r = await put(bad, cookie);
    check(`잘못된 값 ${JSON.stringify(bad)} → 400`, r.status === 400, String(r.status));
  }
  check('잘못된 값은 저장하지 않는다(그대로 list)', ((await (await get(cookie)).json()) as { view?: string }).view === 'list');

  check('card 로 되돌리기 → 다시 읽으면 card', (await put('card', cookie)).status === 200 && ((await (await get(cookie)).json()) as { view?: string }).view === 'card');

  // 모르는 값이 DB 에 들어 있어도 카드로 읽는다
  getDb().prepare(`UPDATE app_settings SET value = 'weird' WHERE key = 'paper.accountsView'`).run();
  check('DB 에 모르는 값 → card', ((await (await get(cookie)).json()) as { view?: string }).view === 'card');

  // 옆 주소는 그대로
  const accounts = await fetch(`${BASE}/api/paper/accounts`, { headers: { cookie } });
  check('/api/paper/accounts 는 그대로 계좌 목록', accounts.status === 200 && Array.isArray(((await accounts.json()) as { accounts?: unknown }).accounts));
} catch (e) {
  fail++;
  console.log('FAIL  시험 중 오류 —', (e as Error).message);
} finally {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  getDb().prepare(`DELETE FROM auth_sessions`).run();
  getDb().prepare(`DELETE FROM app_settings WHERE key = 'paper.accountsView'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
