/**
 * 떠 있는 한국 시간 시계 자리 저장 점검 — `npm run clock:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * `homepage:test` 와 같은 방식 — 사본 DB 로 **시험 서버를 따로 띄워**(포트 4105 · 스케줄러 스위치 셋 끔) 실제 HTTP 로 확인한다.
 * - 사본 DB 의 비밀번호를 시험용으로 바꾸고 세션을 모두 지운다 · 'ui.clock' 을 지우고 시작한다(사본만).
 * - 없음 → 기본값 · 저장 → 다시 읽으면 같음 · 틀린 값 400 · 서버를 다시 켜도 유지 · 로그인 안 하면 401.
 * - 앞에 `kstClockText`(시계 글자)가 PC 시간대와 상관없이 한국 시각인지 본다 — `TZ=America/New_York` · `TZ=UTC` 로 다시 돌려 확인.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';
import { CLOCK_MAX_OFFSET, DEFAULT_CLOCK } from '../src/types/clock';
import { kstClockText } from '../src/utils/marketDate';

const PORT = 4105;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-clock-0001';
const URL_CLOCK = `${BASE}/api/settings/clock`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── kstClockText (서버 없이) ─────────────────────────────────────
console.log(`TZ=${process.env.TZ ?? '(기본)'} · PC 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
for (const [iso, want] of [
  ['2026-10-21T05:05:09Z', '14:05:09'],
  ['2026-10-21T15:00:00Z', '00:00:00'],
  ['2026-10-21T14:59:59Z', '23:59:59'],
  ['2026-03-08T13:30:00Z', '22:30:00'], // 미국 서머타임 시작일 — 한국 시간은 그대로
] as const) {
  const got = kstClockText(Date.parse(iso));
  check(`kstClockText ${iso} → ${want}`, got === want, got);
}

await setPassword(TEST_PW);
getDb().prepare(`DELETE FROM auth_sessions`).run();
getDb().prepare(`DELETE FROM app_settings WHERE key = 'ui.clock'`).run();

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

const put = (clock: unknown, cookie?: string) =>
  fetch(URL_CLOCK, { method: 'PUT', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ clock }) });
const read = async (cookie: string) => ((await (await fetch(URL_CLOCK, { headers: { cookie } })).json()) as { clock?: unknown }).clock;
async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  if (!r.ok) throw new Error(`로그인 실패 ${r.status}`);
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SAVED = { pinned: true, corner: 'top-left', dx: 300, dy: 48 };

try {
  start();
  await waitReady();
  check('로그인하지 않은 요청 — 읽기 401', (await fetch(URL_CLOCK)).status === 401);
  check('로그인하지 않은 요청 — 저장 401', (await put(SAVED)).status === 401);
  check('로그인 안 한 저장은 DB 에 남지 않는다', !getDb().prepare(`SELECT 1 FROM app_settings WHERE key = 'ui.clock'`).get());

  let cookie = await login();
  const first = await fetch(URL_CLOCK, { headers: { cookie } });
  const firstBody = (await first.json()) as Record<string, unknown>;
  check('없음 → 기본값(고정 풀림 · 기본 자리) · 응답 칸은 clock 하나', first.status === 200 && same(firstBody, { clock: DEFAULT_CLOCK }), JSON.stringify(firstBody));

  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const value = { pinned: corner.startsWith('top'), corner, dx: 0, dy: CLOCK_MAX_OFFSET };
    const r = await put(value, cookie);
    const body = (await r.json()) as { clock?: unknown };
    check(`${corner} 저장 → 200 · 다시 읽으면 같음`, r.status === 200 && same(body.clock, value) && same(await read(cookie), value));
  }

  // 모르는 칸은 버리고 네 칸만 저장한다
  const extra = await put({ ...SAVED, note: 'x'.repeat(50) }, cookie);
  check('모르는 칸은 버리고 저장(네 칸만)', extra.status === 200 && same(await read(cookie), SAVED));

  for (const bad of [
    null,
    'top-left',
    [SAVED],
    { ...SAVED, pinned: 'true' },
    { ...SAVED, pinned: undefined },
    { ...SAVED, corner: 'center' },
    { ...SAVED, corner: 'TOP-LEFT' },
    { ...SAVED, dx: -1 },
    { ...SAVED, dy: 1.5 },
    { ...SAVED, dx: '24' },
    { ...SAVED, dx: CLOCK_MAX_OFFSET + 1 },
    { ...SAVED, dy: 1e308 },
    { pinned: true, corner: 'top-left', dx: 1 },
  ]) {
    const r = await put(bad, cookie);
    const msg = ((await r.json()) as { error?: string }).error ?? '';
    check(`틀린 값 ${JSON.stringify(bad)} → 400 · 한국어 문구`, r.status === 400 && /시계 자리는/.test(msg), `${r.status} ${msg}`);
  }
  check('틀린 값은 저장하지 않는다(그대로)', same(await read(cookie), SAVED));

  // 서버를 다시 켠 뒤에도 유지(세션도 DB 에 있어 같은 쿠키로 읽힌다 — 안 되면 다시 로그인)
  stop();
  await waitDown();
  start();
  await waitReady();
  let after = await fetch(URL_CLOCK, { headers: { cookie } });
  if (after.status === 401) {
    cookie = await login();
    after = await fetch(URL_CLOCK, { headers: { cookie } });
  }
  check('서버를 다시 켠 뒤에도 같음', same(((await after.json()) as { clock?: unknown }).clock, SAVED));

  // DB 에 읽을 수 없는 값이 들어 있으면 기본값
  for (const broken of ['not json', '{"pinned":true}', '"top-left"']) {
    getDb().prepare(`UPDATE app_settings SET value = ? WHERE key = 'ui.clock'`).run(broken);
    check(`DB 에 읽을 수 없는 값 ${broken} → 기본값`, same(await read(cookie), DEFAULT_CLOCK));
  }
} catch (e) {
  fail++;
  console.log('FAIL  시험 중 오류 —', (e as Error).message);
} finally {
  stop();
  getDb().prepare(`DELETE FROM auth_sessions`).run();
  getDb().prepare(`DELETE FROM app_settings WHERE key = 'ui.clock'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
