/**
 * 「현금」 탭 쓰기 뒤 시트 캐시 시험(144차 · v2.72.1) — `npm run assetcashcache:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 144차 「꼭 지킬 동작」 3(캐시) · 4(바뀐 파일)를 줄마다 확인한다.
 * - 자동 반영 예약(월급 · 고정 흐름 — `cashTick` 이 부르는 `applyCashMove` 그대로) · 매수 · 매도(`tradeCash`) · 직접 입출금(`applyManualCash`) · 되돌리기(`undoCashMove`) ·
 *   다시 확인 필요(쓴 뒤 다시 읽은 값이 다름) 뒤 **다음 `readAssetSheet` 가 캐시가 아니라 새로 읽음**(가짜 구글 읽기 횟수 · 새 금액).
 * - 쓰지 않은 일(쓰기 전 실패 · 같은 요청 번호)은 캐시를 그대로 둔다(지금과 같음 — 읽기 0).
 * 가짜 구글(만든 값 — 실제 금액 · 계좌 이름 아님) · 실제 구글 · 토스 · 바깥 호출 0.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resetTokenCache } from '../server/asset/google';
import { readAssetSheet, resetSheetCache } from '../server/asset/sheet';
import { applyCashMove, clearCashMovesForTest, clearCashSettingsForTest, listCashMoves, tradeCash, undoCashMove, writeCashSettings } from '../server/asset/cashMoves';
import { applyManualCash } from '../server/asset/cashManual';
import { cashSheetNow } from '../server/asset/cashView';
import { SALARY_ITEM } from '../server/asset/cashSchedule';
import { book } from './fixtures/asset/cashSheetBook';
import { fakeGoogleFetch, flowBook, type FakeGoogle, type FlowBook } from './fixtures/asset/cashFlowBook';
import type { AssetCashKey } from '../src/types/asset';
import { chasuDiff, type Chasu } from './lib/chasuRange';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cashcache-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-cashcache-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = '1eccf3a';
const CHASU: Chasu = { base: BASE, version: 'v2.72.1' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)
const TODAY = '2026-11-18';
const MONTH = TODAY.slice(0, 7);

/** 자산 화면 전체 책(보유 · 티커 · 현금) + 「월 고정지출」 표(설정 쓰기가 읽는다) */
function wholeBook(): FlowBook {
  const b = book('user');
  const f = flowBook();
  const fixed = (m: Record<string, unknown>) => Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('월 고정지출!')));
  return { values: { ...b.values, ...fixed(f.values) } as FlowBook['values'], formulas: { ...b.formulas, ...fixed(f.formulas) } as FlowBook['formulas'] };
}
const g: FakeGoogle = { book: wholeBook(), reads: 0, writes: [], tamper: false, failWrite: false, failReadTab: null };
let otherFetches = 0;
globalThis.fetch = fakeGoogleFetch(g, (async () => {
  otherFetches++;
  throw new Error('시험 — 바깥 주소 호출 막음');
}) as typeof fetch);

const logged: string[] = [];
const keep = { log: console.log, warn: console.warn, error: console.error, info: console.info };
function quiet<T>(fn: () => Promise<T> | T): Promise<T> {
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => Object.assign(console, keep));
}

/** 「현금」 탭 5행(가짜은행0 #1) · 6행(가짜은행1 #1) */
const A: AssetCashKey = { name: '가짜은행0', nth: 1 };
const B: AssetCashKey = { name: '가짜은행1', nth: 1 };
const amountOf = async (row: number) => (await quiet(readAssetSheet)).cashAccounts.find((r) => r.row === row)?.amount ?? null;

/**
 * 캐시를 채운 뒤(읽기 → 같은 읽기는 캐시) 일을 하고, 다음 읽기가 구글을 새로 읽는지 · 새 금액인지.
 * `wrote` 가 false 면 쓰지 않은 일 — 캐시 그대로(읽기 0)인지 본다.
 */
async function afterOp(name: string, op: () => Promise<unknown>, wrote = true, row = 5) {
  resetSheetCache();
  const before = await amountOf(row);
  const r1 = g.reads;
  const again = await amountOf(row);
  const cached = g.reads === r1 && again === before;
  const w0 = g.writes.length;
  await quiet(op).catch(() => undefined);
  const r2 = g.reads;
  const after = await amountOf(row);
  const fresh = g.reads > r2;
  if (wrote) {
    check(`[144-3] ${name} 뒤 다음 시트 읽기가 캐시가 아니라 새로 읽음(구글 읽기 +${g.reads - r2}) · 새 금액`, cached && g.writes.length === w0 + 1 && fresh && after !== before, JSON.stringify({ cached, writes: g.writes.length - w0, fresh, changed: after !== before }));
  } else {
    check(`[144-3] ${name} — 쓰지 않음 → 캐시 그대로(읽기 0 · 지금과 같음)`, cached && g.writes.length === w0 && !fresh && after === before, JSON.stringify({ cached, writes: g.writes.length - w0, fresh }));
  }
}

