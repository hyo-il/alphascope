/**
 * 자산 관리 점검 — `npm run asset:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 101차 지시서 「꼭 지킬 동작」 1~15 를 줄마다 확인한다(시험 이름 앞의 [n] 이 그 줄 번호).
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
import { getDb } from '../server/db';
import { checkPassword, createSession, setPassword } from '../server/auth';
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { authGuard } from '../server/authGuard';
import { assetRouter } from '../server/asset/routes';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { avgPriceOf, parseAssetSheet, readAssetSheet, resetSheetCache, sheetRanges, splitCode } from '../server/asset/sheet';
import type { AssetSheetData } from '../src/types/asset';
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

  // [4] 맞는 비밀번호 → 풀림
  const okUnlock = await unlock(a, ASSET_PW);
  const s2 = await status(a);
  check('[4] 맞는 자산 비밀번호 → 200 · unlocked:true', okUnlock.status === 200 && s2.unlocked === true);
  const opened = await sheet(a);
  check('[4] 풀린 뒤 sheet 는 자산 문지기를 지난다(연결 정보 없음 → 503 not-configured)', opened.status === 503 && ((await opened.json()) as { kind?: string }).kind === 'not-configured', String(opened.status));
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
    '티커!F9': FAKE.fx,
    '티커!B14': '개별 투자', // 구분 줄(코드 없음)
    '티커!B15': '가짜 미국주', '티커!C15': 'NASDAQ:NVDA',
    '티커!B16': '가짜 국내주', '티커!C16': '005930',
    '티커!B17': 'KODEX 미국S&P500', '티커!C17': '0072R0', // 이름 띄어쓰기가 보유 줄과 다르다
    '티커!B19': '적립식 투자',
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
    '주식 투자 정리!C5': `=(${FAKE.usd})*('티커'!$F$9)`, '주식 투자 정리!F5': "=D5*'티커'!$E$15",
    '주식 투자 정리!F6': "=D6*'티커'!$E$17",
    '주식 투자 정리!F39': "=D39*'티커'!$E$16",
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
/** 다음 시트 응답을 바꾼다 — 'ok' · 403 · 403 API 꺼짐 · 400 · 네트워크 */
let mode: 'ok' | '403' | '403-disabled' | '400' | 'down' = 'ok';
const realFetch = globalThis.fetch;
let jwtOk = true;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  if (mode === 'down') throw new TypeError('fetch failed');
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    google.token++;
    const assertion = new URLSearchParams(String(init?.body ?? '')).get('assertion') ?? '';
    const [h, c, sig] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString()) as { scope?: string; aud?: string; iss?: string };
    jwtOk = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig ?? '', 'base64url')) && claims.scope === 'https://www.googleapis.com/auth/spreadsheets.readonly' && claims.aud === 'https://oauth2.googleapis.com/token' && claims.iss === 'selftest@example.invalid';
    return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }), { status: 200 });
  }
  if ((init?.method ?? 'GET') !== 'GET' || !url.includes('/values:batchGet?')) {
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
for (const k of ['warn', 'error'] as const) console[k] = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); origLog[k](...args); };

const fresh = () => { resetSheetCache(); resetTokenCache(); google = { token: 0, values: 0, formulas: 0, writes: 0 }; mode = 'ok'; sheetModel = fakeSheet(); };
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AssetSheetError ? e.kind : `other:${(e as Error).message}`));

