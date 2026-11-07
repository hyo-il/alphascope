/**
 * 자산 관리 점검 — `npm run asset:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 101차 지시서 「꼭 지킬 동작」 1~15 를 줄마다 확인한다(시험 이름 앞의 [n] 이 그 줄 번호).
 * 106차(v2.62.0) 「꼭 지킬 동작」 1~13(4-1 포함)은 [106-n] — 「티커」 D열 자산 분류 · 쓰기 · 총 자산 계산 · 하루 기록.
 * 108차(v2.62.2) 「꼭 지킬 동작」 1~8 은 [108-n](미지정 하나 · 탭 · 위성 · 연금 · 공용 부품 옵션 · 매매 코드 0 — 화면 쪽은 Playwright 로도).
 * 109차(v2.63.0) 「꼭 지킬 동작」 1~10 은 [109-n] — 목표 비율 쓰기 · 비율 조정 계산 · 종목별 합치기 · 괜찮음 범위 설정(화면 7 은 Playwright).
 * 112차(v2.64.1) 「꼭 지킬 동작」 1~8 은 [112-n] — 시작 전 차례(묻지 않음 · 409) · 시작한 날 · 시트에 구매 차례의 달 · 확인 창 날짜 = 서버가 쓴 글자.
 * 111차(v2.64.0) 「꼭 지킬 동작」 1~10 은 [111-n] — 구매일 · 구매 차례 · 이번 달 구매 · 구매 완료(계좌 이름 날짜 쓰기 · 기록) · 요약 목표 비율 순서(화면 6 은 Playwright).
 * 107차(v2.62.1) 「꼭 지킬 동작」 1~11 은 [107-n] — 위성 종목 · 처음 값 · 옛 키 옮김 · 설정 검사 · 분류 색 · 하루 기록 미국 정규장 종가 · 계좌 카드 · 시트 쓰기 한 곳 · 매매 코드 0 · 출력에 금액 없음([106-11] · [13] 이 같은 검사).
 *   화면(8 의 카드 · 접기 · 글자 0 · 드롭다운 가운데 정렬 · 5 의 원형 · 표 같은 색)은 Playwright 로 따로 확인했다(보고서).
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
import { lockSession, setAssetPassword, unlockSession } from '../server/asset/lock';
import { authGuard } from '../server/authGuard';
import { assetRouter } from '../server/asset/routes';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { avgPriceOf, checkTargetRatio, linkedTickerRow, parseAssetSheet, readAssetSheet, replaceNameDate, resetSheetCache, sheetRanges, splitCode, writeAccountDates, writeAssetClasses, writeTargetRatio, ASSET_CLASS_MAX_ROWS } from '../server/asset/sheet';
import { computeMonthlyBuy, purchaseCycle, purchaseDayOf, setPurchaseClockForTest, type PurchaseCalendar } from '../server/asset/purchase';
import { clearPurchasesForTest, purchaseCountForTest, purchaseStartDayStoredForTest, recordPurchase } from '../server/asset/store';
import { ASSET_CLASSES, ASSET_COLOR_IDS, ASSET_GROUP_LABEL, COLORED_GROUP_KEYS, DEFAULT_CLASS_COLORS, UNASSIGNED_SHORT, isAssetClass, type AssetSheetData, type AssetSummary, type AssetTotals } from '../src/types/asset';
import { accountValues, computeAssetTotals, holdingsBySymbol, setAssetPriceSourceForTest, assetSummary, type PriceBook } from '../server/asset/summary';
import { readAssetSettings, stockChoices, writeAssetSettings } from '../server/asset/settings';
import { computeRebalance } from '../server/asset/rebalance';
import { clearRecordsForTest, historyPoints, insertRecord, latestRecord } from '../server/asset/store';
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
  const newApis: [string, string, unknown?][] = [['GET', '/api/asset/summary?pension=0'], ['GET', '/api/asset/history?range=1m&pension=0'], ['PUT', '/api/asset/class', { rows: [15], assetClass: '금' }], ['PUT', '/api/asset/settings', { pensionSections: [] }]];
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
  const offWrite = await call('PUT', '/api/asset/class', a, { rows: [15], assetClass: '금' });
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
    // 목표 비율 머리(쓰기 직전 확인 — 109차) · 시트 칸 순서 = 현금 · 금 · 채권 · 투자
    '자산 투자 비율 관리!C17': '현금성 자산(예금 적금)', '자산 투자 비율 관리!D17': '금', '자산 투자 비율 관리!E17': '채권', '자산 투자 비율 관리!F17': '투자 (주식)',
    '자산 투자 비율 관리!F23': '코어', '자산 투자 비율 관리!F24': '위성',
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
/** 가짜 구글이 받은 쓰기(범위 · 값 · valueInputOption) — [106-7] [106-8] [109-1] · 한 요청에 칸 여럿이면 칸마다 한 줄 */
let writesSeen: { range: string; value: unknown; input: string | null }[] = [];
/** 다음 시트 응답을 바꾼다 — 'ok' · 403 · 403 API 꺼짐 · 400 · 네트워크 · 쓰기만 403 */
let mode: 'ok' | '403' | '403-disabled' | '400' | 'down' | 'write-403' = 'ok';
const realFetch = globalThis.fetch;
/** [106-8] 실제 구글로 나간 요청 — 늘 0 이어야 한다(가짜가 모두 받는다) */
let realGoogleCalls = 0;
/** [109-2] 쓴 직후 시트를 바꿔 「다시 읽은 값이 다름」 을 만든다 */
let afterWrite: (() => void) | null = null;
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
  // 쓰기(values:batchUpdate — 109차부터 한 요청에 여러 칸) — 가짜 시트에 그대로 적는다(실제 구글에 가지 않는다). 숫자는 숫자 그대로
  if (method === 'POST' && /\/values:batchUpdate$/.test(url)) {
    google.writes++;
    const body = JSON.parse(String(init?.body ?? '{}')) as { valueInputOption?: string; data?: { range: string; values?: unknown[][] }[] };
    for (const d of body.data ?? []) writesSeen.push({ range: d.range, value: d.values?.[0]?.[0], input: body.valueInputOption ?? null });
    if (mode === 'write-403') return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
    for (const d of body.data ?? []) {
      const m = d.range.match(/^'((?:[^']|'')+)'!([A-Z]\d+)$/);
      const value = d.values?.[0]?.[0];
      if (m) {
        const key = `${m[1].replace(/''/g, "'")}!${m[2]}`;
        const cell = typeof value === 'number' ? value : String(value ?? '');
        sheetModel.values[key] = cell;
        sheetModel.formulas[key] = cell;
      }
    }
    if (afterWrite) afterWrite();
    return new Response(JSON.stringify({ totalUpdatedCells: body.data?.length ?? 0 }), { status: 200 });
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

