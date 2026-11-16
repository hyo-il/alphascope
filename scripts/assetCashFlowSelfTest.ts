/**
 * 현금 자동 반영(v2.71.0 · 139차) 서버 시험 — `npm run assetcashflow:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 139차 「꼭 지킬 동작」 1(줄 알아보기) · 2(쓰기) · 5(되돌리기) · 7(꺼짐) · 9(로그 · 구글 실제 호출 0)를 줄마다 확인한다.
 * 3 · 4(날짜 · 두 번 쓰지 않기 — 가짜 시계 · 가짜 휴장일)는 「B」 절, 6(매수 · 매도)은 「C」 절, 8(화면)은 `assetcashflowui:test`, 10(바뀐 파일 · 바이트)은 「바뀐 파일」 절.
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 **가짜 시트**(`fixtures/asset/cashFlowBook.ts` — 만든 값 · 쓰기도 그 책에 반영) · 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 계좌 이름을 찍지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetSheetError, batchGet, resetTokenCache } from '../server/asset/google';
import { cashLines, findCashLine, fixedLines, salaryOf } from '../server/asset/cashKeys';
import { applyCashMove, clearCashMovesForTest, clearCashSettingsForTest, listCashMoves, readCashSettings, settleStoppedMoves, undoCashMove, writeCashSettings, type CashMoveInput } from '../server/asset/cashMoves';
import { SALARY_ITEM, bankCalendar, bankClosed, cashTick, dueDay, nextDueDay, setCashCalendarForTest } from '../server/asset/cashSchedule';
import { assetSheetConfig } from '../server/asset/config';
import { BANK, FIXED, SALARY, deleteRow, fakeGoogleFetch, flowBook, insertRow, setCell, type FakeGoogle } from './fixtures/asset/cashFlowBook';
import { cut } from './fixtures/asset/cashSheetBook';
import type { AssetCashKey } from '../src/types/asset';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cashflow-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-cashflow-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';

const C = '현금';
const F = '월 고정지출';
const realFetch = globalThis.fetch;
const g: FakeGoogle = { book: flowBook(), reads: 0, writes: [], tamper: false, failWrite: false, failReadTab: null };
/** 구글이 아닌 곳으로 나간 요청(있으면 안 된다) */
let otherFetches = 0;
globalThis.fetch = fakeGoogleFetch(g, (async () => {
  otherFetches++;
  return new Response('{}', { status: 599 });
}) as typeof fetch);
function reset() {
  g.book = flowBook();
  g.reads = 0;
  g.writes = [];
  g.tamper = false;
  g.failWrite = false;
  g.failReadTab = null;
  resetTokenCache();
}
const cashAt = (row: number) => g.book.values[`${C}!C${row}`];
const config = () => assetSheetConfig()!;

// 로그 잡기 — 금액 · 이름이 찍히면 실패
const logged: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return fn().finally(() => Object.assign(console, keep));
}
const SECRETS = [
  ...BANK.flatMap(([n, a]) => [...String(n).split('\n'), String(a), typeof a === 'number' ? a.toLocaleString('en-US') : '']),
  ...FIXED.flatMap(([, r, a]) => [r, String(a)]),
  String(SALARY),
  SALARY.toLocaleString('en-US'),
].filter((s) => s.length >= 4);

const K = (name: string, nth = 1): AssetCashKey => ({ name, nth });
const KIWOOM = K('가짜키움 (가짜 예수금)');
const KB = (n: number) => K('가짜국민 (가짜 예금)', n);
const SHINHAN = K('가짜신한');
const move = (over: Partial<CashMoveInput> = {}): CashMoveInput => ({ kind: 'buy', itemKey: `trade:${Math.random()}`, label: '가짜', month: '2026-11', day: '2026-11-16', from: KB(2), to: KIWOOM, amount: 150_000, ...over });

const TODAY = '2026-11-16';
const sheetNow = async () => {
  const [rows] = await batchGet(config(), [`'${C}'!B1:C`], 'UNFORMATTED_VALUE');
  const [fx] = await batchGet(config(), [`'${F}'!A1:Z`], 'UNFORMATTED_VALUE');
  return { sections: ['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌'], lines: cashLines(rows), fixed: fixedLines(fx) };
};

