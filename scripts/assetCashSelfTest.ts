/**
 * 자산 「현금」 탭을 머리 글자로 찾기(v2.70.4 · 138차) — `npm run assetcash:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 * 138차 「꼭 지킬 동작」 1(사용자 캡처 모양) · 2(옛 모양 · 줄 넣기 · 지우기) · 3(못 찾으면 shape + 찾지 못한 글자 · 값 없음) ·
 * 4(옛 모양 가짜 값 → 총 자산 · 비율 조정 · 하루 기록이 바꾸기 전 `69624a7` 과 바이트까지 같음 — `fixtures/asset/cashBaseline.json`) ·
 * 5(구글 읽기 두 번 · 쓰기 0 · 시트 쓰기 코드 바뀐 줄 0 · 로그에 금액 · 이름 0) · 7(매매 · 주문 · 로그인 코드 바뀐 파일 0 · 서버가 함께 쓰는 `src/` 는 types/asset.ts · changelog 더하기만 ·
 * `designCheck.ts` 판정 부분 0 — 기준 `69624a7` → 그 차수 끝 · `lib/chasuRange.ts` 가 범위를 정한다) · 점검 명령(`asset:check-sheet`) 줄 수 · 총액 줄 위치를 줄마다 확인한다. 화면(6)은 `assetcashui:test`.
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 **가짜 시트**(`fixtures/asset/cashSheetBook.ts` — 만든 값) · 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 계좌 이름을 찍지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { parseAssetSheet, readAssetSheet, resetSheetCache, sheetRanges } from '../server/asset/sheet';
import { findCashShape } from '../server/asset/sheetShape';
import { SHEET_LAYOUT } from '../server/asset/sheetLayout';
import { runSheetCheck } from './assetCheckSheet';
import { RETIRE_AMOUNT, bankAmount, book, cut, cutRanges, snapshotOf, type Book, type Cell } from './fixtures/asset/cashSheetBook';
import type { AssetSheetData } from '../src/types/asset';
import { chasuDiff, type Chasu } from './lib/chasuRange';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cash-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-cash-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';

const C = SHEET_LAYOUT.cash.tab;
const AT = '2026-11-16T00:00:00.000Z';
const BASELINE = fs.readFileSync(path.join(root, 'scripts/fixtures/asset/cashBaseline.json'), 'utf8').trimEnd();

/** 사용자가 「현금」 탭 at 줄을 넣음(at 부터 아래로 한 칸 · 새 줄은 `set` 으로 채움) */
function insertCashRow(b: Book, at: number, set?: Record<string, Cell>): void {
  for (const dict of [b.values, b.formulas]) {
    const entries = Object.entries(dict).filter(([k]) => k.startsWith(`${C}!`) && Number(/(\d+)$/.exec(k)?.[1]) >= at);
    for (const [k] of entries) delete dict[k];
    for (const [k, v] of entries) dict[k.replace(/(\d+)$/, (n) => String(Number(n) + 1))] = v;
    for (const [col, v] of Object.entries(set ?? {})) dict[`${C}!${col}${at}`] = v;
  }
}
/** 사용자가 「현금」 탭 at 줄을 지움 */
function deleteCashRow(b: Book, at: number): void {
  for (const dict of [b.values, b.formulas]) {
    const inTab = Object.entries(dict).filter(([k]) => k.startsWith(`${C}!`));
    for (const [k] of inTab) delete dict[k];
    for (const [k, v] of inTab) {
      const row = Number(/(\d+)$/.exec(k)?.[1]);
      if (row !== at) dict[row > at ? k.replace(/(\d+)$/, String(row - 1)) : k] = v;
    }
  }
}
const parse = (b: Book): AssetSheetData => {
  const r = sheetRanges();
  return parseAssetSheet(cutRanges(b.values, r.values), cutRanges(b.formulas, r.formulas), AT);
};
const shapeMessage = (b: Book): string => {
  try {
    parse(b);
    return 'ok';
  } catch (e) {
    return e instanceof AssetSheetError && e.kind === 'shape' ? e.message : `other:${(e as Error).message}`;
  }
};
const bankSum = (n: number) => Array.from({ length: n }, (_, k) => bankAmount(k)).reduce((a, x) => a + x, 0);

