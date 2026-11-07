/**
 * 자산 시트 점검 · 시트 바뀜(v2.65.1 · 114차) — `npm run assetsheet:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 114차 지시서 「꼭 지킬 동작」 3(점검 스크립트 `asset:check-sheet`)을 줄마다 확인한다(시험 이름 앞의 [114-n] 이 그 줄 번호).
 * - 구글: 이 프로세스의 `fetch` 를 바꿔치기한 **가짜 시트**(만든 값 · 시험용 RSA 열쇠) · 종료 코드는 자식 프로세스에
 *   `scripts/fixtures/asset/fakeGoogle.mjs` 를 미리 불러 같은 가짜 시트로 — 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 코드 · 이름 · 시트 ID 전체 · 열쇠 값을 찍지 않는다(끝에서 검사).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetTokenCache } from '../server/asset/google';
import { runSheetCheck, sheetArg } from './assetCheckSheet';

let pass = 0;
let fail = 0;
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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sheet-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const EMAIL = 'selftest-sa@selftest-project.iam.gserviceaccount.com';
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: EMAIL, private_key: PEM, private_key_id: 'selftest-key-id-9f8e7d6c5b4a' }));
/** 가짜 시트 ID — 출력에는 앞 4글자 + … 만 나와야 한다 */
const SHEET_ID = 'Zq9xSELFTESTsheetIdThatMustNotLeak0123456789';
const config = { sheetId: SHEET_ID, keyFile };

type Cell = string | number;
const FAKE = { cash: 987654321, retirement: 123123123, salary: 4567890, fx: 1388.77, px: 71234, qty: 37 };
const SECRET = ['987654321', '123123123', '4567890', '1388.77', '71234', 'NVDA', '005930', '0072R0', '가짜 미국주', '가짜 국내주', '가짜 토스주', SHEET_ID, SHEET_ID.slice(0, 12), 'selftest-key-id', 'PRIVATE KEY', '2026.07', '2026.10'];

/** 맞는 시트 — 값 · 수식 */
function goodSheet(): { values: Record<string, Cell>; formulas: Record<string, Cell> } {
  const v: Record<string, Cell> = {
    '티커!B12': '구분', '티커!D12': '자산 분류', '티커!G9': FAKE.fx, '티커!C9': FAKE.fx,
    '티커!B14': '개별 투자',
    '티커!B15': '가짜 미국주', '티커!C15': 'NASDAQ:NVDA', '티커!D15': '주식', '티커!E15': 123.45, '티커!F15': 171000,
    '티커!B16': '가짜 국내주', '티커!C16': '005930', '티커!D16': '채권', '티커!E16': FAKE.px, '티커!F16': FAKE.px,
    '티커!B17': '가짜 토스주', '티커!C17': '0072R0', '티커!D17': '', '티커!E17': 15000, '티커!F17': 15000,
    '주식 투자 정리!B3': '내 계좌 정보', '주식 투자 정리!B38': '내 계좌 정보',
    '주식 투자 정리!B4': '개별 투자 ( 2026.07 )', '주식 투자 정리!B12': '적립식 계좌 ( 2026.10 )', '주식 투자 정리!B21': 'ISA 계좌 ( 2026.07 )', '주식 투자 정리!B29': '연금 저축 계좌 ( 2026.07 )',
    '주식 투자 정리!B5': '가짜 미국주', '주식 투자 정리!D5': FAKE.qty,
    '주식 투자 정리!B13': '가짜 국내주', '주식 투자 정리!D13': FAKE.qty,
    '주식 투자 정리!B22': '가짜 토스주', '주식 투자 정리!D22': FAKE.qty,
    '주식 투자 정리!B30': '가짜 국내주', '주식 투자 정리!D30': FAKE.qty,
    '주식 투자 정리!B39': '가짜 국내주', '주식 투자 정리!D39': FAKE.qty,
    '자산 투자 비율 관리!B18': '자산 배분 비율',
    '자산 투자 비율 관리!C17': '현금성 자산(예금 적금)', '자산 투자 비율 관리!D17': '금', '자산 투자 비율 관리!E17': '채권', '자산 투자 비율 관리!F17': '투자 (주식)',
    '자산 투자 비율 관리!F23': '코어', '자산 투자 비율 관리!F24': '위성',
    '자산 투자 비율 관리!C18': 0.2, '자산 투자 비율 관리!D18': 0.1, '자산 투자 비율 관리!E18': 0.1, '자산 투자 비율 관리!F18': 0.6,
    '자산 투자 비율 관리!G23': 0.7, '자산 투자 비율 관리!G24': 0.3,
    '월 고정지출!B5': '현재 월 급여', '월 고정지출!C5': FAKE.salary,
    '현금!B25': '은행 자산 총액', '현금!C25': FAKE.cash, '현금!B30': '퇴직 연금 총액', '현금!C30': FAKE.retirement,
  };
  const f: Record<string, Cell> = {
    ...v,
    '티커!C9': '=GOOGLEFINANCE("CURRENCY:USDKRW")',
    '티커!E15': '=GOOGLEFINANCE(C15,"price")', '티커!F15': '=GOOGLEFINANCE($C15,"price")*$C$9',
    '티커!E16': '=GOOGLEFINANCE(C16,"price")', '티커!F16': '=GOOGLEFINANCE(C16,"price")',
    '티커!E17': 15000, '티커!F17': '=E17', // 이미 토스(113차 바꾼 뒤 모양)
    '주식 투자 정리!F5': "=D5*'티커'!$F$15", '주식 투자 정리!F13': "=D13*'티커'!$F$16", '주식 투자 정리!F22': "=D22*'티커'!$F$17",
    '주식 투자 정리!F30': "=D30*'티커'!$F$16", '주식 투자 정리!F39': "=D39*'티커'!$F$16",
  };
  return { values: v, formulas: f };
}

