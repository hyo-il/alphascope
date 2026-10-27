/**
 * 홈 화면 설정 저장 점검 — `npm run homepage:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * `accountsview:test` 와 같은 방식 — 사본 DB 로 **시험 서버를 따로 띄워**(포트 4104 · 스케줄러 스위치 셋 끔) 실제 HTTP 로 확인한다.
 * - 사본 DB 의 비밀번호를 시험용으로 바꾸고 세션을 모두 지운다 · 'ui.homePage' 를 지우고 시작한다(사본만).
 * - 없음 → home · 4개 값 저장 → 다시 읽으면 같음 · 목록 밖 값 400 · 서버를 다시 켜도 유지 · 로그인 안 하면 401.
 * - 끝에 `marketByKstTime`(종목 지도 · 실시간 순위의 시작 시장) 경계도 본다 — `TZ=America/New_York` · `TZ=UTC` 로 다시 돌려 PC 시간대와 상관없는지 확인.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';
import { HOME_PAGES } from '../src/types/nav';
import { marketByKstTime } from '../src/utils/marketDate';

const PORT = 4104;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-homepage-0001';
const URL_HOME = `${BASE}/api/settings/home-page`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── marketByKstTime (서버 없이) ─────────────────────────────────────
console.log(`TZ=${process.env.TZ ?? '(기본)'} · PC 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
for (const [kst, want] of [
  ['07:59', 'us'],
  ['08:00', 'kr'],
  ['16:59', 'kr'],
  ['17:00', 'us'],
  ['23:30', 'us'],
  ['00:00', 'us'],
] as const) {
  const got = marketByKstTime(new Date(`2026-10-21T${kst}:00+09:00`));
  check(`marketByKstTime ${kst} KST → ${want}`, got === want, got);
}

await setPassword(TEST_PW);
getDb().prepare(`DELETE FROM auth_sessions`).run();
getDb().prepare(`DELETE FROM app_settings WHERE key = 'ui.homePage'`).run();

let server: ChildProcess | null = null;
let serverLog = '';
// npx 를 거치지 않고 tsx 를 바로 띄우고 프로세스 그룹째 끈다 — npx 만 끄면 tsx 자식이 포트에 남을 수 있다
function start() {
  server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
    detached: true,
    env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false', US_HALTS_ENABLED: 'false', BUYJUDGE_RECHECK_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
}
function stop() {
  if (!server) return;
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  server = null;
}
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
async function waitDown() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/api/version`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const put = (homePage: unknown, cookie?: string) =>
  fetch(URL_HOME, { method: 'PUT', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ homePage }) });
const read = async (cookie: string) => ((await (await fetch(URL_HOME, { headers: { cookie } })).json()) as { homePage?: string }).homePage;
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  if (!r.ok) throw new Error(`로그인 실패 ${r.status}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}

try {
  start();
  await waitReady();
  check('로그인하지 않은 요청 — 읽기 401', (await fetch(URL_HOME)).status === 401);
  check('로그인하지 않은 요청 — 저장 401', (await put('heatmap')).status === 401);
  check('로그인 안 한 저장은 DB 에 남지 않는다', !getDb().prepare(`SELECT 1 FROM app_settings WHERE key = 'ui.homePage'`).get());

  let cookie = await login();
  const first = await fetch(URL_HOME, { headers: { cookie } });
  const firstBody = (await first.json()) as Record<string, unknown>;
  check('없음 → home(종목 탐색) · 응답 칸은 homePage 하나', first.status === 200 && JSON.stringify(firstBody) === '{"homePage":"home"}', JSON.stringify(firstBody));

  for (const page of HOME_PAGES) {
    const r = await put(page, cookie);
    const body = (await r.json()) as { homePage?: string };
    check(`${page} 저장 → 200 · 다시 읽으면 ${page}`, r.status === 200 && body.homePage === page && (await read(cookie)) === page);
  }

  check('heatmap 저장', (await put('heatmap', cookie)).status === 200);
  for (const bad of ['portfolio', 'settings-app', 'compare', '', null, 1, ['heatmap'], { homePage: 'heatmap' }]) {
    const r = await put(bad, cookie);
    const msg = ((await r.json()) as { error?: string }).error ?? '';
    check(`목록 밖 값 ${JSON.stringify(bad)} → 400 · 한국어 문구`, r.status === 400 && /홈 화면은/.test(msg), `${r.status} ${msg}`);
  }
  check('목록 밖 값은 저장하지 않는다(그대로 heatmap)', (await read(cookie)) === 'heatmap');

  // 서버를 다시 켠 뒤에도 유지(세션도 DB 에 있어 같은 쿠키로 읽힌다 — 안 되면 다시 로그인)
  stop();
  await waitDown();
  start();
  await waitReady();
  let after = await fetch(URL_HOME, { headers: { cookie } });
  if (after.status === 401) {
    cookie = await login();
    after = await fetch(URL_HOME, { headers: { cookie } });
  }
  check('서버를 다시 켠 뒤에도 heatmap', ((await after.json()) as { homePage?: string }).homePage === 'heatmap');

  // DB 에 모르는 값이 들어 있으면 종목 탐색
  getDb().prepare(`UPDATE app_settings SET value = 'portfolio' WHERE key = 'ui.homePage'`).run();
  check('DB 에 목록 밖 값 → home', (await read(cookie)) === 'home');
} catch (e) {
  fail++;
  console.log('FAIL  시험 중 오류 —', (e as Error).message);
} finally {
  stop();
  getDb().prepare(`DELETE FROM auth_sessions`).run();
  getDb().prepare(`DELETE FROM app_settings WHERE key = 'ui.homePage'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