const fresh = () => { resetSheetCache(); resetTokenCache(); google = { token: 0, values: 0, formulas: 0, writes: 0 }; writesSeen = []; mode = 'ok'; afterWrite = null; sheetModel = fakeSheet(); };
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
  check('[106-2] [108-1] 자산 분류는 「티커」 D열 — 주식 · 채권 그대로 · 네 글자가 아니면(부동산) 미지정(null) 하나 · 옛 「알 수 없는 분류」 칸 없음', us?.assetClass === '주식' && all.find((h) => h.row === 39)?.assetClass === '채권' && kodex?.assetClass === null && !('assetClassUnknown' in (kodex ?? {})));
  check('[106-2] [108-1] 이을 수 없는 줄은 「티커」 줄 없음 · 미지정(null)', nolink?.tickerRow === null && nolink?.assetClass === null);
  {
    // [115-1] 분류 값에서 「현금」 을 뺐다(v2.65.2) — 고르기 목록 = 채권 · 금 · 주식 · 시트에 「현금」 으로 적힌 줄(가짜 MMF · 「티커」 22행)은 미지정(null) · 시트 글자는 그대로
    const mmf = all.find((h) => h.row === 9);
    check('[115-1] 분류 값 = 채권 · 금 · 주식(「현금」 없음) · 시트 「현금」 글자 → 미지정(null) · 시트 글자는 읽기만(쓰기 0)',
      JSON.stringify(ASSET_CLASSES) === JSON.stringify(['채권', '금', '주식']) && !isAssetClass('현금') && mmf?.tickerRow === 22 && mmf?.assetClass === null && sheetModel.values['티커!D22'] === '현금' && google.writes === 0);
    check('[115-1] 분류 색 「현금」 설정은 그대로(색 고르는 묶음에 cash · 기본 주황)', COLORED_GROUP_KEYS.includes('cash') && DEFAULT_CLASS_COLORS.cash === 'orange' && ASSET_GROUP_LABEL.cash === '현금');
  }
  {
    // [108-1] 빈칸 · 네 글자가 아닌 글자(공백 · 영문 · 비슷한 글자) → 모두 미지정(null) 하나
    resetSheetCache();
    const saved = sheetModel;
    sheetModel = fakeSheet();
    for (const [cell, v] of [['D15', ''], ['D16', 'stock'], ['D20', '금 ETF'], ['D21', ' '], ['D22', '현금성']] as const) {
      sheetModel.values[`티커!${cell}`] = v;
      sheetModel.formulas[`티커!${cell}`] = v;
    }
    const odd = (await readAssetSheet()).sections.flatMap((x) => x.holdings).filter((h) => h.tickerRow != null && [15, 16, 20, 21, 22].includes(h.tickerRow));
    check('[108-1] 빈칸 · 「stock」 · 「금 ETF」 · 공백 · 「현금성」 → 모두 미지정(null) · 계산 묶음 이름 「미지정」 하나', odd.length >= 5 && odd.every((h) => h.assetClass === null) && ASSET_GROUP_LABEL.none === '미지정' && UNASSIGNED_SHORT === '-');
    sheetModel = saved;
    resetSheetCache();
  }
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
  const wrote = await writeAssetClasses([15], '금');
  const w0 = writesSeen[0];
  check('[106-7] [115-3] 한 줄 고르기도 일괄 함수 rows: [15] — 「티커」 D15(종목 줄)에 「금」 → 쓰기 요청 1번(칸 1) · 범위 \'티커\'!D15 · RAW · 값 그대로', google.writes === 1 && writesSeen.length === 1 && w0?.range === "'티커'!D15" && w0?.value === '금' && w0?.input === 'RAW');
  check('[106-7] [115-2] 쓴 뒤 쓴 칸을 다시 읽어 확인(수식 읽기 +1) · 캐시를 비우고 다시 읽은 값을 돌려준다(5행 분류 = 금)', wrote.sections[0].holdings.find((h) => h.row === 5)?.assetClass === '금' && google.values === 1 && google.formulas === 3);
  fresh();
  await writeAssetClasses([16], '');
  check('[106-7] 빈칸(지우기)도 쓴다', google.writes === 1 && writesSeen[0]?.value === '' && sheetModel.values['티커!D16'] === '');
  const refused = async (row: unknown, v: unknown) => {
    fresh();
    const k = await kindOf(writeAssetClasses([row], v));
    return { k, writes: google.writes };
  };
  const r14 = await refused(14, '금'); // 구분 줄(「개별 투자」)
  const r18 = await refused(18, '금'); // 빈 줄
  check('[106-7] 구분 줄(D14) · 빈 줄(D18) → not-editable · 쓰기 0', r14.k === 'not-editable' && r18.k === 'not-editable' && r14.writes === 0 && r18.writes === 0, `${r14.k} ${r18.k}`);
  const outside = [];
  for (const row of [13, 43, 12, 15.5, '15', null]) outside.push(await refused(row, '금'));
  check('[106-7] D14~D42 밖(13 · 43 · 12) · 정수가 아닌 줄 번호 → not-editable · 구글 호출 0', outside.every((x) => x.k === 'not-editable' && x.writes === 0) && google.token === 0, outside.map((x) => x.k).join(','));
  const badValues = [];
  for (const v of ['부동산', '현금', ' 금', 1, null, '=A1']) badValues.push(await refused(15, v));
  check('[106-7] [115-1] 세 글자 · 빈칸이 아닌 값(부동산 · 옛 「현금」 · 공백 섞임 · 숫자 · null · 수식) → not-editable · 쓰기 0', badValues.every((x) => x.k === 'not-editable' && x.writes === 0), badValues.map((x) => x.k).join(','));
  fresh();
  sheetModel.formulas['티커!D16'] = '=IF(A1,"주식","채권")';
  check('[106-7] 그 칸이 `=` 로 시작(수식) → formula-cell · 쓰지 않음', (await kindOf(writeAssetClasses([16], '금'))) === 'formula-cell' && google.writes === 0);
  fresh();
  sheetModel.values['티커!D12'] = '현재가';
  sheetModel.formulas['티커!D12'] = '현재가';
  check('[106-7] 쓰기 직전 머리 D12 가 다르면 shape · 쓰지 않음', (await kindOf(writeAssetClasses([15], '금'))) === 'shape' && google.writes === 0);
  fresh();
  mode = 'write-403'; // 읽기는 되고(뷰어) 쓰기만 403
  const deny = await writeAssetClasses([15], '금').catch((e: unknown) => e);
  check('[106-7] 구글 403(쓰기 권한 없음) → not-shared · 「편집자」 안내', deny instanceof AssetSheetError && deny.kind === 'not-shared' && /편집자/.test(deny.message));
  fresh();
  process.env.ASSET_SYNC_ENABLED = 'false';
  check('[106-7] ASSET_SYNC_ENABLED=false → disabled · 구글 호출 0(토큰도 받지 않음)', (await kindOf(writeAssetClasses([15], '금'))) === 'disabled' && google.token === 0 && google.writes === 0);
  process.env.ASSET_SYNC_ENABLED = 'true';
  // ── 115차 B — 자산 분류 일괄 쓰기 writeAssetClasses(가짜 구글로만 · 실제 시트 쓰기 0) ─────────────────────
  {
    fresh();
    const many = await writeAssetClasses([15, 20, 16, 15, 20], '주식');
    const ranges = writesSeen.map((w) => w.range);
    check('[115-2] 여러 줄 → 쓰기 요청 1번 · 같은 줄 중복은 한 번(15 · 16 · 20 세 칸) · RAW · 값 그대로',
      google.writes === 1 && JSON.stringify(ranges) === JSON.stringify(["'티커'!D15", "'티커'!D16", "'티커'!D20"]) && writesSeen.every((w) => w.value === '주식' && w.input === 'RAW'), ranges.join(','));
    check('[115-2] 쓴 뒤 다시 읽기 — 쓴 칸 확인 읽기(수식) + 시트 다시 읽기 · 돌려준 값에 세 줄 모두 주식',
      google.formulas === 3 && google.values === 1 && [5, 13, 22].every((r) => many.sections.flatMap((x) => x.holdings).find((h) => h.row === r)?.assetClass === '주식'));
    fresh();
    sheetModel.formulas['티커!D20'] = '=IF(A1,"금","채권")';
    const fk = await kindOf(writeAssetClasses([15, 16, 20], '금'));
    check('[115-2] 고른 줄 중 하나라도 수식 칸 → formula-cell(409) · 하나도 쓰지 않음', fk === 'formula-cell' && google.writes === 0 && sheetModel.values['티커!D15'] === '주식');
    fresh();
    const nk = await kindOf(writeAssetClasses([15, 14], '금'));
    const nk2 = await kindOf(writeAssetClasses([15, 18], '금'));
    check('[115-2] 종목 줄이 아닌 줄(구분 줄 14 · 빈 줄 18)이 섞이면 not-editable · 하나도 쓰지 않음', nk === 'not-editable' && nk2 === 'not-editable' && google.writes === 0);
    fresh();
    const shapes = [];
    for (const rows of [[], 15, null, [15, 43], [15, '16'], Array.from({ length: ASSET_CLASS_MAX_ROWS + 1 }, (_, i) => [15, 16, 20, 21, 22][i % 5])]) shapes.push(await kindOf(writeAssetClasses(rows, '금')));
    check('[115-2] 줄 목록 모양 — 빈 목록 · 배열 아님 · 범위 밖 · 글자 줄 → not-editable · 구글 호출 0 · 중복을 빼면 29줄 이하는 받음(30개 = 다섯 줄)',
      shapes.slice(0, 5).every((k) => k === 'not-editable') && shapes[5] !== 'not-editable' && ASSET_CLASS_MAX_ROWS === 29, shapes.join(','));
    fresh();
    const big = await kindOf(writeAssetClasses(Array.from({ length: 30 }, (_, i) => i + 13), '금'));
    check('[115-2] 서른 줄(13~42 — 13 은 범위 밖) → not-editable · 쓰기 0', big === 'not-editable' && google.writes === 0);
    fresh();
    afterWrite = () => { sheetModel.formulas['티커!D16'] = '채권'; };
    const mk = await kindOf(writeAssetClasses([15, 16], '금'));
    check('[115-2] 쓴 뒤 다시 읽은 값이 다르면 mismatch', mk === 'mismatch' && google.writes === 1);
    fresh();
    process.env.ASSET_SYNC_ENABLED = 'false';
    check('[115-2] 스위치 꺼짐 → disabled · 구글 호출 0', (await kindOf(writeAssetClasses([15, 16], '금'))) === 'disabled' && google.token === 0 && google.writes === 0);
    process.env.ASSET_SYNC_ENABLED = 'true';
    fresh();
    check('[115-1] 옛 「현금」 쓰기 → not-editable(400) · 구글 호출 0', (await kindOf(writeAssetClasses([15, 16], '현금'))) === 'not-editable' && google.token === 0);
  }

  // ── 109차 A — 목표 비율 쓰기(가짜 구글로만 · 실제 시트 쓰기 0) ─────────────────────
  {
    const TR = "'자산 투자 비율 관리'";
    const want = { cash: 10, bond: 20, gold: 30, invest: 40, core: 60, satellite: 40 };
    fresh(); // 가짜 시트: C18~F18 = 비율 모양(0.2 …) · G23~G24 = % 모양(70 · 30)
    const back = await writeTargetRatio(want);
    const at = (cell: string) => writesSeen.find((w) => w.range === `${TR}!${cell}`)?.value;
    check('[109-1] 칸 순서 — 현금 C18 · 금 D18 · 채권 E18 · 투자 F18 · 코어 G23 · 위성 G24(화면 순서 현금 · 채권 · 금 · 주식과 섞지 않음)',
      at('C18') === 0.1 && at('D18') === 0.3 && at('E18') === 0.2 && at('F18') === 0.4 && at('G23') === 60 && at('G24') === 40 && writesSeen.length === 6);
    check('[109-1] 원래 모양 그대로 — 비율 묶음(0.2 …)은 0.1 처럼 · % 묶음(70 · 30)은 60 처럼', at('C18') === 0.1 && at('G23') === 60);
    check('[109-1] 숫자로 보냄(글자 「10」 아님) · RAW · 한 요청(쓰기 1번)', writesSeen.every((w) => typeof w.value === 'number' && w.input === 'RAW') && google.writes === 1);
    check('[109-1] 쓴 뒤 다시 읽어 돌려준 목표 비율 = 보낸 값', JSON.stringify(back.targetRatio) === JSON.stringify({ cash: 10, gold: 30, bond: 20, invest: 40, core: 60, satellite: 40 }));
    fresh();
    for (const [c, v] of [['C18', 20], ['D18', 10], ['E18', 10], ['F18', 60]] as const) sheetModel.values[`자산 투자 비율 관리!${c}`] = sheetModel.formulas[`자산 투자 비율 관리!${c}`] = v;
    for (const c of ['G23', 'G24']) delete sheetModel.values[`자산 투자 비율 관리!${c}`], delete sheetModel.formulas[`자산 투자 비율 관리!${c}`];
    await writeTargetRatio(want);
    check('[109-1] % 모양(20 …)이면 정수 그대로 · 빈칸뿐인 묶음은 비율 모양(% 서식 칸 — 0.6)', at('C18') === 10 && at('D18') === 30 && at('G23') === 0.6 && at('G24') === 0.4);
    const bad = [
      { ...want, cash: 11 }, // 네 칸 합 101
      { ...want, core: 50 }, // 코어 + 위성 90
      { ...want, cash: 10.5, bond: 19.5 }, // 정수 아님
      { ...want, cash: -10, invest: 60 }, // 음수
      { ...want, cash: 110, bond: -10 }, // 100 넘음
      { ...want, cash: '10' }, // 글자
      { cash: 10, bond: 20, gold: 30, invest: 40, core: 100 }, // 칸 빠짐
      null,
    ];
    const badKinds = [];
    for (const b of bad) {
      fresh();
      badKinds.push({ k: await kindOf(writeTargetRatio(b)), token: google.token, writes: google.writes });
    }
    check('[109-1] 합 ≠ 100 · 정수 아님 · 0~100 밖 · 글자 · 칸 빠짐 → not-editable · 구글 호출 0', badKinds.every((x) => x.k === 'not-editable' && x.token === 0 && x.writes === 0) && checkTargetRatio(want) !== null, badKinds.map((x) => x.k).join(','));
    const formulaKinds = [];
    for (const [cell, f] of [['F18', '=1-C18-D18-E18'], ['G24', '=1-G23'], ['C18', '=0.1']] as const) {
      fresh();
      sheetModel.formulas[`자산 투자 비율 관리!${cell}`] = f;
      formulaKinds.push({ k: await kindOf(writeTargetRatio(want)), writes: google.writes });
    }
    check('[109-1] 여섯 칸 중 하나라도 수식(F18 · G24 · C18) → formula-cell · 하나도 쓰지 않음', formulaKinds.every((x) => x.k === 'formula-cell' && x.writes === 0), formulaKinds.map((x) => x.k).join(','));
    fresh();
    sheetModel.values['자산 투자 비율 관리!G23'] = sheetModel.formulas['자산 투자 비율 관리!G23'] = '코어 비율';
    check('[109-1] 숫자가 아닌 글자 칸 → not-editable · 쓰지 않음', (await kindOf(writeTargetRatio(want))) === 'not-editable' && google.writes === 0);
    fresh();
    sheetModel.formulas['자산 투자 비율 관리!D17'] = '채권';
    sheetModel.formulas['자산 투자 비율 관리!E17'] = '금';
    check('[109-1] 머리 글자 열 순서가 바뀜(D17 채권 · E17 금) → shape · 쓰지 않음', (await kindOf(writeTargetRatio(want))) === 'shape' && google.writes === 0);
    fresh();
    process.env.ASSET_SYNC_ENABLED = 'false';
    check('[109-1] ASSET_SYNC_ENABLED=false → disabled · 구글 호출 0(토큰도 받지 않음)', (await kindOf(writeTargetRatio(want))) === 'disabled' && google.token === 0 && google.writes === 0);
    process.env.ASSET_SYNC_ENABLED = 'true';
    fresh();
    mode = 'write-403';
    check('[109-1] 구글 403(쓰기 권한 없음) → not-shared', (await kindOf(writeTargetRatio(want))) === 'not-shared');
    fresh();
    afterWrite = () => { sheetModel.values['자산 투자 비율 관리!C18'] = 0.5; };
    const mm = await writeTargetRatio(want).catch((e: unknown) => e);
    check('[109-2] 쓴 뒤 다시 읽은 값이 다르면 mismatch 「시트에 쓴 값이 다르게 읽혔습니다」 · 값은 문구에 없음', mm instanceof AssetSheetError && mm.kind === 'mismatch' && mm.message.startsWith('시트에 쓴 값이 다르게 읽혔습니다') && !/\d/.test(mm.message));
    afterWrite = null;
  }

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
  const v6 = 12 * 20000; // 개별 · 네 글자가 아닌 분류(부동산) → 미지정
  const v9 = 1 * 100000; // 개별 · 시트 글자 「현금」 → v2.65.2 부터 미지정(현금 묶음은 「현금」 탭 금액만)
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
  check('[106-4-1] [115-1] 채권 · 금 · 미지정(옛 「현금」 글자) 분류는 어느 구간이든 코어/위성에 안 들어감 · 현금 묶음 = 「현금」 탭 C25 만', near(grp(on.totals, 'stock'), v5 + v30) && near(on.totals.core + on.totals.satellite, v5 + v30) && near(grp(on.totals, 'cash'), FAKE.cash) && near(grp(on.totals, 'bond'), v13) && near(grp(on.totals, 'gold'), v22));
  const sat2 = computeAssetTotals(sheetData, book(), { ...DEF, satelliteSymbols: ['NVDA', '360750'] }, true);
  check('[106-4-1] [107-1] 위성 종목을 바꾸면 따라감(연금 저축의 주식 360750 → 위성)', near(sat2.totals.satellite, v5 + v30) && near(sat2.totals.core, 0));
  check('[106-4] [108-1] [115-1] 세 글자가 아닌 분류(부동산 · 옛 「현금」)는 계산에서 미지정 묶음(이름 「미지정」) · 옛 「알 수 없는 분류」 개수 칸 없음', near(grp(off.totals, 'none'), v6 + v9) && off.totals.groups.find((g) => g.key === 'none')?.label === '미지정' && !('unknownClassCount' in off));
  // ── 109차 B — 비율 조정(순수 함수 · computeAssetTotals 결과 그대로) ─────────────────────
  {
    const TGT = { cash: 20, gold: 10, bond: 10, invest: 60, core: 70, satellite: 30 };
    const rOff = computeRebalance(off.totals, TGT, 5);
    const rOn = computeRebalance(on.totals, TGT, 5);
    const ex = (r: ReturnType<typeof computeRebalance>, k: string) => r.excluded.find((e) => e.key === k);
    const nowOf = (r: ReturnType<typeof computeRebalance>, k: string) => [...r.assets.rows, ...r.stocks.rows].find((x) => x.key === k)?.nowAmount;
    check('[109-3] 기준 금액 = 현금 + 채권 + 금 + 주식 — 미지정 · 가격 못 받은 종목은 빠지고 「빠짐」 줄(미지정 금액 · 가격 못 받음 줄 수)',
      near(rOff.assets.base, FAKE.cash + v13 + v22 + v5) && near(ex(rOff, 'none')?.amount ?? NaN, v6 + v9) && ex(rOff, 'missing')?.count === off.totals.missing && off.totals.missing > 0 && ex(rOff, 'missing')?.amount === null);
    check('[109-3] 「연금 포함」 켜면 기준에 연금 계좌가 더해지고 퇴직 연금은 빠짐 줄 · 끄면 퇴직 연금 줄 없음',
      near(rOn.assets.base, rOff.assets.base + v30) && near(ex(rOn, 'retirement')?.amount ?? NaN, FAKE.retirement) && ex(rOff, 'retirement') === undefined);
    check('[109-4] 비율 조정의 분류별 지금 금액 = computeAssetTotals(총 자산 탭)와 같은 값 · 코어 / 위성도',
      [rOff, rOn].every((r, n) => { const t = [off, on][n].totals; return (['cash', 'bond', 'gold', 'stock'] as const).every((k) => nowOf(r, k) === grp(t, k)) && nowOf(r, 'core') === t.core && nowOf(r, 'satellite') === t.satellite && r.stocks.base === grp(t, 'stock'); }));
    // 띠 경계 — 0.3 · 0.1 처럼 부동소수 오차가 나는 금액으로 정확히 5%p
    const synth: AssetTotals = { total: 1, core: 0.35, satellite: 0.15, missing: 0, groups: [
      { key: 'cash', label: '현금', amount: 0.3, ratio: null }, { key: 'bond', label: '채권', amount: 0.1, ratio: null },
      { key: 'gold', label: '금', amount: 0.1, ratio: null }, { key: 'stock', label: '주식', amount: 0.5, ratio: null }, { key: 'none', label: '미지정', amount: 0, ratio: null }] };
    const rb = computeRebalance(synth, { cash: 25, bond: 10, gold: 4, invest: 61, core: 75, satellite: 25 }, 5);
    const st = (k: string) => [...rb.assets.rows, ...rb.stocks.rows].find((x) => x.key === k);
    check('[109-3] 띠 안 = 괜찮음 · 경계값(정확히 5%p — 현금 −5 · 코어 +5)도 괜찮음 · 6%p · 11%p 는 조정 필요',
      st('cash')?.status === 'ok' && st('core')?.status === 'ok' && st('bond')?.status === 'ok' && st('gold')?.status === 'adjust' && st('stock')?.status === 'adjust' && st('satellite')?.status === 'ok');
    check('[109-3] 차이 금액 = 목표 − 지금(+ 더 사야 함 · − 줄여야 함 · 반올림 정수) · 차이 %p', (st('stock')?.diffAmount ?? 0) >= 0 && (st('cash')?.diffAmount ?? 0) <= 0 && Math.abs((st('gold')?.diffPp ?? 0) + 6) < 1e-9 && Number.isInteger(st('cash')?.diffAmount));
    const rb3 = computeRebalance(synth, { cash: 25, bond: 10, gold: 4, invest: 61, core: 75, satellite: 25 }, 3);
    check('[109-3] 괜찮음 범위를 바꾸면 상태가 따라감(5 → 3 이면 현금 5%p 는 조정 필요)', rb3.band === 3 && rb3.assets.rows[0].status === 'adjust');
    const rMiss = computeRebalance(synth, { cash: null, bond: 10, gold: 4, invest: 61, core: null, satellite: null }, 5);
    check('[109-3] 목표 칸이 비면 그 줄 목표 null · 상태 없음 · targetMissing · 아는 목표 합 75(≠ 100)',
      rMiss.assets.rows[0].targetPct === null && rMiss.assets.rows[0].status === null && rMiss.assets.rows[0].diffAmount === null && rMiss.assets.targetMissing && rMiss.assets.targetSum === 75 && rMiss.stocks.targetSum === null && !rb.assets.targetMissing && rb.assets.targetSum === 100);
    const zero: AssetTotals = { ...synth, missing: 0, groups: synth.groups.map((g) => ({ ...g, amount: 0 })), core: 0, satellite: 0 };
    const rz = computeRebalance(zero, TGT, 5);
    check('[109-3] 0원 · 0줄이면 빠짐 줄 없음 · 기준 0 이면 지금 % · 상태 없음', rz.excluded.length === 0 && rz.assets.rows.every((x) => x.nowPct === null && x.status === null));
    for (const r of [rOff, rOn]) totalsSecret.push(String(Math.round(r.assets.base)), Math.round(r.assets.base).toLocaleString('en-US'));    const cashRow = (r: ReturnType<typeof computeRebalance>) => r.assets.rows.find((x) => x.key === 'cash');
    check('[115-1] 비율 조정 현금 줄 지금 금액 = 「현금」 탭 C25 금액 = 총 자산 탭 현금 묶음(옛 「현금」 글자 종목은 미지정 빠짐 줄)',
      [rOff, rOn].every((r, n) => cashRow(r)?.nowAmount === FAKE.cash && grp([off, on][n].totals, 'cash') === FAKE.cash && (ex(r, 'none')?.amount ?? 0) >= v9));
  }
  // ── 109차 D — 종목별(같은 코드 여러 계좌 → 한 줄 · valuedRow 그대로 · 코어 / 위성 합 = 비율 조정 금액) ─────────────────────
  {
    // 가짜 시트 복사본에 ISA 계좌로 같은 종목(005930 · 적립식에도 있음)을 3주 더 넣는다
    const dup: AssetSheetData = structuredClone(sheetData);
    const src = dup.sections[1].holdings.find((h) => h.symbol === '005930')!;
    dup.sections[2].holdings.push({ ...src, row: 23, quantity: 3 });
    const satBoth = { ...DEF, satelliteSymbols: ['NVDA'] };
    const res = [false, true].map((pension) => {
      const t = computeAssetTotals(dup, book(), satBoth, pension);
      return { t, rows: holdingsBySymbol(dup, book(), satBoth, pension, t.totals.total), r: computeRebalance(t.totals, { cash: 25, gold: 25, bond: 25, invest: 25, core: 50, satellite: 50 }, 5) };
    });
    const [offR, onR] = res;
    const sam = offR.rows.filter((x) => x.symbol === '005930');
    check('[109-5] 같은 코드 여러 계좌 → 한 줄 · 있는 계좌 둘 · 수량 합 13(합친 표 39행 2주는 더하지 않음) · 금액 합 = 13 × 가격',
      sam.length === 1 && JSON.stringify(sam[0].sections) === JSON.stringify(['적립식 계좌', 'ISA 계좌']) && sam[0].quantity === 13 && near(sam[0].value, 13 * 70000) && sam[0].missing === 0);
    const sumSide = (rows: typeof offR.rows, side: 'core' | 'satellite') => rows.filter((x) => x.assetClass === '주식' && x.side === side).reduce((a, x) => a + (x.value ?? 0), 0);
    check('[109-5] 「코어 / 위성」 거르기 합 = 비율 조정 코어 / 위성 금액(연금 켬 · 끔)',
      res.every(({ rows, r }) => near(sumSide(rows, 'core'), r.stocks.rows[0].nowAmount) && near(sumSide(rows, 'satellite'), r.stocks.rows[1].nowAmount)) && sumSide(onR.rows, 'core') > 0 && sumSide(offR.rows, 'satellite') > 0);
    check('[109-5] 연금 끄면 연금 계좌 종목(360750) 빠짐 · 켜면 있음 · 분류가 주식이 아니면 코어/위성 없음',
      !offR.rows.some((x) => x.symbol === '360750') && onR.rows.some((x) => x.symbol === '360750' && x.side === 'core') && offR.rows.filter((x) => x.assetClass !== '주식').every((x) => x.side === null));
    const vals = offR.rows.map((x) => x.value);
    check('[109-5] 평가 금액 큰 순(금액 없음 맨 뒤) · 가격 못 받은 줄 금액 null · 비중 = 금액 ÷ 총 자산',
      vals.every((v, i) => i === 0 || v == null || (vals[i - 1] != null && (vals[i - 1] as number) >= v)) && offR.rows.some((x) => x.value === null && x.missing > 0) && offR.rows.every((x) => x.value == null ? x.ratio === null : near(x.ratio, x.value / offR.t.totals.total)));
    check('[109-5] 종목별 금액 합 + 현금 C25 + 퇴직 연금 = 총 자산(같은 값 계산)', res.every(({ t, rows }, n) => near(rows.reduce((a, x) => a + (x.value ?? 0), 0) + FAKE.cash + (n === 1 ? FAKE.retirement : 0), t.totals.total)));
  }
  // ── 109차 B — 괜찮음 범위 설정(asset.rebalanceBand · 정수 1~20 · 처음 값 5) ─────────────────────
  {
    getDb().prepare(`DELETE FROM app_settings WHERE key = 'asset.rebalanceBand'`).run();
    const first = readAssetSettings(sheetData).rebalanceBand;
    const rejects = [0, 21, 5.5, '5', null, -1].map((v) => writeAssetSettings({ rebalanceBand: v }, sheetData));
    const saved = writeAssetSettings({ rebalanceBand: 7 }, sheetData);
    const edge = [writeAssetSettings({ rebalanceBand: 1 }, sheetData)?.rebalanceBand, writeAssetSettings({ rebalanceBand: 20 }, sheetData)?.rebalanceBand];
    check('[109-6] asset.rebalanceBand — 처음 값 5 · 0 · 21 · 5.5 · 글자 · null · 음수 거절 · 7 · 1 · 20 저장',
      first === 5 && rejects.every((x) => x === null) && saved?.rebalanceBand === 7 && JSON.stringify(edge) === '[1,20]');
    getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.rebalanceBand', '"abc"') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
    check('[109-6] 저장값이 틀린 모양이면 5 로 읽음', readAssetSettings(sheetData).rebalanceBand === 5);
    getDb().prepare(`DELETE FROM app_settings WHERE key = 'asset.rebalanceBand'`).run();
  }
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
  check('[107-1] 위성 목록에 있어도 분류가 주식이 아니면(옛 「현금」 글자 → 미지정 455890 · 채권 005930) 코어/위성 밖 [115-1]', near(cashSat.totals.satellite, v5) && near(cashSat.totals.core, v30) && near(grp(cashSat.totals, 'cash'), FAKE.cash) && near(grp(cashSat.totals, 'bond'), v13));
  const noSat = computeAssetTotals(sheetData, book(), { ...DEF, satelliteSymbols: [] }, true);
  check('[107-1] 위성 목록이 비면 주식은 모두 코어', near(noSat.totals.satellite, 0) && near(noSat.totals.core, v5 + v30));

  // [107-8] 「자산 현황」 계좌 카드 머리 — 계좌마다 종목 수 · 평가 금액 합(가격 못 받은 줄은 빼고 개수) · 합친 표 없음 · 연금 포함과 상관없음
  const acc = accountValues(sheetData, book());
  for (const a of acc) if (a.value > 0) totalsSecret.push(String(Math.round(a.value)), Math.round(a.value).toLocaleString('en-US'));
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
  check('[107-4] 시트에 없는 계좌 · 종목 코드 · 팔레트에 없는 색(이름 · 색 값) · 미지정 색 · 빈 요청 → 거절 · 저장값 그대로', rejects.every((r) => writeAssetSettings(r, sheetData) === null) && JSON.stringify(readAssetSettings(sheetData)) === before4);
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

  // ── [108-4] 위성 [종목 추가] · 삭제 → 저장 → 코어/위성 금액이 바로 따라감(화면은 저장 뒤 요약을 다시 받는다) ──
  const sat0 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), true).totals;
  const added = writeAssetSettings({ satelliteSymbols: [...readAssetSettings(sheetData).satelliteSymbols, '360750'] }, sheetData);
  const sat1 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), true).totals;
  const removed = writeAssetSettings({ satelliteSymbols: (added?.satelliteSymbols ?? []).filter((x) => x !== 'NVDA') }, sheetData);
  const sat2b = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), true).totals;
  check('[108-4] 위성 추가(360750) → 위성 += 그 종목 · 코어 −= 그 종목 / 삭제(NVDA) → 위성 −= · 코어 += (합은 그대로)', near(sat0.satellite, v5) && near(sat1.satellite, v5 + v30) && near(sat1.core, sat0.core - v30) && JSON.stringify(removed?.satelliteSymbols) === JSON.stringify(['360750']) && near(sat2b.satellite, v30) && near(sat2b.core, v5) && near(sat2b.core + sat2b.satellite, sat0.core + sat0.satellite));
  // [108-4] [종목 추가] 창 목록 = 시트의 분류 「주식」 종목 중 아직 위성이 아닌 것(설정 창이 stockChoices 를 이렇게 거른다 · 관심 목록 · 검색 없음 = source)
  const dlgSrc = fs.readFileSync(new URL('../src/components/asset/AssetSettingsDialog.tsx', import.meta.url), 'utf8');
  const pickRows = stockChoices(withIsaNvda, { ...readAssetSettings(sheetData), satelliteSymbols: ['360750', '455890'] }).filter((c) => c.isStock && !['360750', '455890'].includes(c.symbol)).map((c) => c.symbol);
  check('[108-4] 창 목록 = 주식 종목 중 위성 아닌 것(NVDA) — 위성(360750) · 주식 아님(455890) 빠짐 · 설정 창이 같은 거르기 · source 로 넘김', JSON.stringify(pickRows) === JSON.stringify(['NVDA']) && /<SymbolTable[\s\S]*?source=\{\{[\s\S]*?\.filter\(\(c\) => c\.isStock && !shown\.satelliteSymbols\.includes\(c\.symbol\)\)/.test(dlgSrc));
  writeAssetSettings(DEF, sheetData);

  // ── [108-5] 연금 [계좌 추가] · 삭제 → 「연금 포함」 끔 계산이 따라감 ──
  const pen0 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), false).totals.total;
  writeAssetSettings({ pensionSections: ['연금 저축 계좌', 'ISA 계좌'] }, sheetData);
  const pen1 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), false).totals.total;
  writeAssetSettings({ pensionSections: ['ISA 계좌'] }, sheetData);
  const pen2 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), false).totals.total;
  writeAssetSettings({ pensionSections: [] }, sheetData);
  const pen3 = computeAssetTotals(sheetData, book(), readAssetSettings(sheetData), false);
  check('[108-5] 연금 계좌 추가(ISA) → 연금 뺌 총 자산 −= ISA · 삭제(연금 저축) → += 연금 저축 · 모두 삭제 → 퇴직 연금만 빠짐', near(pen1, pen0 - v22) && near(pen2, pen0 - v22 + v30) && near(pen3.totals.total, plainTotal + v30) && JSON.stringify(readAssetSettings(sheetData).pensionSections) === '[]' && !pen3.totals.groups.some((g) => g.key === 'retirement'));
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
  {
    // [108-1] 옛 하루 기록(v2.62.0 · v2.62.1 — 묶음 이름 「분류 없음」)은 읽을 때 「미지정」 · 저장값은 그대로
    const oldTotals = (t: AssetTotals): AssetTotals => ({ ...t, groups: t.groups.map((g) => (g.key === 'none' ? { ...g, label: '분류 없음' } : g)) });
    insertRecord('2020-01-02', oldTotals(off.totals), oldTotals(on.totals), new Date(0).toISOString());
    const rec = latestRecord();
    const raw = (getDb().prepare(`SELECT totals_json FROM asset_daily WHERE day = '2020-01-02'`).get() as { totals_json: string }).totals_json;
    check('[108-1] 옛 하루 기록의 「분류 없음」 → 읽을 때 「미지정」(연금 뺌 · 포함 둘 다) · 저장값은 고치지 않음', rec?.plain.groups.find((g) => g.key === 'none')?.label === '미지정' && rec?.pension.groups.find((g) => g.key === 'none')?.label === '미지정' && raw.includes('분류 없음'));
    clearRecordsForTest();
  }
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
  for (const n of [wClose.rec?.total, wClose.rec?.totalPension]) if (n != null) totalsSecret.push(String(Math.round(n)), Math.round(n).toLocaleString('en-US'));
  const satAt = (p: number) => 3.5 * p * FX_NOW;
  check('[107-6] 겨울 15:35 KST 기록 — 미국 종목은 11-05 정규장 종가(190)로 · 토스 지금 가격(주간거래 260)이 섞이지 않음', wClose.r === 'recorded' && wClose.rec?.day === '2026-11-05' && near(wClose.rec?.plain.satellite, satAt(190)) && !near(wClose.rec?.plain.satellite, satAt(260)) && wClose.refreshed === 1, `${wClose.r} ${wClose.refreshed}`);
  check('[107-6] 국내 종목 · 현금 · 환율은 지금처럼(토스 지금 가격 — 채권 · 금 칸이 106차 계산과 같음 · 현금 칸 = 「현금」 탭 금액만 [115-1])', near(grp(wClose.rec!.plain, 'bond'), v13) && near(grp(wClose.rec!.plain, 'gold'), v22) && near(grp(wClose.rec!.plain, 'cash'), FAKE.cash) && near(wClose.rec?.total, plainTotal - v5 + satAt(190)));
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


  // ── 111차 — 구매일 · 구매 차례 · 이번 달 구매 · 계좌 이름 날짜 쓰기(가짜 구글로만 · 실제 시트 쓰기 0) ─────────────────────
  {
    const calOf = (holidays: string[], checked = true): PurchaseCalendar => ({ isClosed: (d) => holidays.includes(d), isChecked: () => checked });
    const none = calOf([]);
    check('[111-1] 구매일 2026-11 → 11-27(26일 목 → 그 주 금)', purchaseDayOf(2026, 11, none.isClosed) === '2026-11-27');
    check('[111-1] 구매일 2026-12(가짜 달력 12-25 휴장) → 12-24(26일 토 → 25일 금 휴장 → 그 전 거래일)', purchaseDayOf(2026, 12, calOf(['2026-12-25']).isClosed) === '2026-12-24');
    check('[111-1] 구매일 2027-01 → 01-29(26일 화 → 그 주 금)', purchaseDayOf(2027, 1, none.isClosed) === '2027-01-29');
    check('[111-1] 26일이 일요일인 달(2026-07) → 24일(금) · 토요일인 달(2026-09) → 25일(금)', purchaseDayOf(2026, 7, none.isClosed) === '2026-07-24' && purchaseDayOf(2026, 9, none.isClosed) === '2026-09-25');
    check('[111-1] 금요일 휴장 · 그 전날도 휴장 → 이틀 앞(2027-01 → 01-27 수)', purchaseDayOf(2027, 1, calOf(['2027-01-29', '2027-01-28']).isClosed) === '2027-01-27');
    check('[111-1] 금요일 휴장이고 앞이 주말이면 주말을 건너뜀(2026-07-24 · 23 · 22 · 21 · 20 휴장 → 07-17)', purchaseDayOf(2026, 7, calOf(['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20']).isClosed) === '2026-07-17');
    const inRange = purchaseCycle('2026-11-27', none);
    const outRange = purchaseCycle('2026-11-27', { isClosed: () => false, isChecked: (d) => d < '2026-12-01' });
    check('[111-1] 달력 범위 밖 날짜가 있으면 「휴장일 확인 못 함」(calendarUnchecked) · 범위 안이면 없음', inRange.calendarUnchecked === false && outRange.calendarUnchecked === true);
    const realCal = purchaseCycle('2026-11-27', { isClosed: () => false, isChecked: () => false });
    check('[111-1] 달력 범위 밖(주말만 휴장으로 봄)이어도 날짜는 평일로 셈', realCal.cycleDay === '2026-11-27' && realCal.nextDay === '2026-12-25' && realCal.calendarUnchecked);

    const xmas = calOf(['2026-12-25']);
    const c1 = purchaseCycle('2026-11-26', xmas);
    const c2 = purchaseCycle('2026-11-27', xmas);
    const c3 = purchaseCycle('2026-12-23', xmas);
    const c4 = purchaseCycle('2026-12-24', xmas);
    check('[111-2] 구매일 전날(11-26) → 지난달 차례(10-30) · 다음 구매일 11-27', c1.cycleDay === '2026-10-30' && c1.nextDay === '2026-11-27');
    check('[111-2] 구매일 당일(11-27) → 이번 달 차례 · 다음 12-24', c2.cycleDay === '2026-11-27' && c2.nextDay === '2026-12-24');
    check('[111-2] 다음 달 구매일 전날(12-23)까지 같은 차례(11-27) · 그날(12-24)부터 새 차례', c3.cycleDay === '2026-11-27' && c4.cycleDay === '2026-12-24' && c4.nextDay === '2027-01-29');
    const febMon = purchaseCycle('2027-03-01', { isClosed: (d) => d === '2027-03-01', isChecked: () => true });
    check('[111-2] 차례는 늘 오늘 이하 · 다음은 오늘 뒤(달이 넘어가는 구매일도)', febMon.cycleDay <= '2027-03-01' && febMon.nextDay > '2027-03-01');

    const T = { cash: 20, gold: 10, bond: 10, invest: 60, core: 70, satellite: 30 };
    const odd = 1_000_003; // 반올림 차이가 생기는 월급(가짜)
    const mb = computeMonthlyBuy(odd, T);
    const amt = (k: string) => mb.rows.find((r) => r.key === k)?.amount ?? NaN;
    check('[111-3] 이번 달 구매 — 현금 · 채권 · 금 · 주식 합 = 월급(반올림 차이는 주식 · 코어에)', amt('cash') + amt('bond') + amt('gold') + amt('stock') === odd && mb.total === odd);
    check('[111-3] 코어 + 위성 = 주식 · 위성 = 주식 × 위성 % 반올림', amt('core') + amt('satellite') === amt('stock') && amt('satellite') === Math.round((amt('stock') * 30) / 100));
    check('[111-3] 줄 순서 = 현금 · 채권 · 금 · 주식 · 코어 · 위성 · 금액은 원 단위 정수', mb.rows.map((r) => r.key).join(',') === 'cash,bond,gold,stock,core,satellite' && mb.rows.every((r) => Number.isInteger(r.amount)));
    const noPay = [computeMonthlyBuy(null, T), computeMonthlyBuy(0, T)];
    check('[111-3] 월급 없음(빈칸 · 0) → noSalary · 금액 모두 null', noPay.every((x) => x.noSalary && x.total === null && x.rows.every((r) => r.amount === null)));
    const off = computeMonthlyBuy(odd, { ...T, cash: 25 });
    check('[111-3] 목표 합 ≠ 100 → 합 105 를 돌려줌(화면 경고 줄) · 각 줄은 월급 × % 그대로(맞추지 않음)', off.assetTargetSum === 105 && off.rows.find((r) => r.key === 'stock')?.amount === Math.round(odd * 0.6));
    const blank = computeMonthlyBuy(odd, { ...T, gold: null, satellite: null });
    check('[111-3] 목표 빈칸 → 그 줄 null(「-」) · targetMissing · 코어는 주식 × 코어 %', blank.targetMissing && blank.rows.find((r) => r.key === 'gold')?.amount === null && blank.rows.find((r) => r.key === 'satellite')?.amount === null && blank.rows.find((r) => r.key === 'core')?.amount === Math.round((Math.round(odd * 0.6) * 70) / 100));

    // 이름 글자 — 날짜 부분만 같은 모양으로
    check('[111-4] 날짜 부분만 바뀜 — 「( YYYY.MM )」 · 「( YYYY.MM)」(빈칸 모양 그대로) · 「(YYYY.M.D)」 자릿수 그대로 · 「YYYY-MM-DD」 구분 글자 그대로 · 날짜 없음 null',
      replaceNameDate('개별 투자 ( 2026.07 )', '2026-11-07') === '개별 투자 ( 2026.11 )' &&
      replaceNameDate('연금 저축 계좌 ( 2026.07)', '2026-11-07') === '연금 저축 계좌 ( 2026.11)' &&
      replaceNameDate('ISA 계좌 (2026.7.5) 메모', '2026-11-07') === 'ISA 계좌 (2026.11.7) 메모' &&
      replaceNameDate('적립식 계좌 ( 2026.10.24 )', '2026-11-07') === '적립식 계좌 ( 2026.11.07 )' &&
      replaceNameDate('X ( 2026-10-24 )', '2026-11-07') === 'X ( 2026-11-07 )' &&
      replaceNameDate('적립식 계좌', '2026-11-07') === null && replaceNameDate('적립식 계좌 ( 메모 )', '2026-11-07') === null);

    const H = '주식 투자 정리';
    const setName = (cell: string, v: string) => { sheetModel.values[`${H}!${cell}`] = v; sheetModel.formulas[`${H}!${cell}`] = v; };
    fresh();
    setName('B21', 'ISA 계좌'); // 날짜 없는 칸 — 쓰지 않는다
    setName('B29', '연금 저축 계좌 ( 2026.07)');
    const r1 = await writeAccountDates('2026-11-27');
    const at = (cell: string) => writesSeen.find((w) => w.range === `'${H}'!${cell}`)?.value;
    check('[111-4] 「( 날짜 )」 가 있는 칸만(B4 · B12 · B29 — 날짜 없는 B21 은 안 씀) · 날짜 부분만 바뀜 · 나머지 글자 · 빈칸 그대로',
      r1.cells === 3 && writesSeen.length === 3 && at('B21') === undefined && at('B4') === '개별 투자 ( 2026.11 )' && at('B12') === '적립식 계좌 ( 2026.11 )' && at('B29') === '연금 저축 계좌 ( 2026.11)');
    check('[111-4] 한 요청(쓰기 1번) · RAW · 글자 그대로(문자열)', google.writes === 1 && writesSeen.every((w) => w.input === 'RAW' && typeof w.value === 'string'));
    fresh();
    sheetModel.formulas[`${H}!B12`] = '="적립식 계좌 ( "&TEXT(TODAY(),"yyyy.mm")&" )"';
    check('[111-4] 네 칸 중 하나라도 수식 → formula-cell · 하나도 안 씀', (await kindOf(writeAccountDates('2026-11-27'))) === 'formula-cell' && google.writes === 0);
    fresh();
    for (const c of ['B4', 'B12', 'B21', 'B29']) setName(c, sheetModel.values[`${H}!${c}`].toString().replace(/\s*\(.*\)\s*$/, ''));
    check('[111-4] 날짜가 든 칸이 하나도 없으면 no-date · 안 씀', (await kindOf(writeAccountDates('2026-11-27'))) === 'no-date' && google.writes === 0);
    fresh();
    sheetModel.values[`${H}!B3`] = '바뀐 머리';
    sheetModel.formulas[`${H}!B3`] = '바뀐 머리';
    check('[111-4] 머리 글자(B3)가 다르면 shape · 안 씀', (await kindOf(writeAccountDates('2026-11-27'))) === 'shape' && google.writes === 0);
    fresh();
    process.env.ASSET_SYNC_ENABLED = 'false';
    check('[111-4] 스위치 꺼짐(ASSET_SYNC_ENABLED=false) → disabled · 구글 호출 0(토큰도 받지 않음)', (await kindOf(writeAccountDates('2026-11-27'))) === 'disabled' && google.token === 0 && google.writes === 0);
    process.env.ASSET_SYNC_ENABLED = 'true';
    fresh();
    afterWrite = () => { sheetModel.formulas[`${H}!B4`] = '개별 투자 ( 바뀜 )'; };
    const mm = await writeAccountDates('2026-11-27').catch((e: unknown) => e);
    check('[111-4] 다시 읽은 값이 다르면 mismatch 오류', mm instanceof AssetSheetError && mm.kind === 'mismatch');
    fresh();
  }

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
  check('[106-7] (안쪽 서버) 잠김 → PUT /api/asset/class 403 asset-locked · 쓰기 0', (await putClass({ rows: [15], assetClass: '금' })).status === 403 && google.writes === 0);
  const putRatio = (body: unknown) => fetch(`${base}/api/asset/target-ratio`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const RATIO_OK = { cash: 10, bond: 20, gold: 30, invest: 40, core: 60, satellite: 40 };
  check('[109-1] (안쪽 서버) 잠김 → PUT /api/asset/target-ratio 403 asset-locked · 구글 호출 0', (await putRatio(RATIO_OK)).status === 403 && google.token === 0);
  unlockSession(token);
  const okRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  const okBody = (await okRes.json()) as AssetSheetData;
  check('[B] (안쪽 서버) 풀린 뒤 sheet → 200 · 구간 다섯', okRes.status === 200 && okBody.sections.length === 5);
  const putOk = await putClass({ rows: [15], assetClass: '금' });
  const putBody = (await putOk.json()) as AssetSheetData;
  check('[106-7] (안쪽 서버) 풀린 뒤 PUT /api/asset/class → 200 · 다시 읽은 시트 값', putOk.status === 200 && putBody.sections[0].holdings.find((h) => h.row === 5)?.assetClass === '금' && google.writes === 1);
  const putBad = await putClass({ rows: [14], assetClass: '금' });
  const putFormula = (sheetModel.formulas['티커!D16'] = '=X1', await putClass({ rows: [16], assetClass: '금' }));
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
  check('[109-5] (안쪽 서버) summary 에 bySymbol — 코어 줄 금액 합 = totals.core',
    Array.isArray(sumBody.bySymbol) && sumBody.bySymbol.length > 0 && near(sumBody.bySymbol.filter((x) => x.side === 'core').reduce((a, x) => a + (x.value ?? 0), 0), sumBody.totals.core));
  check('[109-4] (안쪽 서버) summary 에 rebalance — 지금 금액 = 같은 응답의 분류별 금액 · 코어 / 위성 · 괜찮음 범위 · 시트 목표 비율',
    sumBody.rebalance != null && sumBody.rebalance.assets.rows.every((r) => r.nowAmount === sumBody.totals.groups.find((g) => g.key === r.key)?.amount) && sumBody.rebalance.stocks.rows[0].nowAmount === sumBody.totals.core && sumBody.rebalance.stocks.rows[1].nowAmount === sumBody.totals.satellite && sumBody.rebalance.band === sumBody.settings.rebalanceBand && sumBody.targetRatio.invest === sumBody.rebalance.assets.rows[3].targetPct);
  check('[106-10] (안쪽 서버) 풀린 뒤 summary 200(연금 포함) · history 200 · 기간 틀림 400 · settings 200 / 옛 키 400', sumRes.status === 200 && sumBody.includePension === true && JSON.stringify(sumBody.accounts?.map((a) => a.key)) === JSON.stringify(['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌']) && sumBody.accounts[0].name === '개별 투자 ( 2026.07 )' && Array.isArray(sumBody.stockChoices) && sumBody.settings.classColors.gold === 'yellow' && histRes.status === 200 && badRange.status === 400 && setOk.status === 200 && setBad.status === 400);
  check('[106-7] (안쪽 서버) 구분 줄 400 not-editable · 수식 칸 409 formula-cell · 쓰기 늘지 않음', putBad.status === 400 && ((await putBad.json()) as { kind?: string }).kind === 'not-editable' && putFormula.status === 409 && google.writes === 1);
  {
    // [115-2] 옛 모양 { row } · 「현금」 · 여러 줄 한 요청(HTTP)
    sheetModel.formulas['티커!D16'] = sheetModel.values['티커!D16'];
    const before = google.writes;
    const oldShape = await putClass({ row: 15, assetClass: '금' });
    const cashPut = await putClass({ rows: [15], assetClass: '현금' });
    check('[115-2] [115-1] (안쪽 서버) 옛 모양 { row } → 400 not-editable · 「현금」 → 400 not-editable · 쓰기 늘지 않음',
      oldShape.status === 400 && ((await oldShape.json()) as { kind?: string }).kind === 'not-editable' && cashPut.status === 400 && ((await cashPut.json()) as { kind?: string }).kind === 'not-editable' && google.writes === before);
    const multi = await putClass({ rows: [15, 16, 20], assetClass: '채권' });
    const multiBody = (await multi.json()) as AssetSheetData;
    check('[115-2] (안쪽 서버) PUT { rows: [15, 16, 20] } → 200 · 쓰기 요청 1번 · 다시 읽은 값',
      multi.status === 200 && google.writes === before + 1 && [5, 13, 22].every((r) => multiBody.sections.flatMap((x) => x.holdings).find((h) => h.row === r)?.assetClass === '채권'));
  }
  {
    const w0 = google.writes;
    const rOk = await putRatio(RATIO_OK);
    const rOkBody = (await rOk.json()) as AssetSheetData;
    const rBad = await putRatio({ ...RATIO_OK, cash: 11 });
    sheetModel.formulas['자산 투자 비율 관리!F18'] = '=1-C18-D18-E18';
    resetSheetCache();
    const rFormula = await putRatio(RATIO_OK);
    const rFormulaBody = (await rFormula.json()) as { kind?: string; error?: string };
    check('[109-1] (안쪽 서버) PUT /api/asset/target-ratio → 200 다시 읽은 값 · 합 틀림 400 not-editable · 수식 칸 409 formula-cell(쓰기 늘지 않음)',
      rOk.status === 200 && rOkBody.targetRatio.gold === 30 && rBad.status === 400 && rFormula.status === 409 && rFormulaBody.kind === 'formula-cell' && google.writes === w0 + 1);
    sheetModel.formulas['자산 투자 비율 관리!F18'] = sheetModel.values['자산 투자 비율 관리!F18'];
    resetSheetCache();
  }
  resetSheetCache();
  sheetModel.values['티커!B12'] = '바뀐 머리';
  const shapeRes = await fetch(`${base}/api/asset/sheet`, { headers: ck });
  const shapeBody = (await shapeRes.json()) as { kind?: string; error?: string; sections?: unknown };
  check('[7] (안쪽 서버) 모양 바뀜 → 502 · kind shape · 값 칸 없음', shapeRes.status === 502 && shapeBody.kind === 'shape' && shapeBody.sections === undefined);

  {
    // [111-5] POST /api/asset/purchase-done — 가짜 오늘 · 가짜 달력 · 가짜 구글
    fresh();
    clearPurchasesForTest();
    setPurchaseClockForTest(() => Date.parse('2026-11-27T03:00:00Z'), () => ({ isClosed: (d) => d === '2026-12-25', isChecked: () => true }));
    const done = () => fetch(`${base}/api/asset/purchase-done`, { method: 'POST', headers: { ...ck, 'content-type': 'application/json' } });
    const sumMb = async () => ((await (await fetch(`${base}/api/asset/summary?pension=0`, { headers: ck })).json()) as AssetSummary).monthlyBuy;
    const mb0 = await sumMb();
    check('[111-3] (안쪽 서버) summary 에 monthlyBuy — 오늘 · 이번 차례 11-27 · 다음 12-24 · 미완료 · 합 = 시트 월급(새 요청 없음)',
      mb0.today === '2026-11-27' && mb0.cycleDay === '2026-11-27' && mb0.nextDay === '2026-12-24' && !mb0.done && mb0.doneDay === null && mb0.total === FAKE.salary && !mb0.noSalary);
    mode = 'write-403';
    const f1 = await done();
    const f1Body = (await f1.json()) as { kind?: string };
    check('[111-5] 시트 쓰기 실패(403) → 502 not-shared · asset_purchase 기록 없음', f1.status === 502 && f1Body.kind === 'not-shared' && purchaseCountForTest() === 0);
    mode = 'ok';
    sheetModel.formulas['주식 투자 정리!B4'] = '=B3';
    const f2 = await done();
    check('[111-5] 수식 칸 → 409 formula-cell · 기록 없음 · 쓰기 0', f2.status === 409 && ((await f2.json()) as { kind?: string }).kind === 'formula-cell' && purchaseCountForTest() === 0);
    fresh();
    process.env.ASSET_SYNC_ENABLED = 'false';
    const f3 = await done();
    check('[111-5] 스위치 꺼짐 → 503 disabled 「시트 쓰기가 꺼져 있습니다」 · 기록 없음 · 구글 호출 0', f3.status === 503 && /시트 쓰기가 꺼져 있습니다/.test(((await f3.json()) as { error?: string }).error ?? '') && purchaseCountForTest() === 0 && google.token === 0);
    process.env.ASSET_SYNC_ENABLED = 'true';
    const ok = await done();
    const okBody = (await ok.json()) as { cycleDay?: string; doneDay?: string; cells?: number };
    check('[111-5] 성공 → 200 · 기록 1줄(차례 11-27 · 누른 날 11-27) · 쓰기 1번', ok.status === 200 && okBody.cycleDay === '2026-11-27' && okBody.doneDay === '2026-11-27' && okBody.cells === 4 && purchaseCountForTest() === 1 && google.writes === 1);
    const again = await done();
    const againBody = (await again.json()) as { kind?: string; error?: string };
    check('[111-5] 이미 완료한 차례 → 409 already-done 「이미 구매 완료를 눌렀습니다(2026-11-27)」 · 쓰기 늘지 않음 · 기록 1줄', again.status === 409 && againBody.kind === 'already-done' && againBody.error === '이미 구매 완료를 눌렀습니다(2026-11-27).' && google.writes === 1 && purchaseCountForTest() === 1);
    const mb1 = await sumMb();
    check('[111-5] (안쪽 서버) 완료 뒤 summary — done · doneDay 11-27', mb1.done && mb1.doneDay === '2026-11-27');
    setPurchaseClockForTest(() => Date.parse('2026-12-24T03:00:00Z'), () => ({ isClosed: (d) => d === '2026-12-25', isChecked: () => true }));
    const mb2 = await sumMb();
    check('[111-2] (안쪽 서버) 다음 구매일(12-24)이 오면 새 차례 · 미완료(옛 차례는 더 묻지 않음)', mb2.cycleDay === '2026-12-24' && !mb2.done && mb2.nextDay === '2027-01-29');
    lockSession(token);
    const lockedDone = await done();
    check('[111-5] 잠김 → POST /api/asset/purchase-done 403 asset-locked · 쓰기 늘지 않음', lockedDone.status === 403 && ((await lockedDone.json()) as { code?: string }).code === 'asset-locked' && google.writes === 1);
    unlockSession(token);
    setPurchaseClockForTest(null);
    clearPurchasesForTest();
  }

  {
    // [112-n] 시작 전 차례 · 시작한 날 · 시트에 구매 차례의 달 — 가짜 오늘 · 가짜 달력(휴장 없음) · 가짜 구글
    const H = '주식 투자 정리';
    const noHoliday = () => ({ isClosed: () => false, isChecked: () => true });
    const at = (iso: string) => setPurchaseClockForTest(() => Date.parse(`${iso}T03:00:00Z`), noHoliday);
    const done = () => fetch(`${base}/api/asset/purchase-done`, { method: 'POST', headers: { ...ck, 'content-type': 'application/json' } });
    const sumMb = async () => ((await (await fetch(`${base}/api/asset/summary?pension=0`, { headers: ck })).json()) as AssetSummary).monthlyBuy;
    const doneAtOf = (cycle: string) => (getDb().prepare(`SELECT done_at FROM asset_purchase WHERE cycle_date = ?`).get(cycle) as { done_at: string } | undefined)?.done_at ?? null;

    // 1. 빈 DB · 오늘 11-07
    fresh();
    clearPurchasesForTest();
    at('2026-11-07');
    const s1 = await sumMb();
    check('[112-1] 빈 DB · 오늘 11-07 → 시작한 날 11-07 저장 · 차례 10-30 = 시작 전(skipped · 미완료) · 다음 구매일 11-27',
      purchaseStartDayStoredForTest() === '2026-11-07' && s1.startDay === '2026-11-07' && s1.cycleDay === '2026-10-30' && s1.skipped && !s1.done && s1.doneDay === null && s1.nextDay === '2026-11-27');
    const r1 = await done();
    const b1 = (await r1.json()) as { kind?: string; error?: string };
    check('[112-1] 시작 전 차례 [구매 완료] → 409 before-start 「…쓰기 전 구매 차례라 기록하지 않습니다 — 다음 구매일 2026-11-27」 · 시트 쓰기 0번 · 기록 0줄',
      r1.status === 409 && b1.kind === 'before-start' && b1.error === '이 기능을 쓰기 전 구매 차례라 기록하지 않습니다 — 다음 구매일 2026-11-27' && google.writes === 0 && writesSeen.length === 0 && purchaseCountForTest() === 0);

    // 2. 같은 DB · 11-27
    at('2026-11-27');
    const s2 = await sumMb();
    check('[112-2] 같은 DB · 가짜 시계 11-27 → 차례 11-27 · 시작 전 아님 · 미완료(팝업 뜸 · [구매 완료] 가능) · 시작한 날 그대로 11-07',
      s2.cycleDay === '2026-11-27' && !s2.skipped && !s2.done && s2.startDay === '2026-11-07' && purchaseStartDayStoredForTest() === '2026-11-07');

    // 4 · 5. 11-27 차례를 12-02 에 누름 — 한 칸은 일이 있는 모양(「( 2026.07.05 )」)으로 바꿔 두 모양을 함께 본다
    at('2026-12-02');
    sheetModel.values[`${H}!B29`] = '연금 저축 계좌 ( 2026.07.05 )';
    sheetModel.formulas[`${H}!B29`] = '연금 저축 계좌 ( 2026.07.05 )';
    resetSheetCache();
    const s4 = await sumMb();
    const r4 = await done();
    const b4 = (await r4.json()) as { cycleDay?: string; doneDay?: string; cells?: number };
    const written = writesSeen.map((w) => String(w.value));
    const writtenDates = [...new Set(written.map((v) => v.match(/\(\s*([\d.\-/]+)\s*\)/)?.[1] ?? ''))];
    check('[112-4] 11-27 차례를 12-02 에 누름 → 시트에 「2026.11」(차례의 달 · 12 아님) · 일이 있는 칸은 차례의 구매일 「2026.11.27」 · 쓰기 1번',
      r4.status === 200 && b4.cycleDay === '2026-11-27' && google.writes === 1 && written.length === 4 &&
      written.filter((v) => v.includes('( 2026.11 )')).length === 3 && written.includes('연금 저축 계좌 ( 2026.11.27 )') && !written.some((v) => v.includes('2026.12')));
    check('[112-4] asset_purchase.done_at = 누른 날 12-02 · 응답 doneDay 12-02', doneAtOf('2026-11-27') === '2026-12-02' && b4.doneDay === '2026-12-02');
    check('[112-5] 확인 창 날짜 글자(summary sheetDates) = 서버가 실제로 쓴 글자(2026.11 · 2026.11.27)',
      s4.cycleDay === '2026-11-27' && JSON.stringify([...s4.sheetDates].sort()) === JSON.stringify([...writtenDates].sort()) && JSON.stringify([...s4.sheetDates].sort()) === JSON.stringify(['2026.11', '2026.11.27']));

    // 3. 기록이 이미 있는 DB — 시작한 날 = 가장 이른 기록의 차례
    fresh();
    clearPurchasesForTest();
    recordPurchase('2026-10-30', '2026-11-02');
    recordPurchase('2026-11-27', '2026-11-27');
    at('2026-11-07');
    const s3 = await sumMb();
    check('[112-3] asset_purchase 에 기록이 있는 DB → 시작한 날 = 가장 이른 기록의 차례 10-30 · 그 차례는 시작 전이 아님(완료로 보임)',
      purchaseStartDayStoredForTest() === '2026-10-30' && s3.startDay === '2026-10-30' && s3.cycleDay === '2026-10-30' && !s3.skipped && s3.done && s3.doneDay === '2026-11-02');
    getDb().prepare(`DELETE FROM asset_purchase WHERE cycle_date = ?`).run('2026-11-27');
    at('2026-11-27');
    const s3b = await sumMb();
    check('[112-3] 그 뒤 차례(11-27)는 지금처럼 묻는다(시작 전 아님 · 미완료)', s3b.cycleDay === '2026-11-27' && !s3b.skipped && !s3b.done);
    setPurchaseClockForTest(null);
    clearPurchasesForTest();
    fresh();
  }
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
  setPurchaseClockForTest(null);
  clearPurchasesForTest();
  fs.rmSync(tmp, { recursive: true, force: true });
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}

