/**
 * 자산 관리 점검 — `npm run asset:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 101차 지시서 「꼭 지킬 동작」 1~15 를 줄마다 확인한다(시험 이름 앞의 [n] 이 그 줄 번호).
 * 106차(v2.62.0) 「꼭 지킬 동작」 1~13(4-1 포함)은 [106-n] — 「티커」 D열 자산 분류 · 쓰기 · 총 자산 계산 · 하루 기록.
 * - 잠금(1~6 · 11): 사본 DB 로 **시험 서버를 따로 띄워**(포트 4107 · 스위치 끔 · 시트 연결 정보 없음) 실제 HTTP 로 확인한다.
 * - 시트 읽기(7~10 · 13): **만든 가짜 값**만 쓴다 — 구글 주소를 부르는 `fetch` 를 이 프로세스 안에서 바꿔치기하고, 열쇠는 그때 만든 시험용 RSA 키.
 *   실제 구글 호출 0번.
 * - 12 · 14 · 15: 소스 검색 · git · 메뉴 정의.
 * ⚠️ 출력에 가짜 자산 값도 찍지 않는다(13 — 이 시험의 출력과 서버 로그를 끝에서 검사한다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { TEST_SERVER_SWITCHES } from './lib/testServerEnv';
import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb, saveCandles } from '../server/db';
import { checkPassword, createSession, setPassword } from '../server/auth';
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { authGuard } from '../server/authGuard';
import { assetRouter } from '../server/asset/routes';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { avgPriceOf, linkedTickerRow, parseAssetSheet, readAssetSheet, resetSheetCache, sheetRanges, splitCode, writeAssetClass } from '../server/asset/sheet';
import { ASSET_COLOR_IDS, DEFAULT_CLASS_COLORS, type AssetSheetData, type AssetSummary, type AssetTotals } from '../src/types/asset';
import { accountValues, computeAssetTotals, setAssetPriceSourceForTest, assetSummary, type PriceBook } from '../server/asset/summary';
import { readAssetSettings, stockChoices, writeAssetSettings } from '../server/asset/settings';
import { clearRecordsForTest, historyPoints, latestRecord } from '../server/asset/store';
import { dailyTick } from '../server/asset/daily';
import { setSessionHooksForTest, type TossCalendarResponse } from '../server/heatmapSession';
import { NAV_GROUPS, pageMeta } from '../src/types/nav';

const PORT = 4107;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const LOGIN_PW = 'selftest-asset-login-0001';
const ASSET_PW = 'selftest-asset-lock-0002';

let pass = 0;
let fail = 0;
/** 이 시험이 찍은 모든 줄 — 13: 끝에서 가짜 자산 값이 섞이지 않았는지 본다 */
const printed: string[] = [];
function say(line: string) {
  printed.push(line);
  console.log(line);
}
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

// ── 시험 서버 (잠금) ──
getDb().prepare(`DELETE FROM app_settings WHERE key = 'asset.password'`).run();
await setPassword(LOGIN_PW);

