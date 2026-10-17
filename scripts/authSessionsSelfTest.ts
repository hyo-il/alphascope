/**
 * 기기별 로그아웃 점검 (v2.51.3) — `npm run auth:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 사본 DB 로 **시험 서버를 따로 띄워**(포트 4101 · 스케줄러 스위치 셋 끔) 실제 HTTP 로 확인한다 — 문지기(`authGuard`) · 쿠키 · 라우트를 그대로 지난다.
 * - 사본 DB 의 비밀번호를 시험용으로 바꾸고 세션을 모두 지운다(사본만 — 사용자 DB 는 건드리지 않는다).
 * - 목록에 토큰 · 해시 전체 · user_agent 원문이 없다 · 다른 세션 하나만 지워진다 · 이 기기를 지우면 다음 요청이 401 · 로그인하지 않은 요청은 401
 *   · 식별값이 여러 세션에 맞으면 지우지 않는다(400) · 형식이 틀리면 400 · 없으면 404 · 기기 이름 판별.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';
import { deviceName, UNKNOWN_DEVICE } from '../src/utils/deviceName';

const PORT = 4101;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-sessions-0001';
const UA = {
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 기기 이름 ──
check('기기 이름 — Mac · Chrome', deviceName(UA.mac) === 'Mac · Chrome', deviceName(UA.mac));
check('기기 이름 — Windows · Edge(UA 에 Chrome 도 있음)', deviceName(UA.edge) === 'Windows · Edge', deviceName(UA.edge));
check('기기 이름 — iPhone · Safari', deviceName(UA.iphone) === 'iPhone · Safari', deviceName(UA.iphone));
check('기기 이름 — 모르면 「알 수 없는 기기」', deviceName('') === UNKNOWN_DEVICE && deviceName(null) === UNKNOWN_DEVICE && deviceName('curl/8.0') === UNKNOWN_DEVICE);

// ── 시험 서버 ──
await setPassword(TEST_PW);
getDb().prepare(`DELETE FROM auth_sessions`).run();

// npx 를 거치지 않고 tsx 를 바로 띄우고 프로세스 그룹째 끈다 — npx 만 끄면 tsx 자식이 4101 에 남을 수 있다
const server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
  detached: true,
  env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false' },
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

const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];
async function login(ua: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': ua }, body: JSON.stringify({ password: TEST_PW }) });
  if (!res.ok) throw new Error(`로그인 실패 ${res.status}`);
  return cookieOf(res);
}
const get = (cookie?: string) => fetch(`${BASE}/api/auth/sessions`, { headers: cookie ? { cookie } : {} });
const del = (id: string, cookie?: string) => fetch(`${BASE}/api/auth/sessions/${id}`, { method: 'DELETE', headers: cookie ? { cookie } : {} });
type Row = { id: string; device: string; createdAt: string; lastSeenAt: string; current: boolean };
const list = async (cookie: string) => ((await (await get(cookie)).json()) as { sessions: Row[] }).sessions;

try {
  await waitReady();
  const a = await login(UA.mac);
  const b = await login(UA.edge);
  const c = await login(UA.iphone);

  check('로그인하지 않은 요청 — 목록 401', (await get()).status === 401);
  check('로그인하지 않은 요청 — 지우기 401', (await del('0123456789ab')).status === 401);
  const ver = await fetch(`${BASE}/api/version`);
  const unauth = await get();
  const authed = await get(a);
  check('/api 응답은 Cache-Control: no-store(열린 주소 · 401 · 로그인 응답 모두)', [ver, unauth, authed].every((r) => r.headers.get('cache-control') === 'no-store'), [ver, unauth, authed].map((r) => r.headers.get('cache-control')).join(' / '));

  const resA = await get(a);
  const raw = await resA.text();
  const rows = (JSON.parse(raw) as { sessions: Row[] }).sessions;
  const hashes = (getDb().prepare(`SELECT token_hash FROM auth_sessions`).all() as { token_hash: string }[]).map((r) => r.token_hash);
  const tokens = [a, b, c].map((ck) => ck.split('=')[1]);
  check('목록 — 세션 3개 · 이 기기는 하나(맨 앞)', rows.length === 3 && rows.filter((r) => r.current).length === 1 && rows[0].current && rows[0].device === 'Mac · Chrome', JSON.stringify(rows.map((r) => [r.device, r.current])));
  check('목록 — 토큰 · 해시 전체 · user_agent 원문이 응답에 없다', tokens.every((t) => !raw.includes(t)) && hashes.every((h) => !raw.includes(h)) && !raw.includes('Mozilla'));
  check('목록 — 식별값은 16진수 12자 · 칸은 다섯 개만', rows.every((r) => /^[0-9a-f]{12}$/.test(r.id) && Object.keys(r).sort().join() === 'createdAt,current,device,id,lastSeenAt'));
  check('목록 — 기기 이름', rows.map((r) => r.device).sort().join(' / ') === 'Mac · Chrome / Windows · Edge / iPhone · Safari');

  // 다른 세션 하나만 지운다
  const rowsB = await list(b);
  const idB = rowsB.find((r) => r.current)!.id;
  const resDelB = await del(idB, a);
  check('다른 기기(B) 하나만 로그아웃 → 200 · current false', resDelB.status === 200 && (await resDelB.json()).current === false);
  check('B 의 다음 요청은 401', (await get(b)).status === 401);
  const after = await list(a);
  check('A · C 는 그대로(목록 2개)', after.length === 2 && (await get(c)).status === 200, JSON.stringify(after.map((r) => r.device)));

  check('형식이 틀린 식별값 → 400', (await del('xyz', a)).status === 400 && (await del('0123456789abcdef0123', a)).status === 400);
  check('없는 식별값 → 404', (await del('000000000000', a)).status === 404);

  // 식별값이 여러 세션에 맞으면 지우지 않는다(400) — 앞 12자가 같은 세션 둘을 직접 넣는다
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const put = getDb().prepare(`INSERT INTO auth_sessions (token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)`);
  put.run(`abcdefabcdef${'1'.repeat(52)}`, now, now, later, 'x');
  put.run(`abcdefabcdef${'2'.repeat(52)}`, now, now, later, 'x');
  const amb = await del('abcdefabcdef', a);
  const still = (getDb().prepare(`SELECT COUNT(*) AS n FROM auth_sessions WHERE token_hash LIKE 'abcdefabcdef%'`).get() as { n: number }).n;
  check('식별값이 여러 세션에 맞음 → 400 · 둘 다 남는다', amb.status === 400 && still === 2);
  getDb().prepare(`DELETE FROM auth_sessions WHERE token_hash LIKE 'abcdefabcdef%'`).run();

  // 만료된 세션은 목록에 없다
  put.run('f'.repeat(64), now, now, new Date(Date.now() - 1000).toISOString(), UA.mac);
  check('만료된 세션은 목록에 없다', !(await list(a)).some((r) => r.id === 'ffffffffffff'));
  getDb().prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run('f'.repeat(64));

  // 이 기기를 지우면 쿠키도 지우고 다음 요청은 401
  const idA = (await list(a)).find((r) => r.current)!.id;
  const resSelf = await del(idA, a);
  const selfBody = (await resSelf.json()) as { current?: boolean };
  check('이 기기 로그아웃 → 200 · current true · 쿠키 지움', resSelf.status === 200 && selfBody.current === true && /as_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(resSelf.headers.get('set-cookie') ?? ''), resSelf.headers.get('set-cookie') ?? '');
  check('이 기기의 다음 요청은 401', (await get(a)).status === 401);
  check('C 는 여전히 로그인', (await get(c)).status === 200 && (await list(c)).length === 1);
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
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