try {
  clearCashMovesForTest();
  clearCashSettingsForTest();
  resetTokenCache();
  const now = await quiet(cashSheetNow);
  await quiet(() => writeCashSettings({ enabled: true }, now, TODAY));
  await quiet(() => writeCashSettings({ depositPair: { section: '개별 투자', key: A } }, now, TODAY));

  // 자동 반영 예약 — `cashTick` 이 부르는 길 그대로(applyCashMove · 종류 salary / fixed)
  await afterOp('자동 반영 예약(월급)', () => applyCashMove({ kind: 'salary', itemKey: SALARY_ITEM, label: '월급', month: MONTH, day: TODAY, from: null, to: A, amount: 100_000 }, { transientRetry: true }));
  await afterOp('자동 반영 예약(고정 흐름)', () => applyCashMove({ kind: 'fixed', itemKey: JSON.stringify({ category: '저축', reason: '가짜', nth: 1 }), label: '가짜', month: MONTH, day: TODAY, from: A, to: B, amount: 30_000 }, { transientRetry: true }));
  // 같은 달 같은 예약 — 쓰지 않음(그 달 한 번)
  await afterOp('같은 달 같은 예약(중복)', () => applyCashMove({ kind: 'salary', itemKey: SALARY_ITEM, label: '월급', month: MONTH, day: TODAY, from: null, to: A, amount: 100_000 }, { transientRetry: true }), false);
  await afterOp('매수(예수금 줄에서 빠짐)', () => tradeCash('buy', '개별 투자', 9101, '가짜종목', 50_000, TODAY));
  await afterOp('매도(예수금 줄로 들어감)', () => tradeCash('sell', '개별 투자', 9102, '가짜종목', 20_000, TODAY));
  await afterOp('직접 입출금(이체)', () => applyManualCash({ kind: 'transfer', from: A, to: B, amount: 10_000, requestId: 'selftest-cache-0001' }));
  await afterOp('같은 요청 번호 다시(중복)', () => applyManualCash({ kind: 'transfer', from: A, to: B, amount: 10_000, requestId: 'selftest-cache-0001' }), false);
  const manualId = listCashMoves().find((m) => m.kind === 'transfer')?.id as number;
  await afterOp('되돌리기', () => undoCashMove(manualId));
  await afterOp('쓰기 전 실패(줄 못 찾음)', () => applyManualCash({ kind: 'deposit', to: { name: '없는 가짜은행', nth: 1 }, amount: 10_000, requestId: 'selftest-cache-0002' }), false);
  g.tamper = true;
  await afterOp('다시 확인 필요(쓴 뒤 다시 읽은 값이 다름)', () => applyManualCash({ kind: 'deposit', to: A, amount: 7_000, requestId: 'selftest-cache-0003' }));
  g.tamper = false;
  check('[144-3] 다시 확인 필요 기록이 남음(위 줄)', listCashMoves()[0]?.status === 'check');

  // 비우는 곳은 쓰기 한 곳 — 라우트 · 직접 입출금에서 따로 부르지 않음
  const rt = fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8');
  const man = fs.readFileSync(path.join(root, 'server/asset/cashManual.ts'), 'utf8');
  const cm = fs.readFileSync(path.join(root, 'server/asset/cashMoves.ts'), 'utf8');
  const calls = (s: string) => (s.match(/resetSheetCache\(\)/g) ?? []).length;
  const write = cm.slice(cm.indexOf('export async function writeCashMove'), cm.indexOf('export function serial'));
  check('[144-3] 라우트(routes.ts) · 직접 입출금(cashManual.ts)의 따로 부른 resetSheetCache 0 · cashMoves.ts 는 writeCashMove 안 한 곳',
    calls(rt) === 0 && calls(man) === 0 && calls(cm) === 1 && calls(write) === 1 && /finally \{[\s\S]*resetSheetCache\(\);/.test(write), `routes ${calls(rt)} · manual ${calls(man)} · cashMoves ${calls(cm)}`);

  // 4. 바뀐 파일
  const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/auth.ts', 'server/authGuard.ts', 'server/index.ts', 'src/services', 'python', 'server/asset/trade.ts', 'server/asset/google.ts', 'server/asset/sheet.ts']);
  check(`[144-4] 매매 · 주문 · 로그인 · 보유 쓰기 · 구글 쓰기 · 시트 읽기 코드 바뀐 파일 0(${BASE} → 그 차수 끝)`, trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
  const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
  const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
  const changedShared = chasuDiff(root, CHASU, ['--name-only'], shared).stdout.trim().split('\n').filter(Boolean); // 그 차수 범위만(lib/chasuRange)
  const deleted = chasuDiff(root, CHASU, ['-U0'], ['src/data/changelog.ts']).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  check(`[144-4] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 줄 0(changelog 더하기 제외)`, shared.length > 30 && changedShared.every((f) => f === 'src/data/changelog.ts') && deleted.length === 0, `${changedShared.join(',')} · 지운 줄 ${deleted.length}`);
  const dc = chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  check('[144-4] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(장면 더하기만)', dc.length === 0, `지운 줄 ${dc.length}`);
  const SECRETS = ['100000', '100,000', '50000', '50,000', '가짜은행0', '가짜은행1', '가짜종목'];
  check('[144-3] 로그에 금액 · 계좌 이름 0', logged.every((l) => !SECRETS.some((s) => l.includes(s))), `${logged.filter((l) => SECRETS.some((s) => l.includes(s))).length}줄`);
  check('[144-3] 구글 실제 호출 0 · 바깥 주소 호출 0', otherFetches === 0);
} finally {
  clearCashSettingsForTest();
  clearCashMovesForTest();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail === 0 ? 0 : 1);