try {
  clearCashMovesForTest();
  clearCashSettingsForTest();

  // ═══ 1. 줄 알아보기 ═══
  {
    reset();
    const lines = cashLines(cut(g.book.values, `'${C}'!B1:C`));
    check('[139-1] 「현금」 은행 계좌 8줄 · 같은 이름은 #1 · #2 · #3(시트 순서) · 두 줄 이름은 공백 하나 · 총액 · 퇴직 연금 줄은 계좌가 아님',
      lines.length === 8 && lines.filter((l) => l.key.name === KB(1).name).map((l) => `${l.row}:${l.key.nth}`).join() === '6:1,7:2,9:3'
      && lines.some((l) => l.key.name === '가짜적금 (가짜 26.11.16 ~ 29.11.16)') && !lines.some((l) => /총액|가짜연금/.test(l.key.name)));
    // 위 · 중간에 줄 넣기 · 지우기 → 같은 줄(금액으로 확인)
    const amountOf = (key: AssetCashKey) => {
      const l = findCashLine(cashLines(cut(g.book.values, `'${C}'!B1:C`)), key);
      return l ? l.cell : null;
    };
    insertRow(g.book, C, 5, { B: '새 줄 맨 위', C: 1 });
    insertRow(g.book, C, 9, { B: '가짜국민 (다른 이름)', C: 2 });
    check('[139-1] 맨 위 · 중간에 줄을 넣어도 「가짜국민 #2」 · 「#3」 · 키움을 같은 줄로 찾음', amountOf(KB(2)) === 2_100_000 && amountOf(KB(3)) === 2_200_000 && amountOf(KIWOOM) === 1_000_000);
    deleteRow(g.book, C, 5);
    deleteRow(g.book, C, 6); // 가짜국민 #1 지움 → 옛 #2 가 #1 이 된다
    check('[139-1] 같은 이름 줄 하나를 지우면 순서가 당겨짐(옛 #2 = 지금 #1 · #3 은 없음 → 찾지 못함)', amountOf(KB(1)) === 2_100_000 && amountOf(KB(3)) === null);
    reset();
    deleteRow(g.book, C, 8); // 가짜신한 지움
    const before = JSON.stringify(g.book.values);
    await quiet(async () => {
      writeCashSettings({ enabled: true }, await sheetNow(), TODAY);
    });
    const r = await quiet(() => applyCashMove(move({ from: SHINHAN, to: KIWOOM })));
    check('[139-1] 못 찾으면 쓰지 않음 — 「건너뜀(「현금」 줄을 찾지 못함)」 · 쓰기 요청 0 · 시트 그대로', r.status === 'skipped' && r.reason === 'missing-row' && g.writes.length === 0 && JSON.stringify(g.book.values) === before);

    const fx = fixedLines(cut(g.book.values, `'${F}'!A1:Z`));
    const inv = fx.filter((l) => l.key.reason === FIXED[0][1]);
    check('[139-1] 「월 고정지출」 머리(C10 · D10 · E10)를 글자로 찾음 · 합쳐진 분류 이어받기(저축 및 투자 6줄 · 월세 1 · 고정 지출 2 · 변동 지출 1)',
      fx.length === 10 && fx.filter((l) => l.key.category === '저축 및 투자').length === 6 && fx.filter((l) => l.key.category === '고정 지출').length === 2 && fx.filter((l) => l.key.category === '변동 지출').length === 1);
    check('[139-1] 같은 사유 4줄 = #1~#4 · 금액이 다름(150만 · 100만 · 30만 · 30만)', inv.map((l) => `${l.key.nth}:${l.amount}`).join() === '1:1500000,2:1000000,3:300000,4:300000');
    check('[139-1] ₩0 줄 = 0 · 빈 비용 = null(둘 다 반영하지 않음 — B 절) · 변동 지출 = 반영 안 함 · 그 밖 세 분류 = 반영', fx.find((l) => l.key.reason === '가짜 ISA')?.amount === 0 && fx.find((l) => l.key.reason === '가짜 연금저축')?.amount === null
      && fx.filter((l) => !l.reflect).map((l) => l.key.category).join() === '변동 지출' && fx.filter((l) => l.reflect).length === 9);
    check('[139-1] 표 아래 빈 줄 다음 「표 밖 메모」 는 표 줄이 아님 · 「현재 월 급여」 머리 확인 뒤 월급', !fx.some((l) => l.key.reason === '표 밖 메모') && salaryOf(cut(g.book.values, `'${F}'!A1:Z`)) === SALARY);
    const twoHeads = flowBook();
    Object.assign(twoHeads.values, { [`${F}!C30`]: '분류', [`${F}!D30`]: '지출 사유', [`${F}!E30`]: '비용' });
    let shape = '';
    try {
      fixedLines(cut(twoHeads.values, `'${F}'!A1:Z`));
    } catch (e) {
      shape = e instanceof AssetSheetError ? e.kind : 'other';
    }
    check('[139-1] 머리 줄이 두 번이면 짐작하지 않고 shape 오류', shape === 'shape');
  }

  // ═══ 2. 쓰기 ═══
  {
    reset();
    clearCashMovesForTest();
    const r = await quiet(() => applyCashMove(move({ from: KB(2), to: KIWOOM, amount: 150_000 })));
    check('[139-2] 출금 −/입금 + 를 한 요청으로 — 쓰기 요청 1 · 범위 2(가짜국민 #2 = C7 · 키움 = C5)', r.status === 'applied' && g.writes.length === 1 && g.writes[0].join() === `'${C}'!C7,'${C}'!C5`);
    check('[139-2] 값 — 가짜국민 #2 2,100,000 − 150,000 · 키움 1,000,000 + 150,000', cashAt(7) === 1_950_000 && cashAt(5) === 1_150_000);

    // 사용자가 시트에서 고친 숫자에서 이어 감
    setCell(g.book, `${C}!C5`, 777_000);
    insertRow(g.book, C, 5, { B: '사용자가 넣은 줄', C: 1 }); // 키움이 C6 으로
    const r2 = await quiet(() => applyCashMove(move({ from: KB(2), to: KIWOOM, amount: 50_000 })));
    check('[139-2] 쓰기 직전에 다시 읽은 숫자에서 이어 감(사용자가 고친 777,000 → 827,000) · 줄이 옮겨져도 맞는 줄(C6)', r2.status === 'applied' && cashAt(6) === 827_000 && cashAt(8) === 1_900_000 && g.writes[1].join() === `'${C}'!C8,'${C}'!C6`);

    const recs = listCashMoves();
    check('[139-2] 기록 — 반영 · 금액 · 출금 · 입금 열쇠 · 최신 위', recs.length === 2 && recs[0].status === 'applied' && recs[0].amount === 50_000 && recs[0].from?.nth === 2 && recs[0].to?.name === KIWOOM.name && recs[0].id > recs[1].id);

    // 밖으로(출금만)
    const r3 = await quiet(() => applyCashMove(move({ kind: 'fixed', itemKey: 'x', from: SHINHAN, to: null, amount: 55_000 })));
    check('[139-2] 밖으로 나가는 줄은 출금만(범위 1)', r3.status === 'applied' && g.writes[2].length === 1 && cashAt(9) === 2_945_000);

    // 다시 읽어 확인 — 다르게 남으면 「다시 확인 필요」
    g.tamper = true;
    const r4 = await quiet(() => applyCashMove(move({ from: KB(2), to: KIWOOM, amount: 10_000 })));
    g.tamper = false;
    check('[139-2] 쓴 뒤 다시 읽은 값이 다르면 「다시 확인 필요(쓴 뒤 다시 읽은 값이 다름)」', r4.status === 'check' && r4.reason === 'mismatch');

    // 수식 · 빈칸 금액 칸 → 쓰지 않음
    const n = g.writes.length;
    setCell(g.book, `${C}!C10`, '=1+1'); // 가짜국민 #3(줄 넣은 뒤 C10)
    const r5 = await quiet(() => applyCashMove(move({ from: KB(3), to: KIWOOM })));
    setCell(g.book, `${C}!C10`, '');
    const r6 = await quiet(() => applyCashMove(move({ from: KB(3), to: KIWOOM })));
    check('[139-2] 금액 칸이 수식 · 빈칸이면 쓰지 않음(건너뜀 · 쓰기 0)', r5.status === 'skipped' && r5.reason === 'formula-cell' && r6.status === 'skipped' && r6.reason === 'not-number' && g.writes.length === n);

    // 쓰기 실패
    g.failWrite = true;
    const r7 = await quiet(() => applyCashMove(move({ from: KB(2), to: KIWOOM })));
    g.failWrite = false;
    check('[139-2] 구글 쓰기 실패 → 「건너뜀(시트를 읽거나 쓰지 못함 · network)」', r7.status === 'skipped' && r7.reason === 'write-failed' && r7.detail === 'network');

    const all = g.writes.flat();
    const bankRows = new Set(cashLines(cut(g.book.values, `'${C}'!B1:C`)).map((l) => l.row));
    check('[139-2] 쓴 칸은 모두 「현금」 탭 은행 계좌 줄의 C열(가짜 쓰기 기록 — 총액 · 이름 · 퇴직 연금 · 「월 고정지출」 0)',
      all.length > 0 && all.every((r) => /^'현금'!C\d+$/.test(r) && bankRows.has(Number(/(\d+)$/.exec(r)![1]))), all.join(' '));
  }

  // ═══ 5. 되돌리기 ═══
  {
    reset();
    clearCashMovesForTest();
    const r = await quiet(() => applyCashMove(move({ from: KB(2), to: KIWOOM, amount: 200_000 })));
    // 사용자가 그 뒤 두 줄 숫자를 고침
    setCell(g.book, `${C}!C5`, 1_500_000);
    setCell(g.book, `${C}!C7`, 1_000_000);
    const u = await quiet(() => undoCashMove(r.id));
    check('[139-5] 되돌리기 = 지금 숫자 기준 반대로(키움 1,500,000 − 200,000 · 가짜국민 #2 1,000,000 + 200,000) · 한 요청', cashAt(5) === 1_300_000 && cashAt(7) === 1_200_000 && g.writes.length === 2 && g.writes[1].length === 2);
    check('[139-5] 기록 상태 「되돌림」 · 되돌린 때', u.status === 'undone' && u.undoneAt != null && listCashMoves()[0].status === 'undone');
    let again = '';
    await quiet(() => undoCashMove(r.id).catch((e: AssetSheetError) => void (again = e.kind)));
    check('[139-5] 두 번 되돌리지 않음(already-done · 쓰기 0 더)', again === 'already-done' && g.writes.length === 2);
    const skip = await quiet(() => applyCashMove(move({ from: SHINHAN, to: K('없는 줄') })));
    let notApplied = '';
    await quiet(() => undoCashMove(skip.id).catch((e: AssetSheetError) => void (notApplied = e.kind)));
    check('[139-5] 「건너뜀」 기록은 되돌릴 수 없음', notApplied === 'already-done' && g.writes.length === 2);
    // 되돌리는 줄을 시트에서 지웠으면 쓰지 않고 「반영」 그대로
    const r2 = await quiet(() => applyCashMove(move({ from: KB(2), to: SHINHAN, amount: 1_000 })));
    deleteRow(g.book, C, 8);
    let gone = '';
    await quiet(() => undoCashMove(r2.id).catch((e: AssetSheetError) => void (gone = e.kind)));
    check('[139-5] 되돌릴 줄을 찾지 못하면 쓰지 않고 「반영」 그대로(sheet-changed 안내)', gone === 'sheet-changed' && listCashMoves()[0].status === 'applied' && g.writes.length === 3);
  }

  // ═══ 7. 꺼짐 ═══
  {
    reset();
    await quiet(async () => {
      writeCashSettings({ enabled: false }, await sheetNow(), TODAY);
    });
    let off = '';
    await quiet(() => applyCashMove(move()).catch((e: AssetSheetError) => void (off = e.kind)));
    check('[139-7] 설정 「현금 자동 반영」 끔 → 쓰기 0(disabled)', off === 'disabled' && g.writes.length === 0);
    await quiet(async () => {
      writeCashSettings({ enabled: true }, await sheetNow(), TODAY);
    });
    process.env.ASSET_SYNC_ENABLED = 'false';
    let off2 = '';
    await quiet(() => applyCashMove(move()).catch((e: AssetSheetError) => void (off2 = e.kind)));
    let off3 = '';
    await quiet(() => undoCashMove(1).catch((e: AssetSheetError) => void (off3 = e.kind)));
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[139-7] ASSET_SYNC_ENABLED=false → 반영 · 되돌리기 쓰기 0', off2 === 'disabled' && off3 === 'disabled' && g.writes.length === 0);
    check('[139-7] 설정 처음 값 = 꺼짐(저장값 없음)', (() => {
      clearCashSettingsForTest();
      const s = readCashSettings();
      return s.enabled === false && s.enabledDay === null && s.salary.day === 25 && s.salary.shift === 'prev' && s.flowShift === 'next';
    })());
  }

  // ═══ 설정 저장 검사 ═══
  {
    reset();
    const now = await quiet(sheetNow);
    const on = writeCashSettings({ enabled: true }, now, TODAY);
    const pair = writeCashSettings({ depositPair: { section: '개별 투자', key: KIWOOM } }, now, TODAY);
    const badPair = writeCashSettings({ depositPair: { section: '개별 투자', key: K('없는 줄') } }, now, TODAY);
    const badSection = writeCashSettings({ depositPair: { section: '없는 계좌', key: KIWOOM } }, now, TODAY);
    const item = now.fixed.find((l) => l.key.reason === '가짜 월세')!.key;
    const flow = writeCashSettings({ flow: { item, day: 31, from: KB(1), to: 'out' } }, now, TODAY);
    const variable = writeCashSettings({ flow: { item: now.fixed.find((l) => l.key.category === '변동 지출')!.key, day: 5, from: KB(1), to: 'out' } }, now, TODAY);
    const same = writeCashSettings({ flow: { item, day: 5, from: KB(1), to: KB(1) } }, now, TODAY);
    const extra = writeCashSettings({ enabled: true, hack: 1 }, now, TODAY);
    check('[139-1] 설정 — 켜면 켠 날 저장 · 짝은 지금 「현금」 줄만 · 시트에 없는 계좌 · 줄 · 변동 지출 · 같은 줄 출금 · 입금 · 모르는 칸은 거절',
      on?.enabled === true && on.enabledDay === TODAY && pair?.depositPairs['개별 투자']?.name === KIWOOM.name && badPair === null && badSection === null
      && flow?.flows.length === 1 && flow.flows[0].to === 'out' && variable === null && same === null && extra === null);
    const removed = writeCashSettings({ flow: { item, day: null, from: null, to: null } }, now, TODAY);
    check('[139-1] 고정 흐름 줄 지우기(날짜 · 출금 · 입금 모두 비움)', removed?.flows.length === 0);
    clearCashSettingsForTest();
  }

  // ═══ B. 3 · 4 날짜(가짜 시계 · 가짜 휴장일) · 두 번 쓰지 않기 ═══
  {
    reset();
    clearCashMovesForTest();
    clearCashSettingsForTest();
    // 가짜 국내 휴장일 — 12-25(금) · 12-31(목 — 증시만 쉼)
    const krHolidays = new Set(['2026-12-25', '2026-12-31']);
    const kr = (d: string) => krHolidays.has(d);
    const cal = bankCalendar(kr);
    setCashCalendarForTest(kr);
    check('[139-3] 25일이 일요일(2026-10-25) → 앞 영업일 10-23(금) · 공휴일(12-25 금) → 12-24', dueDay('2026-10', 25, 'prev', cal) === '2026-10-23' && dueDay('2026-12', 25, 'prev', cal) === '2026-12-24');
    check('[139-3] 고정 흐름 휴일이면 다음 영업일(12-25 → 12-28 월) · 31일 → 말일(11-30) · 10-31(토) → 11-02(다음 달로 넘어감)',
      dueDay('2026-12', 25, 'next', cal) === '2026-12-28' && dueDay('2026-11', 31, 'next', cal) === '2026-11-30' && dueDay('2026-10', 31, 'next', cal) === '2026-11-02');
    check('[139-3] 12-31 은 은행 영업일(국내 휴장일 표에 있어도) · 실제 달력도 12-31 영업일 · 12-26(토) 쉼', dueDay('2026-12', 31, 'next', cal) === '2026-12-31' && bankClosed('2026-12-31') === false && bankClosed('2026-12-26') === true);

    const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
    const now0 = await quiet(sheetNow);
    const item = (reason: string, nth = 1) => now0.fixed.find((l) => l.key.reason === reason && l.key.nth === nth)!.key;
    const INV = FIXED[0][1];
    writeCashSettings({ enabled: true }, now0, '2026-10-20');
    writeCashSettings({ salary: { to: KB(1) } }, now0, '2026-10-20');
    for (const f of [
      { item: item('가짜 월세'), day: 31, from: KB(1), to: 'out' as const },
      { item: item('가짜 통신비'), day: 5, from: SHINHAN, to: 'out' as const },
      { item: item('가짜 보험'), day: 12, from: SHINHAN, to: 'out' as const },
      { item: item(INV, 2), day: 10, from: KB(1), to: KIWOOM },
      { item: item('가짜 ISA'), day: 10, from: KB(1), to: KIWOOM },
    ]) writeCashSettings({ flow: f }, now0, '2026-10-20');
    const s0 = readCashSettings();
    check('[139-3] 준비 — 켠 날 2026-10-20 · 월급 줄 · 고정 흐름 5줄', s0.enabledDay === '2026-10-20' && s0.flows.length === 5 && s0.salary.to?.nth === 1);

    const kb1 = () => cashAt(6) as number;
    const start = kb1();
    const t1 = await quiet(() => cashTick(at('2026-10-20', '09:00')));
    check('[139-3] 켜기 전 날짜(9월 · 10-05 · 10-12)는 반영 안 함 · 기록도 없음 · 아직 날이 아님(10-23 월급 · 11-02 월세)은 기다림', t1.status === 'done' && t1.applied === 0 && t1.skipped === 0 && t1.waiting === 2 && g.writes.length === 0 && listCashMoves().length === 0);
    check('[139-3] 다음 반영 날 — 월급 10-23', nextDueDay(readCashSettings(), 'salary', null, at('2026-10-20', '09:00'), cal) === '2026-10-23');
    await quiet(() => cashTick(at('2026-10-23', '07:59')));
    check('[139-3] 그날 한국 08:00 전에는 반영 안 함', g.writes.length === 0);
    const t3 = await quiet(() => cashTick(at('2026-10-23', '08:01')));
    check('[139-3] 그날 08:00 뒤 첫 확인에 월급 반영 — 「현재 월 급여」 만큼 들어오는 줄 +(쓰기 1 · 입금만)', t3.status === 'done' && t3.applied === 1 && g.writes.length === 1 && g.writes[0].length === 1 && kb1() === start + SALARY);
    check('[139-3] 다음 반영 날 — 반영한 뒤 월급은 다음 달 11-25', nextDueDay(readCashSettings(), 'salary', null, at('2026-10-23', '09:00'), cal) === '2026-11-25');

    // 4. 두 번 쓰지 않기
    await quiet(() => cashTick(at('2026-10-23', '12:00')));
    settleStoppedMoves(); // 서버 다시 켬(멈춘 줄 정리) 뒤 확인
    await quiet(() => cashTick(at('2026-10-23', '12:30')));
    const dup = await quiet(() => applyCashMove(move({ kind: 'salary', itemKey: SALARY_ITEM, month: '2026-10', from: null, to: KB(1), amount: SALARY })));
    check('[139-4] 같은 항목 · 같은 달 두 번째 확인 · 서버 다시 켬 · 직접 한 번 더 → 쓰기 0(그 달 기록 하나)', g.writes.length === 1 && dup.status === 'duplicate' && listCashMoves().filter((m) => m.kind === 'salary' && m.month === '2026-10').length === 1);

    const t5 = await quiet(() => cashTick(at('2026-11-02', '08:30')));
    const rent = listCashMoves()[0];
    check('[139-3] 10월 월세(31일 → 10-31 토 → 다음 영업일 11-02) 반영 · 출금만 · 그 달 = 2026-10', t5.applied === 1 && rent.label === '가짜 월세' && rent.month === '2026-10' && rent.day === '2026-11-02' && rent.to === null && kb1() === start + SALARY - 700_000);

    // 서버가 꺼져 11월을 지나 12-03 에 켜짐 → 11월 것은 쓰지 않고 「건너뜀(서버 꺼짐)」
    const w5 = g.writes.length;
    const t6 = await quiet(() => cashTick(at('2026-12-03', '09:00')));
    const nov = listCashMoves().filter((m) => m.month === '2026-11');
    check('[139-3] 다음 달로 넘어간 지난달 것(11월 월급 · 월세 · 통신비 · 보험 · 투자 · ISA 6건)은 반영 안 함 — 「건너뜀(서버 꺼짐)」 · 쓰기 0',
      t6.skipped === 6 && nov.length === 6 && nov.every((m) => m.status === 'skipped' && m.reason === 'server-off') && g.writes.length === w5);

    // 12월 안에서 서버가 꺼졌다 켜짐 → 지난 것(12-07 통신비 · 12-10 투자 · ISA · 12-14 보험)을 한 번
    setCell(g.book, `${F}!E18`, 66_000); // 통신비 금액이 바뀜(반영할 때의 시트 금액)
    deleteRow(g.book, F, 19); // 보험 줄이 사라짐
    const t7 = await quiet(() => cashTick(at('2026-12-15', '09:00')));
    const dec = listCashMoves().filter((m) => m.month === '2026-12');
    const by = (label: string) => dec.find((m) => m.label === label);
    check('[139-3] 그 달 안에서 켜지면 지난 것을 한 번 — 통신비(12-05 토 → 12-07) · 투자 #2(12-10) 반영 · 쓰기 2',
      t7.applied === 2 && by('가짜 통신비')?.status === 'applied' && by('가짜 통신비')?.day === '2026-12-07' && by(`${INV} #2`)?.status === 'applied' && g.writes.length === w5 + 2);
    check('[139-3] 금액은 반영할 때의 시트 금액(통신비 55,000 → 66,000) · 투자 #2 = 100만(같은 사유 #2)', by('가짜 통신비')?.amount === 66_000 && by(`${INV} #2`)?.amount === 1_000_000);
    check('[139-1] [139-3] ₩0 줄(ISA)은 반영하지 않음(건너뜀 · 비용이 ₩0) · 줄이 사라지면(보험) 「다시 확인 필요」 로 건너뜀', by('가짜 ISA')?.reason === 'zero' && by('가짜 보험')?.reason === 'missing-item' && t7.skipped === 2);
    await quiet(() => cashTick(at('2026-12-15', '09:30')));
    check('[139-4] 같은 날 다시 확인 → 쓰기 0', g.writes.length === w5 + 2);

    const t8 = await quiet(() => cashTick(at('2026-12-24', '08:00')));
    check('[139-3] 12월 월급 — 25일 공휴일 → 앞 영업일 12-24 08:00 에 반영', t8.applied === 1 && listCashMoves()[0].kind === 'salary' && listCashMoves()[0].day === '2026-12-24');
    const t9 = await quiet(() => cashTick(at('2026-12-31', '09:00')));
    check('[139-3] 12월 월세(31일) — 12-31 은 은행 영업일이라 그날 반영', t9.applied === 1 && listCashMoves()[0].label === '가짜 월세' && listCashMoves()[0].day === '2026-12-31');

    // 7. 꺼짐
    const w9 = g.writes.length;
    writeCashSettings({ enabled: false }, now0, '2026-12-31');
    const off1 = await quiet(() => cashTick(at('2027-01-26', '09:00')));
    writeCashSettings({ enabled: true }, now0, '2027-01-26');
    process.env.ASSET_SYNC_ENABLED = 'false';
    const off2 = await quiet(() => cashTick(at('2027-01-26', '09:00')));
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[139-7] 설정 끔 · ASSET_SYNC_ENABLED=false → 예약 확인은 off · 쓰기 0', off1.status === 'off' && off2.status === 'off' && g.writes.length === w9);
    const back = await quiet(() => cashTick(at('2027-01-26', '09:00')));
    check('[139-3] 끄고 다시 켜면 다시 켠 날(2027-01-26)부터 — 1월 25일 월급(1-25 월)은 켜기 전이라 반영 안 함', back.status === 'done' && back.applied === 0 && g.writes.length === w9 && !listCashMoves().some((m) => m.month === '2027-01' && m.kind === 'salary'));
    setCashCalendarForTest(null);
    clearCashSettingsForTest();
  }

  // ═══ 9. 로그 · 구글 ═══
  {
    const leaked = logged.filter((l) => SECRETS.some((s) => l.includes(s)));
    check('[139-9] 로그에 금액 · 수량 · 계좌 이름 0(id · 종류 · 상태 · 까닭 종류만)', logged.length > 0 && leaked.length === 0, leaked.slice(0, 2).join(' | '));
    check('[139-9] 구글 실제 호출 0(이 프로세스의 fetch 는 가짜 시트만 · 그 밖 요청 0)', otherFetches === 0 && g.reads > 0);
  }
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 예외 — ${(e as Error).message}`);
} finally {
  clearCashMovesForTest();
  clearCashSettingsForTest();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
