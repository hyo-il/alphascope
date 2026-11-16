/**
 * 현금 자동 반영 설정 쉽게(v2.71.1 · 140차) 서버 시험 — `npm run assetcasheasy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 140차 「꼭 지킬 동작」 1(은행 묶기) · 2(미리 보기 = 실제 예약) · 4(「월 고정지출」 바뀐 모양) · 5(옛 저장값) · 6(쓰기 목록 바이트) · 8(바뀐 파일 · 로그 · 구글)을 줄마다 확인한다.
 * 3 · 7(화면)은 `assetcasheasyui:test`.
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 가짜 시트(`fixtures/asset/cashFlowBook.ts` — 만든 값) · 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 계좌 이름을 찍지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../server/db';
import { batchGet, resetTokenCache } from '../server/asset/google';
import { cashLines, findFixedLine, fixedLines, salaryOf } from '../server/asset/cashKeys';
import { clearCashMovesForTest, clearCashSettingsForTest, listCashMoves, readCashSettings, readCashStored, writeCashSettings } from '../server/asset/cashMoves';
import { bankCalendar, cashTick, dueDay, setCashCalendarForTest } from '../server/asset/cashSchedule';
import { cashPreview, previewUntil } from '../server/asset/cashPreview';
import { clearCashBankFixForTest, readCashBankFix, writeCashBankFix } from '../server/asset/cashBanks';
import { buildCashPreview } from '../server/asset/cashView';
import { assetSheetConfig } from '../server/asset/config';
import { BANK, FIXED, SALARY, fakeGoogleFetch, flowBook, type FakeGoogle, type FlowBook } from './fixtures/asset/cashFlowBook';
import { runCashScenario } from './fixtures/asset/cashFlowScenario';
import { cut } from './fixtures/asset/cashSheetBook';
import { tradingDiff } from './lib/tradingDiff';
import { ASSET_CASH_FROM_SALARY, cashBankGroups, cashBankLabelOf, cashBankName, type AssetCashKey } from '../src/types/asset';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-casheasy-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-casheasy-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const C = '현금';
const F = '월 고정지출';
const g: FakeGoogle = { book: flowBook(), reads: 0, writes: [], tamper: false, failWrite: false, failReadTab: null };
let otherFetches = 0;
globalThis.fetch = fakeGoogleFetch(g, (async () => {
  otherFetches++;
  return new Response('{}', { status: 599 });
}) as typeof fetch);
function reset(book: FlowBook = flowBook()) {
  g.book = book;
  g.reads = 0;
  g.writes = [];
  resetTokenCache();
}
const config = () => assetSheetConfig()!;

// 로그 잡기 — 금액 · 이름이 찍히면 실패
const logged: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(console, keep));
}

/** 사용자 캡처 모양의 계좌 이름(140차 지시서의 은행 나눔 — 은행 이름은 지시서 글자 · 상품 이름은 만든 것) */
const USER_NAMES = [
  '국민은행',
  '국민은행\n(청년 적금 26.11.16 ~ 29.11.16)',
  ...Array.from({ length: 6 }, () => '국민은행 (정기 예금)'),
  '키움증권 (개별 투자 예수금)',
  '키움증권 (적립식)',
  '키움증권 (ISA 예수금)',
  '키움증권 (연금 저축 예수금)',
  '토스뱅크',
  '토스뱅크 (모으기)',
  '토스증권 (예수금)',
  '카카오뱅크 (세이프박스)',
  '카카오증권(카카오페이)',
  'JT저축은행 (정기 예금)',
];
const SECRETS = [
  ...BANK.flatMap(([n, a]) => [...String(n).split('\n'), String(a), typeof a === 'number' ? a.toLocaleString('en-US') : '']),
  ...FIXED.flatMap(([, r, a]) => [r, String(a)]),
  ...USER_NAMES.flatMap((n) => n.split('\n')),
  String(SALARY),
  SALARY.toLocaleString('en-US'),
].filter((s) => s.length >= 4);

