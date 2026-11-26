/**
 * 직접 입출금(v2.72.0 · 143차 — 이체 · 입금 · 출금) 서버 시험 — `npm run assetcashmanual:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 143차 「꼭 지킬 동작」 1(쓰기) · 2(거절) · 3(「현금 자동 반영」 꺼짐) · 4(두 번 쓰지 않기) · 5(되돌리기) · 7(일별 변화 계산 그대로) · 8(바뀐 파일 · 로그 · 구글)을 줄마다 확인한다.
 * 6(화면)은 `assetcashmanualui:test`.
 * 이 프로세스 안에 로그인 문지기 + 자산 라우터만 띄워 실제 HTTP 로 부른다. 구글은 이 프로세스의 `fetch` 를 바꿔치기한 가짜 시트(`fixtures/asset/cashFlowBook.ts` — 만든 값) ·
 * 실제 구글 호출 0 · 그 밖 바깥 주소는 막고 센다.
 * ⚠️ 출력에 가짜 금액 · 계좌 이름 · 메모를 찍지 않는다.
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
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { clearCashMovesForTest, clearCashSettingsForTest, listCashMoves, readCashSettings, undoCashMove, writeCashSettings } from '../server/asset/cashMoves';
import { cashSheetNow } from '../server/asset/cashView';
import { BANK, fakeGoogleFetch, flowBook, setCell, type FakeGoogle } from './fixtures/asset/cashFlowBook';
import type { AssetCashKey, AssetCashManualResult, AssetCashViewV3 } from '../src/types/asset';
import { chasuDiff, chasuUntracked, type Chasu } from './lib/chasuRange';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cashmanual-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-cashmanual-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = '현금';
const g: FakeGoogle = { book: flowBook(), reads: 0, writes: [], tamper: false, failWrite: false, failReadTab: null };
let otherFetches = 0;
const realFetch = globalThis.fetch;
/** 구글 쓰기 요청을 잠시 붙잡기(앞 요청이 「쓰는 중」 인 동안 같은 번호가 오는 경우) */
let holdWrite: Promise<void> | null = null;
const fakeFetch = fakeGoogleFetch(g, (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return realFetch(input, init);
  otherFetches++;
  throw new Error('시험 — 바깥 주소 호출 막음');
}) as typeof fetch);
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (holdWrite && /sheets\.googleapis\.com/.test(url) && (init?.method ?? 'GET') !== 'GET') await holdWrite;
  return fakeFetch(input, init);
}) as typeof fetch;
function reset() {
  g.book = flowBook();
  g.reads = 0;
  g.writes = [];
  g.tamper = false;
  g.failWrite = false;
  g.failReadTab = null;
  g.failReadAfterWrite = false;
  g.denyWrite = false;
  resetTokenCache();
}
const cashAt = (row: number) => g.book.values[`${C}!C${row}`] as number;
/** 은행 계좌 줄(5~12행) C열 합 */
const bankSum = () => [5, 6, 7, 8, 9, 10, 11, 12].reduce((s, r) => s + (typeof cashAt(r) === 'number' ? cashAt(r) : 0), 0);

// 로그 잡기 — 금액 · 이름 · 메모가 찍히면 실패
const logged: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(console, keep));
}
const MEMO = '가짜보너스메모';
const SECRETS = [...BANK.flatMap(([n, a]) => [...String(n).split('\n'), String(a), typeof a === 'number' ? a.toLocaleString('en-US') : '']), MEMO, '500000', '500,000', '123457', '123,457'].filter((s) => s.length >= 4);

const KIWOOM: AssetCashKey = { name: '가짜키움 (가짜 예수금)', nth: 1, of: 1 };
const KB = (nth: number): AssetCashKey => ({ name: '가짜국민 (가짜 예금)', nth, of: 3 });
const SHINHAN: AssetCashKey = { name: '가짜신한', nth: 1, of: 1 };
const TODAY = '2026-11-17';