// ── 가짜 구글(이 프로세스) ──
let model = goodSheet();
let mode = 'ok';
const g = { reads: 0, writes: 0, renders: [] as string[] };
const realFetch = globalThis.fetch;
const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
function cut(m: Record<string, Cell>, range: string): Cell[][] {
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
  if (!r) throw new Error('범위 모양');
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(r[2]), Number(r[3])];
  const [c2, r2] = r[4] ? [colNum(r[4]), Number(r[5])] : [c1, r1];
  const rows: Cell[][] = [];
  for (let y = r1; y <= r2; y++) {
    const row: Cell[] = [];
    for (let x = c1; x <= c2; x++) row.push(m[`${tab}!${colChr(x)}${y}`] ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') {
    g.writes++;
    return new Response('{}', { status: 418 });
  }
  g.reads++;
  if (mode === '403') return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }), { status: 403 });
  if (mode.startsWith('400:')) return new Response(JSON.stringify({ error: { code: 400, message: `Unable to parse range: '${mode.slice(4)}'!B25` } }), { status: 400 });
  const params = new URL(url).searchParams;
  const render = params.get('valueRenderOption') ?? '';
  g.renders.push(render);
  const m = render === 'FORMULA' ? model.formulas : model.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
}) as typeof fetch;

async function run(label: string, change?: (m: typeof model) => void, m = 'ok') {
  model = goodSheet();
  change?.(model);
  mode = m;
  g.reads = 0;
  g.renders = [];
  resetTokenCache();
  const lines: string[] = [];
  const res = await runSheetCheck(config, (l) => lines.push(l));
  printed.push(...lines.map((l) => `[${label}] ${l}`));
  return { ...res, text: lines.join('\n'), last: lines.at(-1) ?? '' };
}