// ── 12 · 13 · 14 · 15 ─────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
}
const appCode = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// [106-8] 쓰기는 한 곳 — 106차부터 시트 쓰기(「티커」 D열 자산 분류)가 생겼다(101차 [12] 「쓰기 주소 0」 을 대신한다).
// 109차: 쓰기 함수가 `valuesUpdate`(한 칸 · 글자) → `valuesWrite`(values:batchUpdate · 여러 칸 · 숫자 그대로)로 바뀌고 부르는 곳이 sheet.ts 두 곳(자산 분류 · 목표 비율)이 됐다
const codeFiles = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => ({ f: path.relative(root, f), src: fs.readFileSync(f, 'utf8') }));
const callers = codeFiles.flatMap(({ f, src }) => [...src.matchAll(/\bvaluesWrite\(/g)].map(() => f));
const fnBody = (name: string) => {
  const src = fs.readFileSync(path.join(root, 'server/asset/sheet.ts'), 'utf8');
  const i = src.indexOf(`export async function ${name}(`);
  return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i));
};
// 111차: 부르는 곳이 셋(+ writeAccountDates 계좌 이름 날짜)
// 113차: 시트 가격(priceSheet.ts 바꾸기 · 되돌리기 · priceWriter.ts 10초 쓰기)이 같은 함수를 부른다(쓰는 방식은 인자 — `assetprice:test` [113-7])
const WRITE_CALLERS = JSON.stringify(['server/asset/google.ts', 'server/asset/priceSheet.ts', 'server/asset/priceSheet.ts', 'server/asset/priceWriter.ts', 'server/asset/sheet.ts', 'server/asset/sheet.ts', 'server/asset/sheet.ts']);
check('[106-8] [109-1] [111-8] 시트 쓰기 함수 valuesWrite — 정의(google.ts) 1 + 부르는 곳 sheet.ts 3(writeAssetClasses · writeTargetRatio · writeAccountDates) + 113차 시트 가격 3(priceSheet.ts 2 · priceWriter.ts 1)뿐 · 옛 valuesUpdate 0', JSON.stringify(callers.sort()) === WRITE_CALLERS && /valuesWrite\(/.test(fnBody('writeAssetClasses')) && /valuesWrite\(/.test(fnBody('writeTargetRatio')) && /valuesWrite\(/.test(fnBody('writeAccountDates')) && !/\bvaluesUpdate\b/.test(appCode), callers.join(','));
check('[106-8] [109-1] 그 밖의 구글 쓰기 주소(서식 spreadsheets:batchUpdate · values:append · values:clear) 0 · values:batchUpdate 는 google.ts 한 곳 · googleapis 는 google.ts 한 곳', !/(?<!values):batchUpdate|values:append|values:clear|values:batchClear/.test(appCode) && codeFiles.filter(({ src }) => /values:batchUpdate/.test(src)).map((x) => x.f).join(',') === 'server/asset/google.ts' && codeFiles.filter(({ src }) => /sheets\.googleapis\.com/.test(src)).map((x) => x.f).join(',') === 'server/asset/google.ts');
check('[106-8] 구글 scope 는 spreadsheets 하나(drive 등 다른 scope 없음)', /auth\/spreadsheets'/.test(appCode) && !/auth\/spreadsheets\.readonly/.test(appCode) && !/auth\/drive/.test(appCode));
check('[106-8] 실제 구글 호출 0 — 이 시험의 googleapis 요청은 모두 가짜가 받았다(쓰기는 가짜 응답으로만)', realGoogleCalls === 0);
{
  // [115-3] 옛 한 칸 함수는 지웠다(A-11) — 소스에 writeAssetClass 없음 · 화면은 rows 로 부른다 · 구글 쓰는 함수는 valuesWrite 하나
  const dash = fs.readFileSync(path.join(root, 'src/components/asset/AssetDashboard.tsx'), 'utf8');
  const googleSrc = fs.readFileSync(path.join(root, 'server/asset/google.ts'), 'utf8');
  check('[115-3] writeAssetClass(한 칸 함수) 소스에 없음 · 한 칸 고르기도 일괄 함수(화면이 rows 배열로 부름) · 구글 쓰는 export 함수는 valuesWrite 하나',
    !/\bwriteAssetClass\b/.test(appCode) && /\bwriteAssetClasses\(/.test(fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8')) && /JSON\.stringify\(\{ rows/.test(dash) && !/JSON\.stringify\(\{ row,/.test(dash) &&
      [...googleSrc.matchAll(/export async function (\w+)/g)].map((m) => m[1]).filter((n) => /write|update|append|clear/i.test(n)).join(',') === 'valuesWrite');
}

// [107-5] 분류 색 — 옛 토큰 남는 곳 0 · 원형 · 표 점 · 설정 창이 같은 이름 → 클래스 표(assetColors.ts) 하나를 쓴다
const cssSrc = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
check('[107-5] 옛 색 토큰 --color-asset-* 와 그 클래스(bg · stroke -asset-cash 등) 남는 곳 0(src · server · index.css)', !/--color-asset-|-asset-(?:cash|bond|gold|stock|retirement|none)\b/.test(appCode + cssSrc));
const colorsSrc = fs.readFileSync(path.join(root, 'src/components/asset/assetColors.ts'), 'utf8');
check('[107-5] 팔레트 이름마다 --color-swatch-* 토큰 · 클래스가 있다(+ 미지정 회색)', ASSET_COLOR_IDS.every((id) => cssSrc.includes(`--color-swatch-${id}:`) && colorsSrc.includes(`'bg-swatch-${id}'`) && colorsSrc.includes(`'stroke-swatch-${id}'`)) && cssSrc.includes('--color-swatch-gray:'));
const assetUi = fs.readdirSync(path.join(root, 'src/components/asset')).map((f) => fs.readFileSync(path.join(root, 'src/components/asset', f), 'utf8'));
check('[107-5] 원형(groupStroke) · 분류별 표 점(groupDot)이 같은 표를 쓰고, 그 밖에 swatch 클래스를 직접 쓰는 화면 0', /groupStroke\(/.test(assetUi.join('\n')) && /groupDot\(/.test(assetUi.join('\n')) && codeFiles.filter(({ f, src }) => /\b(?:bg|stroke|text|fill|border)-swatch-/.test(src) && f !== 'src/components/asset/assetColors.ts').length === 0);

// [108-1] 「분류 없음」 · 「알 수 없는 분류」 두 갈래 코드 · 문구 0(src · server · 화면 가짜 값)
const assetFixtures = fs.readdirSync(path.join(root, 'scripts/fixtures/asset')).map((f) => fs.readFileSync(path.join(root, 'scripts/fixtures/asset', f), 'utf8')).join('\n');
check('[108-1] 「분류 없음」 · 「알 수 없는 분류」 · 「알 수 없음 ·」 글자와 assetClassUnknown · unknownClassCount 남는 곳 0(src · server · fixtures/asset)', !/분류 없음|알 수 없는 분류|알 수 없음 ·|assetClassUnknown|unknownClassCount/.test(appCode + cssSrc + assetFixtures));

// [108-3] 탭 — 「총 자산 | 자산 현황」 · 처음 총 자산 · 마지막 탭 기억(읽기 실패 → 총 자산) · 「상세 보기」 접기 글자 0(화면 동작은 Playwright 로도 확인)
const dashSrc = fs.readFileSync(path.join(root, 'src/components/asset/AssetDashboard.tsx'), 'utf8');
check('[108-3] [109-7] 자산 관리 탭 = 총 자산 · 자산 현황 · 비율 조정(이 순서) · 기억 키 alphascope.asset.tab · 모르는 값 · 읽기 실패면 총 자산', /\{ id: 'total', label: '총 자산' \},\s*\{ id: 'status', label: '자산 현황' \},\s*\{ id: 'rebalance', label: '비율 조정' \}/.test(dashSrc) && /const v = localStorage\.getItem\(TAB_KEY\);\s*return v === 'status' \|\| v === 'rebalance' \? v : 'total';\s*\} catch \{\s*return 'total';/.test(dashSrc));
check('[108-3] 자산 관리 화면 · 서버에 「상세 보기」 글자 0(접기 지움)', !assetUi.join('\n').includes('상세 보기') && !codeFiles.filter(({ f }) => f.startsWith('server/asset/') || f === 'src/types/asset.ts').some(({ src }) => src.includes('상세 보기')));

// [108-6] 공용 부품 — 새 옵션(source · columns · nameOf · rowNote)은 자산 설정 창만 쓴다 · 기본(옵션 없음)은 지금 창 · 지금 칸 그대로
const pickerSrc = fs.readFileSync(path.join(root, 'src/components/common/SymbolPicker.tsx'), 'utf8');
const tableSrc = fs.readFileSync(path.join(root, 'src/components/common/SymbolTable.tsx'), 'utf8');
const optionUsers = codeFiles.filter(({ f, src }) => f.startsWith('src/') && !f.startsWith('src/components/common/') && /\b(source=\{\{|nameOf=\{|rowNote=\{|columns=\{\[)/.test(src) && /SymbolTable|SymbolPicker|SymbolListBar/.test(src)).map((x) => x.f);
check('[108-6] 새 옵션을 쓰는 곳 = 자산 설정 창 하나 · 기본은 옛 창(CatalogPickerDialog) · 옛 칸(시장 · 분야)', JSON.stringify(optionUsers) === JSON.stringify(['src/components/asset/AssetSettingsDialog.tsx']) && /props\.source \? <SourcePickerDialog [^>]*\/> : <CatalogPickerDialog \{\.\.\.props\} \/>/.test(pickerSrc) && /<th className="whitespace-nowrap py-2 pr-6">시장<\/th>\s*<th className="whitespace-nowrap py-2 pr-6">분야<\/th>/.test(tableSrc), optionUsers.join(','));

// [108-7] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(107차 끝 af69935 와 지금 작업 트리)
const changed108 = spawnSync('git', ['diff', '--name-only', 'af69935', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[108-7] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(af69935 와 지금 작업 트리)', changed108.status === 0 && changed108.stdout.trim() === '', changed108.stdout.trim() || changed108.stderr.trim());


// [111-7] 자산 현황 요약 목표 비율 — 현금 · 채권 · 금 · 주식 순서 · 「투자」 → 「주식」(화면만 — 시트 칸은 그대로 invest)
const sheetValuesSrc = fs.readFileSync(path.join(root, 'src/components/asset/AssetSheetValues.tsx'), 'utf8');
check('[111-7] 자산 현황 요약 목표 비율 순서 = 현금 · 채권 · 금 · 주식(「투자」 글자 없음)', /<Field label="현금" value=\{pct\(t\.cash\)\} \/>\s*<Field label="채권" value=\{pct\(t\.bond\)\} \/>\s*<Field label="금" value=\{pct\(t\.gold\)\} \/>\s*<Field label="주식" value=\{pct\(t\.invest\)\} \/>/.test(sheetValuesSrc) && !/label="투자"/.test(sheetValuesSrc));
// [111-9] 매매 · 시황 · 자동매매 · 거래정지 · 시장 달력 코드 바뀐 파일 0(110차 끝 2b548e5 와 지금 작업 트리)
const changed111 = spawnSync('git', ['diff', '--name-only', '2b548e5', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'server/marketCalendar.ts', 'python'], { cwd: root, encoding: 'utf8' });
check('[111-9] 매매 · 시황 · 자동매매 · 거래정지 · 시장 달력 코드 바뀐 파일 0(2b548e5 와 지금 작업 트리)', changed111.status === 0 && changed111.stdout.trim() === '', changed111.stdout.trim() || changed111.stderr.trim());
// [111-10] 구매 완료 경로가 로그에 계좌 이름 · 날짜 · 금액을 찍지 않는다(이유 종류만) — 소스 검사 + 아래 출력 검사
const purchaseSrc = ['server/asset/purchase.ts', 'server/asset/routes.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n') + fnBody('writeAccountDates');
check('[111-10] 구매 완료 · 이번 달 구매 코드에 console 출력 없음(실패 로그는 sendSheetError 의 이유 종류 한 줄뿐)', !/console\.(log|info|debug)/.test(purchaseSrc) && (purchaseSrc.match(/console\.warn/g) ?? []).length === 2);
// [112-1] 화면 — 시작 전 차례면 팝업을 열지 않고(처음 정할 때 · 그릴 때 둘 다) [구매 완료] 를 숨긴다(화면 동작은 Playwright 로도)
const buySrc = fs.readFileSync(path.join(root, 'src/components/asset/AssetMonthlyBuy.tsx'), 'utf8');
check('[112-1] 화면 — 시작 전 차례면 구매일 팝업 없음(AssetDashboard 두 곳 !skipped) · [구매 완료] 버튼 숨김 · 「시작 전 차례 — 묻지 않음」',
  /if \(!mb\.done && !mb\.skipped\) setPurchasePopup\(true\)/.test(dashSrc) && /purchasePopup && summary && !summary\.monthlyBuy\.done && !summary\.monthlyBuy\.skipped &&/.test(dashSrc) &&
  /mb\.done \|\| mb\.skipped \? undefined :/.test(buySrc) && buySrc.includes('시작 전 차례 — 묻지 않음'));
check('[112-5] 확인 창 문구 — 서버가 준 sheetDates 로 만들고 「오늘(날짜)로」 글자 0', /askPurchaseDone\(summary\.monthlyBuy\.sheetDates\)/.test(dashSrc) && /sheetDateText\(sheetDates\)/.test(dashSrc) && !/날짜를 오늘/.test(dashSrc));
// [112-7] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 코드 바뀐 파일 0(111차 끝 1117cba 와 지금 작업 트리)
const changed112 = spawnSync('git', ['diff', '--name-only', '1117cba', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'server/marketCalendar.ts', 'python'], { cwd: root, encoding: 'utf8' });
check('[112-7] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 코드 바뀐 파일 0(1117cba 와 지금 작업 트리)', changed112.status === 0 && changed112.stdout.trim() === '', changed112.stdout.trim() || changed112.stderr.trim());
const leaked = (textAll: string) => SECRET_STRINGS.filter((x) => textAll.includes(x));
check('[13] 서버 로그(시험 서버) · 안쪽 경고 출력에 가짜 금액 · 수량이 없다', leaked(serverLog + captured.join('\n')).length === 0 && captured.some((l) => l.includes('[asset] 시트 읽기 실패: shape')));
check('[13] 이 시험의 출력에 가짜 금액 · 수량이 없다', leaked(printed.join('\n')).length === 0);
const allOut = [serverLog, captured.join('\n'), logged.join('\n'), printed.join('\n')].join('\n');
check('[112-8] 로그 · 시험 출력에 계좌 이름 날짜 글자(괄호 속 점 모양 연 · 월 — 시험 이름의 하이픈 날짜는 계좌 이름이 아님)가 없다', !/\(\s*\d{4}\.\d{1,2}(\.\d{1,2})?\s*\)/.test(allOut));
check('[106-11] [107-11] [111-10] [112-8] 로그 · 시험 출력에 계산한 총 자산 · 분류 금액 · 계좌 평가 합 · 종가 기록 금액이 없다(출력 문자열 검사)', totalsSecret.length > 0 && totalsSecret.every((x) => !allOut.includes(x)) && leaked(allOut).length === 0);

const changed = spawnSync('git', ['diff', '--name-only', '0a2dc10', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[14] 매매 · 시황 · 자동매매 코드 바뀐 파일 0(0a2dc10 와 지금 작업 트리)', changed.status === 0 && changed.stdout.trim() === '', changed.stdout.trim() || changed.stderr.trim());
const changed106 = spawnSync('git', ['diff', '--name-only', 'c166ecd', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[106-12] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(c166ecd 와 지금 작업 트리)', changed106.status === 0 && changed106.stdout.trim() === '', changed106.stdout.trim() || changed106.stderr.trim());

// [107-9] 시트 쓰기는 지금처럼 「티커」 D14~D42 자산 분류 한 곳뿐 · 서식 쓰기(batchUpdate — repeatCell · 정렬 등) 0 — 이번 설정 저장은 앱 DB(app_settings)에만
check('[107-9] 시트 쓰기 = sheet.ts 세 곳(자산 분류 · 109차 목표 비율 · 111차 계좌 이름 날짜) + 113차 시트 가격(priceSheet.ts · priceWriter.ts) · 서식 쓰기(spreadsheets:batchUpdate · repeatCell · horizontalAlignment) 0 · settings.ts 는 시트를 쓰지 않음', JSON.stringify(callers.sort()) === WRITE_CALLERS && !/(?<!values):batchUpdate|repeatCell|horizontalAlignment|userEnteredFormat/.test(appCode) && !/valuesWrite|googleapis/.test(fs.readFileSync(path.join(root, 'server/asset/settings.ts'), 'utf8')));
// [107-10] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(106차 끝 428db88 와 지금 작업 트리)
const changed107 = spawnSync('git', ['diff', '--name-only', '428db88', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'python'], { cwd: root, encoding: 'utf8' });
check('[107-10] 매매 · 시황 · 자동매매 · 거래정지 코드 바뀐 파일 0(428db88 와 지금 작업 트리)', changed107.status === 0 && changed107.stdout.trim() === '', changed107.stdout.trim() || changed107.stderr.trim());

// [15] 메뉴 — 계좌 대메뉴의 소메뉴는 「계좌 관리」 · 「자산 관리」 순서 · 대메뉴를 누르면 첫 소메뉴(appStore.setGroup 이 pages[0] 으로 간다 — 화면 클릭은 Playwright 로도 확인)
const accountGroup = NAV_GROUPS.find((g) => g.id === 'account');
check('[15] 계좌 소메뉴 = 계좌 관리(portfolio) · 자산 관리(asset) 순서', JSON.stringify(accountGroup?.pages.map((p) => [p.id, p.label])) === JSON.stringify([['portfolio', '계좌 관리'], ['asset', '자산 관리']]));
check('[15] 자산 관리는 상단 종목 헤더를 감춘다 · 종목이 없어도 열린다', pageMeta('asset')?.hidesSymbolHeader === true && !pageMeta('asset')?.needsSymbol);
const storeSrc = fs.readFileSync(path.join(root, 'src/store/appStore.ts'), 'utf8');
check('[15] 대메뉴를 누르면 첫 소메뉴로 간다(appStore.setGroup 이 pages[0]) → 「계좌」 = 「계좌 관리」', /setGroup: \(group\) => \{[\s\S]{0,400}?const landing = item\?\.pages\[0\]\?\.id;/.test(storeSrc) && accountGroup?.pages[0]?.id === 'portfolio');

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