await setPassword('selftest-cashmanual-login-0001');
await setAssetPassword('selftest-cashmanual-lock-0002');
const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const ck = { cookie: `as_session=${encodeURIComponent(createSession('cashmanual-selftest'))}` };
async function call(method: string, p: string, body?: unknown, cookie = ck): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${p}`, { method, headers: { ...cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
let seq = 0;
const rid = () => `selftest-req-${String(++seq).padStart(4, '0')}`;
const manual = async (body: Record<string, unknown>, cookie = ck) => {
  const r = await quiet(() => call('POST', '/api/asset/cash/manual', body, cookie));
  return { status: r.status, body: r.body as unknown as AssetCashManualResult & { kind?: string; error?: string } };
};
const transfer = (over: Record<string, unknown> = {}) => manual({ kind: 'transfer', from: KB(1), to: KIWOOM, amount: 500_000, memo: MEMO, requestId: rid(), ...over });
/** 되돌리기 — 라우트와 같은 `undoCashMove`(라우트 응답은 설정 화면 전체라 가짜 책에 없는 탭까지 읽는다) · 결과 = 200 / 오류 종류에 맞는 숫자 */
const UNDO_STATUS: Record<string, number> = { disabled: 503, 'already-done': 409, 'sheet-changed': 409, 'not-editable': 400 };
const undo = async (id: number) =>
  quiet(() => undoCashMove(id).then(() => ({ status: 200 }), (e) => ({ status: e instanceof AssetSheetError ? (UNDO_STATUS[e.kind] ?? 502) : 500 })));
/** 쓰기 요청의 범위가 모두 「현금」 탭 은행 계좌 줄(5~12행) C열인가 */
const onlyBankC = () => g.writes.flat().every((r) => /^'현금'!C(5|6|7|8|9|10|11|12)$/.test(r));

try {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  check('자산 잠금 풀기', (await call('POST', '/api/asset/unlock', { password: 'selftest-cashmanual-lock-0002' })).status === 200);
  check('[143-3] 시작 상태 — 「현금 자동 반영」 꺼짐(설정 처음 값)', readCashSettings().enabled === false);

  // ═══ 1. 쓰기 ═══
  {
    reset();
    const sum0 = bankSum();
    const t = await transfer();
    check('[143-1] 이체 = 한 요청에 두 칸(가짜국민 #1 = C6 −금액 · 키움 = C5 +금액)', t.status === 200 && g.writes.length === 1 && g.writes[0].join() === `'${C}'!C6,'${C}'!C5`, `${t.status} · ${g.writes.length}`);
    check('[143-1] 이체 값 — 2,000,000 − 500,000 · 1,000,000 + 500,000 · 은행 계좌 합(총 자산) 그대로', cashAt(6) === 1_500_000 && cashAt(5) === 1_500_000 && bankSum() === sum0);
    check('[143-1] 응답 = 기록 한 줄(이체 · 반영 · 메모) + 쓴 뒤 두 계좌 금액', t.body.move?.kind === 'transfer' && t.body.move.status === 'applied' && t.body.move.label === MEMO && t.body.after.from === 1_500_000 && t.body.after.to === 1_500_000 && t.body.duplicate === false);
    check('[143-1] 쓰기 직전 「현금」 탭을 다시 읽음(수식 그대로 1번) + 쓴 뒤 다시 읽어 확인(1번)', g.reads === 2, `읽기 ${g.reads}`);

    reset();
    const d = await manual({ kind: 'deposit', from: null, to: KIWOOM, amount: 123_457, requestId: rid() });
    check('[143-1] 입금 = 한 칸 +(키움 C5) · 한 요청', d.status === 200 && g.writes.length === 1 && g.writes[0].join() === `'${C}'!C5` && cashAt(5) === 1_123_457 && d.body.after.to === 1_123_457 && d.body.after.from === null);
    check('[143-1] 메모 없음 = 빈 글자', d.body.move?.label === '' && d.body.move.kind === 'deposit');

    reset();
    const w = await manual({ kind: 'withdraw', from: SHINHAN, amount: 300_000, memo: '  가짜   메모  ', requestId: rid() });
    check('[143-1] 출금 = 한 칸 −(가짜신한 C8) · 한 요청', w.status === 200 && g.writes.length === 1 && g.writes[0].join() === `'${C}'!C8` && cashAt(8) === 2_700_000 && w.body.after.from === 2_700_000 && w.body.after.to === null);
    check('[143-1] 메모 앞뒤 · 가운데 공백 정리', w.body.move?.label === '가짜 메모');

    // 사용자가 시트에서 고친 숫자에서 이어 감
    reset();
    setCell(g.book, `${C}!C5`, 777_000);
    const d2 = await manual({ kind: 'deposit', to: KIWOOM, amount: 3_000, requestId: rid() });
    check('[143-1] 쓰기 직전 다시 읽은 숫자(사용자가 고친 777,000)에서 이어 감', d2.status === 200 && cashAt(5) === 780_000);

    // 다시 읽은 값이 다르면 「다시 확인 필요」
    reset();
    g.tamper = true;
    const tm = await transfer();
    check('[143-1] 쓴 뒤 다시 읽은 값이 다르면 기록 「다시 확인 필요(쓴 뒤 다시 읽은 값이 다름)」', tm.status === 200 && tm.body.move?.status === 'check' && tm.body.move.reason === 'mismatch');
    check('[143-1] 쓰는 칸은 「현금」 탭 은행 계좌 줄 C열뿐(이 절의 모든 쓰기)', onlyBankC(), g.writes.flat().join());
  }

  // ═══ 2. 거절 ═══
  {
    const rejects: [string, () => Promise<{ status: number; body: { kind?: string; error?: string } }>, number, string][] = [
      ['같은 계좌 이체', () => transfer({ from: KIWOOM, to: KIWOOM }), 400, 'not-editable'],
      ['금액 0', () => transfer({ amount: 0 }), 400, 'not-editable'],
      ['금액 음수', () => transfer({ amount: -5_000 }), 400, 'not-editable'],
      ['금액 소수', () => transfer({ amount: 1_000.5 }), 400, 'not-editable'],
      ['금액 글자', () => transfer({ amount: '1000' }), 400, 'not-editable'],
      ['종류 틀림', () => transfer({ kind: 'move' }), 400, 'not-editable'],
      ['요청 번호 없음', () => transfer({ requestId: undefined }), 400, 'not-editable'],
      ['입금에 빠지는 계좌', () => manual({ kind: 'deposit', from: KB(1), to: KIWOOM, amount: 1_000, requestId: rid() }), 400, 'not-editable'],
      ['출금에 들어가는 계좌 없음 아님', () => manual({ kind: 'withdraw', from: KB(1), to: KIWOOM, amount: 1_000, requestId: rid() }), 400, 'not-editable'],
      ['이체에 들어가는 계좌 없음', () => transfer({ to: null }), 400, 'not-editable'],
      ['메모 41자', () => transfer({ memo: '가'.repeat(41) }), 400, 'not-editable'],
      ['계좌 못 찾음(시트에 없는 이름)', () => transfer({ from: { name: '가짜없는은행', nth: 1, of: 1 } }), 409, 'sheet-changed'],
    ];
    for (const [name, fn, status, kind] of rejects) {
      reset();
      clearCashMovesForTest();
      const before = JSON.stringify(g.book.values);
      const r = await fn();
      check(`[143-2] ${name} → ${status} · 쓰기 0 · 기록 0 · 까닭`, r.status === status && r.body.kind === kind && typeof r.body.error === 'string' && r.body.error.length > 0 && g.writes.length === 0 && listCashMoves().length === 0 && JSON.stringify(g.book.values) === before, `${r.status} ${r.body.kind}`);
    }
    // 같은 이름 줄 수가 바뀜(#n 이 밀렸을 수 있음) → 찾지 못함
    reset();
    clearCashMovesForTest();
    g.book.values[`${C}!B9`] = '가짜신한 2';
    g.book.formulas[`${C}!B9`] = '가짜신한 2';
    const moved = await transfer({ from: KB(2) });
    check('[143-2] 같은 이름 줄 수가 바뀜(저장 때 3 → 지금 2) → 409 찾지 못함 · 쓰기 0 · 기록 0', moved.status === 409 && moved.body.kind === 'sheet-changed' && g.writes.length === 0 && listCashMoves().length === 0);
    // 금액 칸이 숫자가 아님
    reset();
    setCell(g.book, `${C}!C5`, '가짜 글자');
    const nn = await transfer();
    check('[143-2] 금액 칸이 숫자가 아님 → 409 · 쓰기 0 · 기록 0', nn.status === 409 && g.writes.length === 0 && listCashMoves().length === 0);
    // 구글이 쓰기를 거절(403) → 쓰기 안 됨 · 기록 0
    reset();
    g.denyWrite = true;
    const denied = await transfer();
    check('[143-2] 구글이 쓰기를 분명히 거절(403) → 실패 · 기록 0(다시 할 수 있음)', denied.status >= 400 && listCashMoves().length === 0);
    // 시트 쓰기 스위치 꺼짐
    reset();
    process.env.ASSET_SYNC_ENABLED = 'false';
    const off = await transfer();
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[143-2] ASSET_SYNC_ENABLED=false → 503 「시트 쓰기가 꺼져 있어요」 · 쓰기 0 · 기록 0', off.status === 503 && off.body.kind === 'disabled' && /시트 쓰기가 꺼져/.test(off.body.error ?? '') && g.writes.length === 0 && g.reads === 0 && listCashMoves().length === 0);
    // 잠김(이 로그인 세션은 풀지 않음)
    reset();
    const other = { cookie: `as_session=${encodeURIComponent(createSession('cashmanual-locked'))}` };
    const locked = await manual({ kind: 'transfer', from: KB(1), to: KIWOOM, amount: 1_000, requestId: rid() }, other);
    check('[143-2] 자산 잠김 → 403 asset-locked · 쓰기 0 · 읽기 0', locked.status === 403 && (locked.body as unknown as { code: string }).code === 'asset-locked' && g.writes.length === 0 && g.reads === 0, `쓰기 ${g.writes.length}`);
  }

  // ═══ 3. 「현금 자동 반영」 꺼짐 ═══
  {
    reset();
    clearCashMovesForTest();
    check('[143-3] 설정 「현금 자동 반영」 꺼짐 상태', readCashSettings().enabled === false);
    const r = await transfer();
    check('[143-3] 꺼져 있어도 이체 됨 — 쓰기 1', r.status === 200 && r.body.move?.status === 'applied' && g.writes.length === 1);
    const now = await quiet(cashSheetNow);
    await quiet(() => writeCashSettings({ enabled: true }, now, TODAY));
    reset();
    const on = await transfer();
    check('[143-3] 켜져 있어도 같게 됨 — 쓰기 1', on.status === 200 && g.writes.length === 1);
    await quiet(() => writeCashSettings({ enabled: false }, now, TODAY));
  }

  // ═══ 4. 두 번 쓰지 않기 ═══
  {
    reset();
    clearCashMovesForTest();
    const id = rid();
    const body = { kind: 'transfer', from: KB(1), to: KIWOOM, amount: 500_000, memo: MEMO, requestId: id };
    const a = await manual(body);
    const b = await manual(body);
    check('[143-4] 같은 요청 번호 두 번(차례로) → 쓰기 1 · 같은 기록 · 둘째는 duplicate', a.status === 200 && b.status === 200 && g.writes.length === 1 && a.body.move.id === b.body.move.id && b.body.duplicate === true && listCashMoves().length === 1);
    check('[143-4] 둘째 응답의 쓴 뒤 금액도 첫 응답과 같음', b.body.after.from === a.body.after.from && b.body.after.to === a.body.after.to && cashAt(6) === 1_500_000);

    reset();
    clearCashMovesForTest();
    const id2 = rid();
    const both = await Promise.all([manual({ ...body, requestId: id2 }), manual({ ...body, requestId: id2 })]);
    check('[143-4] 같은 요청 번호 동시에 두 번(두 번 누름) → 쓰기 1 · 같은 기록', both.every((x) => x.status === 200) && g.writes.length === 1 && both[0].body.move.id === both[1].body.move.id && listCashMoves().length === 1 && cashAt(6) === 1_500_000);

    // 쓴 뒤 다시 읽기가 끊김(응답 끊김) → 「다시 확인 필요」 · 다시 보내도 쓰기 0
    reset();
    clearCashMovesForTest();
    g.failReadAfterWrite = true;
    const id3 = rid();
    const cut = await manual({ ...body, requestId: id3 });
    const again = await manual({ ...body, requestId: id3 });
    check('[143-4] 쓰기 요청 뒤 끊김 → 기록 「다시 확인 필요」(쓰였을 수 있음) · 같은 번호로 다시 보내도 쓰기 1 · 같은 기록', cut.status === 200 && cut.body.move.status === 'check' && cut.body.move.reason === 'write-failed' && again.body.move.id === cut.body.move.id && g.writes.length === 1, `${cut.status} ${cut.body.move?.status} 쓰기 ${g.writes.length}`);

    // 앞 요청이 「쓰는 중」 인 동안 같은 번호 → 409 처리 중(성공으로 돌려주지 않음) · 끝난 뒤 같은 번호 → 그 기록 · 쓰기 1
    reset();
    clearCashMovesForTest();
    let release = () => {};
    holdWrite = new Promise<void>((ok) => (release = ok));
    const id5 = rid();
    const firstP = manual({ ...body, requestId: id5 });
    for (let i = 0; i < 50 && listCashMoves()[0]?.status !== 'pending'; i++) await new Promise((r) => setTimeout(r, 20));
    const during = await manual({ ...body, requestId: id5 });
    release();
    holdWrite = null;
    const firstR = await firstP;
    const after5 = await manual({ ...body, requestId: id5 });
    check('[143-4] 앞 요청이 쓰는 중일 때 같은 번호 → 409 「처리 중」(성공으로 닫지 않음) · 끝난 뒤 같은 번호 → 같은 기록 · 쓰기 1',
      during.status === 409 && during.body.kind === 'busy' && firstR.status === 200 && after5.body.move?.id === firstR.body.move.id && after5.body.duplicate === true && g.writes.length === 1, `${during.status} ${during.body.kind} 쓰기 ${g.writes.length}`);
    const diff = await manual({ ...body, amount: 600_000, requestId: id5 });
    check('[143-4] 같은 번호에 다른 내용(금액) → 400 · 쓰기 그대로', diff.status === 400 && diff.body.kind === 'not-editable' && g.writes.length === 1);

    // 쓰기 전에 실패한 번호는 고친 뒤 같은 번호로 다시 할 수 있음(기록 0 → 1)
    reset();
    clearCashMovesForTest();
    setCell(g.book, `${C}!C5`, '가짜 글자');
    const id4 = rid();
    const first = await manual({ ...body, requestId: id4 });
    setCell(g.book, `${C}!C5`, 1_000_000);
    const second = await manual({ ...body, requestId: id4 });
    check('[143-4] 쓰기 전 실패(기록 0) 뒤 같은 번호로 다시 → 쓰기 1 · 기록 1', first.status === 409 && second.status === 200 && g.writes.length === 1 && listCashMoves().length === 1);
  }

  // ═══ 5. 되돌리기 ═══
  {
    for (const [name, body, rows] of [
      ['이체', { kind: 'transfer', from: KB(1), to: KIWOOM }, [6, 5]],
      ['입금', { kind: 'deposit', to: KIWOOM }, [5]],
      ['출금', { kind: 'withdraw', from: SHINHAN }, [8]],
    ] as [string, Record<string, unknown>, number[]][]) {
      reset();
      clearCashMovesForTest();
      const before = rows.map(cashAt);
      const r = await manual({ ...body, amount: 250_000, memo: MEMO, requestId: rid() });
      setCell(g.book, `${C}!C${rows[0]}`, cashAt(rows[0]) + 1_000); // 그 사이 사용자가 고침 — 지금 숫자에서 반대로
      const u = await undo(r.body.move.id);
      const after = rows.map(cashAt);
      const expect = before.map((v, i) => (i === 0 ? v + 1_000 : v));
      check(`[143-5] ${name} 되돌리기 → 반대 금액을 지금 숫자에(쓰기 2 · 기록 「되돌림」)`, r.status === 200 && u.status === 200 && after.join() === expect.join() && g.writes.length === 2 && listCashMoves()[0].status === 'undone', `${u.status} ${after.join() === expect.join()}`);
      const u2 = await undo(r.body.move.id);
      check(`[143-5] ${name} 두 번 되돌리기 안 됨(409 · 쓰기 그대로)`, u2.status === 409 && g.writes.length === 2);
    }
    check('[143-5] 되돌리기는 「현금 자동 반영」 이 꺼져 있어도 됨(위 셋 모두 꺼진 상태)', readCashSettings().enabled === false);
    // 쓰기 스위치가 꺼지면 되돌리기도 안 됨
    reset();
    clearCashMovesForTest();
    const r = await transfer();
    process.env.ASSET_SYNC_ENABLED = 'false';
    const u = await undo(r.body.move.id);
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[143-5] ASSET_SYNC_ENABLED=false 면 되돌리기도 503 · 쓰기 그대로', u.status === 503 && g.writes.length === 1 && listCashMoves()[0].status === 'applied');
  }

  // ═══ 6. 반영 기록(설정 화면 응답) · 시트 캐시 ═══
  {
    // 쓴 뒤 시트 30초 캐시를 비움 — 화면이 바로 다시 읽으면 새 금액(옛 금액을 보고 다시 저장해 두 번 쓰지 않게).
    // v2.72.1(144차)부터 비우는 곳은 쓰기 한 곳 `writeCashMove`(직접 입출금 · 되돌리기 · 예약 · 매수 · 매도 모두) — 읽기 횟수로 보는 시험은 `assetcashcache:test`
    const cmSrc = fs.readFileSync(path.join(root, 'server/asset/cashMoves.ts'), 'utf8');
    const writeFn = cmSrc.slice(cmSrc.indexOf('export async function writeCashMove'), cmSrc.indexOf('export function serial'));
    check('[143-6] 직접 입출금 쓰기 뒤 · 되돌리기 뒤 시트 캐시 비움(resetSheetCache — 쓰기 한 곳 writeCashMove 의 finally)',
      /finally \{[\s\S]*resetSheetCache\(\);[\s\S]*\}/.test(writeFn));
    // 설정 화면 응답(`buildCashView`)의 moves = `listCashMoves()` 그대로
    const view = fs.readFileSync(path.join(root, 'server/asset/cashView.ts'), 'utf8');
    const moves: AssetCashViewV3['moves'] = listCashMoves();
    check('[143-6] 반영 기록(설정 화면 응답 moves = listCashMoves)에 직접 입출금 줄(종류 transfer · 메모 = label · 빠지는 · 들어가는 계좌)', /moves: listCashMoves\(\)/.test(view) && moves[0]?.kind === 'transfer' && moves[0].label === MEMO && moves[0].from?.name === KB(1).name && moves[0].to?.name === KIWOOM.name);
  }

  // ═══ 7 · 8. 계산 그대로 · 바뀐 파일 · 로그 · 구글 ═══
  {
    const BASE = '00e8ed0';
    const CHASU: Chasu = { base: BASE, version: 'v2.72.0' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)
    const daily = chasuDiff(root, CHASU, ['--name-only'], ['server/asset/dailyChange.ts', 'server/asset/summary.ts', 'server/asset/daily.ts', 'server/asset/store.ts', 'server/asset/rebalance.ts']);
    check('[143-7] 일별 변화 · 총 자산 계산 함수(dailyChange · summary · daily · store · rebalance) 바뀐 줄 0', daily.status === 0 && daily.stdout.trim() === '', daily.stdout.trim());
    const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'server/index.ts', 'src/services', 'python', 'server/asset/trade.ts', 'server/asset/rowOps.ts', 'server/asset/google.ts', 'server/asset/cashKeys.ts', 'server/asset/cashSchedule.ts']);
    check('[143-8] 매매 · 주문 · 로그인 · 보유 쓰기 · 구글 쓰기 · 줄 알아보기 · 예약 코드 바뀐 파일 0(00e8ed0 → 그 차수 끝)', trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const serverChanged = chasuDiff(root, CHASU, ['--name-only'], ['server']).stdout.trim().split('\n').filter(Boolean);
    const untracked = chasuUntracked(root, CHASU, ['server']);
    const SERVER_OK = ['server/asset/routes.ts', 'server/asset/cashMoves.ts', 'server/asset/cashView.ts', 'server/asset/cashManual.ts'];
    check('[143-8] 서버에서 바뀐 파일은 routes · cashMoves · cashView · 새 cashManual 뿐', [...serverChanged, ...untracked].every((f) => SERVER_OK.includes(f)), [...serverChanged, ...untracked].join(','));
    // cashMoves.ts — 지운 줄은 켬 판단 두 줄 · 타입 이름 · 표 주석 · 내보내기 한 단어뿐(쓰기 · 기록 · 되돌리기 본문은 그대로)
    const cm = chasuDiff(root, CHASU, ['-U0'], ['server/asset/cashMoves.ts']).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    const cmOk = cm.every((l) => /isCashWriteOn\(\)\) throw|AssetCashMoveKind|AssetCashMoveRecord|kind TEXT NOT NULL|const CASH_SKIP_TEXT|export function (applyCashMove|undoCashMove)|^-import \{ one, wideRange \} from '\.\/sheet';$/.test(l));
    check('[143-8] cashMoves.ts 지운 줄은 켬 판단 · 타입 이름 · 표 주석 · 내보내기뿐(쓰기 · 기록 · 되돌리기 본문 그대로)', cmOk && cm.length <= 13, `${cm.length}줄`);
    const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
    const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
    // 143차 범위만(lib/chasuRange)
    const changedShared = chasuDiff(root, CHASU, ['--name-only'], [...shared]).stdout.trim().split('\n').filter(Boolean);
    const ALLOWED = ['src/data/changelog.ts', 'src/types/asset.ts'];
    const deleted = chasuDiff(root, CHASU, ['-U0'], [...ALLOWED]).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check(`[143-8] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 것은 types/asset.ts · data/changelog.ts 뿐 · 더하기만(지운 줄 0)`,
      shared.length > 30 && changedShared.every((f) => ALLOWED.includes(f)) && changedShared.includes('src/types/asset.ts') && deleted.length === 0, `${changedShared.join(',')} · 지운 줄 ${deleted.length}`);
    const dc = chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout;
    const dcDeleted = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[143-8] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(장면 더하기만)', dcDeleted.length === 0, `지운 줄 ${dcDeleted.length}`);
    const leaked = logged.filter((l) => SECRETS.some((s) => l.includes(s)));
    check('[143-8] 로그에 금액 · 계좌 이름 · 메모 0', leaked.length === 0, `${leaked.length}줄`);
    check('[143-8] 로그에 기록 줄이 남음(id · 종류 · 상태만)', logged.some((l) => /현금 반영 id=\d+ transfer applied/.test(l)));
    check('[143-8] 구글 실제 호출 0 · 바깥 주소 호출 0', otherFetches === 0, `바깥 ${otherFetches}`);
  }
} finally {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  srv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
