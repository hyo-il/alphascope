/**
 * 자산 시트 점검 · 시트 바뀜(v2.65.1 · 114차) — `npm run assetsheet:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 114차 지시서 「꼭 지킬 동작」 3(점검 스크립트 `asset:check-sheet`) · 4 · 5(시트 바뀜 처리 — `server/asset/sheetSwitch.ts`) · 6(시트 ID 전체 없음) ·
 * 8(매매 · 시황 … 코드 바뀐 파일 0)을 줄마다 확인한다(시험 이름 앞의 [114-n] 이 그 줄 번호).
 * 115차(v2.65.2) 「꼭 지킬 동작」 8(점검 명령 — 현금 칸 없음 · 옛 「현금」 글자는 미지정 줄로 따로 셈)은 [115-8].
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
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../server/db';
import { resetTokenCache, AssetSheetError } from '../server/asset/google';
import { assetRouter } from '../server/asset/routes';
import { priceSheetStatus, restoreSheetPrices } from '../server/asset/priceSheet';
import { clearPriceStateForTest, priceMoved, priceRows, priceSkipped, priceSource, savePriceState } from '../server/asset/priceState';
import { checkSheetSwitch, clearSheetKeyForTest, sheetKeyOf, sheetSwitchedAt, storedSheetKeyForTest } from '../server/asset/sheetSwitch';
import {
  archiveCountsForTest, clearArchivesForTest, clearPurchasesForTest, clearRecordsForTest, clearSheetBackup, insertRecord, purchaseStartDay, recordPurchase, saveSheetBackup, sheetBackup,
} from '../server/asset/store';
import type { AssetTotals } from '../src/types/asset';
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
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/);
  if (!r) throw new Error('범위 모양');
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(r[2]), Number(r[3])];
  const [c2, r2] = r[4] ? [colNum(r[4]), r[5] ? Number(r[5]) : Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)))] : [c1, r1];
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
    /3줄 · 국내 2 · 미국 1/.test(ok.text) && /빈칸 1 · 미지정\(현금 — 고르기 목록에 없음\) 0줄 · 그 밖 0/.test(ok.text) && /GOOGLEFINANCE 2줄 · 이미 토스 1줄 · 다른 모양 0줄/.test(ok.text) && /이어진 줄 5 \/ 5/.test(ok.text) && ok.text.includes(EMAIL) && /####\.##/.test(ok.text), ok.text);

  // ═══ [115-8] 분류 값에서 「현금」 을 뺐다(v2.65.2) — 3번 셈에 「현금」 칸 없음 · 옛 「현금」 글자는 「미지정(현금 — 고르기 목록에 없음) n줄」 로 따로 ═══
  const cashCls = await run('현금글자', (m) => {
    m.values['티커!D17'] = '현금';
    m.formulas['티커!D17'] = '현금';
  });
  check('[115-8] 점검 명령 3번 — 분류 셈은 채권 · 금 · 주식만(「현금 n」 칸 없음) · 옛 「현금」 글자 1줄은 미지정 줄로 따로 · 그 밖 0 · 빈칸 0',
    cashCls.ok && /자산 분류 채권 1 · 금 0 · 주식 1 · 빈칸 0 · 미지정\(현금 — 고르기 목록에 없음\) 1줄 · 그 밖 0/.test(cashCls.text) && !/현금 \d/.test(cashCls.text.split('\n').find((l) => l.startsWith('3.')) ?? 'x'), cashCls.text);
  check('[115-8] 맞는 시트(현금 글자 없음) — 미지정(현금) 0줄', /미지정\(현금 — 고르기 목록에 없음\) 0줄 · 그 밖 0/.test(ok.text), ok.text);

  // ═══ 118차 D — 7번 칸 모양(값 없이 · 읽기 그대로 2번) ═══
  check('[118-D] 보유 구간마다 종목 줄 · 빈 줄 · 합친 표 표시', /보유 「개별 투자」 5~5행 — 종목 줄 1 · 빈 줄 0/.test(ok.text) && /보유 「적립식 주식」\(합친 표\) 39~39행 — 종목 줄 1 · 빈 줄 0/.test(ok.text), ok.text);
  check('[118-D] 「티커」 묶음 — 머리 줄 안에 있으면 그 이름 · 줄 수 · 빈 줄 · 구매 평균 환율 칸 모양', /묶음 「개별 투자」\(머리 14행\) — 종목 줄 3 · 빈 줄 0/.test(ok.text) && /구매 평균 환율 칸 — 숫자/.test(ok.text), ok.text);
  const shape = await run('칸모양', (m) => {
    m.formulas['주식 투자 정리!E6'] = '=C6*D6';
    m.formulas['주식 투자 정리!F6'] = '=GOOGLEFINANCE("KRX:005930")';
    // 빈 줄 하나 뒤에 종목 줄이 이어지는 구간 — 빈 줄의 칸 모양을 보인다
    m.values['주식 투자 정리!B7'] = '가짜 국내주';
    m.formulas['주식 투자 정리!B7'] = '가짜 국내주';
    m.formulas['주식 투자 정리!F7'] = "=D7*'티커'!$F$16";
    // 머리 줄이 한 줄 위(13행) — 고정 줄이 아니라 머리 글자로 찾는다
    m.values['티커!B13'] = '개별 투자';
    m.formulas['티커!B13'] = '개별 투자';
    delete m.values['티커!B14'];
    delete m.formulas['티커!B14'];
    m.values['티커!G9'] = 1300;
    m.formulas['티커!G9'] = "='환율 원본'!B2";
  });
  check('[118-D] 수식만 남은 빈 줄 — 칸 글자 · 수식 모양(숫자 · 따옴표 안 가림) · 값 없음', /6행 E 수식\(=C#\*D#\) · F 수식\(=GOOGLEFINANCE\("…"\)\)/.test(shape.text), shape.text);
  check('[119-A] 머리 줄이 13행으로 옮겨져도 머리 글자로 찾음 — 첫 묶음 이름 · 머리 13행', /묶음 「개별 투자」\(머리 13행\)/.test(shape.text), shape.text);
  check('[118-D] 구매 평균 환율 수식 → 모양 표시 + ⚠️ 알림 · 연결 판단은 그대로(✅)', /구매 평균 환율 칸 — 수식\(='환율 원본'!B#\)/.test(shape.text) && /⚠️ 구매 평균 환율 칸이 숫자가 아닙니다/.test(shape.text) && shape.ok, shape.text);
  check('[118-D] 7번을 더해도 읽기는 값 1번 · 수식 1번 · 쓰기 0', shape.reads === 2 && g.reads === 2 && g.writes === 0);

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

  // ═══ [114-4] · [114-5] · [114-6] 시트 바뀜 처리 ═══
  {
    const ids = { a: 'AaaaSELFTESTfirstSheetIdMustNotBeStored000000', b: 'BbbbSELFTESTsecondSheetIdMustNotBeStored11111', c: 'CcccSELFTESTthirdSheetIdMustNotBeStored222222' };
    process.env.GOOGLE_SA_KEY_FILE = keyFile;
    process.env.ASSET_PRICE_WRITE_ENABLED = 'true';
    process.env.ASSET_SYNC_ENABLED = 'true';
    const db = getDb();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const KEEP = ['asset.pensionSections', 'asset.satelliteSymbols', 'asset.classColors', 'asset.rebalanceBand', 'asset.purchaseStartDay'];
    const snapshot = () =>
      JSON.stringify({
        settings: db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${KEEP.map(() => '?').join(',')}) ORDER BY key`).all(...KEEP),
        purchase: db.prepare(`SELECT * FROM asset_purchase ORDER BY cycle_date`).all(),
      });
    // 처음 상태(사본 DB) — 비우고 시작
    clearSheetKeyForTest();
    clearArchivesForTest();
    clearRecordsForTest();
    clearSheetBackup();
    clearPriceStateForTest();
    clearPurchasesForTest();
    const totals = (t: number): AssetTotals => ({ total: t, groups: [], core: 0, satellite: 0, missing: 0 } as unknown as AssetTotals);
    const captured: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => {
      const line = a.map(String).join(' ');
      if (!/^(PASS|FAIL) /.test(line)) captured.push(line);
      origLog(...a);
    };
    g.reads = 0;
    g.writes = 0;

    process.env.ASSET_SHEET_ID = ids.a;
    const first = checkSheetSwitch();
    const s1 = storedSheetKeyForTest();
    check('[114-4] 처음(저장값 없음)이면 지금 해시만 저장 · 정리하지 않음', first === 'saved' && s1.key === sheetKeyOf(ids.a) && s1.key.length === 12 && s1.hint === ids.a.slice(0, 4) && s1.at === null);
    check('[114-4] 같은 해시면 아무것도 하지 않음', checkSheetSwitch() === 'same');

    // 시험용 시트(A) 위에서 쌓인 것 — 하루 기록 3줄 · 시트 가격 백업 3칸 · 토스 상태 · 설정 · 구매 기록
    for (const [d, t] of [['2026-11-03', 101], ['2026-11-04', 102], ['2026-11-05', 103]] as const) insertRecord(d, totals(t), totals(t + 1), `${d}T23:00:00.000Z`);
    saveSheetBackup([{ cell: 'C9', formula: '=GOOGLEFINANCE("CURRENCY:USDKRW")' }, { cell: 'E15', formula: '=GOOGLEFINANCE(C15,"price")' }, { cell: 'F15', formula: '=GOOGLEFINANCE($C15,"price")*$C$9' }], '2026-11-05T01:00:00.000Z');
    savePriceState({ source: 'toss', rows: [{ row: 15, code: 'NASDAQ:NVDA', market: 'US' }], skipped: [{ row: 17, name: '가짜 토스주', code: '0072R0', reason: 'no-toss-price' }], moved: [{ row: 21, wasName: '', wasCode: '005930', nowName: null, nowCode: null }] });
    const put = db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    put.run('asset.pensionSections', JSON.stringify(['연금 저축 계좌', 'ISA 계좌']));
    put.run('asset.satelliteSymbols', JSON.stringify(['NVDA']));
    put.run('asset.classColors', JSON.stringify({ cash: 'red', bond: 'purple', gold: 'yellow', stock: 'teal', retirement: 'pink' }));
    put.run('asset.rebalanceBand', '7');
    purchaseStartDay('2026-10-01');
    recordPurchase('2026-10-30', '2026-10-30');
    const before = snapshot();
    const dailyBefore = db.prepare(`SELECT day, total, total_pension, totals_json, missing, recorded_at FROM asset_daily ORDER BY day`).all();

    // 원본(B)으로 바꿈
    process.env.ASSET_SHEET_ID = ids.b;
    const sw = checkSheetSwitch(new Date('2026-11-07T23:10:00.000Z'));
    const after = archiveCountsForTest();
    const archived = db.prepare(`SELECT day, total, total_pension, totals_json, missing, recorded_at FROM asset_daily_archive WHERE sheet_key = ? ORDER BY day`).all(sheetKeyOf(ids.a));
    check('[114-4] 해시가 다르면 한 번 정리 — asset_daily → asset_daily_archive(줄 수 같음 · 값 그대로 · 옛 시트 해시) · asset_daily 비움 · 지운 줄 0',
      sw === 'switched' && count('asset_daily') === 0 && after.daily === 3 && JSON.stringify(archived) === JSON.stringify(dailyBefore));
    const st = priceSheetStatus();
    check('[114-4] 시트 가격 상태 처음으로(google · 바꾼 줄 · 바꾸지 않은 줄 · 옮겨진 줄 비움)',
      priceSource() === 'google' && priceRows().length === 0 && priceSkipped().length === 0 && priceMoved().length === 0 && st.source === 'google' && !st.hasBackup);
    check('[114-4] 옛 시트 백업은 지우지 않고 따로 보관(칸 3 · 옛 시트 앞 4글자) · 되돌리기용 백업 0 · 화면 「옛 시트 백업 n칸 보관 중」',
      sheetBackup().length === 0 && after.backup === 3 && JSON.stringify(st.archived) === JSON.stringify({ cells: 3, sheets: [ids.a.slice(0, 4)] }));
    const restoreKind = await restoreSheetPrices().then(() => 'ok', (e: unknown) => (e instanceof AssetSheetError ? e.kind : 'other'));
    check('[114-4] 새 시트에는 쓰지 않음 — 바뀜 처리 · 되돌리기(no-backup) 모두 구글 호출 0', restoreKind === 'no-backup' && g.reads === 0 && g.writes === 0, `${restoreKind} r${g.reads} w${g.writes}`);
    check('[114-4] 서버 로그 한 줄 「[asset] 시트가 바뀜 — 하루 기록 3줄 보관 · 옛 시트 백업 3칸 보관」(ID 없음)', captured.some((l) => l === '[asset] 시트가 바뀜 — 하루 기록 3줄 보관 · 옛 시트 백업 3칸 보관'), captured.join(' / '));
    check('[114-4] 바뀐 시각 저장(빈 차트 「원본 시트 연결 뒤 ○부터」)', sheetSwitchedAt() === '2026-11-07T23:10:00.000Z');
    check('[114-5] 그대로 두는 것 — 위성 · 연금 · 색 · 범위 · purchaseStartDay · asset_purchase 값이 처리 전후 같음', snapshot() === before && before.includes('ISA 계좌') && before.includes('2026-10-30'));

    // 서버를 다시 켜도(같은 해시) 다시 하지 않음 — 다른 프로세스로 확인
    insertRecord('2026-11-06', totals(201), totals(202), '2026-11-06T23:00:00.000Z');
    const child = spawnSync(path.join(root, 'node_modules/.bin/tsx'), ['-e', "import('./server/asset/sheetSwitch.ts').then((m) => console.log('RESULT=' + m.checkSheetSwitch()))"], {
      cwd: root, encoding: 'utf8', env: { ...process.env, ASSET_SHEET_ID: ids.b }, timeout: 120_000,
    });
    check('[114-4] 서버를 다시 켜도 다시 하지 않음(다른 프로세스 · 같은 해시 → same · 하루 기록 그대로)', /RESULT=same/.test(child.stdout) && count('asset_daily') === 1 && archiveCountsForTest().daily === 3, `${child.stdout.slice(-200)} ${child.stderr.slice(-200)}`);

    // 시험용(A)으로 되돌려도 자동 복원 없음(보관만) — 처리는 그 해시로 한 번 더
    process.env.ASSET_SHEET_ID = ids.a;
    const back = checkSheetSwitch(new Date('2026-11-08T01:00:00.000Z'));
    check('[114-4] 같은 해시(A)로 돌아와도 자동으로 되돌리지 않음 — B 의 기록 1줄도 보관 · asset_daily 비어 있음',
      back === 'switched' && count('asset_daily') === 0 && archiveCountsForTest().daily === 4 && (db.prepare(`SELECT COUNT(*) AS n FROM asset_daily_archive WHERE sheet_key = ?`).get(sheetKeyOf(ids.b)) as { n: number }).n === 1);
    check('[114-5] 두 번 바꾼 뒤에도 그대로 두는 것 같음', snapshot() === before);

    // 자산 요청 처음 때(C) — 라우터 맨 앞
    process.env.ASSET_SHEET_ID = ids.c;
    const app = express();
    app.use(express.json());
    app.use(assetRouter);
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((ok) => srv.once('listening', ok));
    const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/asset/status`);
    srv.close();
    check('[114-4] 자산 요청 처음 때도 확인 — GET /api/asset/status 뒤 저장값 = 지금 해시', res.status === 200 && storedSheetKeyForTest().key === sheetKeyOf(ids.c));

    // [114-6] 시트 ID 전체가 app_settings · 보관표 · 로그 어디에도 없음
    const allSettings = JSON.stringify(db.prepare(`SELECT key, value FROM app_settings`).all());
    const allArchive = JSON.stringify([...db.prepare(`SELECT * FROM asset_daily_archive`).all(), ...db.prepare(`SELECT * FROM asset_sheet_backup_archive`).all()]);
    const idLeak = Object.values(ids).filter((id) => allSettings.includes(id) || allArchive.includes(id) || captured.join('\n').includes(id) || allSettings.includes(id.slice(0, 8)));
    check('[114-6] app_settings · 보관표 · 서버 로그에 시트 ID 전체 없음(해시 12자 · 앞 4글자만)', idLeak.length === 0 && allSettings.includes(sheetKeyOf(ids.c)), idLeak.map((x) => x.slice(0, 4)).join(','));

    console.log = origLog;
    // 사본 DB 정리
    clearSheetKeyForTest();
    clearArchivesForTest();
    clearRecordsForTest();
    clearSheetBackup();
    clearPriceStateForTest();
    clearPurchasesForTest();
    for (const k of KEEP) db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(k);
  }
} finally {
  globalThis.fetch = realFetch;
}

// ═══ [114-8] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 · 시세 · 장 시간 코드 바뀐 파일 0 ═══
const diff = spawnSync('git', ['diff', '--name-only', 'c68fab2', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'server/marketCalendar.ts', 'server/heatmapSession.ts', 'server/quoteService.ts', 'src/services/toss', 'python'], { cwd: root, encoding: 'utf8' });
check('[114-8] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 · 시세 · 장 시간 코드 바뀐 파일 0(c68fab2 와 지금 작업 트리)', diff.status === 0 && diff.stdout.trim() === '', diff.stdout.trim() || diff.stderr.trim());

const leaked = SECRET.filter((x) => printed.join('\n').includes(x));
check('[114-6] 이 시험 · 점검 스크립트 출력에 시트 ID 전체 · 금액 · 코드 · 이름 · 열쇠 값 없음', leaked.length === 0, leaked.join(','));
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
