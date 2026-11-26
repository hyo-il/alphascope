/**
 * 예수금 보이기 · 경고(v2.71.3 · 142차) 서버 시험 — `npm run assetcashguard:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 142차 「꼭 지킬 동작」 1(`balance`) · 5(보내는 값 · 쓰기 · 기록 그대로 — `cashMoves.ts` 바뀐 줄 0) · 6(바뀐 파일 · 로그)을 줄마다 확인한다.
 * 2 · 3 · 4(화면)는 `assetcashguardui:test`.
 * 이 프로세스 안에 로그인 문지기 + 자산 라우터만 띄워 실제 HTTP 로 부른다. 구글은 이 프로세스의 `fetch` 를 바꿔치기한 가짜 시트(`fixtures/asset/cashFlowBook.ts` — 만든 값) ·
 * 실제 구글 호출 0 · 그 밖 바깥 주소(토스 환율 등)는 막고 센다.
 * ⚠️ 출력에 가짜 금액 · 계좌 이름을 찍지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createSession, setPassword } from '../server/auth';
import { authGuard } from '../server/authGuard';
import { setAssetPassword } from '../server/asset/lock';
import { assetRouter } from '../server/asset/routes';
import { resetTokenCache } from '../server/asset/google';
import { clearCashMovesForTest, clearCashSettingsForTest, readCashSettings, writeCashSettings } from '../server/asset/cashMoves';
import { cashSheetNow } from '../server/asset/cashView';
import { BANK, fakeGoogleFetch, flowBook, type FakeGoogle } from './fixtures/asset/cashFlowBook';
import type { AssetCashKey, AssetCashPairView } from '../src/types/asset';
import { chasuDiff, type Chasu } from './lib/chasuRange';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cashguard-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-cashguard-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = '현금';
const g: FakeGoogle = { book: flowBook(), reads: 0, writes: [], tamper: false, failWrite: false, failReadTab: null };
let otherFetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = fakeGoogleFetch(g, (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return realFetch(input, init);
  otherFetches++;
  throw new Error('시험 — 바깥 주소 호출 막음');
}) as typeof fetch);
function reset() {
  g.book = flowBook();
  g.reads = 0;
  g.writes = [];
  resetTokenCache();
}

// 로그 잡기 — 금액 · 이름이 찍히면 실패
const logged: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(console, keep));
}
const SECRETS = BANK.flatMap(([n, a]) => [...String(n).split('\n'), String(a), typeof a === 'number' ? a.toLocaleString('en-US') : '']).filter((s) => s.length >= 4);

const KIWOOM: AssetCashKey = { name: '가짜키움 (가짜 예수금)', nth: 1 };
const SECTION = '개별 투자';
const TODAY = '2026-11-17';

await setPassword('selftest-cashguard-login-0001');
await setAssetPassword('selftest-cashguard-lock-0002');
const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const ck = { cookie: `as_session=${encodeURIComponent(createSession('cashguard-selftest'))}` };
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${p}`, { method, headers: { ...ck, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const pairOf = async (section = SECTION) => {
  const r = await quiet(() => call('GET', `/api/asset/cash/pair?section=${encodeURIComponent(section)}`));
  return { status: r.status, view: r.body as unknown as AssetCashPairView };
};

try {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  check('자산 잠금 풀기', (await call('POST', '/api/asset/unlock', { password: 'selftest-cashguard-lock-0002' })).status === 200);

  // ═══ 1. balance ═══
  {
    // 짝 없음 · 꺼짐 → 읽기 0 · balance null
    reset();
    const off = await pairOf();
    check('[142-1] 짝 없음 · 꺼짐 → balance null · 구글 읽기 0', off.status === 200 && off.view.balance === null && off.view.pair === null && g.reads === 0, `${off.status} · 읽기 ${g.reads}`);

    // 짝만(꺼짐) → 읽기 0
    const now = await quiet(cashSheetNow);
    await quiet(() => writeCashSettings({ depositPair: { section: SECTION, key: KIWOOM } }, now, TODAY));
    reset();
    const pairedOff = await pairOf();
    check('[142-1] 짝 있음 · 꺼짐 → balance null · pair null · 구글 읽기 0(읽지 않음)', pairedOff.view.enabled === false && pairedOff.view.balance === null && pairedOff.view.pair === null && g.reads === 0, `읽기 ${g.reads}`);

    // 짝 있음 · 켬 → C열 숫자 · 읽기 1(141차와 같은 「현금」 탭 한 번)
    await quiet(() => writeCashSettings({ enabled: true }, now, TODAY));
    reset();
    const on = await pairOf();
    check('[142-1] 짝 있음 · 켬 → balance = 시트 C열 숫자', on.status === 200 && on.view.enabled && on.view.pair?.key.name === KIWOOM.name && on.view.balance === BANK[0][1], `${on.status}`);
    check('[142-1] 구글 요청 수 그대로 — pair 한 번에 「현금」 탭 읽기 1번(쓰기 0)', g.reads === 1 && g.writes.length === 0, `읽기 ${g.reads} · 쓰기 ${g.writes.length}`);

    // 마이너스 숫자도 그대로(−18,329 같은 값 · 만든 값)
    reset();
    g.book.values[`${C}!C5`] = -18_329;
    const minus = await pairOf();
    check('[142-1] C열이 마이너스면 그 숫자 그대로(balance < 0)', minus.view.balance === -18_329);

    // 숫자 아님 → null
    reset();
    g.book.values[`${C}!C5`] = '가짜 글자';
    const text = await pairOf();
    check('[142-1] C열이 숫자가 아니면 balance null(pair 는 그대로)', text.view.balance === null && text.view.pair != null);
    reset();
    delete g.book.values[`${C}!C5`];
    const blank = await pairOf();
    check('[142-1] C열이 빈칸이면 balance null', blank.view.balance === null && blank.view.pair != null);

    // 같은 이름 줄 수가 바뀌어 짝 줄을 못 찾음 → null(쓰기와 같은 findCashLine)
    await quiet(() => writeCashSettings({ depositPair: { section: SECTION, key: { name: '가짜국민 (가짜 예금)', nth: 2 } } }, now, TODAY));
    reset();
    const kb = await pairOf();
    const kbOk = kb.view.balance === BANK[2][1];
    g.book.values[`${C}!B9`] = '가짜신한 2'; // 같은 이름 셋 중 하나를 다른 이름으로 → 저장 때 줄 수(of 3)와 다름
    const moved = await pairOf();
    check('[142-1] 같은 이름 #2 → 그 줄 C열 · 같은 이름 줄 수가 바뀌면 null(쓰기와 같은 판단)', kbOk && moved.view.balance === null, `${kbOk}`);
    await quiet(() => writeCashSettings({ depositPair: { section: SECTION, key: KIWOOM } }, now, TODAY));

    // 다른 계좌(짝 없음) — 켜져 있어도 읽기 0
    reset();
    const other = await pairOf('적립식 주식-없는-계좌');
    check('[142-1] 켬 · 그 계좌 짝 없음 → balance null · 읽기 0', other.view.enabled && other.view.pair === null && other.view.balance === null && g.reads === 0);
  }

  // ═══ 2. 계좌 머리 짝 — 시트 응답에 짝 설정(앱 DB 만 · 구글 요청 더하지 않음) ═══
  {
    const routes = fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8');
    const i = routes.indexOf("assetRouter.get('/api/asset/sheet'");
    const body = routes.slice(i, routes.indexOf('\n});', i));
    check('[142-2] 시트 응답 = readAssetSheet() 한 번 + 앱 DB 값(cashBankFix · cashDepositPairs) — 구글 부르는 줄 더하지 않음',
      /cashDepositPairs: readCashSettings\(\)\.depositPairs/.test(body) && (body.match(/await /g) ?? []).length === 1 && !/batchGet|cashSheetNow|readCashSheetNow/.test(body));
    reset();
    const pairs = readCashSettings().depositPairs;
    check('[142-2] 짝 설정 읽기는 구글 요청 0(앱 DB) · 꺼져 있어도 짝을 돌려줌', g.reads === 0 && pairs[SECTION]?.name === KIWOOM.name);
    const now2 = await quiet(cashSheetNow);
    await quiet(() => writeCashSettings({ enabled: false }, now2, TODAY));
    check('[142-2] 「현금 자동 반영」 을 꺼도 짝은 남음(계좌 머리 예수금은 보임)', readCashSettings().enabled === false && readCashSettings().depositPairs[SECTION]?.name === KIWOOM.name);
  }

  // ═══ 5 · 6. 보내는 값 · 쓰기 · 기록 · 바뀐 파일 · 로그 ═══
  {
    const BASE = '54cfc1a';
    const CHASU: Chasu = { base: BASE, version: 'v2.71.3' }; // 142차 범위만(끝 00e8ed0 — scripts/lib/chasuRange.ts) · 143차 몫은 assetcashmanual:test
    const cashMoves = chasuDiff(root, CHASU, ['--name-only'], ['server/asset/cashMoves.ts', 'server/asset/cashKeys.ts', 'server/asset/cashSchedule.ts', 'server/asset/cashBanks.ts', 'server/asset/google.ts', 'server/asset/rowOps.ts', 'server/asset/trade.ts']);
    check('[142-5] 예수금 쓰기 · 기록 · 되돌리기 · 구글 쓰기 · 보유 쓰기 파일 바뀐 줄 0(54cfc1a 와 142차 끝 00e8ed0)', cashMoves.status === 0 && cashMoves.stdout.trim() === '', cashMoves.stdout.trim());
    const routes = chasuDiff(root, CHASU, ['-U0'], ['server/asset/routes.ts']).stdout;
    const tradeRoutes = fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8');
    const hunks = routes.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+)/.test(l));
    const touchesTrade = hunks.some((l) => /tradeCash|parseCashAmount|recordTrade|recordNewHolding|undoCashMove/.test(l));
    check('[142-5] routes.ts 매수 · 매도 · 되돌리기 줄 그대로 — 바뀐 줄은 pair · 시트 응답 · import 뿐', !touchesTrade && /tradeCash\('buy'/.test(tradeRoutes), hunks.filter((l) => /tradeCash|recordTrade/.test(l)).length.toString());

    const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'server/index.ts', 'src/services', 'python']);
    check('[142-6] 매매 · 주문 · 로그인 · 시황 코드 바뀐 파일 0(54cfc1a → 그 차수 끝)', trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const serverChanged = chasuDiff(root, CHASU, ['--name-only'], ['server']).stdout.trim().split('\n').filter(Boolean);
    check('[142-6] 서버에서 바뀐 파일은 server/asset/routes.ts 하나(142차 끝까지)', serverChanged.every((f) => f === 'server/asset/routes.ts'), serverChanged.join(','));
    const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
    const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
    const changedShared = chasuDiff(root, CHASU, ['--name-only'], shared).stdout.trim().split('\n').filter(Boolean); // 그 차수 범위만(lib/chasuRange)
    const ALLOWED = ['src/data/changelog.ts', 'src/types/asset.ts'];
    const deleted = chasuDiff(root, CHASU, ['-U0'], [...ALLOWED]).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check(`[142-6] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 것은 types/asset.ts · data/changelog.ts 뿐 · 더하기만(지운 줄 0)`,
      shared.length > 30 && changedShared.every((f) => ALLOWED.includes(f)) && changedShared.includes('src/types/asset.ts') && deleted.length === 0, `${changedShared.join(',')} · 지운 줄 ${deleted.length}`);
    const dc = chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout;
    const dcDeleted = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[142-6] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(장면 더하기만)', dcDeleted.length === 0, `지운 줄 ${dcDeleted.length}`);
    const leaked = logged.filter((l) => SECRETS.some((s) => l.includes(s)) || l.includes('18329') || l.includes('18,329'));
    check('[142-6] 로그에 금액 · 계좌 이름 0', leaked.length === 0, `${leaked.length}줄`);
    check('[142-6] 구글 실제 호출 0 · 바깥 주소 호출은 토스 환율(막음)뿐', g.writes.length === 0, `바깥 ${otherFetches}`);
  }
} finally {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