const server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
  detached: true,
  // 11: 시트 연결 정보를 비워 띄운다 — dotenv 는 이미 있는 값(빈 값 포함)을 덮지 않는다
  env: { ...process.env, API_PORT: String(PORT), ...TEST_SERVER_SWITCHES, ASSET_SHEET_ID: '', GOOGLE_SA_KEY_FILE: '' },
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
const json = { 'content-type': 'application/json' };
async function login(password = LOGIN_PW, headers: Record<string, string> = {}): Promise<{ status: number; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { ...json, ...headers }, body: JSON.stringify({ password }) });
  return { status: res.status, cookie: cookieOf(res) };
}
const call = (method: string, path: string, cookie?: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...json, ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const status = async (cookie: string) => (await (await call('GET', '/api/asset/status', cookie)).json()) as { passwordSet: boolean; unlocked: boolean; sheetConfigured: boolean };
const unlock = (cookie: string, password: string, headers: Record<string, string> = {}) => call('POST', '/api/asset/unlock', cookie, { password }, headers);
const sheet = (cookie?: string) => call('GET', '/api/asset/sheet', cookie);
const codeOf = async (res: Response) => ((await res.json().catch(() => ({}))) as { code?: string; authRequired?: boolean; minutes?: number });

try {
  await waitReady();
  const a = (await login()).cookie;

  // [1] 자산 비밀번호가 없을 때
  const s0 = await status(a);
  check('[1] 자산 비밀번호 없음 → status passwordSet:false · unlocked:false', s0.passwordSet === false && s0.unlocked === false);
  const noPwSheet = await sheet(a);
  check('[1] 자산 비밀번호 없음 → 자산 데이터 API 403 asset-locked', noPwSheet.status === 403 && (await codeOf(noPwSheet)).code === 'asset-locked');
  const noPwUnlock = await unlock(a, ASSET_PW);
  check('[1] 자산 비밀번호 없음 → 잠금 풀기도 안 됨(403 asset-no-password)', noPwUnlock.status === 403 && (await codeOf(noPwUnlock)).code === 'asset-no-password');

  // [11] 시트 연결 정보가 없어도 서버는 떴다
  check('[11] ASSET_SHEET_ID · GOOGLE_SA_KEY_FILE 없음 → 서버 정상 시작 · sheetConfigured:false', s0.sheetConfigured === false);

  // [6] 자산 비밀번호를 정해도 로그인 비밀번호 · 세션은 그대로
  await setAssetPassword(ASSET_PW);
  const loginRow = () => (getDb().prepare(`SELECT value FROM app_settings WHERE key = 'auth.owner'`).get() as { value: string }).value;
  const assetRow = () => (getDb().prepare(`SELECT value FROM app_settings WHERE key = 'asset.password'`).get() as { value: string }).value;
  check('[6] 자산 비밀번호를 정한 뒤에도 로그인 비밀번호가 맞고, 자산 비밀번호로는 로그인되지 않는다', (await checkPassword('auth.owner', LOGIN_PW)) && !(await checkPassword('auth.owner', ASSET_PW)) && (await checkPassword('asset.password', ASSET_PW)) && !(await checkPassword('asset.password', LOGIN_PW)));
  check('[6] 자산 비밀번호를 정해도 로그인 세션은 살아 있다', (await call('GET', '/api/auth/me', a)).status === 200);

  // [2] 로그인은 됐지만 잠김
  const s1 = await status(a);
  check('[2] 비밀번호를 정한 뒤 — status passwordSet:true · unlocked:false', s1.passwordSet === true && s1.unlocked === false);
  const locked = await sheet(a);
  check('[2] 로그인한 채 잠김 → GET /api/asset/sheet 403 asset-locked', locked.status === 403 && (await codeOf(locked)).code === 'asset-locked');
  const otherPath = await call('GET', '/api/asset/anything', a);
  check('[2] 자산 문지기는 모든 /api/asset/* 를 막는다(없는 주소도 403)', otherPath.status === 403 && (await codeOf(otherPath)).code === 'asset-locked');

  // [3] 로그인 안 함 → 로그인 문지기 401
  const no = await Promise.all([call('GET', '/api/asset/status'), call('POST', '/api/asset/unlock', undefined, { password: ASSET_PW }), call('POST', '/api/asset/lock'), sheet()]);
  check('[3] 로그인 안 함 → status · unlock · lock · sheet 모두 401(authRequired)', (await Promise.all(no.map(async (r) => r.status === 401 && (await codeOf(r)).authRequired === true))).every(Boolean), no.map((r) => r.status).join(','));
  // [106-10] 106차 새 주소도 같은 두 문지기 뒤(로그인 안 함 401 · 잠김 403)
  const newApis: [string, string, unknown?][] = [['GET', '/api/asset/summary?pension=0'], ['GET', '/api/asset/history?range=1m&pension=0'], ['PUT', '/api/asset/class', { row: 15, assetClass: '금' }], ['PUT', '/api/asset/settings', { pensionSections: [] }]];
  const anon = await Promise.all(newApis.map(([m, p, b]) => call(m, p, undefined, b)));
  check('[106-10] 로그인 안 함 → summary · history · class · settings 모두 401(authRequired)', (await Promise.all(anon.map(async (r) => r.status === 401 && (await codeOf(r)).authRequired === true))).every(Boolean), anon.map((r) => r.status).join(','));
  const lockedNew = await Promise.all(newApis.map(([m, p, b]) => call(m, p, a, b)));
  check('[106-10] 로그인한 채 잠김 → summary · history · class · settings 모두 403 asset-locked', (await Promise.all(lockedNew.map(async (r) => r.status === 403 && (await codeOf(r)).code === 'asset-locked'))).every(Boolean), lockedNew.map((r) => r.status).join(','));

  // [4] 맞는 비밀번호 → 풀림
  const okUnlock = await unlock(a, ASSET_PW);
  const s2 = await status(a);
  check('[4] 맞는 자산 비밀번호 → 200 · unlocked:true', okUnlock.status === 200 && s2.unlocked === true);
  const opened = await sheet(a);
  check('[4] 풀린 뒤 sheet 는 자산 문지기를 지난다(연결 정보 없음 → 503 not-configured)', opened.status === 503 && ((await opened.json()) as { kind?: string }).kind === 'not-configured', String(opened.status));
  // [106-7] 시험 서버는 스위치 7개를 끈 채 떴다 — 쓰기 API 는 시트를 보기 전에 「꺼짐」
  const offWrite = await call('PUT', '/api/asset/class', a, { row: 15, assetClass: '금' });
  check('[106-7] ASSET_SYNC_ENABLED=false(시험 서버) → PUT /api/asset/class 503 · kind disabled', offWrite.status === 503 && ((await offWrite.json()) as { kind?: string }).kind === 'disabled', String(offWrite.status));
  const b = (await login()).cookie;
  check('[4] 풀림은 그 로그인 세션만 — 다른 세션은 여전히 잠김', (await sheet(b)).status === 403 && (await status(b)).unlocked === false);
  // 틀리는 시도는 다른 IP(X-Forwarded-For — trust proxy 는 루프백만 믿는다)로 — 127.0.0.1 은 아래 [5] 에서 다시 푼다
  const ipAsset = { 'x-forwarded-for': '203.0.113.5' };
  check('[4] 로그인 비밀번호로는 자산 잠금이 풀리지 않는다', (await unlock(b, LOGIN_PW, ipAsset)).status === 401 && (await status(b)).unlocked === false);

  // [4] 틀린 비밀번호 5번(같은 IP) → 15분 막힘 · 로그인과 따로 센다
  //   위에서 1번 틀렸으니 4번 더 → 5번
  const wrong: number[] = [];
  for (let i = 0; i < 4; i++) wrong.push((await unlock(b, 'wrong-password-x', ipAsset)).status);
  check('[4] 틀린 자산 비밀번호 → 401 asset-wrong(로그인 화면으로 보내는 authRequired 없음)', wrong.every((x) => x === 401));
  const blocked = await unlock(b, ASSET_PW, ipAsset);
  const blockedBody = await codeOf(blocked);
  check('[4] 같은 IP 5번 틀림 → 맞는 비밀번호도 429 asset-blocked · 남은 15분', blocked.status === 429 && blockedBody.code === 'asset-blocked' && blockedBody.minutes === 15, `${blocked.status} ${blockedBody.minutes}`);
  const loginWhileAssetBlocked = await login(LOGIN_PW, ipAsset);
  check('[4] 자산 잠금 풀기가 막혀도 로그인은 된다(따로 센다)', loginWhileAssetBlocked.status === 200);
  check('[4] 이미 풀린 세션(A)은 막힘과 상관없이 그대로', (await sheet(a)).status === 503);

  // 반대 — 다른 IP 로 로그인 5번 틀려 로그인을 막아도 자산 풀기는 막히지 않는다(trust proxy = 루프백 → X-Forwarded-For 로 IP 를 나눈다)
  const ipLogin = { 'x-forwarded-for': '198.51.100.7' };
  const c = (await login(LOGIN_PW, ipLogin)).cookie;
  for (let i = 0; i < 5; i++) await login('wrong-login-x', ipLogin);
  check('[4] (반대) 로그인 5번 틀림 → 그 IP 로그인 429', (await login(LOGIN_PW, ipLogin)).status === 429);
  const assetAfterLoginBlock = await unlock(c, ASSET_PW, ipLogin);
  check('[4] (반대) 로그인이 막힌 IP 도 자산 잠금 풀기는 된다(따로 센다)', assetAfterLoginBlock.status === 200, String(assetAfterLoginBlock.status));

  // [5] 잠그기 · 로그아웃
  const lockRes = await call('POST', '/api/asset/lock', a);
  check('[5] 「잠그기」 → 200 · 다시 403 asset-locked', lockRes.status === 200 && (await sheet(a)).status === 403 && (await status(a)).unlocked === false);
  check('[5] 잠근 뒤 다시 풀 수 있다', (await unlock(a, ASSET_PW)).status === 200 && (await sheet(a)).status === 503);
  await call('POST', '/api/auth/logout', a);
  check('[5] 로그아웃 → 옛 세션은 401(로그인 문지기)', (await sheet(a)).status === 401);
  const a2 = (await login()).cookie;
  check('[5] 로그아웃 뒤 다시 로그인 → 자산은 다시 잠김(403)', (await sheet(a2)).status === 403 && (await status(a2)).unlocked === false);

  // [6] 로그인 비밀번호를 바꿔도 자산 비밀번호는 그대로 · 그 반대
  const assetBefore = assetRow();
  await setPassword(`${LOGIN_PW}-changed`);
  check('[6] 로그인 비밀번호를 바꿔도 자산 비밀번호 기록은 바이트까지 같다', assetRow() === assetBefore && (await checkPassword('asset.password', ASSET_PW)));
  const loginBefore = loginRow();
  await setAssetPassword(`${ASSET_PW}-changed`);
  check('[6] 자산 비밀번호를 바꿔도 로그인 비밀번호 기록은 바이트까지 같다', loginRow() === loginBefore && (await checkPassword('auth.owner', `${LOGIN_PW}-changed`)));
} catch (e) {
  fail++;
  say(`FAIL  시험 중 오류 — ${(e as Error).message}`);
} finally {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}


// ── 시트 읽기 — 가짜 시트 · 가짜 구글(이 프로세스의 fetch 바꿔치기) ──────────────────────
/*
  ⚠️ 실제 구글을 부르지 않는다: 연결 정보를 가짜(시트 ID · 시험용 RSA 열쇠)로 바꾸고, googleapis 주소는 모두 아래 가짜가 받는다.
  가짜 값은 일부러 눈에 띄는 숫자 — 13: 이 숫자들이 이 시험의 출력 · 서버 로그에 한 번도 나오지 않아야 한다.
*/
const FAKE = { cash: 987654321, retirement: 123123123, salary: 4567890, fx: 1388.77, usd: '77.4321', krw: 15234, qtyA: 3.5, qtyB: 12 };
const SECRET_STRINGS = ['987654321', '987,654,321', '123123123', '4567890', '4,567,890', '1388.77', '77.4321', '15234', '15,234'];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-asset-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-fake-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;

type Cell = string | number;
/** 가짜 시트 — '탭!칸' → 값 / 수식 */
function fakeSheet(): { values: Record<string, Cell>; formulas: Record<string, Cell> } {
  const v: Record<string, Cell> = {
    '티커!B12': '구분',
    '티커!D12': '자산 분류',
    '티커!G9': FAKE.fx,
    '티커!B14': '개별 투자', // 구분 줄(코드 없음)
    '티커!B15': '가짜 미국주', '티커!C15': 'NASDAQ:NVDA', '티커!D15': '주식',
    '티커!B16': '가짜 국내주', '티커!C16': '005930', '티커!D16': '채권',
    '티커!B17': 'KODEX 미국S&P500', '티커!C17': '0072R0', '티커!D17': '부동산', // 이름 띄어쓰기가 보유 줄과 다르다 · 알 수 없는 분류
    '티커!B19': '적립식 투자',
    '티커!B20': '가짜 금 ETF', '티커!C20': '411060', '티커!D20': '금',
    '티커!B21': '가짜 연금 주식', '티커!C21': '360750', '티커!D21': '주식',
    '티커!B22': '가짜 MMF', '티커!C22': '455890', '티커!D22': '현금',
    // 넣기 전 자리(E · F)에 엉뚱한 값 — 옛 주소로 읽으면 틀린다
    '티커!F9': 1.11,
    '주식 투자 정리!B3': '내 계좌 정보',
    '주식 투자 정리!B38': '내  계좌 정보', // 공백만 다름 — 같은 모양
    '주식 투자 정리!B4': '개별 투자 ( 2026.07 )',
    '주식 투자 정리!B12': '적립식 계좌 ( 2026.07 )',
    '주식 투자 정리!B21': 'ISA 계좌 ( 2026.07 )',
    '주식 투자 정리!B29': '연금 저축 계좌 ( 2026.07 )',
    // 개별 투자 — 5행: 미국(달러 수식) · 6행: 국내(숫자 · 이름 띄어쓰기 다름) · 7행: 빈 줄 · 8행: 이을 수식 없음
    '주식 투자 정리!B5': '가짜 미국주', '주식 투자 정리!C5': Number(FAKE.usd) * FAKE.fx, '주식 투자 정리!D5': FAKE.qtyA,
    '주식 투자 정리!B6': 'KODEX 미국 S&P500', '주식 투자 정리!C6': FAKE.krw, '주식 투자 정리!D6': FAKE.qtyB,
    '주식 투자 정리!B8': '이을 수식 없는 줄', '주식 투자 정리!C8': 1000, '주식 투자 정리!D8': 1,
    '주식 투자 정리!B9': '가짜 MMF', '주식 투자 정리!C9': 99000, '주식 투자 정리!D9': 1,
    // 적립식 · ISA · 연금 저축 — 106차 계산 시험
    '주식 투자 정리!B13': '가짜 국내주', '주식 투자 정리!C13': 60000, '주식 투자 정리!D13': 10,
    '주식 투자 정리!B22': '가짜 금 ETF', '주식 투자 정리!C22': 14000, '주식 투자 정리!D22': 4,
    '주식 투자 정리!B30': '가짜 연금 주식', '주식 투자 정리!C30': 25000, '주식 투자 정리!D30': 5,
    // 합계 표
    '주식 투자 정리!B39': '가짜 국내주', '주식 투자 정리!C39': 70000, '주식 투자 정리!D39': 2,
    '자산 투자 비율 관리!B18': '자산 배분 비율',
    '자산 투자 비율 관리!C18': 0.2, '자산 투자 비율 관리!D18': 0.1, '자산 투자 비율 관리!E18': 0.1, '자산 투자 비율 관리!F18': 0.6,
    '자산 투자 비율 관리!G23': 70, '자산 투자 비율 관리!G24': 30,
    '월 고정지출!B5': '현재 월 급여', '월 고정지출!C5': FAKE.salary,
    '현금!B25': '은행 자산 총액', '현금!C25': FAKE.cash,
    '현금!B30': '퇴직 연금 총액', '현금!C30': FAKE.retirement,
  };
  const f: Record<string, Cell> = { ...v,
    '주식 투자 정리!C5': `=(${FAKE.usd})*('티커'!$G$9)`, '주식 투자 정리!F5': "=D5*'티커'!$F$15",
    '주식 투자 정리!F6': "=D6*'티커'!$F$17",
    '주식 투자 정리!F9': "=D9*'티커'!$F$22",
    '주식 투자 정리!F13': "=D13*'티커'!$F$16",
    '주식 투자 정리!F22': "=D22*'티커'!$F$20",
    '주식 투자 정리!F30': "=D30*'티커'!$F$21",
    '주식 투자 정리!F39': "=D39*'티커'!$F$16",
  };
  return { values: v, formulas: f };
}

const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
/** `'탭'!B5:F9` · `'탭'!C25` → 줄 → 칸 (끝의 빈 칸 · 빈 줄은 구글처럼 잘라 낸다) */
function cut(model: Record<string, Cell>, range: string): Cell[][] {
  const m = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
  if (!m) throw new Error('범위 모양');
  const tab = m[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(m[2]), Number(m[3])];
  const [c2, r2] = m[4] ? [colNum(m[4]), Number(m[5])] : [c1, r1];
  const rows: Cell[][] = [];
  for (let r = r1; r <= r2; r++) {
    const row: Cell[] = [];
    for (let c = c1; c <= c2; c++) row.push(model[`${tab}!${colChr(c)}${r}`] ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

let sheetModel = fakeSheet();
let google = { token: 0, values: 0, formulas: 0, writes: 0 };
/** 가짜 구글이 받은 쓰기(범위 · 값 · valueInputOption) — [106-7] [106-8] */
let writesSeen: { range: string; value: unknown; input: string | null }[] = [];
/** 다음 시트 응답을 바꾼다 — 'ok' · 403 · 403 API 꺼짐 · 400 · 네트워크 · 쓰기만 403 */
let mode: 'ok' | '403' | '403-disabled' | '400' | 'down' | 'write-403' = 'ok';
const realFetch = globalThis.fetch;
/** [106-8] 실제 구글로 나간 요청 — 늘 0 이어야 한다(가짜가 모두 받는다) */
let realGoogleCalls = 0;
let jwtOk = true;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) {
    if (/google/.test(url)) realGoogleCalls++;
    return realFetch(input, init);
  }
  if (mode === 'down') throw new TypeError('fetch failed');
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    google.token++;
    const assertion = new URLSearchParams(String(init?.body ?? '')).get('assertion') ?? '';
    const [h, c, sig] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString()) as { scope?: string; aud?: string; iss?: string };
    jwtOk = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url')) && claims.scope === 'https://www.googleapis.com/auth/spreadsheets' && claims.aud === 'https://oauth2.googleapis.com/token' && claims.iss === 'selftest@example.invalid';
    return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), { status: 200 });
  }
  const method = init?.method ?? 'GET';
  // 쓰기(values.update) — 가짜 시트에 그대로 적는다(실제 구글에 가지 않는다)
  if (method === 'PUT' && /\/values\/[^:?]+\?/.test(url)) {
    google.writes++;
    const u = new URL(url);
    const range = decodeURIComponent(u.pathname.split('/values/')[1] ?? '');
    const body = JSON.parse(String(init?.body ?? '{}')) as { values?: unknown[][] };
    const value = body.values?.[0]?.[0];
    writesSeen.push({ range, value, input: u.searchParams.get('valueInputOption') });
    if (mode === 'write-403') return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
    const m = range.match(/^'((?:[^']|'')+)'!([A-Z]\d+)$/);
    if (m) {
      const key = `${m[1].replace(/''/g, "'")}!${m[2]}`;
      sheetModel.values[key] = String(value ?? '');
      sheetModel.formulas[key] = String(value ?? '');
    }
    return new Response(JSON.stringify({ updatedCells: 1 }), { status: 200 });
  }
  if (method !== 'GET' || !url.includes('/values:batchGet?')) {
    google.writes++;
    return new Response('{}', { status: 400 });
  }
  if (mode === '403') return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
  if (mode === '403-disabled') return new Response(JSON.stringify({ error: { code: 403, details: [{ reason: 'SERVICE_DISABLED' }] } }), { status: 403 });
  if (mode === '400') return new Response('{}', { status: 400 });
  const params = new URL(url).searchParams;
  const render = params.get('valueRenderOption');
  if (render === 'FORMULA') google.formulas++;
  else google.values++;
  const model = render === 'FORMULA' ? sheetModel.formulas : sheetModel.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(model, r) })) }), { status: 200 });
}) as typeof fetch;

