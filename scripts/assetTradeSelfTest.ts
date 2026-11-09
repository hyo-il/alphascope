/**
 * 자산 매수 · 매도 입력 서버 시험(118차 · v2.66.0) — `npm run assettrade:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 118차 지시서 「꼭 지킬 동작」 1~6 · 8 · 9 를 줄마다 확인한다(시험 이름 앞의 [118-n] 이 그 줄 번호).
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 가짜 시트(만든 값 · 시험용 RSA 열쇠) — 실제 구글 호출 0.
 * 안쪽 서버(로그인 문지기 + 자산 라우터)에 실제 HTTP 로 부른다.
 * ⚠️ 출력에 가짜 금액 · 수량 · 이름 · 코드를 찍지 않는다(끝에서 검사).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../server/db';
import { createSession, setPassword } from '../server/auth';
import { lockSession, setAssetPassword } from '../server/asset/lock';
import { ACTIVE, assetRouter } from '../server/asset/routes';
import { authGuard } from '../server/authGuard';
import { resetTokenCache } from '../server/asset/google';
import { resetSheetCache } from '../server/asset/sheet';
import { clearTradesForTest, listTrades, recordTrade } from '../server/asset/trade';
import { clearSheetKeyForTest } from '../server/asset/sheetSwitch';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-trade-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest-sa@selftest.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'SelfTestTradeSheetIdNotReal0123456789';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

let pass = 0;
let fail = 0;
const printed: string[] = [];
const realLog = console.log;
const realWarn = console.warn;
console.log = (...a: unknown[]) => {
  printed.push(a.join(' '));
  realLog(...a);
};
console.warn = (...a: unknown[]) => {
  printed.push(a.join(' '));
  realWarn(...a);
};
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

type Cell = string | number;
const H = '주식 투자 정리';
const T = '티커';
const NAME = { us: '가짜 미국주', kr: '가짜 국내주', us2: '가짜 미국둘', fq: '가짜 수식수량', nl: '가짜 안이음' };
const CODE = { us: 'NASDAQ:FAKE', kr: '999991', us2: 'NYSE:FAK2', fq: '999992', nl: '999993' };
const usd = (d: number | string) => `=(${d})*('티커'!$G$9)`;

function sheet(): { values: Record<string, Cell>; formulas: Record<string, Cell> } {
  const v: Record<string, Cell> = {
    [`${T}!B12`]: '구분', [`${T}!D12`]: '자산 분류', [`${T}!G9`]: 1300,
    [`${T}!B15`]: NAME.us, [`${T}!C15`]: CODE.us, [`${T}!B16`]: NAME.kr, [`${T}!C16`]: CODE.kr, [`${T}!B17`]: NAME.us2, [`${T}!C17`]: CODE.us2, [`${T}!B18`]: NAME.fq, [`${T}!C18`]: CODE.fq,
    [`${H}!B3`]: '내 계좌 정보', [`${H}!B38`]: '내 계좌 정보',
    [`${H}!B4`]: '개별 투자 ( 2026.07 )', [`${H}!B12`]: '적립식 계좌 ( 2026.10 )', [`${H}!B21`]: 'ISA 계좌 ( 2026.07 )', [`${H}!B29`]: '연금 저축 계좌 ( 2026.07 )',
    [`${H}!B5`]: NAME.us, [`${H}!C5`]: 130650, [`${H}!D5`]: 10,
    [`${H}!B6`]: NAME.kr, [`${H}!C6`]: 70000, [`${H}!D6`]: 3,
    [`${H}!B7`]: NAME.us2, [`${H}!C7`]: 65000, [`${H}!D7`]: 2,
    [`${H}!B8`]: NAME.fq, [`${H}!C8`]: 50000, [`${H}!D8`]: 4,
    [`${H}!B9`]: NAME.nl, [`${H}!C9`]: 50000, [`${H}!D9`]: 4,
    // 합친 표 — 같은 달러 줄이 커도 G9 계산에 넣지 않는다
    [`${H}!B39`]: NAME.us, [`${H}!C39`]: 130650, [`${H}!D39`]: 1000,
    '자산 투자 비율 관리!B18': '자산 배분 비율', '월 고정지출!B5': '현재 월 급여', '현금!B25': '은행 자산 총액', '현금!B30': '퇴직 연금 총액',
  };
  const f: Record<string, Cell> = {
    ...v,
    [`${H}!C5`]: usd(100.5), [`${H}!F5`]: `=D5*'티커'!$F$15`,
    [`${H}!F6`]: `=D6*'티커'!$F$16`,
    [`${H}!C7`]: usd(50), [`${H}!F7`]: `=D7*'티커'!$F$17`,
    [`${H}!D8`]: '=2+2', [`${H}!F8`]: `=D8*'티커'!$F$18`,
    [`${H}!C39`]: usd(100.5), [`${H}!F39`]: `=D39*'티커'!$F$15`,
  };
  return { values: v, formulas: f };
}

// ── 가짜 구글 ──
let model = sheet();
const g = { reads: 0, writes: [] as { input: string; cells: { range: string; value: Cell }[] }[], writeStatus: 200, lie: false, realCalls: 0 };
function reset(change?: (m: typeof model) => void) {
  model = sheet();
  change?.(model);
  g.reads = 0;
  g.writes = [];
  g.writeStatus = 200;
  g.lie = false;
  resetSheetCache();
  resetTokenCache();
}
const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
const parseRange = (range: string) => {
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
  if (!r) throw new Error('범위 모양');
  return { tab: r[1].replace(/''/g, "'"), c1: colNum(r[2]), r1: Number(r[3]), c2: r[4] ? colNum(r[4]) : colNum(r[2]), r2: r[5] ? Number(r[5]) : Number(r[3]) };
};
function cut(m: Record<string, Cell>, range: string): Cell[][] {
  const { tab, c1, r1, c2, r2 } = parseRange(range);
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
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return realFetch(input, init);
  if (!/googleapis\.com/.test(url)) {
    g.realCalls++;
    throw new Error('시험 — 바깥 주소 호출 막음');
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') {
    const body = JSON.parse(String(init?.body)) as { valueInputOption: string; data: { range: string; values: Cell[][] }[] };
    g.writes.push({ input: body.valueInputOption, cells: body.data.map((d) => ({ range: d.range, value: d.values[0][0] })) });
    if (g.writeStatus !== 200) return new Response('{}', { status: g.writeStatus });
    for (const d of body.data) {
      const { tab, c1, r1 } = parseRange(d.range);
      const key = `${tab}!${colChr(c1)}${r1}`;
      // 거짓말 — 쓴 값과 다르게 읽히는 시트(다시 읽기 확인 시험)
      model.formulas[key] = g.lie ? 1 : d.values[0][0];
      model.values[key] = typeof d.values[0][0] === 'number' ? d.values[0][0] : 0;
    }
    return new Response('{}', { status: 200 });
  }
  g.reads++;
  const params = new URL(url).searchParams;
  const m = params.get('valueRenderOption') === 'FORMULA' ? model.formulas : model.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
}) as typeof fetch;

await setPassword('selftest-assettrade-login-0001');
await setAssetPassword('selftest-assettrade-lock-0002');
clearSheetKeyForTest();
clearTradesForTest();

const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const token = createSession('assettrade-selftest');
const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${p}`, { method, headers: { ...ck, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
await call('POST', '/api/asset/unlock', { password: 'selftest-assettrade-lock-0002' });

const SEC = '개별 투자';
const US = { name: NAME.us, code: CODE.us, quantity: 10, avgPrice: 100.5 };
const KR = { name: NAME.kr, code: CODE.kr, quantity: 3, avgPrice: 70000 };
const trade = (b: Record<string, unknown>) => call('POST', '/api/asset/trade', b);
const buyKr = { section: SEC, row: 6, side: 'buy', qty: 2, price: 71001, expect: KR };
const buyUs = { section: SEC, row: 5, side: 'buy', qty: 2.5, price: 110.1234, expect: US };
const sellUs = { section: SEC, row: 5, side: 'sell', qty: 4, price: 120, expect: US };
const rows = () => (getDb().prepare(`SELECT COUNT(*) AS n FROM asset_trades`).get() as { n: number }).n;
const cellOf = (c: string) => g.writes[0]?.cells.find((x) => x.range === `'${H}'!${c}`)?.value;
const g9 = () => g.writes[0]?.cells.find((x) => x.range === `'${T}'!G9`)?.value;

try {
  // ═══ 1. 매수 계산 ═══
  {
    reset();
    const r = await trade(buyKr);
    check('[118-1] 국내 매수 → 200 · 수량 합 · 평균 원 단위 반올림(352002 ÷ 5) · 숫자(RAW)', r.status === 200 && cellOf('D6') === 5 && cellOf('C6') === 70400 && g.writes[0].input === 'RAW', JSON.stringify(r.body));
    check('[118-1] 국내 매수 — 시트 쓰기 1요청 · 칸 2개(평균가 · 수량) · 쓴 뒤 다시 읽기 있음(읽기 3번 = 값 · 수식 · 확인)', g.writes.length === 1 && g.writes[0].cells.length === 2 && g.reads === 3);
    reset();
    const u = await trade(buyUs);
    check('[118-1] 미국 매수 — 평균 달러 소수 4자리 반올림 · 수량 합(받은 그대로)', u.status === 200 && cellOf('D5') === 12.5 && cellOf('C5') === usd(102.4247));
    check('[118-1] 미국 매수 — USER_ENTERED · 평균가 칸은 수식 모양 그대로(숫자만 바뀜) · 1요청', g.writes.length === 1 && g.writes[0].input === 'USER_ENTERED' && typeof cellOf('C5') === 'string' && String(cellOf('C5')).endsWith("*('티커'!$G$9)"));
    reset((m) => {
      m.formulas[`${H}!C5`] = `= ( 100.5 ) * ( '티커'!$G$9 )`;
    });
    await trade(buyUs);
    check('[118-1] 미국 평균가 수식에 띄어쓰기가 달라도 그 모양 그대로 숫자만 바꿈', cellOf('C5') === `= ( 102.4247 ) * ( '티커'!$G$9 )`);
    reset();
    const fract = await trade({ ...buyUs, qty: 0.1, price: 100.5 });
    check('[118-1] 수량 합에 부동소수 찌꺼기 없음(10 + 0.1 = 10.1)', fract.status === 200 && cellOf('D5') === 10.1);
  }

  // ═══ 2. G9 ═══
  {
    reset();
    const r = await trade({ ...buyUs, fx: 1400 });
    // (1300 × (10×100.5 + 2×50) + 1400 × 275.3085) ÷ (1105 + 275.3085) = 1319.95 — 합친 표(1000주)를 넣으면 다른 값
    check('[118-2] 환율 넣은 미국 매수 — G9 = 식 그대로 · 소수 2자리 · 합친 표 제외 · 같은 1요청', r.status === 200 && g9() === 1319.95 && g.writes.length === 1, String(g9() ?? '없음'));
    const t = listTrades('1').trades[0];
    check('[118-2] 기록 — fx · fx_before · fx_after', t.fx === 1400 && t.fxBefore === 1300 && t.fxAfter === 1319.95);
    reset();
    await trade(buyUs);
    check('[118-2] 환율 비운 미국 매수 — G9 쓰기 0', g.writes.length === 1 && g9() === undefined);
    reset();
    await trade({ ...buyUs, fx: null });
    check('[118-2] 환율 null — G9 쓰기 0', g.writes.length === 1 && g9() === undefined);
    reset();
    await trade(buyKr);
    check('[118-2] 국내 매수 — G9 쓰기 0', g9() === undefined);
    reset();
    await trade(sellUs);
    check('[118-2] 매도 — G9 쓰기 0', g.writes.length === 1 && g9() === undefined);
    reset();
    const krFx = await trade({ ...buyKr, fx: 1400 });
    const sellFx = await trade({ ...sellUs, fx: 1400 });
    check('[118-2] 국내 · 매도에 환율을 넣으면 400 · 쓰기 0', krFx.status === 400 && sellFx.status === 400 && g.writes.length === 0);
    reset((m) => {
      m.formulas[`${T}!G9`] = "='다른탭'!B2";
    });
    const before = rows();
    const lockedFx = await trade({ ...buyUs, fx: 1400 });
    check('[118-2] G9 이 수식이면 환율 넣은 매수 거절 409 formula-cell · 쓰기 0 · 기록 0 — 수식을 덮어쓰지 않음', lockedFx.status === 409 && lockedFx.body.kind === 'formula-cell' && g.writes.length === 0 && rows() === before);
    reset((m) => {
      m.formulas[`${T}!G9`] = "='다른탭'!B2";
    });
    const noFx = await trade(buyUs);
    check('[118-2] G9 이 수식이어도 환율을 비우면 저장됨(G9 쓰기 0)', noFx.status === 200 && g9() === undefined);
  }

  // ═══ 3. 일부 매도 ═══
  {
    reset();
    const r = await trade(sellUs);
    check('[118-3] 일부 매도 — 수량만 쓰고(칸 1개) 평균가 칸 쓰기 0 · 수량 = 차', r.status === 200 && g.writes[0].cells.length === 1 && cellOf('D5') === 6 && cellOf('C5') === undefined);
    const t = listTrades('1').trades[0];
    check('[118-3] 일부 매도 기록 — 평균 그대로', t.side === 'sell' && t.afterAvg === t.beforeAvg && t.afterQty === 6);
    reset();
    const over = await trade({ ...sellUs, qty: 10.5 });
    check('[118-3] 매도 > 보유 → 400 · 쓰기 0', over.status === 400 && over.body.kind === 'not-editable' && g.writes.length === 0);
    reset();
    const all = await trade({ ...sellUs, qty: 10 });
    check('[118-3] 모두 매도 → 409 sell-all-later · 쓰기 0', all.status === 409 && all.body.kind === 'sell-all-later' && g.writes.length === 0);
  }

  // ═══ 4. 시트 바뀜 ═══
  {
    const cases: [string, (m: typeof model) => void][] = [
      ['수량', (m) => { m.values[`${H}!D5`] = 11; m.formulas[`${H}!D5`] = 11; }],
      ['이름', (m) => { m.values[`${H}!B5`] = '가짜 바뀐이름'; m.formulas[`${H}!B5`] = '가짜 바뀐이름'; }],
      ['코드', (m) => { m.values[`${T}!C15`] = 'NASDAQ:OTHR'; m.formulas[`${T}!C15`] = 'NASDAQ:OTHR'; }],
      ['평균가', (m) => { m.formulas[`${H}!C5`] = usd(101); }],
      ['줄 비워짐', (m) => { delete m.values[`${H}!B5`]; delete m.formulas[`${H}!B5`]; }],
    ];
    for (const [label, change] of cases) {
      reset(change);
      const n = rows();
      const r = await trade(buyUs);
      check(`[118-4] 화면 연 뒤 ${label} 다름 → 409 sheet-changed · 쓰기 0 · 기록 0`, r.status === 409 && r.body.kind === 'sheet-changed' && g.writes.length === 0 && rows() === n, JSON.stringify(r.body.kind));
    }
    reset();
    const msg = await trade({ ...buyUs, expect: { ...US, quantity: 9 } });
    check('[118-4] 문구 「시트가 바뀌었어요 — 다시 열어 주세요」', msg.body.error === '시트가 바뀌었어요 — 다시 열어 주세요.');
  }

  // ═══ 5. 기록 ═══
  {
    clearTradesForTest();
    reset();
    const ok = await trade(buyKr);
    check('[118-5] 시트 쓰기 성공 → 기록 1줄 · 응답은 id 만', ok.status === 200 && rows() === 1 && Object.keys(ok.body).join() === 'id');
    reset();
    g.writeStatus = 500;
    const fail500 = await trade(buyKr);
    check('[118-5] 시트 쓰기 실패 → 502 · 기록 0줄 추가', fail500.status === 502 && rows() === 1);
    reset();
    g.lie = true;
    const lied = await trade(buyKr);
    check('[118-5] 쓴 뒤 다시 읽어 다르면 mismatch · 기록 0줄 추가', lied.body.kind === 'mismatch' && rows() === 1);
    reset();
    await trade(sellUs);
    const list = await call('GET', '/api/asset/trades?limit=10');
    const trades = list.body.trades as { side: string; section: string; holdingRow: number }[];
    check('[118-5] GET /api/asset/trades 최근 순(매도가 위) · 줄 번호 · 계좌', list.status === 200 && trades.length === 2 && trades[0].side === 'sell' && trades[1].side === 'buy' && trades[0].holdingRow === 5 && trades[0].section === SEC);
    const one = await call('GET', '/api/asset/trades?limit=1');
    check('[118-5] limit · hasMore', (one.body.trades as unknown[]).length === 1 && one.body.hasMore === true && list.body.hasMore === false);
    reset();
    const [a, b] = await Promise.allSettled([recordTrade(buyKr), recordTrade(buyKr)]);
    check('[118-5] 동시에 두 건 → 하나만 처리(쓰기 1번 · 뒤는 busy)', a.status === 'fulfilled' && b.status === 'rejected' && (b.reason as { kind?: string }).kind === 'busy' && g.writes.length === 1);
    check('[118-5] 잠금 시간: POST /api/asset/trade 는 「화면을 쓴 것」 · GET 기록은 아님', ACTIVE.has('POST /api/asset/trade') && !ACTIVE.has('GET /api/asset/trades'));
    lockSession(token);
    const locked = await call('GET', '/api/asset/trades');
    const lockedPost = await trade(buyKr);
    check('[118-5] 잠긴 세션 — 기록 · 입력 모두 403 asset-locked', locked.status === 403 && locked.body.code === 'asset-locked' && lockedPost.status === 403);
    await call('POST', '/api/asset/unlock', { password: 'selftest-assettrade-lock-0002' });
  }

  // ═══ 6. 입력 검사 ═══
  {
    const bad: [string, Record<string, unknown>][] = [
      ['수량 0', { ...buyKr, qty: 0 }],
      ['수량 음수', { ...buyKr, qty: -1 }],
      ['가격 0', { ...buyKr, price: 0 }],
      ['가격 음수', { ...buyUs, price: -1 }],
      ['환율 0', { ...buyUs, fx: 0 }],
      ['환율 음수', { ...buyUs, fx: -5 }],
      ['국내 소수 수량', { ...buyKr, qty: 1.5 }],
      ['국내 소수 가격', { ...buyKr, price: 71000.5 }],
      ['미국 수량 소수 7자리', { ...buyUs, qty: 1.1234567 }],
      ['미국 가격 소수 5자리', { ...buyUs, price: 1.12345 }],
      ['글자 수량', { ...buyKr, qty: '2' }],
      ['합친 표', { ...buyKr, section: '적립식 주식', row: 39 }],
      ['줄 범위 밖', { ...buyKr, row: 12 }],
    ];
    for (const [label, body] of bad) {
      reset();
      const r = await trade(body);
      check(`[118-6] ${label} → 400 not-editable · 쓰기 0`, r.status === 400 && r.body.kind === 'not-editable' && g.writes.length === 0, `${r.status}`);
    }
    reset();
    const fq = await trade({ section: SEC, row: 8, side: 'buy', qty: 1, price: 1, expect: { name: NAME.fq, code: CODE.fq, quantity: 4, avgPrice: 50000 } });
    check('[118-6] 수량 칸이 수식인 줄 → 409 formula-cell · 쓰기 0', fq.status === 409 && fq.body.kind === 'formula-cell' && g.writes.length === 0);
    reset();
    const nl = await trade({ section: SEC, row: 9, side: 'buy', qty: 1, price: 1, expect: { name: NAME.nl, code: '', quantity: 4, avgPrice: 50000 } });
    check('[118-6] 「티커」 와 이어지지 않은 줄 → 409(코드 없음 · 쓰기 0)', nl.status === 409 && g.writes.length === 0, String(nl.body.kind));
    process.env.ASSET_SYNC_ENABLED = 'false';
    reset();
    const off = await trade(buyKr);
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[118-6] 스위치 꺼짐 → 503 disabled · 읽기 0 · 쓰기 0', off.status === 503 && off.body.kind === 'disabled' && g.reads === 0 && g.writes.length === 0);
    reset((m) => {
      delete m.values[`${H}!B3`];
      delete m.formulas[`${H}!B3`];
    });
    const shape = await trade(buyKr);
    check('[118-6] 머리 글자 다름 → shape · 쓰기 0', shape.body.kind === 'shape' && g.writes.length === 0);
  }

  // ═══ 8 · 9. 쓰는 함수 · 출력 ═══
  {
    const src = fs.readFileSync(path.join(root, 'server/asset/trade.ts'), 'utf8');
    check('[118-8] trade.ts 의 구글 쓰기는 valuesWrite 1곳 · 주소를 직접 부르지 않음', [...src.matchAll(/\bvaluesWrite\(/g)].length === 1 && !/googleapis|fetch\(/.test(src));
    check('[118-9] 로그는 id 만(console 은 기록 id 한 줄 · 값 변수 없음)', [...src.matchAll(/console\.\w+\(/g)].length === 1 && /console\.log\(`\[asset\] 매수·매도 기록 id=\$\{id\}`\)/.test(src));
    check('[118-8] 실제 구글 · 바깥 호출 0', g.realCalls === 0);
    const out = printed.join('\n');
    const leaks = [...Object.values(NAME), ...Object.values(CODE), '130650', '70400', '102.4247', '1319.95', '71001', '110.1234', process.env.ASSET_SHEET_ID as string].filter((s) => out.includes(s));
    check('[118-9] 시험 · 서버 출력에 금액 · 수량 값 · 이름 · 코드 · 시트 ID 없음', leaks.length === 0, `${leaks.length}개`);
  }
} finally {
  srv.close();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