try {
  fresh();
  const data = await readAssetSheet();
  check('[B] 가짜 구글 — JWT RS256 서명이 맞고 scope 는 spreadsheets.readonly · aud 는 토큰 주소', jwtOk && google.token === 1);
  check('[B] 한 번 읽기 = 값 batchGet 1번 + 수식 batchGet 1번 · 쓰기 호출 0', google.values === 1 && google.formulas === 1 && google.writes === 0);
  await readAssetSheet();
  check('[B] 30초 안에 다시 읽으면 캐시(구글 호출 늘지 않음)', google.values === 1 && google.formulas === 1 && google.token === 1);

  const all = data.sections.flatMap((x) => x.holdings);
  const us = all.find((h) => h.row === 5);
  const kodex = all.find((h) => h.row === 6);
  const nolink = all.find((h) => h.row === 8);
  // [8] 잇기
  check('[8] 보유 줄 ↔ 종목 줄 — F열 `\'티커\'!$E$NN` 으로 잇는다(5행 → 티커 15행 NASDAQ:NVDA)', us?.code === 'NASDAQ:NVDA');
  check('[8] 이름 띄어쓰기가 달라도(「KODEX 미국 S&P500」 ↔ 「KODEX 미국S&P500」) 줄 번호로 바르게 이어진다', kodex?.code === '0072R0' && kodex?.name === 'KODEX 미국 S&P500');
  check('[8] 이을 수식이 없는 줄은 코드 없음(이름으로 짐작하지 않는다) · 빈 줄은 건너뜀', nolink?.code === null && nolink?.market === null && !all.some((h) => h.row === 7));
  // [9] 평균 매입가
  check('[9] `=(달러값)*(\'티커\'!$F$9)` → 달러 원래 값 · USD(환율을 곱한 값이 아니다)', us?.currency === 'USD' && us?.avgPrice === Number(FAKE.usd));
  const example = avgPriceOf("=(119.2338)*('티커'!$F$9)", 165000);
  check('[9] 지시서 예시 수식 그대로(괄호 · 따옴표 · $) → USD · 괄호 안 값', example.currency === 'USD' && example.avgPrice === 119.2338);
  check('[9] 숫자 칸 → 원화 KRW 그대로', kodex?.currency === 'KRW' && kodex?.avgPrice === FAKE.krw);
  // [10] 코드 나누기
  const nv = splitCode('NASDAQ:NVDA');
  check('[10] NASDAQ:NVDA → 미국 · 거래소 NASDAQ · 종목 NVDA', nv.market === 'US' && nv.exchange === 'NASDAQ' && nv.symbol === 'NVDA' && us?.market === 'US' && us?.symbol === 'NVDA');
  check('[10] 005930 · 0072R0 → 국내 · 코드 그대로', splitCode('005930').symbol === '005930' && splitCode('005930').market === 'KR' && splitCode('0072R0').symbol === '0072R0' && splitCode('0072R0').market === 'KR' && kodex?.market === 'KR');
  // 그 밖의 값 — 숫자는 찍지 않고 맞는지만
  check('[B] 구간 다섯 — 이름은 시트 글자 그대로 · 마지막은 합계 표', data.sections.length === 5 && data.sections[0].name === '개별 투자 ( 2026.07 )' && data.sections[4].combined && !data.sections[0].combined && data.sections[4].holdings[0]?.code === '005930');
  check('[B] 현금 합계 · 퇴직 연금 · 월급 · 구매 평균 환율', data.cashTotal === FAKE.cash && data.retirement === FAKE.retirement && data.salary === FAKE.salary && data.avgFxRate === FAKE.fx);
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
  unlockSession(token);
  const okRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  const okBody = (await okRes.json()) as AssetSheetData;
  check('[B] (안쪽 서버) 풀린 뒤 sheet → 200 · 구간 다섯', okRes.status === 200 && okBody.sections.length === 5);
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
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}

// ── 12 · 13 · 14 · 15 ─────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
}
const appCode = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
check('[12] 구글 쓰기 주소 문자열 0(values:update · batchUpdate · values:append · values:clear) — server · src', !/values:update|batchUpdate|values:append|values:clear|values:batchClear/.test(appCode));
check('[12] 구글 scope 는 spreadsheets.readonly 뿐(쓰기 scope 없음)', /auth\/spreadsheets\.readonly/.test(appCode) && !/auth\/spreadsheets(?!\.readonly)/.test(appCode) && !/auth\/drive/.test(appCode));

const leaked = (textAll: string) => SECRET_STRINGS.filter((x) => textAll.includes(x));
check('[13] 서버 로그(시험 서버) · 안쪽 경고 출력에 가짜 금액 · 수량이 없다', leaked(serverLog + captured.join('\n')).length === 0 && captured.some((l) => l.includes('[asset] 시트 읽기 실패: shape')));
check('[13] 이 시험의 출력에 가짜 금액 · 수량이 없다', leaked(printed.join('\n')).length === 0);

const changed = spawnSync('git', ['diff', '--name-only', '0a2dc10', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[14] 매매 · 시황 · 자동매매 코드 바뀐 파일 0(0a2dc10 와 지금 작업 트리)', changed.status === 0 && changed.stdout.trim() === '', changed.stdout.trim() || changed.stderr.trim());


// [15] 메뉴 — 계좌 대메뉴의 소메뉴는 「계좌 관리」 · 「자산 관리」 순서 · 대메뉴를 누르면 첫 소메뉴(appStore.setGroup 이 pages[0] 으로 간다 — 화면 클릭은 Playwright 로도 확인)
const accountGroup = NAV_GROUPS.find((g) => g.id === 'account');
check('[15] 계좌 소메뉴 = 계좌 관리(portfolio) · 자산 관리(asset) 순서', JSON.stringify(accountGroup?.pages.map((p) => [p.id, p.label])) === JSON.stringify([['portfolio', '계좌 관리'], ['asset', '자산 관리']]));
check('[15] 자산 관리는 상단 종목 헤더를 감춘다 · 종목이 없어도 열린다', pageMeta('asset')?.hidesSymbolHeader === true && !pageMeta('asset')?.needsSymbol);
const storeSrc = fs.readFileSync(path.join(root, 'src/store/appStore.ts'), 'utf8');
check('[15] 대메뉴를 누르면 첫 소메뉴로 간다(appStore.setGroup 이 pages[0]) → 「계좌」 = 「계좌 관리」', /setGroup: \(group\) => \{[\s\S]{0,400}?const landing = item\?\.pages\[0\]\?\.id;/.test(storeSrc) && accountGroup?.pages[0]?.id === 'portfolio');

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