// ── 가짜 구글 ──
let sheet = book('user');
const g = { reads: 0, values: 0, formulas: 0, writes: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') {
    g.writes++;
    return new Response('{}', { status: 200 });
  }
  g.reads++;
  const params = new URL(url).searchParams;
  const render = params.get('valueRenderOption');
  if (render === 'FORMULA') g.formulas++;
  else g.values++;
  const m = render === 'FORMULA' ? sheet.formulas : sheet.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
}) as typeof fetch;
function reset(b: Book) {
  sheet = b;
  g.reads = g.values = g.formulas = g.writes = 0;
  resetSheetCache();
  resetTokenCache();
}

// 로그 잡기 — 금액 · 이름이 찍히면 실패
const logged: string[] = [];
const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function capture<T>(fn: () => Promise<T>): Promise<T> {
  for (const k of ['warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  const keepLog = console.log;
  console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return fn().finally(() => {
    console.log = keepLog;
    Object.assign(console, { warn: orig.warn, error: orig.error, info: orig.info });
  });
}
const SECRETS = (b: Book) =>
  Object.entries(b.values)
    .filter(([k]) => k.startsWith(`${C}!`) && !/!B(2|4|28)$/.test(k) && !/(총액)$/.test(String(b.values[k])))
    .flatMap(([, v]) => (typeof v === 'number' ? [String(v), v.toLocaleString('en-US')] : String(v).split('\n')))
    .filter((s) => s.length >= 4);

try {
  // ═══ 1. 사용자 캡처 모양 ═══
  const user = parse(book('user'));
  check('[138-1] 캡처 모양 — 총액 26행 C열 = 은행 계좌 21줄 합(시트 총액 그대로)', user.cashTotal === bankSum(21));
  check('[138-1] 캡처 모양 — 퇴직 연금 총액 31행 C열', user.retirement === RETIRE_AMOUNT);
  check('[138-1] 은행 계좌 21줄 · 시트 순서 · 줄 번호 5~25', user.cashAccounts.length === 21 && user.cashAccounts.every((r, k) => r.row === 5 + k && r.amount === bankAmount(k)));
  check('[138-1] 같은 이름 줄도 모두 따로(합치지 않음)', new Set(user.cashAccounts.map((r) => r.name)).size < user.cashAccounts.length);
  check('[138-1] 두 줄 이름은 줄바꿈 없이 한 줄(공백)', user.cashAccounts.at(-1)?.name === '가짜은행 (가짜 적금 26.11.16 ~ 29.11.16)' && user.cashAccounts.every((r) => !/\n/.test(r.name)));
  check('[138-1] 퇴직 연금 줄 — 29행 1줄(빈 30행은 건너뜀) · 「갱신일자」 · 머리 · 총액 글자는 계좌가 아님', user.retirementAccounts.length === 1 && user.retirementAccounts[0].row === 29 && user.retirementAccounts[0].amount === RETIRE_AMOUNT
    && ![...user.cashAccounts, ...user.retirementAccounts].some((r) => /갱신일자|총액|^은행 자산$|^퇴직 연금$/.test(r.name)));
  const shapeUser = findCashShape(cut(book('user').values, `'${C}'!B1:C`));
  check('[138-1] 찾은 줄 — 은행 머리 4 · 총액 26 · 퇴직 연금 머리 28 · 총액 31', shapeUser.bank.headRow === 4 && shapeUser.bank.totalRow === 26 && shapeUser.retirement.headRow === 28 && shapeUser.retirement.totalRow === 31);
  {
    const b = book('user');
    b.values[`${C}!C10`] = '';
    b.values[`${C}!B12`] = '  ';
    const d = parse(b);
    check('[138-1] 금액 빈칸은 null(0 아님 — 화면 「—」) · 이름 빈 줄은 건너뜀', d.cashAccounts.find((r) => r.row === 10)?.amount === null && !d.cashAccounts.some((r) => r.row === 12) && d.cashAccounts.length === 20);
  }

  // ═══ 2. 옛 모양 · 줄 넣기 · 지우기 ═══
  const old = parse(book('old'));
  check('[138-2] 옛 모양(총액 25 · 30행)도 그대로 읽힘', old.cashTotal === bankSum(20) && old.retirement === RETIRE_AMOUNT && old.cashAccounts.length === 20 && old.retirementAccounts.length === 1);
  const moves: [string, (b: Book) => void, number, number][] = [
    ['머리 위(3행)에 줄 넣기', (b) => insertCashRow(b, 3, { B: '메모' }), 21, 1],
    ['은행 계좌 맨 위(5행)에 줄 넣기', (b) => insertCashRow(b, 5, { B: '가짜새계좌', C: 5 }), 22, 1],
    ['은행 계좌 중간(15행)에 줄 넣기', (b) => insertCashRow(b, 15, { B: '가짜새계좌', C: 5 }), 22, 1],
    ['은행 계좌 맨 아래(총액 바로 위 26행)에 줄 넣기', (b) => insertCashRow(b, 26, { B: '가짜새계좌', C: 5 }), 22, 1],
    ['두 구간 사이(27행)에 빈 줄 넣기', (b) => insertCashRow(b, 27), 21, 1],
    ['퇴직 연금에 줄 넣기(30행)', (b) => insertCashRow(b, 30, { B: '가짜새연금', C: 7 }), 21, 2],
    ['맨 아래(32행)에 줄 넣기', (b) => insertCashRow(b, 32, { B: '메모2' }), 21, 1],
    ['은행 계좌 맨 위(5행) 지우기', (b) => deleteCashRow(b, 5), 20, 1],
    ['은행 계좌 중간(15행) 지우기', (b) => deleteCashRow(b, 15), 20, 1],
    ['은행 계좌 맨 아래(25행) 지우기', (b) => deleteCashRow(b, 25), 20, 1],
    ['퇴직 연금 빈 줄(30행) 지우기', (b) => deleteCashRow(b, 30), 21, 1],
  ];
  for (const [label, move, bankRows, retireRows] of moves) {
    const b = book('user');
    const before = { total: b.values[`${C}!C26`], retire: b.values[`${C}!C31`] };
    move(b);
    let d: AssetSheetData | null = null;
    try {
      d = parse(b);
    } catch {
      d = null;
    }
    check(`[138-2] ${label} → 총액 · 계좌 줄 수 맞음(은행 ${bankRows} · 퇴직 연금 ${retireRows})`,
      d != null && d.cashTotal === before.total && d.retirement === before.retire && d.cashAccounts.length === bankRows && d.retirementAccounts.length === retireRows);
  }

  // ═══ 3. 못 찾으면 shape + 찾지 못한 글자 ═══
  const broken: [string, (b: Book) => void, RegExp][] = [
    ['「은행 자산 총액」 없음', (b) => void (b.values[`${C}!B26`] = '은행 합계'), /「현금」 탭에서 「은행 자산 총액」 줄을 찾지 못했어요/],
    ['「은행 자산」 머리 없음', (b) => void (b.values[`${C}!B4`] = ''), /「현금」 탭에서 「은행 자산」 줄을 찾지 못했어요/],
    ['「퇴직 연금」 머리 없음', (b) => void (b.values[`${C}!B28`] = '연금'), /「현금」 탭에서 「퇴직 연금」 줄을 찾지 못했어요/],
    ['「퇴직 연금 총액」 없음', (b) => void delete b.values[`${C}!B31`], /「현금」 탭에서 「퇴직 연금 총액」 줄을 찾지 못했어요/],
    ['「은행 자산 총액」 두 번', (b) => void (b.values[`${C}!B10`] = '은행 자산 총액'), /「현금」 탭에 「은행 자산 총액」 줄이 두 번 있어요/],
    ['은행 머리 · 총액 순서 바뀜', (b) => Object.assign(b.values, { [`${C}!B4`]: '은행 자산 총액', [`${C}!B26`]: '은행 자산' }), /「은행 자산」 줄이 「은행 자산 총액」 줄보다 위에/],
    ['두 구간 순서 바뀜', (b) => Object.assign(b.values, { [`${C}!B4`]: '퇴직 연금', [`${C}!B26`]: '퇴직 연금 총액', [`${C}!B28`]: '은행 자산', [`${C}!B31`]: '은행 자산 총액' }), /「은행 자산 총액」 줄이 「퇴직 연금」 줄보다 위에/],
    ['「현금」 탭이 비었음', (b) => {
      for (const k of Object.keys(b.values)) if (k.startsWith(`${C}!`)) delete b.values[k];
    }, /「현금」 탭에서 「은행 자산」 줄을 찾지 못했어요/],
  ];
  for (const [label, change, msg] of broken) {
    const b = book('user');
    change(b);
    const m = shapeMessage(b);
    check(`[138-3] ${label} → shape · 찾지 못한 글자를 말함`, msg.test(m), m.slice(0, 80));
    check(`[138-3] ${label} → 오류 글에 금액 · 이름 없음`, !SECRETS(book('user')).some((s) => m.includes(s)));
  }
  check('[138-3] 띄어쓰기만 다른 글자는 같은 줄(공백 무시 — 기존 머리 글자 비교와 같음)', (() => {
    const b = book('user');
    b.values[`${C}!B26`] = ' 은행자산 총액 ';
    return parse(b).cashTotal === bankSum(21);
  })());
  {
    reset((() => {
      const b = book('user');
      b.values[`${C}!B26`] = '은행 합계';
      return b;
    })());
    let err: unknown = null;
    let data: unknown = null;
    try {
      data = await readAssetSheet();
    } catch (e) {
      err = e;
    }
    check('[138-3] readAssetSheet — shape 오류 · 값을 돌려주지 않음 · 수식은 읽지 않음 · 쓰기 0', err instanceof AssetSheetError && err.kind === 'shape' && data == null && g.values === 1 && g.formulas === 0 && g.writes === 0);
  }

  // ═══ 4. 바이트 비교 — 바꾸기 전(69624a7)과 같음 ═══
  const now = snapshotOf(old);
  check('[138-4] 옛 모양 가짜 값 → computeAssetTotals(연금 뺌 · 포함) · 비율 조정 · 하루 기록 종목별 · 계좌 · 종목별이 69624a7 과 바이트까지 같음', now === BASELINE,
    `길이 ${now.length} / ${BASELINE.length}`);
  {
    const shifted = book('old');
    insertCashRow(shifted, 10, { B: '가짜새계좌' }); // 금액 빈 줄 — 총액(시트 합계)은 그대로
    check('[138-4] 금액 빈 줄을 넣어도 총 자산 계산은 바이트까지 같음(시트 총액만 씀)', snapshotOf(parse(shifted)) === BASELINE);
  }

  // ═══ 5. 구글 호출 수 · 쓰기 0 · 로그 ═══
  reset(book('user'));
  const read = await capture(() => readAssetSheet());
  check('[138-5] 시트 읽기 = batchGet 두 번(값 1 · 수식 1) · 쓰기 0', g.reads === 2 && g.values === 1 && g.formulas === 1 && g.writes === 0, `${g.values}/${g.formulas}/${g.writes}`);
  check('[138-5] 「현금」 탭은 값 읽기 안 넓은 범위 하나(B · C — 줄 수를 정하지 않음) · 수식 읽기에는 없음 · 고정 칸 B25 · B30 · C25 · C30 없음', (() => {
    const r = sheetRanges();
    const cashRanges = [...r.values, ...r.formulas].filter((x) => x.startsWith(`'${C}'`));
    return cashRanges.length === 1 && cashRanges[0] === `'${C}'!B1:C` && r.values.includes(cashRanges[0]);
  })());
  const layoutSrc = fs.readFileSync(path.join(root, 'server/asset/sheetLayout.ts'), 'utf8');
  check('[138-5] sheetLayout 에 「현금」 고정 칸(B25 · B30 · C25 · C30 · cashTotal · retirement 칸) 없음(A-11)', !/'(B25|B30|C25|C30)'/.test(layoutSrc) && !/cashTotal:|retirement:/.test(layoutSrc));
  check('[138-5] 읽은 값은 같은 결과(캐시 · 화면용 계좌 줄 포함)', read.cashAccounts.length === 21 && read.cashTotal === bankSum(21));
  const secrets = SECRETS(book('user'));
  check('[138-5] 읽는 동안 로그에 금액 · 계좌 이름 0', !logged.some((l) => secrets.some((s) => l.includes(s))), `${logged.length}줄`);

  // ═══ 5 · 7 — 바뀐 파일(기준 69624a7) ═══
  {
    const BASE = '69624a7';
    const CHASU: Chasu = { base: BASE, version: 'v2.70.4' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)
    // 시트에 쓰는 코드: 구글 쓰기 함수 · 가격 쓰기 · 줄 넣기 · 매수 · 매도 파일은 바뀐 줄 0 · sheet.ts 는 쓰기 함수 세 개 본문이 그대로(A 커밋 5605a27 — 이 작업에서 sheet.ts 를 바꾼 커밋)
    const writers = chasuDiff(root, CHASU, ['--name-only'], ['server/asset/google.ts', 'server/asset/priceSheet.ts', 'server/asset/priceWriter.ts', 'server/asset/rowOps.ts', 'server/asset/trade.ts', 'server/asset/purchase.ts', 'server/asset/settings.ts', 'server/asset/store.ts']);
    const show = (rev: string) => spawnSync('git', ['show', `${rev}:server/asset/sheet.ts`], { cwd: root, encoding: 'utf8' }).stdout;
    const body = (src: string, name: string) => src.split(new RegExp(`export (?:async )?function ${name}\\(`))[1]?.split('\nexport ')[0] ?? '';
    const [before, after] = [show(BASE), show('5605a27')];
    const same = ['writeAssetClasses', 'writeTargetRatio', 'writeAccountDates', 'checkTargetRatio'].every((n) => body(before, n).length > 50 && body(before, n) === body(after, n));
    check('[138-5] 시트 쓰기 코드 바뀐 줄 0(google · 가격 쓰기 · 줄 넣기 · 매수 매도 · 구매 · 설정 파일 0 · sheet.ts 쓰기 함수 본문 그대로)', writers.status === 0 && writers.stdout.trim() === '' && same, writers.stdout.trim());
    const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python']);
    check('[138-7] 매매 · 주문 · 자동매매 · AI 검증 · 시세 · 시황 · 로그인 · src/services · python 바뀐 파일 0(69624a7 → 그 차수 끝)', trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
    const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
    const changedShared = chasuDiff(root, CHASU, ['--name-only'], [...shared]).stdout.trim().split('\n').filter(Boolean);
    const ALLOWED = ['src/data/changelog.ts', 'src/types/asset.ts'];
    const deleted = chasuDiff(root, CHASU, ['-U0'], ALLOWED).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check(`[138-7] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 것은 types/asset.ts · data/changelog.ts 뿐 · 모두 더하기만(지운 줄 0)`,
      shared.length > 30 && changedShared.every((f) => ALLOWED.includes(f)) && changedShared.includes('src/types/asset.ts') && deleted.length === 0, `${changedShared.join(',')} · 지운 줄 ${deleted.length}`);
    const dc = chasuDiff(root, { ...CHASU, end: 'deaf94c' }, ['-U0'], ['scripts/designCheck.ts']).stdout; // 장면을 더한 B 커밋까지
    const dcDeleted = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[138-7] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0 · 더한 곳은 장면 목록 한 곳(현금펼침 — B 커밋 deaf94c)', dcDeleted.length === 0 && (dc.match(/^@@ /gm) ?? []).length === 1 && dc.includes('현금펼침'), `지운 줄 ${dcDeleted.length}`);
  }

  // ═══ 점검 명령 — 「은행 계좌 N줄 · 퇴직 연금 N줄 · 총액 줄 위치」 · 금액 · 이름은 출력 안 함 ═══
  for (const [kind, bank, retire, bt, rt] of [['user', 21, 1, 26, 31], ['old', 20, 1, 25, 30]] as const) {
    reset(book(kind));
    const lines: string[] = [];
    await runSheetCheck({ sheetId: 'selftest-cash-sheet', keyFile }, (l) => lines.push(l));
    const text = lines.join('\n');
    check(`[138-A] asset:check-sheet(${kind === 'user' ? '캡처' : '옛'} 모양) — 「은행 계좌 ${bank}줄 · 퇴직 연금 ${retire}줄 · 총액 줄 B${bt} · B${rt}」`,
      text.includes(`은행 계좌 ${bank}줄 · 퇴직 연금 ${retire}줄 · 총액 줄 「은행 자산 총액」 B${bt} · 「퇴직 연금 총액」 B${rt}`), lines.find((l) => l.includes('현금')) ?? '');
    check(`[138-A] asset:check-sheet(${kind}) — 금액 · 계좌 이름 출력 0 · 구글 읽기 두 번 · 쓰기 0`, !SECRETS(book(kind)).some((s) => text.includes(s)) && g.reads === 2 && g.writes === 0);
  }
  {
    const b = book('user');
    b.values[`${C}!B31`] = '연금 합계';
    reset(b);
    const lines: string[] = [];
    const res = await runSheetCheck({ sheetId: 'selftest-cash-sheet', keyFile }, (l) => lines.push(l));
    check('[138-A] asset:check-sheet — 총액 줄을 못 찾으면 ❌ 와 찾지 못한 글자 · 연결하지 마세요', !res.ok && lines.some((l) => l.includes('❌') && l.includes('「퇴직 연금 총액」 줄을 찾지 못했어요')));
  }
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}

orig.log(`\n자산 「현금」 탭 시험 — ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