/** 이 블록에서 찍힌 console 출력(서버 코드의 경고 포함) — 13 */
const captured: string[] = [];
const origLog = { log: console.log, warn: console.warn, error: console.error };
// [106-11] 하루 기록 로그(console.log)도 검사한다 — 아래 하루 기록 블록에서만 바꿔 끼운다
const logged: string[] = [];
/** [106-11] 계산한 총 자산 · 분류 금액(가짜 값) — 출력 · 로그에 나오면 안 된다 */
const totalsSecret: string[] = [];
for (const k of ['warn', 'error'] as const) console[k] = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); origLog[k](...args); };

const fresh = () => { resetSheetCache(); resetTokenCache(); google = { token: 0, values: 0, formulas: 0, writes: 0 }; writesSeen = []; mode = 'ok'; sheetModel = fakeSheet(); };
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AssetSheetError ? e.kind : `other:${(e as Error).message}`));

try {
  fresh();
  const data = await readAssetSheet();
  check('[B] 가짜 구글 — JWT RS256 서명이 맞고 scope 는 spreadsheets(106차 — 쓰기 포함) · aud 는 토큰 주소', jwtOk && google.token === 1);
  check('[B] 한 번 읽기 = 값 batchGet 1번 + 수식 batchGet 1번 · 쓰기 호출 0', google.values === 1 && google.formulas === 1 && google.writes === 0);
  await readAssetSheet();
  check('[B] 30초 안에 다시 읽으면 캐시(구글 호출 늘지 않음)', google.values === 1 && google.formulas === 1 && google.token === 1);

  const all = data.sections.flatMap((x) => x.holdings);
  const us = all.find((h) => h.row === 5);
  const kodex = all.find((h) => h.row === 6);
  const nolink = all.find((h) => h.row === 8);
  // [8] 잇기
  check('[8] [106-2] 보유 줄 ↔ 종목 줄 — F열 `\'티커\'!$F$NN`(넣은 뒤 주소)으로 잇는다(5행 → 티커 15행 NASDAQ:NVDA)', us?.code === 'NASDAQ:NVDA' && us?.tickerRow === 15);
  check('[106-2] 옛 주소 `\'티커\'!$E$NN` 은 잇지 않는다(넣기 전 수식 = 「티커」 E열 = 가격 칸)', linkedTickerRow("=D5*'티커'!$E$15") === null && linkedTickerRow("=D5*'티커'!$F$15") === 15);
  check('[106-2] 자산 분류는 「티커」 D열 — 주식 · 채권 그대로 · 네 글자가 아니면 null + 「알 수 없는 분류」 글자', us?.assetClass === '주식' && all.find((h) => h.row === 39)?.assetClass === '채권' && kodex?.assetClass === null && kodex?.assetClassUnknown === '부동산' && us?.assetClassUnknown === null);
  check('[106-2] 이을 수 없는 줄은 「티커」 줄 · 분류 없음(null)', nolink?.tickerRow === null && nolink?.assetClass === null);
  check('[8] 이름 띄어쓰기가 달라도(「KODEX 미국 S&P500」 ↔ 「KODEX 미국S&P500」) 줄 번호로 바르게 이어진다', kodex?.code === '0072R0' && kodex?.name === 'KODEX 미국 S&P500');
  check('[8] 이을 수식이 없는 줄은 코드 없음(이름으로 짐작하지 않는다) · 빈 줄은 건너뜀', nolink?.code === null && nolink?.market === null && !all.some((h) => h.row === 7));
  // [9] 평균 매입가
  check('[9] [106-2] `=(달러값)*(\'티커\'!$G$9)` → 달러 원래 값 · USD(환율을 곱한 값이 아니다)', us?.currency === 'USD' && us?.avgPrice === Number(FAKE.usd));
  const example = avgPriceOf("=(119.2338)*('티커'!$G$9)", 165000);
  check('[9] [106-2] 지시서 예시 수식(넣은 뒤 주소 G9 · 괄호 · 따옴표 · $) → USD · 괄호 안 값', example.currency === 'USD' && example.avgPrice === 119.2338);
  check('[106-2] 옛 주소 `…*(\'티커\'!$F$9)` 는 달러로 보지 않는다(원화 값 그대로)', avgPriceOf("=(119.2338)*('티커'!$F$9)", 165000).currency === 'KRW');
  check('[9] 숫자 칸 → 원화 KRW 그대로', kodex?.currency === 'KRW' && kodex?.avgPrice === FAKE.krw);
  // [10] 코드 나누기
  const nv = splitCode('NASDAQ:NVDA');
  check('[10] NASDAQ:NVDA → 미국 · 거래소 NASDAQ · 종목 NVDA', nv.market === 'US' && nv.exchange === 'NASDAQ' && nv.symbol === 'NVDA' && us?.market === 'US' && us?.symbol === 'NVDA');
  check('[10] 005930 · 0072R0 → 국내 · 코드 그대로', splitCode('005930').symbol === '005930' && splitCode('005930').market === 'KR' && splitCode('0072R0').symbol === '0072R0' && splitCode('0072R0').market === 'KR' && kodex?.market === 'KR');
  // 그 밖의 값 — 숫자는 찍지 않고 맞는지만
  check('[B] 구간 다섯 — 이름은 시트 글자 그대로 · 마지막은 합계 표 · 설정 key(합계 표는 null)', data.sections.length === 5 && data.sections[0].name === '개별 투자 ( 2026.07 )' && data.sections[4].combined && !data.sections[0].combined && data.sections[4].holdings[0]?.code === '005930' && JSON.stringify(data.sections.map((x) => x.key)) === JSON.stringify(['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌', null]));
  check('[B] [106-2] 현금 합계 · 퇴직 연금 · 월급 · 구매 평균 환율(「티커」 G9 — 옛 F9 가 아님)', data.cashTotal === FAKE.cash && data.retirement === FAKE.retirement && data.salary === FAKE.salary && data.avgFxRate === FAKE.fx);
  const t = data.targetRatio;
  check('[B] 목표 비율 — 비율(0.2)로 적힌 묶음은 백분율로 · 이미 백분율(70)인 묶음은 그대로', t.cash === 20 && t.gold === 10 && t.bond === 10 && t.invest === 60 && t.core === 70 && t.satellite === 30);
  check('[B] readAt 은 ISO 시각', !Number.isNaN(Date.parse(data.readAt)));

  // [7] 모양 확인 — 머리 글자가 다르면 값 없이 「모양 바뀜」
  fresh();
  sheetModel.values['현금!B25'] = '은행 자산';
  let shapeErr: AssetSheetError | null = null;
  try {
    await readAssetSheet();
  } catch (e) {
    shapeErr = e instanceof AssetSheetError ? e : null;
  }
  check('[7] 머리 글자가 다르면 kind shape · 어느 탭 · 어느 칸을 말한다', shapeErr?.kind === 'shape' && /「현금」 탭 B25/.test(shapeErr.message));
  check('[7] 모양이 다르면 수식은 읽지 않고 값도 돌려주지 않는다', google.formulas === 0 && !SECRET_STRINGS.some((x) => (shapeErr?.message ?? '').includes(x)));
  const r = sheetRanges();
  const fakeValues = r.values.map((x) => cut(sheetModel.values, x));
  let pureKind = '';
  try {
    parseAssetSheet(fakeValues, [], new Date().toISOString());
  } catch (e) {
    pureKind = e instanceof AssetSheetError ? e.kind : 'other';
  }
  check('[7] (순수 함수) 머리 글자가 다르면 값을 만들지 않는다', pureKind === 'shape');
  fresh();
  sheetModel.values['주식 투자 정리!B12'] = '다른 표';
  check('[7] 구간 이름 머리(앞부분 비교)가 다르면 shape', (await kindOf(readAssetSheet())) === 'shape');
  // [106-1] 「티커」 D12 ≠ 「자산 분류」(열을 아직 안 넣은 시트 — D12 는 옛 가격 칸 머리) → 값 없이 「모양 바뀜(티커 · D12)」
  fresh();
  sheetModel.values['티커!D12'] = '현재가';
  let d12Err: AssetSheetError | null = null;
  try {
    await readAssetSheet();
  } catch (e) {
    d12Err = e instanceof AssetSheetError ? e : null;
  }
  check('[106-1] 「티커」 D12 ≠ 자산 분류 → kind shape · 「티커」 탭 D12 를 말한다 · 수식은 읽지 않음', d12Err?.kind === 'shape' && /「티커」 탭 D12/.test(d12Err.message) && google.formulas === 0);
  fresh();
  delete sheetModel.values['티커!D12'];
  check('[106-1] 「티커」 D12 가 비어 있어도 shape', (await kindOf(readAssetSheet())) === 'shape');

  // 실패 이유
  fresh();
  mode = '403';
  check('[B] 403 → not-shared(시트를 공유하지 않음)', (await kindOf(readAssetSheet())) === 'not-shared');
  fresh();
  mode = '403-disabled';
  check('[B] 403 SERVICE_DISABLED → api-disabled', (await kindOf(readAssetSheet())) === 'api-disabled');
  fresh();
  mode = '400';
  check('[B] 400(탭 없음) → shape', (await kindOf(readAssetSheet())) === 'shape');
  fresh();
  mode = 'down';
  check('[B] 네트워크 끊김 → network', (await kindOf(readAssetSheet())) === 'network');
  fresh();
  process.env.GOOGLE_SA_KEY_FILE = path.join(tmp, 'none.json');
  check('[B] 열쇠 파일 없음 → key-file', (await kindOf(readAssetSheet())) === 'key-file');
  process.env.GOOGLE_SA_KEY_FILE = '';
  check('[11] 연결 정보 없음 → not-configured(구글을 부르지 않음)', (await kindOf(readAssetSheet())) === 'not-configured' && google.token === 0);
  process.env.GOOGLE_SA_KEY_FILE = keyFile;

  // [106-7] 자산 분류 쓰기 — 가짜 구글로만(실제 시트 쓰기 0)
  process.env.ASSET_SYNC_ENABLED = 'true';
  fresh();
  const wrote = await writeAssetClass(15, '금');
  const w0 = writesSeen[0];
  check('[106-7] 「티커」 D15(종목 줄)에 「금」 → values.update 1번 · 범위 \'티커\'!D15 · RAW · 값 그대로', google.writes === 1 && w0?.range === "'티커'!D15" && w0?.value === '금' && w0?.input === 'RAW');
  check('[106-7] 쓴 뒤 캐시를 비우고 다시 읽은 값을 돌려준다(5행 분류 = 금)', wrote.sections[0].holdings.find((h) => h.row === 5)?.assetClass === '금' && google.values === 1 && google.formulas === 2);
  fresh();
  await writeAssetClass(16, '');
  check('[106-7] 빈칸(지우기)도 쓴다', google.writes === 1 && writesSeen[0]?.value === '' && sheetModel.values['티커!D16'] === '');
  const refused = async (row: unknown, v: unknown) => {
    fresh();
    const k = await kindOf(writeAssetClass(row, v));
    return { k, writes: google.writes };
  };
  const r14 = await refused(14, '금'); // 구분 줄(「개별 투자」)
  const r18 = await refused(18, '금'); // 빈 줄
  check('[106-7] 구분 줄(D14) · 빈 줄(D18) → not-editable · 쓰기 0', r14.k === 'not-editable' && r18.k === 'not-editable' && r14.writes === 0 && r18.writes === 0, `${r14.k} ${r18.k}`);
  const outside = [];
  for (const row of [13, 43, 12, 15.5, '15', null]) outside.push(await refused(row, '금'));
  check('[106-7] D14~D42 밖(13 · 43 · 12) · 정수가 아닌 줄 번호 → not-editable · 구글 호출 0', outside.every((x) => x.k === 'not-editable' && x.writes === 0) && google.token === 0, outside.map((x) => x.k).join(','));
  const badValues = [];
  for (const v of ['부동산', ' 금', 1, null, '=A1']) badValues.push(await refused(15, v));
  check('[106-7] 네 글자 · 빈칸이 아닌 값(부동산 · 공백 섞임 · 숫자 · null · 수식) → not-editable · 쓰기 0', badValues.every((x) => x.k === 'not-editable' && x.writes === 0), badValues.map((x) => x.k).join(','));
  fresh();
  sheetModel.formulas['티커!D16'] = '=IF(A1,"주식","채권")';
  check('[106-7] 그 칸이 `=` 로 시작(수식) → formula-cell · 쓰지 않음', (await kindOf(writeAssetClass(16, '금'))) === 'formula-cell' && google.writes === 0);
  fresh();
  sheetModel.values['티커!D12'] = '현재가';
  sheetModel.formulas['티커!D12'] = '현재가';
  check('[106-7] 쓰기 직전 머리 D12 가 다르면 shape · 쓰지 않음', (await kindOf(writeAssetClass(15, '금'))) === 'shape' && google.writes === 0);
  fresh();
  mode = 'write-403'; // 읽기는 되고(뷰어) 쓰기만 403
  const deny = await writeAssetClass(15, '금').catch((e: unknown) => e);
  check('[106-7] 구글 403(쓰기 권한 없음) → not-shared · 「편집자」 안내', deny instanceof AssetSheetError && deny.kind === 'not-shared' && /편집자/.test(deny.message));
  fresh();
  process.env.ASSET_SYNC_ENABLED = 'false';
  check('[106-7] ASSET_SYNC_ENABLED=false → disabled · 구글 호출 0(토큰도 받지 않음)', (await kindOf(writeAssetClass(15, '금'))) === 'disabled' && google.token === 0 && google.writes === 0);
  process.env.ASSET_SYNC_ENABLED = 'true';

  // ── 106차 B — 총 자산 계산(가짜 시트 · 가짜 가격) ─────────────────────
  fresh();
  const sheetData = await readAssetSheet();
  const PRICE: Record<string, number> = { NVDA: 200, '0072R0': 20000, '005930': 70000, '411060': 15000, '360750': 30000, '455890': 100000 };
  const FX_NOW = 1400;
  const book = (over: Partial<Record<string, number | null>> = {}, fx: number | null = FX_NOW): PriceBook => {
    const prices = new Map<string, number>();
    for (const [k, v] of Object.entries({ ...PRICE, ...over })) if (v != null) prices.set(k, v);
    return { prices, usdKrw: fx };
  };
  const DEF = { pensionSections: ['연금 저축 계좌'], satelliteSymbols: ['NVDA'] };
  // 줄마다 평가(원) — 시험 안에서만 쓴다(출력하지 않는다)
  const v5 = 3.5 * 200 * FX_NOW; // 개별 · 미국 · 주식 → 위성
  const v6 = 12 * 20000; // 개별 · 알 수 없는 분류 → 분류 없음
  const v9 = 1 * 100000; // 개별 · 현금 분류 → 현금(위성 아님)
  const v13 = 10 * 70000; // 적립식 · 채권
  const v22 = 4 * 15000; // ISA · 금
  const v30 = 5 * 30000; // 연금 저축 · 주식 → 코어(연금 포함일 때만)
  const v39 = 2 * 70000; // 합친 표 — 더하지 않는다
  const near = (a: number | null | undefined, b: number) => a != null && Math.abs(a - b) < 1e-6;
  const grp = (t: AssetTotals, k: string) => t.groups.find((g) => g.key === k)?.amount;
  const off = computeAssetTotals(sheetData, book(), DEF, false);
  const on = computeAssetTotals(sheetData, book(), DEF, true);
  const plainTotal = FAKE.cash + v5 + v6 + v9 + v13 + v22;
  for (const n of [plainTotal, plainTotal + v30 + FAKE.retirement, FAKE.cash + v9]) totalsSecret.push(String(Math.round(n)), Math.round(n).toLocaleString('en-US'));
  check('[106-3] 총 자산 = 현금 C25 + 계좌 구간 평가 — 39~44행 합친 표는 더하지 않는다(이중 계산 없음)', near(off.totals.total, plainTotal) && !near(off.totals.total, plainTotal + v39));
  check('[106-3] 분류별 합 = 총 자산(합친 표 줄이 어느 분류에도 없다)', near(off.totals.groups.reduce((a, g) => a + g.amount, 0), off.totals.total));
  check('[106-4] 연금 꺼짐 → 연금 구간 보유 · 퇴직 연금(C30) 빠짐 · 퇴직 연금 칸 없음', near(off.totals.total, plainTotal) && !off.totals.groups.some((g) => g.key === 'retirement'));
  check('[106-4] 연금 켜짐 → 연금 구간 보유 + 퇴직 연금을 더함(퇴직 연금은 따로 한 칸)', near(on.totals.total, plainTotal + v30 + FAKE.retirement) && near(grp(on.totals, 'retirement'), FAKE.retirement));
  const isaPension = { ...DEF, pensionSections: ['ISA 계좌'] };
  const offIsa = computeAssetTotals(sheetData, book(), isaPension, false);
  check('[106-4] 연금 구간 설정을 ISA 로 바꾸면 그대로 따라감(꺼짐 → ISA 빠지고 연금 저축은 더함)', near(offIsa.totals.total, FAKE.cash + v5 + v6 + v9 + v13 + v30));
  check('[106-4-1] 분류 주식 + 개별 투자 = 위성 · 그 밖 구간 주식 = 코어(연금 포함일 때 연금 저축 주식)', near(on.totals.satellite, v5) && near(on.totals.core, v30) && near(off.totals.core, 0) && near(off.totals.satellite, v5));
  check('[106-4-1] 채권 · 금 · 현금 분류는 어느 구간이든 코어/위성에 안 들어감(개별 투자의 현금 분류 줄도)', near(grp(on.totals, 'stock'), v5 + v30) && near(on.totals.core + on.totals.satellite, v5 + v30) && near(grp(on.totals, 'cash'), FAKE.cash + v9) && near(grp(on.totals, 'bond'), v13) && near(grp(on.totals, 'gold'), v22));
  const sat2 = computeAssetTotals(sheetData, book(), { ...DEF, satelliteSymbols: ['NVDA', '360750'] }, true);
  check('[106-4-1] [107-1] 위성 종목을 바꾸면 따라감(연금 저축의 주식 360750 → 위성)', near(sat2.totals.satellite, v5 + v30) && near(sat2.totals.core, 0));
  check('[106-4] [106-2] 알 수 없는 분류(부동산)는 계산에서 분류 없음 · 개수 1', near(grp(off.totals, 'none'), v6) && off.unknownClassCount === 1);
  // [106-5] 미국 — 평가 × 토스 환율 · 매입 × G9
  const onlyUs = { ...sheetData, sections: sheetData.sections.map((x, i) => ({ ...x, holdings: i === 0 ? x.holdings.filter((h) => h.row === 5) : [] })) };
  const us1 = computeAssetTotals(onlyUs, book(), DEF, false);
  check('[106-5] 미국 평가 = 수량 × 토스 가격 × 토스 환율', near(us1.totals.total - FAKE.cash, 3.5 * 200 * FX_NOW));
  check('[106-5] 미국 매입 = 수량 × 달러 평균가 × G9(구매 평균 환율) — 평가 손익 · 비율', near(us1.profit?.amount, 3.5 * 200 * FX_NOW - 3.5 * Number(FAKE.usd) * FAKE.fx) && near(us1.profit?.ratio, (3.5 * 200 * FX_NOW) / (3.5 * Number(FAKE.usd) * FAKE.fx) - 1));
  const usNoFx = computeAssetTotals(onlyUs, book({}, null), DEF, false);
  check('[106-5] [106-6] 토스 환율이 없으면 미국 줄은 가격 못 받음(원화로 짐작하지 않는다)', usNoFx.totals.missing === 1 && near(usNoFx.totals.total, FAKE.cash));
  // [106-6] 가격 못 받은 줄
  const miss = computeAssetTotals(sheetData, book({ '411060': null }), DEF, false);
  check('[106-6] 가격 못 받은 줄은 총 자산에서 빠지고 개수 · 이름이 보인다(이을 수식 없는 줄 포함)', near(miss.totals.total, plainTotal - v22) && miss.totals.missing === 2 && miss.missingNames.includes('가짜 금 ETF') && miss.missingNames.includes('이을 수식 없는 줄'));
  check('[106-6] 가격을 다 받으면 못 받은 줄은 이을 수식 없는 줄 1개뿐', off.totals.missing === 1);

  // ── [107-1] 위성 = 분류 「주식」 + 위성 종목 코드 · 같은 코드는 계좌가 달라도 같은 쪽 · 주식 아님은 밖 ──
  const isaNvda = { ...sheetData.sections[0].holdings.find((h) => h.row === 5)!, row: 23 };
  const withIsaNvda = { ...sheetData, sections: sheetData.sections.map((x) => (x.key === 'ISA 계좌' ? { ...x, holdings: [...x.holdings, isaNvda] } : x)) };
  const same = computeAssetTotals(withIsaNvda, book(), DEF, true);
  check('[107-1] 같은 코드(NVDA)가 ISA 계좌에도 있으면 그 줄도 위성(계좌로 나누지 않음)', near(same.totals.satellite, 2 * v5) && near(same.totals.core, v30));
  const cashSat = computeAssetTotals(sheetData, book(), { ...DEF, satelliteSymbols: ['NVDA', '455890', '005930'] }, true);
  check('[107-1] 위성 목록에 있어도 분류가 주식이 아니면(현금 455890 · 채권 005930) 코어/위성 밖', near(cashSat.totals.satellite, v5) && near(cashSat.totals.core, v30) && near(grp(cashSat.totals, 'cash'), FAKE.cash + v9) && near(grp(cashSat.totals, 'bond'), v13));
  const noSat = computeAssetTotals(sheetData, book(), { ...DEF, satelliteSymbols: [] }, true);
  check('[107-1] 위성 목록이 비면 주식은 모두 코어', near(noSat.totals.satellite, 0) && near(noSat.totals.core, v5 + v30));

  // [107-8] 「상세 보기」 카드 머리 — 계좌마다 종목 수 · 평가 금액 합(가격 못 받은 줄은 빼고 개수) · 합친 표 없음 · 연금 포함과 상관없음
  const acc = accountValues(sheetData, book());
  check('[107-8] 계좌 카드 4개(시트 순서 · 합친 표 없음) · 종목 수 · 평가 금액 합 · 가격 못 받은 줄 수', JSON.stringify(acc.map((a) => [a.key, a.holdings, a.missing])) === JSON.stringify([['개별 투자', 4, 1], ['적립식 계좌', 1, 0], ['ISA 계좌', 1, 0], ['연금 저축 계좌', 1, 0]]) && near(acc[0].value, v5 + v6 + v9) && near(acc[1].value, v13) && near(acc[2].value, v22) && near(acc[3].value, v30) && acc[0].name === '개별 투자 ( 2026.07 )');

  // ── [107-2] 처음(저장값 없음) — 위성 = 개별 투자의 「주식」 종목 → 106차 계산(계좌로 나눔)과 같은 코어 · 위성 금액 ──
  /** 106차(v2.62.0) 코어/위성 계산 그대로 — 위성 계좌의 「주식」 = 위성 · 그 밖 계좌 「주식」 = 코어(비교 기준) */
  const legacy106 = (d: AssetSheetData, satelliteSections: string[], pensionSections: string[], includePension: boolean) => {
    let core = 0;
    let satellite = 0;
    for (const sec of d.sections) {
      if (sec.combined || !sec.key) continue;
      if (pensionSections.includes(sec.key) && !includePension) continue;
      for (const h of sec.holdings) {
        if (h.assetClass !== '주식' || !h.symbol || h.quantity == null) continue;
        const price = book().prices.get(h.symbol);
        if (price == null) continue;
        const v = h.market === 'US' ? h.quantity * price * FX_NOW : h.quantity * price;
        if (satelliteSections.includes(sec.key)) satellite += v;
        else core += v;
      }
    }
    return { core, satellite };
  };
  const SETTING_KEYS = `('asset.pensionSections', 'asset.satelliteSections', 'asset.satelliteSymbols', 'asset.classColors')`;
  const settingRow = (key: string) => (getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value;
  getDb().prepare(`DELETE FROM app_settings WHERE key IN ${SETTING_KEYS}`).run();
  const first = readAssetSettings(sheetData);
  check('[107-2] 처음 — 위성 종목 = 개별 투자의 분류 「주식」 종목(NVDA)만 · 저장됨', JSON.stringify(first.satelliteSymbols) === JSON.stringify(['NVDA']) && settingRow('asset.satelliteSymbols') === JSON.stringify(['NVDA']));
  for (const inc of [false, true]) {
    const nowCalc = computeAssetTotals(sheetData, book(), first, inc).totals;
    const old = legacy106(sheetData, ['개별 투자'], ['연금 저축 계좌'], inc);
    check(`[107-2] 처음 값의 코어 · 위성 = 106차 계산과 같음(연금 ${inc ? '포함' : '뺌'})`, near(nowCalc.core, old.core) && near(nowCalc.satellite, old.satellite) && old.satellite > 0);
  }
  writeAssetSettings({ satelliteSymbols: [] }, sheetData);
  check('[107-2] 한 번 정한 뒤로는 사용자 값(빈 목록도 그대로 — 다시 채우지 않음)', readAssetSettings(sheetData).satelliteSymbols.length === 0);

  // ── [107-3] 옛 위성 계좌 저장값 → 그 계좌들의 「주식」 종목으로 한 번 옮기고 옛 키를 지움 ──
  getDb().prepare(`DELETE FROM app_settings WHERE key IN ${SETTING_KEYS}`).run();
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.satelliteSections', ?)`).run(JSON.stringify(['개별 투자', '연금 저축 계좌']));
  const moved = readAssetSettings(sheetData);
  check('[107-3] 옛 asset.satelliteSections(개별 투자 · 연금 저축) → 위성 종목 NVDA · 360750 · 옛 키 지워짐', JSON.stringify(moved.satelliteSymbols) === JSON.stringify(['NVDA', '360750']) && settingRow('asset.satelliteSections') === undefined && settingRow('asset.satelliteSymbols') === JSON.stringify(['NVDA', '360750']));
  const movedOld = legacy106(sheetData, ['개별 투자', '연금 저축 계좌'], ['연금 저축 계좌'], true);
  const movedNow = computeAssetTotals(sheetData, book(), moved, true).totals;
  check('[107-3] 옮긴 뒤 코어 · 위성 = 옛 설정의 106차 계산과 같음', near(movedNow.core, movedOld.core) && near(movedNow.satellite, movedOld.satellite));
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.satelliteSections', ?)`).run(JSON.stringify(['ISA 계좌']));
  check('[107-3] 이미 옮긴 뒤 옛 키가 다시 생겨도 위성 종목은 그대로(한 번만 옮김)', JSON.stringify(readAssetSettings(sheetData).satelliteSymbols) === JSON.stringify(['NVDA', '360750']));
  getDb().prepare(`DELETE FROM app_settings WHERE key = 'asset.satelliteSections'`).run();

  // ── [107-4] 설정 저장 — 시트에 없는 계좌 · 코드 · 팔레트에 없는 색은 요청 전체를 거절 ──
  getDb().prepare(`DELETE FROM app_settings WHERE key IN ${SETTING_KEYS}`).run();
  const d0 = readAssetSettings(sheetData);
  check('[106-4] 설정 기본값 = 연금으로 볼 계좌 [연금 저축 계좌]', JSON.stringify(d0.pensionSections) === JSON.stringify(['연금 저축 계좌']));
  check('[106-4] 연금 계좌 바꾸기 — 시트 순서로 저장', JSON.stringify(writeAssetSettings({ pensionSections: ['연금 저축 계좌', 'ISA 계좌'] }, sheetData)?.pensionSections) === JSON.stringify(['ISA 계좌', '연금 저축 계좌']));
  const rejects = [
    { pensionSections: ['없는 계좌'] },
    { pensionSections: '연금 저축 계좌' },
    { satelliteSymbols: ['NVDA', 'NOPE'] },
    { satelliteSymbols: 'NVDA' },
    { classColors: { gold: 'gold-ish' } },
    { classColors: { none: 'red' } },
    { classColors: { gold: '#ffcc00' } },
    { pensionSections: ['ISA 계좌'], classColors: { gold: '없는 색' } },
    {},
    [],
  ];
  const before4 = JSON.stringify(readAssetSettings(sheetData));
  check('[107-4] 시트에 없는 계좌 · 종목 코드 · 팔레트에 없는 색(이름 · 색 값) · 분류 없음 색 · 빈 요청 → 거절 · 저장값 그대로', rejects.every((r) => writeAssetSettings(r, sheetData) === null) && JSON.stringify(readAssetSettings(sheetData)) === before4);
  check('[107-4] 위성 종목 · 색 저장 — 시트의 코드 · 팔레트 이름만', JSON.stringify(writeAssetSettings({ satelliteSymbols: ['360750', 'NVDA'], classColors: { gold: 'green' } }, sheetData)?.satelliteSymbols) === JSON.stringify(['360750', 'NVDA']) && readAssetSettings(sheetData).classColors.gold === 'green' && readAssetSettings(sheetData).classColors.cash === 'orange');
  const goneSheet = { ...sheetData, sections: sheetData.sections.map((x) => (x.key === '연금 저축 계좌' ? { ...x, holdings: [] } : x)) };
  check('[107-4] 시트에서 빠진 종목이 이미 위성 목록에 있으면 그대로 다시 저장할 수 있다', writeAssetSettings({ satelliteSymbols: ['360750', 'NVDA'] }, goneSheet) !== null);

  // ── [107-5] 분류 색 — 기본 금 노랑 · 현금 주황 · 저장값이 팔레트에 없으면 기본색 ──
  getDb().prepare(`DELETE FROM app_settings WHERE key IN ${SETTING_KEYS}`).run();
  const c0 = readAssetSettings(sheetData).classColors;
  check('[107-5] 분류 색 기본 = 금 노랑(yellow) · 현금 주황(orange) · 채권 보라 · 주식 파랑 · 퇴직 연금 분홍', c0.gold === 'yellow' && c0.cash === 'orange' && JSON.stringify(c0) === JSON.stringify(DEFAULT_CLASS_COLORS) && c0.bond === 'purple' && c0.stock === 'blue' && c0.retirement === 'pink');
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.classColors', ?)`).run(JSON.stringify({ gold: 'neon', cash: 'teal' }));
  const c1 = readAssetSettings(sheetData).classColors;
  check('[107-5] 저장값의 팔레트에 없는 이름은 기본색 · 있는 이름은 그대로', c1.gold === 'yellow' && c1.cash === 'teal');
  // 고르기 목록 — 분류 「주식」 + 목록에 남은 주식 아닌 종목(흐리게) · 어느 계좌인지
  const choices = stockChoices(withIsaNvda, { ...readAssetSettings(sheetData), satelliteSymbols: ['NVDA', '455890'] });
  check('[107-1] 고르기 목록 = 주식 종목(NVDA · 360750) + 목록에 남은 현금 종목(455890 · 주식 아님) · NVDA 계좌 둘', JSON.stringify(choices.map((c) => [c.symbol, c.isStock])) === JSON.stringify([['NVDA', true], ['455890', false], ['360750', true]]) && JSON.stringify(choices[0].sections) === JSON.stringify(['개별 투자', 'ISA 계좌']));
  getDb().prepare(`DELETE FROM app_settings WHERE key IN ${SETTING_KEYS}`).run();
  writeAssetSettings(DEF, sheetData);

  // ── [106-9] 하루 기록 — 가짜 시계 · 가짜 달력 · 가짜 가격 ─────────────
  const savedToss = { id: process.env.TOSS_CLIENT_ID, secret: process.env.TOSS_CLIENT_SECRET };
  process.env.TOSS_CLIENT_ID = 'selftest-not-real';
  process.env.TOSS_CLIENT_SECRET = 'selftest-not-real';
  setAssetPriceSourceForTest(async () => book());
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); origLog.log(...args); };
  type Range2 = [string, string];
  const range = ([s0, e0]: Range2) => ({ startTime: s0, endTime: e0 });
  /** 가짜 토스 달력 — 날마다 [미국 정규 · 애프터] · [국내 정규] (시각은 한국 시간 +09:00) */
  const calendar = (us: { date: string; reg: Range2; after: Range2 }[], kr: { date: string; reg: Range2 }[]) => async (market: string): Promise<TossCalendarResponse> => {
    const days = market === 'US' ? us.map((d) => ({ date: d.date, regularMarket: range(d.reg), afterMarket: range(d.after) })) : kr.map((d) => ({ date: d.date, integrated: { regularMarket: range(d.reg) } }));
    return { result: { previousBusinessDay: days[0] ?? null, today: days[1] ?? null, nextBusinessDay: days[2] ?? null } };
  };
  const at = (iso: string) => Date.parse(iso);
  const k = (d: string, hm: string) => `${d}T${hm}:00+09:00`;
  const usDay = (date: string, regS: string, regE: string, aftE: string, nextDate: string) => ({ date, reg: [k(date, regS), k(nextDate, regE)] as Range2, after: [k(nextDate, regE), k(nextDate, aftE)] as Range2 });
  const krDay = (date: string) => ({ date, reg: [k(date, '09:00'), k(date, '15:30')] as Range2 });
  const count = () => (getDb().prepare(`SELECT COUNT(*) AS n FROM asset_daily`).get() as { n: number }).n;
  clearRecordsForTest();
  // [107-6] 미국 정규장 종가 — 가짜 일봉(사본 DB 의 NVDA 일봉을 비우고 「다시 받기」 가 가짜 봉을 쓴다 · 토스 호출 0)
  /** 날짜 → 가짜 정규장 종가(없으면 200 = book() 의 NVDA · null = 그날 봉 없음) */
  const usCloses = new Map<string, number | null>();
  const CLOSE_DAYS = ['2026-10-22', '2026-10-23', '2026-11-05', '2026-11-06', '2026-11-25'];
  /** 가짜 봉을 받은 시각 — 정규장 끝 + 10분보다 앞이면 확정 값이 아니다 */
  let closeFetchedAt = Date.parse('2030-01-01T00:00:00Z');
  let refreshCalls = 0;
  getDb().prepare(`DELETE FROM candles WHERE symbol = 'NVDA' AND timeframe = '1d'`).run();
  setSessionHooksForTest({
    refreshDaily: async (symbol: string) => {
      refreshCalls++;
      getDb().prepare(`DELETE FROM candles WHERE symbol = ? AND timeframe = '1d'`).run(symbol);
      const bars = CLOSE_DAYS.flatMap((d) => {
        const c = usCloses.has(d) ? usCloses.get(d) : 200;
        return c == null ? [] : [{ timestamp: Date.parse(`${d}T12:00:00Z`), open: c, high: c, low: c, close: c, volume: 1000 }];
      });
      saveCandles(symbol, '1d', bars, closeFetchedAt);
    },
  });

  // 서머타임(EDT) — 애프터 끝 08:50 KST(국내 정규장 전) → 그 시각에 기록
  setSessionHooksForTest({ calendar: calendar([usDay('2026-10-22', '22:30', '05:00', '08:50', '2026-10-23'), usDay('2026-10-23', '22:30', '05:00', '08:50', '2026-10-24'), usDay('2026-10-26', '22:30', '05:00', '08:50', '2026-10-27')], [krDay('2026-10-22'), krDay('2026-10-23'), krDay('2026-10-26')]) });
  const t1 = await dailyTick(at(k('2026-10-23', '08:40')));
  const t2 = await dailyTick(at(k('2026-10-23', '08:55')));
  const t3 = await dailyTick(at(k('2026-10-23', '09:30')));
  check('[106-9] 서머타임 — 애프터 끝(08:50 KST) 전에는 쓰지 않고 · 끝난 뒤 1번 · 그날 거래일(10-22)로', t1 !== 'recorded' && t2 === 'recorded' && latestRecord()?.day === '2026-10-22' && count() === 1, `${t1} ${t2}`);
  check('[106-9] 같은 날 두 번 쓰지 않는다', t3 === 'done-already' && count() === 1, t3);
  const rec = latestRecord();
  check('[106-9] 기록 = 총 자산(연금 뺌) · 연금 포함 · 분류별 · 코어 · 위성 · 가격 못 받은 줄 수', rec != null && near(rec.total, off.totals.total) && near(rec.totalPension, on.totals.total) && near(rec.pension.core, v30) && near(rec.plain.satellite, v5) && rec.missing === 1 && rec.plain.groups.length === 5);

  // 서머타임 아님(EST) — 애프터 끝 09:50 KST 가 국내 정규장 안 → 국내 정규장 끝(15:30)까지 미룸
  setSessionHooksForTest({ calendar: calendar([usDay('2026-11-04', '23:30', '06:00', '09:50', '2026-11-05'), usDay('2026-11-05', '23:30', '06:00', '09:50', '2026-11-06'), usDay('2026-11-06', '23:30', '06:00', '09:50', '2026-11-07')], [krDay('2026-11-05'), krDay('2026-11-06'), krDay('2026-11-09')]) });
  const w1 = await dailyTick(at(k('2026-11-06', '10:00')));
  const w2 = await dailyTick(at(k('2026-11-06', '15:35')));
  check('[106-9] 서머타임 아님 — 애프터 끝(09:50 KST)이 국내 정규장 안이면 쓰지 않고 국내 정규장 끝(15:30) 뒤 1번', w1 === 'not-yet' && w2 === 'recorded' && latestRecord()?.day === '2026-11-05', `${w1} ${w2}`);

  // 서버 재시작 — 꺼져 있던 동안의 그날 것은 켜진 뒤 한 번(토요일 — 국내 휴장 → 애프터 끝 그대로) · 다음 정규장 시작 뒤에는 쓰지 않음
  setSessionHooksForTest({ calendar: calendar([usDay('2026-11-05', '23:30', '06:00', '09:50', '2026-11-06'), usDay('2026-11-06', '23:30', '06:00', '09:50', '2026-11-07'), usDay('2026-11-09', '23:30', '06:00', '09:50', '2026-11-10')], [krDay('2026-11-05'), krDay('2026-11-06'), krDay('2026-11-09')]) });
  const before = count();
  const late = await dailyTick(at(k('2026-11-10', '00:10'))); // 11-09 정규장(23:30)이 이미 시작 — 11-06 은 지난 날
  check('[106-9] 서버 재시작 — 다음 미국 정규장이 시작한 뒤에는 지난 날(11-06)을 채우지 않는다', late === 'expired' && count() === before, late);
  const r1 = await dailyTick(at(k('2026-11-07', '20:00'))); // 토요일 저녁에 켜짐 — 11-06 애프터는 09:50 에 끝났다
  check('[106-9] 서버 재시작 — 켜진 뒤 그날 것(11-06)을 한 번(국내 휴장일이라 미루지 않음)', r1 === 'recorded' && latestRecord()?.day === '2026-11-06' && count() === before + 1, r1);
  check('[106-9] 다시 켜도(같은 날) 또 쓰지 않는다', (await dailyTick(at(k('2026-11-08', '12:00')))) === 'done-already' && count() === before + 1);

  // 휴장(미국 추수감사절 11-26 — 달력에 그 날 칸이 없다) → 11-25 기록 뒤 11-26 것은 없다
  setSessionHooksForTest({ calendar: calendar([usDay('2026-11-24', '23:30', '06:00', '09:50', '2026-11-25'), usDay('2026-11-25', '23:30', '06:00', '09:50', '2026-11-26'), usDay('2026-11-27', '23:30', '03:00', '06:50', '2026-11-28')], [krDay('2026-11-25'), krDay('2026-11-26'), krDay('2026-11-27')]) });
  const h1 = await dailyTick(at(k('2026-11-26', '15:40')));
  const h2 = await dailyTick(at(k('2026-11-27', '15:40')));
  check('[106-9] 휴장 — 11-25 기록 뒤 미국 휴장일(11-26)은 기록하지 않는다(같은 11-25 로 두 번 쓰지 않음)', h1 === 'recorded' && latestRecord()?.day === '2026-11-25' && h2 === 'done-already', `${h1} ${h2}`);

  // ── [107-6] 하루 기록의 미국 종목 = 그 거래일 미국 정규장 종가(겨울 · 기록 시각 15:30 KST = 미국 주간거래 중) ──
  const winterCal = calendar([usDay('2026-11-04', '23:30', '06:00', '09:50', '2026-11-05'), usDay('2026-11-05', '23:30', '06:00', '09:50', '2026-11-06'), usDay('2026-11-06', '23:30', '06:00', '09:50', '2026-11-07')], [krDay('2026-11-05'), krDay('2026-11-06'), krDay('2026-11-09')]);
  const recordWinter = async (closeFor11_05: number | null, nowNvda: number) => {
    clearRecordsForTest();
    getDb().prepare(`DELETE FROM candles WHERE symbol = 'NVDA' AND timeframe = '1d'`).run(); // 앞 시험이 남긴 가짜 봉
    usCloses.clear();
    usCloses.set('2026-11-05', closeFor11_05);
    setSessionHooksForTest({ calendar: winterCal });
    setAssetPriceSourceForTest(async () => book({ NVDA: nowNvda })); // 토스 지금 가격 = 주간거래 체결이 섞인 값
    refreshCalls = 0;
    const r = await dailyTick(at(k('2026-11-06', '15:35')));
    return { r, rec: latestRecord(), refreshed: refreshCalls };
  };
  const wClose = await recordWinter(190, 260);
  const satAt = (p: number) => 3.5 * p * FX_NOW;
  check('[107-6] 겨울 15:35 KST 기록 — 미국 종목은 11-05 정규장 종가(190)로 · 토스 지금 가격(주간거래 260)이 섞이지 않음', wClose.r === 'recorded' && wClose.rec?.day === '2026-11-05' && near(wClose.rec?.plain.satellite, satAt(190)) && !near(wClose.rec?.plain.satellite, satAt(260)) && wClose.refreshed === 1, `${wClose.r} ${wClose.refreshed}`);
  check('[107-6] 국내 종목 · 현금 · 환율은 지금처럼(토스 지금 가격 — 채권 · 금 · 현금 칸이 106차 계산과 같음)', near(grp(wClose.rec!.plain, 'bond'), v13) && near(grp(wClose.rec!.plain, 'gold'), v22) && near(grp(wClose.rec!.plain, 'cash'), FAKE.cash + v9) && near(wClose.rec?.total, plainTotal - v5 + satAt(190)));
  const wMiss = await recordWinter(null, 260);
  check('[107-6] 그날 정규장 종가 봉이 없으면 그 미국 종목은 「가격 못 받음」(지금 가격으로 대신하지 않음 · 줄 수 +1)', wMiss.r === 'recorded' && wMiss.rec?.missing === 2 && near(wMiss.rec?.plain.satellite, 0) && near(wMiss.rec?.total, plainTotal - v5), `${wMiss.r} ${wMiss.rec?.missing}`);
  closeFetchedAt = at(k('2026-11-06', '06:05')); // 정규장 끝(06:00 KST) + 5분 — 아직 확정 값이 아님
  const wEarly = await recordWinter(190, 260);
  check('[107-6] 정규장 끝 + 10분 전에 받은 봉은 종가로 쓰지 않음 → 「가격 못 받음」', wEarly.r === 'recorded' && wEarly.rec?.missing === 2 && near(wEarly.rec?.plain.satellite, 0), `${wEarly.r} ${wEarly.rec?.missing}`);
  closeFetchedAt = Date.parse('2030-01-01T00:00:00Z');
  usCloses.clear();
  setAssetPriceSourceForTest(async () => book());
  const sumAfter = await assetSummary(false);
  check('[107-7] 화면의 지금 총 자산은 토스 지금 가격 그대로(하루 기록 종가와 상관없음)', near(sumAfter.totals.satellite, v5) && near(sumAfter.totals.total, plainTotal));

  // 스위치 꺼짐 · 모의 모드 · 가격 하나도 못 받음
  clearRecordsForTest();
  setSessionHooksForTest({ calendar: calendar([usDay('2026-10-22', '22:30', '05:00', '08:50', '2026-10-23'), usDay('2026-10-23', '22:30', '05:00', '08:50', '2026-10-24'), usDay('2026-10-26', '22:30', '05:00', '08:50', '2026-10-27')], [krDay('2026-10-22'), krDay('2026-10-23'), krDay('2026-10-26')]) });
  process.env.ASSET_SYNC_ENABLED = 'false';
  resetSheetCache();
  google = { token: 0, values: 0, formulas: 0, writes: 0 };
  const s1 = await dailyTick(at(k('2026-10-23', '09:00')));
  check('[106-9] ASSET_SYNC_ENABLED=false → 하루 기록 안 함 · 시트도 읽지 않음', s1 === 'off' && count() === 0 && google.values === 0, s1);
  process.env.ASSET_SYNC_ENABLED = 'true';
  process.env.TOSS_CLIENT_ID = '';
  check('[106-9] 모의 데이터 모드(토스 키 없음) → 하루 기록 안 함', (await dailyTick(at(k('2026-10-23', '09:00')))) === 'off' && count() === 0);
  process.env.TOSS_CLIENT_ID = 'selftest-not-real';
  setAssetPriceSourceForTest(async () => ({ prices: new Map(), usdKrw: null }));
  const np = await dailyTick(at(k('2026-10-23', '09:00')));
  check('[106-9] 가격을 하나도 못 받으면 쓰지 않고 다음 확인에 다시', np === 'no-prices' && count() === 0, np);
  setAssetPriceSourceForTest(async () => book());
  check('[106-9] 다음 확인에 가격을 받으면 그때 쓴다', (await dailyTick(at(k('2026-10-23', '09:05')))) === 'recorded' && count() === 1);
  check('[106-11] 하루 기록 로그 = 「하루 기록 완료 · 가격 못 받음 N줄」 뿐(금액 없음)', logged.filter((l) => l.startsWith('[asset]')).every((l) => /^\[asset\] 하루 기록 완료 · 가격 못 받음 \d+줄$/.test(l)) && logged.some((l) => l.startsWith('[asset] 하루 기록 완료')));

  // 어제보다 · 하루 기록 차트
  setAssetPriceSourceForTest(async () => book({ NVDA: 210 }));
  const sumNow = await assetSummary(false);
  check('[106-9] 어제보다 = 지금 총 자산 − 가장 최근 하루 기록(같은 연금 갈래) · 그 날짜', sumNow.vsLast?.day === '2026-10-22' && near(sumNow.vsLast?.amount, 3.5 * 10 * FX_NOW) && sumNow.includePension === false);
  const sumPension = await assetSummary(true);
  check('[106-4] summary — 연금 포함이면 퇴직 연금 칸 · 연금 포함 기록과 견줌', sumPension.totals.groups.some((g) => g.key === 'retirement') && near(sumPension.vsLast?.amount, 3.5 * 10 * FX_NOW));
  getDb().prepare(`INSERT INTO asset_daily (day, total, total_pension, totals_json, missing, recorded_at) VALUES ('2025-01-02', 1, 2, ?, 0, '2025-01-03T00:00:00Z')`).run(JSON.stringify({ plain: off.totals, pension: on.totals }));
  const nowRef = at(k('2026-10-24', '12:00'));
  check('[106-13] 하루 기록 기간 — 1m 은 최근 것만 · all 은 모두 · 날짜 순 · 연금 갈래', historyPoints('1m', false, nowRef).length === 1 && historyPoints('all', false, nowRef).map((p) => p.day).join(',') === '2025-01-02,2026-10-22' && historyPoints('all', true, nowRef)[0].total === 2);
  setSessionHooksForTest({ calendar: null, refreshDaily: null });
  setAssetPriceSourceForTest(async () => book());
  console.log = origLog.log;
  process.env.TOSS_CLIENT_ID = savedToss.id;
  process.env.TOSS_CLIENT_SECRET = savedToss.secret;
  if (savedToss.id === undefined) delete process.env.TOSS_CLIENT_ID;
  if (savedToss.secret === undefined) delete process.env.TOSS_CLIENT_SECRET;

  // 주소 그대로 — 로그인 문지기 + 자산 문지기 + 라우트(이 프로세스 안)
  fresh();
  const app = express();
  app.use(express.json());
  app.use(authGuard);
  app.use(assetRouter);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const token = createSession('selftest');
  const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
  const lockedRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  check('[2] (안쪽 서버) 풀기 전 sheet → 403 asset-locked · 구글 호출 0', lockedRes.status === 403 && google.token === 0);
  const putClass = (body: unknown) => fetch(`${base}/api/asset/class`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  check('[106-7] (안쪽 서버) 잠김 → PUT /api/asset/class 403 asset-locked · 쓰기 0', (await putClass({ row: 15, assetClass: '금' })).status === 403 && google.writes === 0);
  unlockSession(token);
  const okRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  const okBody = (await okRes.json()) as AssetSheetData;
  check('[B] (안쪽 서버) 풀린 뒤 sheet → 200 · 구간 다섯', okRes.status === 200 && okBody.sections.length === 5);
  const putOk = await putClass({ row: 15, assetClass: '금' });
  const putBody = (await putOk.json()) as AssetSheetData;
  check('[106-7] (안쪽 서버) 풀린 뒤 PUT /api/asset/class → 200 · 다시 읽은 시트 값', putOk.status === 200 && putBody.sections[0].holdings.find((h) => h.row === 5)?.assetClass === '금' && google.writes === 1);
  const putBad = await putClass({ row: 14, assetClass: '금' });
  const putFormula = (sheetModel.formulas['티커!D16'] = '=X1', await putClass({ row: 16, assetClass: '금' }));
  const sumRes = await fetch(`${base}/api/asset/summary?pension=1`, { headers: ck });
  const sumBody = (await sumRes.json()) as AssetSummary;
  const histRes = await fetch(`${base}/api/asset/history?range=all&pension=0`, { headers: ck });
  const badRange = await fetch(`${base}/api/asset/history?range=2y`, { headers: ck });
  const putSettings = (body: unknown) => fetch(`${base}/api/asset/settings`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const setOk = await putSettings({ satelliteSymbols: ['NVDA'] });
  const setBad = await putSettings({ satelliteSections: ['개별 투자'] });
  const setBadCode = await putSettings({ satelliteSymbols: ['NOPE'] });
  const setBadColor = await putSettings({ classColors: { gold: 'gold' } });
  const setColor = await putSettings({ classColors: { gold: 'red' } });
  const setColorBody = (await setColor.json()) as { classColors?: { gold?: string } };
  check('[107-4] (안쪽 서버) PUT /api/asset/settings — 옛 키 · 시트에 없는 코드 · 팔레트에 없는 색 400 · 팔레트 색 200', setBad.status === 400 && setBadCode.status === 400 && setBadColor.status === 400 && setColor.status === 200 && setColorBody.classColors?.gold === 'red');
  await putSettings({ classColors: { gold: 'yellow' } });
  check('[106-10] (안쪽 서버) 풀린 뒤 summary 200(연금 포함) · history 200 · 기간 틀림 400 · settings 200 / 옛 키 400', sumRes.status === 200 && sumBody.includePension === true && JSON.stringify(sumBody.accounts?.map((a) => a.key)) === JSON.stringify(['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌']) && sumBody.accounts[0].name === '개별 투자 ( 2026.07 )' && Array.isArray(sumBody.stockChoices) && sumBody.settings.classColors.gold === 'yellow' && histRes.status === 200 && badRange.status === 400 && setOk.status === 200 && setBad.status === 400);
  check('[106-7] (안쪽 서버) 구분 줄 400 not-editable · 수식 칸 409 formula-cell · 쓰기 늘지 않음', putBad.status === 400 && ((await putBad.json()) as { kind?: string }).kind === 'not-editable' && putFormula.status === 409 && google.writes === 1);
  resetSheetCache();
  sheetModel.values['티커!B12'] = '바뀐 머리';
  const shapeRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  const shapeBody = (await shapeRes.json()) as { kind?: string; error?: string; sections?: unknown };
  check('[7] (안쪽 서버) 모양 바뀜 → 502 · kind shape · 값 칸 없음', shapeRes.status === 502 && shapeBody.kind === 'shape' && shapeBody.sections === undefined);
  srv.close();
} catch (e) {
  fail++;
  say(`FAIL  시트 시험 중 오류 — ${(e as Error).message}`);
} finally {
  console.warn = origLog.warn;
  console.error = origLog.error;
  console.log = origLog.log;
  globalThis.fetch = realFetch;
  setSessionHooksForTest({ calendar: null, refreshDaily: null });
  setAssetPriceSourceForTest(null);
  fs.rmSync(tmp, { recursive: true, force: true });
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}

// ── 12 · 13 · 14 · 15 ─────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
}
const appCode = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// [106-8] 쓰기는 한 곳 — 106차부터 시트 쓰기(「티커」 D열 자산 분류)가 생겼다(101차 [12] 「쓰기 주소 0」 을 대신한다)
const codeFiles = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => ({ f: path.relative(root, f), src: fs.readFileSync(f, 'utf8') }));
const callers = codeFiles.flatMap(({ f, src }) => [...src.matchAll(/\bvaluesUpdate\(/g)].map(() => f));
const writeFnBody = (() => {
  const src = fs.readFileSync(path.join(root, 'server/asset/sheet.ts'), 'utf8');
  const i = src.indexOf('export async function writeAssetClass(');
  return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i));
})();
check('[106-8] 시트 쓰기 함수 valuesUpdate — 정의(google.ts) 1 + 부르는 곳 1(sheet.ts writeAssetClass)뿐', JSON.stringify(callers.sort()) === JSON.stringify(['server/asset/google.ts', 'server/asset/sheet.ts']) && /valuesUpdate\(/.test(writeFnBody), callers.join(','));
check('[106-8] 그 밖의 구글 쓰기 주소(batchUpdate · values:append · values:clear) 0 · PUT 은 google.ts 한 곳', !/batchUpdate|values:append|values:clear|values:batchClear/.test(appCode) && codeFiles.filter(({ src }) => /sheets\.googleapis\.com/.test(src)).map((x) => x.f).join(',') === 'server/asset/google.ts');
check('[106-8] 구글 scope 는 spreadsheets 하나(drive 등 다른 scope 없음)', /auth\/spreadsheets'/.test(appCode) && !/auth\/spreadsheets\.readonly/.test(appCode) && !/auth\/drive/.test(appCode));
check('[106-8] 실제 구글 호출 0 — 이 시험의 googleapis 요청은 모두 가짜가 받았다(쓰기는 가짜 응답으로만)', realGoogleCalls === 0);

// [107-5] 분류 색 — 옛 토큰 남는 곳 0 · 원형 · 표 점 · 설정 창이 같은 이름 → 클래스 표(assetColors.ts) 하나를 쓴다
const cssSrc = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
check('[107-5] 옛 색 토큰 --color-asset-* 와 그 클래스(bg · stroke -asset-cash 등) 남는 곳 0(src · server · index.css)', !/--color-asset-|-asset-(?:cash|bond|gold|stock|retirement|none)\b/.test(appCode + cssSrc));
const colorsSrc = fs.readFileSync(path.join(root, 'src/components/asset/assetColors.ts'), 'utf8');
check('[107-5] 팔레트 이름마다 --color-swatch-* 토큰 · 클래스가 있다(+ 분류 없음 회색)', ASSET_COLOR_IDS.every((id) => cssSrc.includes(`--color-swatch-${id}:`) && colorsSrc.includes(`'bg-swatch-${id}'`) && colorsSrc.includes(`'stroke-swatch-${id}'`)) && cssSrc.includes('--color-swatch-gray:'));
const assetUi = fs.readdirSync(path.join(root, 'src/components/asset')).map((f) => fs.readFileSync(path.join(root, 'src/components/asset', f), 'utf8'));
check('[107-5] 원형(groupStroke) · 분류별 표 점(groupDot)이 같은 표를 쓰고, 그 밖에 swatch 클래스를 직접 쓰는 화면 0', /groupStroke\(/.test(assetUi.join('\n')) && /groupDot\(/.test(assetUi.join('\n')) && codeFiles.filter(({ f, src }) => /\b(?:bg|stroke|text|fill|border)-swatch-/.test(src) && f !== 'src/components/asset/assetColors.ts').length === 0);

const leaked = (textAll: string) => SECRET_STRINGS.filter((x) => textAll.includes(x));
check('[13] 서버 로그(시험 서버) · 안쪽 경고 출력에 가짜 금액 · 수량이 없다', leaked(serverLog + captured.join('\n')).length === 0 && captured.some((l) => l.includes('[asset] 시트 읽기 실패: shape')));
check('[13] 이 시험의 출력에 가짜 금액 · 수량이 없다', leaked(printed.join('\n')).length === 0);
const allOut = [serverLog, captured.join('\n'), logged.join('\n'), printed.join('\n')].join('\n');
check('[106-11] 로그 · 시험 출력에 계산한 총 자산 · 분류 금액이 없다(출력 문자열 검사)', totalsSecret.length > 0 && totalsSecret.every((x) => !allOut.includes(x)) && leaked(allOut).length === 0);

const changed = spawnSync('git', ['diff', '--name-only', '0a2dc10', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[14] 매매 · 시황 · 자동매매 코드 바뀐 파일 0(0a2dc10 와 지금 작업 트리)', changed.status === 0 && changed.stdout.trim() === '', changed.stdout.trim() || changed.stderr.trim());
const changed106 = spawnSync('git', ['diff', '--name-only', 'c166ecd', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[106-12] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(c166ecd 와 지금 작업 트리)', changed106.status === 0 && changed106.stdout.trim() === '', changed106.stdout.trim() || changed106.stderr.trim());


// [15] 메뉴 — 계좌 대메뉴의 소메뉴는 「계좌 관리」 · 「자산 관리」 순서 · 대메뉴를 누르면 첫 소메뉴(appStore.setGroup 이 pages[0] 으로 간다 — 화면 클릭은 Playwright 로도 확인)
const accountGroup = NAV_GROUPS.find((g) => g.id === 'account');
check('[15] 계좌 소메뉴 = 계좌 관리(portfolio) · 자산 관리(asset) 순서', JSON.stringify(accountGroup?.pages.map((p) => [p.id, p.label])) === JSON.stringify([['portfolio', '계좌 관리'], ['asset', '자산 관리']]));
check('[15] 자산 관리는 상단 종목 헤더를 감춘다 · 종목이 없어도 열린다', pageMeta('asset')?.hidesSymbolHeader === true && !pageMeta('asset')?.needsSymbol);
const storeSrc = fs.readFileSync(path.join(root, 'src/store/appStore.ts'), 'utf8');
check('[15] 대메뉴를 누르면 첫 소메뉴로 간다(appStore.setGroup 이 pages[0]) → 「계좌」 = 「계좌 관리」', /setGroup: \(group\) => \{[\s\S]{0,400}?const landing = item\?\.pages\[0\]\?\.id;/.test(storeSrc) && accountGroup?.pages[0]?.id === 'portfolio');

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