try {
  // ═══ [114-3] 점검 스크립트 ═══
  // 쓰기 함수 import 없음(소스 검사)
  const src = fs.readFileSync(path.join(root, 'scripts/assetCheckSheet.ts'), 'utf8');
  const imports = [...src.matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)'/gm)].map((x) => ({ names: x[1], from: x[2] }));
  const bannedNames = /\b(valuesWrite|write[A-Z]\w*|convertSheetPrices|restoreSheetPrices|saveSheetBackup|clearSheetBackup|savePriceState|getDb|insertRecord|recordPurchase)\b/;
  check('[114-3] 점검 스크립트는 쓰기 함수 · DB 함수를 import 하지 않음(소스 검사)', imports.length > 0 && imports.every((x) => !bannedNames.test(x.names)) && !imports.some((x) => /\/db'$|requireCopyDb|\/store'$|\/priceState'$/.test(x.from)),
    imports.filter((x) => bannedNames.test(x.names)).map((x) => x.from).join(','));
  check('[114-3] 칸 목록은 sheetLayout.ts 에서 가져옴(SHEET_LAYOUT import · 칸 주소 글자를 박지 않음)', /SHEET_LAYOUT/.test(src) && !/'(B12|D12|C9|B3|B38|C25|C30|C5|G9|C18|G23)'/.test(src));
  check('[114-3] --sheet <ID> · --sheet=<ID> 인자', sheetArg(['--sheet', 'abc']) === 'abc' && sheetArg(['--sheet=xyz']) === 'xyz' && sheetArg([]) === null);

  const ok = await run('맞음');
  check('[114-3] 가짜 구글로 맞는 시트 → ✅ 연결해도 됩니다 · ❌ 0', ok.ok && ok.problems === 0 && ok.last === '✅ 연결해도 됩니다', ok.text.split('\n').filter((l) => /❌|다름/.test(l)).join(' / '));
  check('[114-3] 구글 읽기 = 값 1번 · 수식 1번(쓰기 0)', ok.reads === 2 && g.reads === 2 && JSON.stringify(g.renders) === JSON.stringify(['UNFORMATTED_VALUE', 'FORMULA']) && g.writes === 0);
  check('[114-3] 줄 수 · 모양 보고 — 종목 3줄(국내 2 · 미국 1) · 빈칸 1 · GOOGLEFINANCE 2줄 · 이미 토스 1줄 · 이어진 줄 5 / 5 · 서비스 계정 이메일',
    /3줄 · 국내 2 · 미국 1/.test(ok.text) && /빈칸 1 · 그 밖 0/.test(ok.text) && /GOOGLEFINANCE 2줄 · 이미 토스 1줄 · 다른 모양 0줄/.test(ok.text) && /이어진 줄 5 \/ 5/.test(ok.text) && ok.text.includes(EMAIL) && /####\.##/.test(ok.text), ok.text);

  const noD = await run('D12없음', (m) => {
    delete m.values['티커!D12'];
    delete m.formulas['티커!D12'];
  });
  check('[114-3] D12 「자산 분류」 없음 → ❌ + 「티커」 D12 · 종료 1(ok=false)', !noD.ok && /❌ 「티커」 D12 — 「자산 분류」/.test(noD.text) && /^❌ 연결하지 마세요 — 위 1곳/.test(noD.last), noD.text);

  const tab = await run('탭이름', undefined, '400:현금');
  check('[114-3] 탭 이름 다름(구글 400) → ❌ + 「현금」 탭', !tab.ok && /탭 이름이 시트에 없습니다 — 「현금」 탭/.test(tab.text) && /^❌ 연결하지 마세요/.test(tab.last), tab.text);

  const shared = await run('공유안됨', undefined, '403');
  check('[114-3] 공유 안 됨(403) → ❌ + 서비스 계정 이메일에 편집자로 공유', !shared.ok && shared.text.includes(`서비스 계정(${EMAIL})에 이 시트를 편집자로 공유해 주세요`) && /^❌ 연결하지 마세요/.test(shared.last) && shared.reads === 1, shared.text);

  const fBad = await run('F모양', (m) => {
    m.formulas['티커!F16'] = '=E16*2';
  });
  check('[114-3] F 모양 다름 → ❌ + 「티커」 F16', !fBad.ok && /❌ 「티커」 F16 — 원화 표기 칸/.test(fBad.text) && /위 1곳/.test(fBad.last), fBad.text);

  const unlinked = await run('이음없음', (m) => {
    m.formulas['주식 투자 정리!F13'] = '=D13*1000';
  });
  check('[114-3] 보유 줄이 「티커」 와 이어지지 않음 → ❌ + 「주식 투자 정리」 F13', !unlinked.ok && /❌ 「주식 투자 정리」 F13/.test(unlinked.text) && /이어진 줄 4 \/ 5/.test(unlinked.text), unlinked.text);

  // 종료 코드 — 자식 프로세스(가짜 구글 미리 불러오기)
  const exitOf = (sheet: typeof model, m: string, args: string[], env: Record<string, string | undefined> = {}) => {
    const file = path.join(tmp, `model-${crypto.randomUUID()}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...sheet, mode: m }));
    const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), ['--import', path.join(root, 'scripts/fixtures/asset/fakeGoogle.mjs'), path.join(root, 'scripts/assetCheckSheet.ts'), ...args], {
      cwd: tmp, // .env 를 읽지 않는 곳
      encoding: 'utf8',
      env: { ...process.env, ASSET_SHEET_ID: '', GOOGLE_SA_KEY_FILE: keyFile, FAKE_GOOGLE_FILE: file, ...env },
      timeout: 120_000,
    });
    printed.push(...(r.stdout ?? '').split('\n').map((l) => `[자식] ${l}`));
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  const e0 = exitOf(goodSheet(), 'ok', ['--sheet', SHEET_ID]);
  const bad = goodSheet();
  delete bad.values['티커!D12'];
  const e1 = exitOf(bad, 'ok', [`--sheet=${SHEET_ID}`]);
  const e403 = exitOf(goodSheet(), '403', ['--sheet', SHEET_ID]);
  const eEnv = exitOf(goodSheet(), 'ok', [], { ASSET_SHEET_ID: SHEET_ID });
  const eNone = exitOf(goodSheet(), 'ok', []);
  check('[114-3] 종료 코드 — 맞음 0 · D12 없음 1 · 403 1 · --sheet 없으면 .env ASSET_SHEET_ID(0) · 둘 다 없으면 1',
    e0.code === 0 && /✅ 연결해도 됩니다/.test(e0.out) && e1.code === 1 && e403.code === 1 && eEnv.code === 0 && eNone.code === 1 && /시트 ID 가 없습니다/.test(eNone.out),
    [e0.code, e1.code, e403.code, eEnv.code, eNone.code].join(',') + ' ' + e0.out.slice(-300));
  const childOut = [e0, e1, e403, eEnv, eNone].map((x) => x.out).join('\n');
  const leakedChild = SECRET.filter((x) => childOut.includes(x));
  check('[114-3] 출력에 시트 ID 전체 · 금액 · 코드 · 이름 · 열쇠 값 없음(앞 4글자 + … 만)', leakedChild.length === 0 && childOut.includes(`${SHEET_ID.slice(0, 4)}…`) && !childOut.includes(SHEET_ID.slice(0, 5)), leakedChild.join(','));
} finally {
  globalThis.fetch = realFetch;
}

const leaked = SECRET.filter((x) => printed.join('\n').includes(x));
check('[114-6] 이 시험 · 점검 스크립트 출력에 시트 ID 전체 · 금액 · 코드 · 이름 · 열쇠 값 없음', leaked.length === 0, leaked.join(','));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