const K = (name: string, nth = 1): AssetCashKey => ({ name, nth });
const KIWOOM = K('가짜키움 (가짜 예수금)');
const KB = (n: number) => K('가짜국민 (가짜 예금)', n);
const SHINHAN = K('가짜신한');
const INV = FIXED[0][1];
const at = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
const sheetNow = async () => {
  const [rows] = await batchGet(config(), [`'${C}'!B1:C`], 'UNFORMATTED_VALUE');
  const [fx] = await batchGet(config(), [`'${F}'!A1:Z`], 'UNFORMATTED_VALUE');
  return { sections: ['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌'], lines: cashLines(rows), fixed: fixedLines(fx), salary: salaryOf(fx) };
};
const putStored = (v: unknown) =>
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.cash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(v));
const storedRaw = () => JSON.parse((getDb().prepare(`SELECT value FROM app_settings WHERE key = 'asset.cash'`).get() as { value: string }).value) as Record<string, unknown>;

try {
  clearCashMovesForTest();
  clearCashSettingsForTest();
  clearCashBankFixForTest();

  // ═══ 1. 은행 묶기 ═══
  {
    const groups = cashBankGroups(USER_NAMES, (n) => n);
    const shape = groups.map((x) => `${x.bank}:${x.items.length}`).join(',');
    check('[140-1] 사용자 캡처 모양 → 은행 7묶음(국민은행 8 · 키움증권 4 · 토스뱅크 2 · 토스증권 · 카카오뱅크 · 카카오증권 · JT저축은행) · 순서 = 시트에서 처음 나온 순서',
      shape === '국민은행:8,키움증권:4,토스뱅크:2,토스증권:1,카카오뱅크:1,카카오증권:1,JT저축은행:1', shape);
    const kb = groups[0].items.map((i) => i.label);
    check('[140-1] 국민은행 = 입출금(괄호 없음) + 청년 적금(두 줄 이름) + 정기 예금 #1~#6(같은 상품 여럿 — 시트 순서)',
      kb.join('|') === `입출금|청년 적금 26.11.16 ~ 29.11.16|${[1, 2, 3, 4, 5, 6].map((n) => `정기 예금 #${n}`).join('|')}`, kb.join('|'));
    check('[140-1] 은행까지 붙인 이름 — 입출금 하나면 은행만(「국민은행」) · 그 밖 「키움증권 · 적립식」 · 「국민은행 · 정기 예금 #3」',
      groups[0].items[0].full === '국민은행' && groups[1].items[1].full === '키움증권 · 적립식' && groups[0].items[4].full === '국민은행 · 정기 예금 #3' && groups[2].items[0].full === '토스뱅크');
    check('[140-1] 괄호 바로 붙은 이름도 괄호 앞 = 은행(「카카오증권(카카오페이)」 → 카카오증권 · 카카오페이) · 앞뒤 빈칸 · 줄바꿈 정리',
      JSON.stringify(cashBankName('카카오증권(카카오페이)')) === JSON.stringify({ raw: '카카오증권', bank: '카카오증권', product: '카카오페이' }) && cashBankName('  국민은행 \n ( 청년 적금 ) ').product === '청년 적금');
    check('[140-1] 열쇠(이름 · 몇 번째 — 139차 #n) → 은행 이름이 같은 줄(정기 예금 #4 = 같은 이름 넷째 줄)', cashBankLabelOf(K('국민은행 (정기 예금)', 4), USER_NAMES) === '국민은행 · 정기 예금 #4' && cashBankLabelOf(K('없는 계좌'), USER_NAMES) === null);
    const added = cashBankGroups([...USER_NAMES, '새마을금고 (자유 적금)', '국민은행 (주택 청약)'], (n) => n);
    check('[140-1] 시트에 새 은행 줄을 넣으면 고치기 없이 새 묶음(맨 뒤) · 있는 은행 줄은 그 은행 묶음 끝에',
      added.length === 8 && added[7].bank === '새마을금고' && added[0].items.length === 9 && added[0].items[8].label === '주택 청약');

    // 은행 묶음 고치기 — 앱에만(시트 쓰기 0)
    reset();
    const names = USER_NAMES.map((n) => n.trim().replace(/\s+/g, ' '));
    const w0 = g.writes.length;
    const moved = writeCashBankFix({ row: { name: '카카오증권(카카오페이)', bank: '카카오페이' } }, names);
    const renamed = writeCashBankFix({ rename: { from: '토스뱅크', to: '토스' } }, names);
    const fix = readCashBankFix();
    const fixed = cashBankGroups(USER_NAMES, (n) => n, fix);
    check('[140-1] 「은행 묶음 고치기」 가 먼저 — 줄 옮기기(카카오증권(카카오페이) → 카카오페이) · 은행 이름 바꾸기(토스뱅크 → 토스) · 시트 쓰기 0',
      moved != null && renamed != null && fixed.some((x) => x.bank === '카카오페이' && x.items.length === 1) && !fixed.some((x) => x.bank === '카카오증권') && fixed.some((x) => x.bank === '토스' && x.items.length === 2) && g.writes.length === w0);
    const into = writeCashBankFix({ row: { name: '토스증권 (예수금)', bank: '토스' } }, names);
    check('[140-1] 다른 은행 묶음으로 옮기면 그 묶음에 합쳐짐(토스 3)', into != null && cashBankGroups(USER_NAMES, (n) => n, readCashBankFix()).find((x) => x.bank === '토스')?.items.length === 3);
    const bad = [
      writeCashBankFix({ row: { name: '없는 계좌', bank: 'X' } }, names),
      writeCashBankFix({ row: { name: '토스뱅크', bank: '' } }, names),
      writeCashBankFix({ row: { name: '토스뱅크', bank: '가'.repeat(21) } }, names),
      writeCashBankFix({ rename: { from: '없는 은행', to: 'X' } }, names),
      writeCashBankFix({ row: { name: '토스뱅크', bank: 'X' }, rename: { from: '토스뱅크', to: 'Y' } }, names),
      writeCashBankFix({ other: 1 }, names),
    ];
    check('[140-1] 고치기 검사 — 시트에 없는 계좌 · 은행 · 빈 이름 · 20자 넘음 · 두 가지 한 번에 · 모르는 칸은 거절', bad.every((x) => x === null));
    writeCashBankFix({ row: { name: '카카오증권(카카오페이)', bank: null } }, names);
    writeCashBankFix({ rename: { from: '토스뱅크', to: null } }, names);
    writeCashBankFix({ row: { name: '토스증권 (예수금)', bank: '토스증권' } }, names);
    const back = readCashBankFix();
    check('[140-1] 처음대로(null) · 처음 묶음과 같은 은행으로 옮기기는 고치기를 남기지 않음', Object.keys(back.rows).length === 0 && Object.keys(back.renames).length === 0);
    clearCashBankFixForTest();
  }

  // ═══ 5. 옛 저장값(139차 모양) ═══
  {
    reset();
    clearCashSettingsForTest();
    const now0 = await quiet(sheetNow);
    const item = (reason: string, nth = 1) => ({ ...now0.fixed.find((l) => l.key.reason === reason && l.key.nth === nth)!.key, of: now0.fixed.filter((l) => l.key.reason === reason).length });
    const old = {
      enabled: false,
      enabledDay: null,
      depositPairs: { '개별 투자': { ...KIWOOM, of: 1 } },
      salary: { to: { ...KB(1), of: 3 }, day: 25, shift: 'prev' },
      flowShift: 'next',
      flows: [
        { item: item('가짜 월세'), day: 31, from: { ...SHINHAN, of: 1 }, to: 'out' },
        { item: item(INV, 2), day: 10, from: null, to: { ...KIWOOM, of: 1 } },
      ],
    };
    putStored(old);
    const s = readCashSettings();
    const st = readCashStored();
    check('[140-5] 옛 모양(v 없음)이 그대로 읽힘 — 짝 · 월급 · 휴일 · 정한 빠지는 계좌(of 그대로)',
      s.depositPairs['개별 투자']?.name === KIWOOM.name && s.salary.to?.nth === 1 && s.salary.to.of === 3 && s.flows[0].from?.name === SHINHAN.name && s.flows[0].from?.of === 1 && s.flowShift === 'next');
    check('[140-5] 옛 모양의 빠지는 계좌 빈칸 = 「월급 받는 계좌 따라감」(저장값) → 반영에 쓰는 설정은 월급 받는 계좌 열쇠', st.flows[1].from === ASSET_CASH_FROM_SALARY && s.flows[1].from?.name === KB(1).name && s.flows[1].from?.nth === 1);
    await quiet(() => writeCashSettings({ flowShift: 'next' }, now0, '2026-11-16'));
    const raw = storedRaw() as { v?: number; flows: { from: unknown }[] };
    check('[140-5] 저장하면 새 모양(v: 2 · 따라감 = "salary" · 정한 계좌는 열쇠 그대로)', raw.v === 2 && raw.flows[1].from === 'salary' && (raw.flows[0].from as AssetCashKey).name === SHINHAN.name);
    putStored({ ...old, v: 2, flows: [{ ...old.flows[1], from: null }] });
    check('[140-5] 새 모양의 빈칸은 빈칸(정하지 않음 — 반영 안 함)', readCashStored().flows[0].from === null && readCashSettings().flows[0].from === null);
    // 월급 받는 계좌를 바꾸면 따라가는 줄도 바뀜 · 같은 계좌가 되면 반영 안 함
    putStored(old);
    await quiet(() => writeCashSettings({ salary: { to: KB(2) } }, now0, '2026-11-16'));
    check('[140-5] 월급 받는 계좌를 바꾸면 따라가는 줄의 빠지는 계좌도 바뀜(정한 줄은 그대로)', readCashSettings().flows[1].from?.nth === 2 && readCashSettings().flows[0].from?.name === SHINHAN.name);
    await quiet(() => writeCashSettings({ salary: { to: KIWOOM } }, now0, '2026-11-16'));
    check('[140-5] 월급 받는 계좌 = 들어가는 계좌가 되면 따라가는 줄은 반영 안 함(빠지는 계좌 빈칸)', readCashSettings().flows[1].from === null);
    const sameRow = await quiet(() => writeCashSettings({ flowEdit: { item: item(INV, 3), day: 10, from: 'salary', to: KIWOOM } }, now0, '2026-11-16'));
    check('[140-5] 따라감인데 들어가는 계좌가 월급 받는 계좌와 같으면 저장 거절', sameRow === null);
    clearCashSettingsForTest();
  }

  // ═══ 2. 미리 보기 = 실제 예약 · 모두 적용 ═══
  {
    reset();
    clearCashMovesForTest();
    clearCashSettingsForTest();
    const kr = new Set(['2026-12-25', '2026-12-31']);
    const cal = bankCalendar((d) => kr.has(d));
    setCashCalendarForTest((d) => kr.has(d));
    const now0 = await quiet(sheetNow);
    const T = '2026-11-16';
    await quiet(() => writeCashSettings({ salary: { to: KB(1) } }, now0, T));
    await quiet(() => writeCashSettings({ flowDayAll: 26 }, now0, T));
    const st = readCashStored();
    const payable = now0.fixed.filter((l) => l.reflect && l.amount != null && l.amount > 0);
    check('[140-2] 「모두 적용」 — 반영하는 분류의 ₩0 아닌 줄 모두 26일(7줄 · ₩0 · 빈 비용 · 변동 지출 빼고) · 빠지는 계좌 = 따라감 · 월세 · 고정 지출 = 쓴 돈(밖으로)',
      st.flows.length === 7 && payable.length === 7 && st.flows.every((f) => f.day === 26 && f.from === ASSET_CASH_FROM_SALARY)
      && st.flows.filter((f) => f.to === 'out').length === 3 && st.flows.filter((f) => f.to === null).length === 4);
    for (let n = 1; n <= 4; n++) {
      const it = now0.fixed.find((l) => l.key.reason === INV && l.key.nth === n)!.key;
      await quiet(() => writeCashSettings({ flowEdit: { item: it, day: 26, from: 'salary', to: KIWOOM } }, now0, T));
    }
    // 한 줄만 다른 날 · 다른 빠지는 계좌
    const tel = now0.fixed.find((l) => l.key.reason === '가짜 통신비')!.key;
    await quiet(() => writeCashSettings({ flowEdit: { item: tel, day: 5, from: SHINHAN, to: 'out' } }, now0, T));
    const w0 = g.writes.length;
    const m0 = listCashMoves().length;
    const pv = await quiet(() => cashPreview(now0, { rows: {}, renames: {} }, at(T, '09:00'), cal));
    check('[140-2] 꺼져 있어도 보임(enabled false · 「켜면 이렇게」) · 범위 오늘 ~ 다음 달 같은 날 하루 앞', !pv.enabled && pv.from === T && pv.until === '2026-12-15' && previewUntil('2027-01-31') === '2027-02-27' && pv.items.length > 0);
    const planned = pv.items.filter((i) => i.status === 'planned');
    const sal = planned.find((i) => i.kind === 'salary');
    check('[140-2] 월급 = 25일(11-25 수) · 「현재 월 급여」 · → 월급 받는 계좌', sal?.day === '2026-11-25' && sal.amount === SALARY && sal.from === null && sal.to != null && !sal.out);
    const day26 = planned.filter((i) => i.kind === 'fixed' && i.day === '2026-11-26');
    check('[140-2] 「모두 적용」 뒤 모든 줄 같은 날(11-26 · 6줄) · 따로 고친 통신비만 12-07(12-05 토 → 다음 영업일)',
      day26.length === 6 && planned.find((i) => i.label === '가짜 통신비')?.day === '2026-12-07' && dueDay('2026-12', 5, 'next', cal) === '2026-12-07');
    check('[140-2] 빠지는 → 들어가는 — 투자 = 월급 받는 계좌 → 키움 · 월세 = → 쓴 돈(밖으로)',
      day26.filter((i) => i.label.startsWith(INV)).every((i) => i.from === day26.find((x) => x.label === '가짜 월세')?.from && i.to != null && !i.out) && day26.find((i) => i.label === '가짜 월세')?.out === true);
    const notes = pv.items.filter((i) => i.status === 'not');
    check('[140-2] 반영 안 함도 보임 — ₩0(ISA) · 빈 비용(연금저축) = ₩0 · 변동 지출은 맨 아래', notes.find((i) => i.label === '가짜 ISA')?.why === 'zero' && notes.find((i) => i.label === '가짜 연금저축')?.why === 'zero' && pv.items[pv.items.length - 1].why === 'variable');
    check('[140-2] 미리 보기는 시트 쓰기 0 · 기록 0', g.writes.length === w0 && listCashMoves().length === m0);

    // 실제 예약(같은 가짜 시계 · 같은 시트)과 견줌 — 켠 날 = 오늘 · 매일 09:00 확인
    await quiet(() => writeCashSettings({ enabled: true }, now0, T));
    for (let t = at(T, '09:00'); t <= at('2026-12-15', '09:00'); t += 86_400_000) await quiet(() => cashTick(t));
    const real = listCashMoves().filter((m) => m.status === 'applied').map((m) => `${m.day}|${m.kind}|${m.label}|${m.amount}`).sort();
    const want = planned.map((i) => `${i.day}|${i.kind}|${i.label}|${i.amount}`).sort();
    check('[140-2] 미리 보기 「반영 예정」 = 실제 예약이 쓴 것(날짜 · 무엇 · 금액 8건 같음 — 월급 · 11-26 여섯 · 통신비)', real.length === 8 && real.join() === want.join(), `${real.length} / ${want.length}`);
    const after = await quiet(() => cashPreview(now0, { rows: {}, renames: {} }, at('2026-11-26', '09:00'), cal));
    check('[140-2] 반영한 뒤 미리 보기 — 오늘 것은 「이미 기록 있음(반영)」 · 다음 달 월급(12-24 · 25일 공휴일 → 앞 영업일)은 반영 예정',
      after.items.filter((i) => i.day === '2026-11-26' && i.status === 'recorded' && i.record === 'applied').length === 6 && after.items.some((i) => i.kind === 'salary' && i.day === '2026-12-24' && i.status === 'planned'));

    // 휴일 → 앞 영업일 · 계좌를 못 찾음 · 같은 계좌
    clearCashMovesForTest();
    kr.add('2026-11-25');
    const hol = await quiet(() => cashPreview(now0, { rows: {}, renames: {} }, at(T, '09:00'), bankCalendar((d) => kr.has(d))));
    check('[140-2] 월급 25일이 휴일이면 앞 영업일(11-24) — 예약 함수 dueDay 와 같음', hol.items.find((i) => i.kind === 'salary')?.day === '2026-11-24' && dueDay('2026-11', 25, 'prev', bankCalendar((d) => kr.has(d))) === '2026-11-24');
    kr.delete('2026-11-25');
    const gone = { ...now0, lines: now0.lines.filter((l) => l.key.name !== KIWOOM.name) };
    const pvGone = await quiet(() => cashPreview(gone, { rows: {}, renames: {} }, at(T, '09:00'), cal));
    check('[140-2] 들어가는 계좌를 「현금」 탭에서 못 찾으면 「반영 안 함 — 다시 확인 필요」', pvGone.items.filter((i) => i.label.startsWith(INV) && i.status === 'not' && i.why === 'missing-row').length === 4);
    await quiet(() => writeCashSettings({ salary: { to: KIWOOM } }, now0, T));
    const pvSame = await quiet(() => cashPreview(now0, { rows: {}, renames: {} }, at(T, '09:00'), cal));
    check('[140-2] 월급 받는 계좌 = 들어가는 계좌가 되면 「같음」 으로 반영 안 함(날짜 없이 아래)', pvSame.items.filter((i) => i.label.startsWith(INV) && i.why === 'same-row' && i.day === null).length === 4);
    // 주소 함수(buildCashPreview) — 같은 달력 · 쓰기 0
    await quiet(() => writeCashSettings({ salary: { to: KB(1) } }, now0, T));
    const w1 = g.writes.length;
    const viaRoute = await quiet(() => buildCashPreview(at(T, '09:00')));
    check('[140-2] GET /api/asset/cash/preview 함수 — 시트 읽기만(쓰기 0) · 은행까지 붙인 이름', g.writes.length === w1 && viaRoute.items.some((i) => i.kind === 'salary' && i.to === '가짜국민 · 가짜 예금 #1'));
    setCashCalendarForTest(null);
    clearCashSettingsForTest();
    clearCashMovesForTest();
  }

  // ═══ 4. 「월 고정지출」 바뀐 모양(1~3행 매매 원칙 · 머리 8행 · 청년 미래 적금 맨 위) ═══
  {
    reset();
    clearCashSettingsForTest();
    const now0 = await quiet(sheetNow);
    const item = (reason: string, nth = 1) => now0.fixed.find((l) => l.key.reason === reason && l.key.nth === nth)!.key;
    await quiet(() => writeCashSettings({ salary: { to: KB(1) } }, now0, '2026-11-16'));
    for (const f of [
      { item: item(INV, 2), day: 10, from: 'salary' as const, to: KIWOOM },
      { item: item('가짜 월세'), day: 31, from: SHINHAN, to: 'out' as const },
      { item: item('가짜 보험'), day: 12, from: 'salary' as const, to: 'out' as const },
    ])
      await quiet(() => writeCashSettings({ flowEdit: f }, now0, '2026-11-16'));
    // 새 모양 — 표 머리를 B8:D8 로 · 위에 매매 원칙 · 갱신 줄 · 저축 및 투자 맨 위에 「가짜 청년 미래 적금」
    const b = flowBook();
    for (const k of Object.keys(b.values)) if (k.startsWith(`${F}!`)) delete b.values[k];
    const rows: Record<string, string | number> = {
      B1: '매매 원칙', C1: '가짜 원칙 하나', B2: '가짜 원칙 둘', B3: '가짜 원칙 셋', B5: '현재 월 급여', C5: SALARY, B7: '2026.09 갱신', B8: '분류', C8: '지출 사유', D8: '비용',
      B9: '저축 및 투자', C9: '가짜 청년 미래 적금', D9: 500_000,
    };
    FIXED.forEach(([cat, reason, amount], i) => {
      const r = 10 + i;
      if (cat && cat !== '저축 및 투자') rows[`B${r}`] = cat;
      rows[`C${r}`] = reason;
      if (amount !== '') rows[`D${r}`] = amount;
    });
    for (const [cell, v] of Object.entries(rows)) b.values[`${F}!${cell}`] = v;
    b.formulas = { ...b.formulas, ...Object.fromEntries(Object.entries(b.values).filter(([k]) => k.startsWith(`${F}!`))) };
    const fx = fixedLines(cut(b.values, `'${F}'!A1:Z`));
    const s = readCashSettings();
    const hit = s.flows.map((f) => findFixedLine(fx, f.item));
    check('[140-4] 바뀐 모양에서도 표를 읽음 — 머리 8행 · 청년 미래 적금이 저축 및 투자 맨 위 · 월급 그대로',
      fx[0].key.reason === '가짜 청년 미래 적금' && fx[0].key.category === '저축 및 투자' && fx.length === 11 && salaryOf(cut(b.values, `'${F}'!A1:Z`)) === SALARY);
    check('[140-4] 이미 저장된 설정이 같은 줄을 가리킴(투자 #2 = 100만 · 월세 · 보험 — 분류 · 사유 · #n)',
      hit[0]?.amount === 1_000_000 && hit[0].key.nth === 2 && hit[1]?.key.reason === '가짜 월세' && hit[2]?.key.reason === '가짜 보험' && hit.every((h) => h?.reflect));
    clearCashSettingsForTest();
  }

  // ═══ 6. 반영 · 쓰기 · 기록 · 되돌리기 바이트 같음 ═══
  {
    reset();
    const now = await quiet(() => runCashScenario(g));
    const baseline = fs.readFileSync(path.join(root, 'scripts/fixtures/asset/cashFlowWritesBaseline.json'), 'utf8').trimEnd();
    check('[140-6] 139차 모양 설정 · 같은 입력(가짜 시계 10-20 ~ 01-31 · 매수 · 매도 · 되돌리기) → 같은 쓰기 목록 · 쓴 값 · 기록(기준 f5d753e 정답과 바이트 같음)', now === baseline, `길이 ${now.length} / ${baseline.length}`);
    clearCashSettingsForTest();
    clearCashMovesForTest();
  }

  // ═══ 8. 바뀐 파일 · 로그 · 구글 ═══
  {
    const BASE = 'f5d753e';
    const trading = tradingDiff(root, BASE, ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python', 'server/asset/trade.ts', 'server/asset/rowOps.ts']);
    check('[140-8] 매매 · 주문 · 로그인 · 휴장일 · 보유 쓰기 코드 바뀐 파일 0(f5d753e 와 지금)', trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
    const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
    const changedShared = spawnSync('git', ['diff', '--name-only', BASE, '--', ...shared], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
    const ALLOWED = ['src/data/changelog.ts', 'src/types/asset.ts'];
    const deleted = spawnSync('git', ['diff', '-U0', BASE, '--', ...ALLOWED], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check(`[140-8] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 것은 types/asset.ts · data/changelog.ts 뿐 · 더하기만(지운 줄 0)`,
      shared.length > 30 && changedShared.every((f) => ALLOWED.includes(f)) && changedShared.includes('src/types/asset.ts') && deleted.length === 0, `${changedShared.join(',')} · 지운 줄 ${deleted.length}`);
    const dc = spawnSync('git', ['diff', '-U0', BASE, '--', 'scripts/designCheck.ts'], { cwd: root, encoding: 'utf8' }).stdout;
    const dcDeleted = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[140-8] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(장면 더하기만)', dcDeleted.length === 0, `지운 줄 ${dcDeleted.length}`);
    const leaked = logged.filter((l) => SECRETS.some((s) => l.includes(s)));
    check('[140-8] 로그에 금액 · 계좌 이름 0', leaked.length === 0, leaked.slice(0, 2).join(' | '));
    check('[140-8] 구글 실제 호출 0(이 프로세스의 fetch 는 가짜 시트만 · 그 밖 요청 0)', otherFetches === 0 && g.reads > 0);
    // 화면 고르는 칸 · 「현금 합계」 · 매수 창이 같은 함수를 씀(따로 은행 이름을 만들지 않음)
    const uses = ['src/components/asset/AssetCashSettings.tsx', 'src/components/asset/AssetSheetValues.tsx', 'server/asset/routes.ts', 'server/asset/cashPreview.ts'].filter((f) => /cashBank(Groups|LabelOf)/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    check('[140-8] 은행 묶기는 한 곳(types/asset.ts cashBankGroups · cashBankLabelOf)을 설정 화면 · 「현금 합계」 · 예수금 짝 · 미리 보기가 함께 씀', uses.length === 4, uses.join(','));
  }
} finally {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  clearCashBankFixForTest();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
