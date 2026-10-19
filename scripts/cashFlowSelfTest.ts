/**
 * 계좌 입금 · 출금 점검 — `npm run cashflow:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * `accountsview:test` 와 같은 방식 — 사본 DB 로 **시험 서버를 따로 띄워**(포트 4103 · 스케줄러 스위치 셋 끔) 실제 HTTP 로 확인하고,
 * 스냅샷 · 하루 손실 한도는 같은 사본 DB 에서 함수를 바로 부른다.
 * - 사본 DB 의 비밀번호를 시험용으로 바꾸고 세션을 모두 지운다 · 시험 계좌는 이름 「cashflow-test …」 로 만들고 끝나면 지운다.
 * - 입금 · 출금 → 현금 · 원금이 함께 바뀌고 총 손익 그대로 · 출금할 수 있는 돈(미체결 매수에 묶인 돈) · 금액 검사 · 원금 0 이하 ·
 *   로그인 없이 401 · 초기화 · 삭제하면 기록 삭제 · 복사는 기록 없이 지금 원금 · 스냅샷 · 그래프 · 하루 손실 한도.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';
import { createAccount, deleteAccount, getAccount, listAccounts, listCashFlows } from '../server/paperTradingService';
import { listSnapshots, recordSnapshot } from '../server/paperPerformanceService';
import { backfillSnapshots } from '../server/paperSnapshotScheduler';
import { evaluateDailyLoss, readDailyLoss } from '../server/autoTrading/guards';
import { copyAccount } from '../server/autoTrading/copy';
import { flowNeutralValues } from '../src/utils/flowNeutral';
import { maxDrawdown } from '../src/utils/drawdown';
import { defaultStrategy } from '../src/types/autoTrading';
import { writeSetting, readSetting } from '../server/gemini/store';

const PORT = 4103;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-cashflow-0001';
const PREFIX = 'cashflow-test';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number | null | undefined, b: number, eps = 1e-6) => a != null && Math.abs(a - b) <= eps;

function cleanup() {
  for (const a of listAccounts().filter((x) => x.name.startsWith(PREFIX))) deleteAccount(a.id);
}

await setPassword(TEST_PW);
getDb().prepare(`DELETE FROM auth_sessions`).run();
cleanup();

const server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
  detached: true,
  env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false' },
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

let cookie = '';
const move = (id: number, kind: 'deposit' | 'withdraw', amount: unknown, withCookie = true) =>
  fetch(`${BASE}/api/paper/accounts/${id}/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withCookie ? { cookie } : {}) },
    body: JSON.stringify({ amount }),
  });
const detail = async (id: number) =>
  (await (await fetch(`${BASE}/api/paper/accounts/${id}`, { headers: { cookie } })).json()) as {
    account: { initialBalance: number; currentCash: number };
    totalPnl: number;
    totalReturn: number;
    withdrawable: number;
  };
const errorOf = async (r: Response) => ((await r.json()) as { error?: string }).error ?? '';
const utcDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

try {
  await waitReady();

  // ── 문지기 ──
  const krw = createAccount({ name: `${PREFIX} KRW`, initialBalance: 1_000_000, currency: 'KRW' });
  check('로그인 없이 입금 401', (await move(krw.id, 'deposit', 1000, false)).status === 401);
  check('로그인 없이 출금 401', (await move(krw.id, 'withdraw', 1000, false)).status === 401);
  check('로그인 없이 입출금 기록 없음', listCashFlows(krw.id).length === 0);

  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  if (!login.ok) throw new Error(`로그인 실패 ${login.status}`);
  cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

  // ── 입금 · 출금: 현금 · 원금 함께, 총 손익 그대로 ──
  // 손실 10만 원인 계좌(현금 90만 · 원금 100만)
  getDb().prepare(`UPDATE paper_accounts SET current_cash = 900000 WHERE id = ?`).run(krw.id);
  const before = await detail(krw.id);
  const dep = await move(krw.id, 'deposit', 500_000);
  const depBody = (await dep.json()) as { account?: { currentCash: number; initialBalance: number }; flow?: { type: string; amount: number } };
  check('입금 200 · 기록 한 줄(deposit 500,000)', dep.status === 200 && depBody.flow?.type === 'deposit' && depBody.flow?.amount === 500_000);
  const afterDep = await detail(krw.id);
  check('입금 → 현금 +500,000', near(afterDep.account.currentCash, before.account.currentCash + 500_000));
  check('입금 → 원금 +500,000', near(afterDep.account.initialBalance, before.account.initialBalance + 500_000));
  check('입금 → 총 손익 그대로(−100,000)', near(afterDep.totalPnl, before.totalPnl) && near(before.totalPnl, -100_000), `${before.totalPnl} → ${afterDep.totalPnl}`);
  check(
    '입금 → 수익률 = 총 손익 ÷ 새 원금(−10% → −6.67% — 손익이 있으면 원금이 커진 만큼 % 는 작아진다)',
    near(afterDep.totalReturn, (-100_000 / 1_500_000) * 100, 1e-9),
    `${before.totalReturn.toFixed(2)}% → ${afterDep.totalReturn.toFixed(2)}%`,
  );

  const wd = await move(krw.id, 'withdraw', 300_000);
  check('출금 200', wd.status === 200);
  const afterWd = await detail(krw.id);
  check('출금 → 현금 −300,000', near(afterWd.account.currentCash, afterDep.account.currentCash - 300_000));
  check('출금 → 원금 −300,000', near(afterWd.account.initialBalance, afterDep.account.initialBalance - 300_000));
  check('출금 → 총 손익 그대로', near(afterWd.totalPnl, before.totalPnl));

  // 손익 0 인 계좌는 수익률도 그대로 0
  const flat = createAccount({ name: `${PREFIX} flat`, initialBalance: 2_000_000, currency: 'KRW' });
  await move(flat.id, 'deposit', 1_000_000);
  const flatD = await detail(flat.id);
  check('손익 0 계좌 — 입금 뒤에도 수익률 0%', flatD.totalReturn === 0 && flatD.totalPnl === 0);

  // ── 출금할 수 있는 돈 — 미체결 매수에 묶인 돈 ──
  getDb()
    .prepare(
      `INSERT INTO paper_orders (account_id, symbol, name, side, order_type, requested_price, quantity, currency, fx_rate, status, reason, ordered_at)
       VALUES (?, '005930', '삼성전자', 'BUY', 'LIMIT', 100000, 2, 'KRW', 1, 'PENDING', 'cashflow-test', ?)`,
    )
    .run(krw.id, new Date().toISOString());
  const acct = getAccount(krw.id);
  const reserved = 100_000 * 2 * (1 + acct.slippageRate) * (1 + acct.commissionRate);
  const expected = Math.floor(acct.currentCash - reserved);
  const withPending = await detail(krw.id);
  check('출금할 수 있는 돈 = 현금 − 미체결 매수에 묶인 돈(원 단위 내림)', withPending.withdrawable === expected, `${withPending.withdrawable} = ${expected}`);
  const over = await move(krw.id, 'withdraw', expected + 1);
  const overErr = await errorOf(over);
  check('묶인 돈까지 빼려면 400 · 이유 문구', over.status === 400 && overErr.includes('출금할 수 있는 돈') && overErr.includes('미체결'), overErr);
  check('거절된 출금은 현금 · 원금을 바꾸지 않는다', near(getAccount(krw.id).currentCash, acct.currentCash) && near(getAccount(krw.id).initialBalance, acct.initialBalance));
  const exact = await move(krw.id, 'withdraw', expected);
  check('출금할 수 있는 돈 전부 출금 200', exact.status === 200, await errorOf(exact.clone()));
  check('그 뒤 출금할 수 있는 돈 0', (await detail(krw.id)).withdrawable === 0);
  getDb().prepare(`DELETE FROM paper_orders WHERE account_id = ? AND reason = 'cashflow-test'`).run(krw.id);

  // ── 금액 검사 ──
  for (const [bad, label] of [[0, '0'], [-1000, '음수'], ['abc', '숫자 아님'], [null, '없음'], [true, 'true'], [1000.5, '원화 소수'], [Number.NaN, 'NaN']] as const) {
    const r = await move(krw.id, 'deposit', bad);
    check(`입금 ${label} → 400`, r.status === 400, `${r.status} ${await errorOf(r)}`);
  }
  const usd = createAccount({ name: `${PREFIX} USD`, initialBalance: 1000, currency: 'USD' });
  const usdBad = await move(usd.id, 'deposit', 1.234);
  check('달러 소수 3자리 → 400', usdBad.status === 400, await errorOf(usdBad));
  const usdOk = await move(usd.id, 'deposit', 1.23);
  check('달러 소수 2자리 → 200 · 원금 1001.23', usdOk.status === 200 && near(getAccount(usd.id).initialBalance, 1001.23));
  check('없는 계좌 → 404', (await move(999_999, 'deposit', 1000)).status === 404);

  // ── 원금이 0 이하가 되는 출금 ──
  const rich = createAccount({ name: `${PREFIX} rich`, initialBalance: 100_000, currency: 'KRW' });
  getDb().prepare(`UPDATE paper_accounts SET current_cash = 1000000 WHERE id = ?`).run(rich.id); // 많이 번 계좌
  const zero = await move(rich.id, 'withdraw', 100_000);
  check('원금이 0 이 되는 출금 → 400', zero.status === 400 && (await errorOf(zero)).includes('원금'));
  check('원금이 남는 출금 → 200', (await move(rich.id, 'withdraw', 99_999)).status === 200 && near(getAccount(rich.id).initialBalance, 1));

  // ── 거래 내역 응답에 입출금 ──
  const trades = (await (await fetch(`${BASE}/api/paper/trades?accountId=${krw.id}`, { headers: { cookie } })).json()) as { trades?: unknown[]; cashFlows?: { type: string }[] };
  check('거래 내역 응답에 입출금 3줄(최신 먼저)', Array.isArray(trades.trades) && trades.cashFlows?.map((f) => f.type).join(',') === 'withdraw,withdraw,deposit', JSON.stringify(trades.cashFlows?.map((f) => f.type)));

  // ── 스냅샷 — 입출금이 그날 손익으로 잡히지 않는다 ──
  const weekend = [0, 6].includes(new Date(`${utcDay()}T00:00:00Z`).getUTCDay());
  if (weekend) {
    console.log('SKIP  오늘(UTC)이 주말이라 recordSnapshot 이 점을 남기지 않는다 — 평일에 다시 돌린다');
  } else {
    const snap = createAccount({ name: `${PREFIX} snap`, initialBalance: 1_000_000, currency: 'KRW' });
    // 어제 점 = 100만. 오늘 시장이 +1만, 그리고 50만 입금
    getDb()
      .prepare(`INSERT INTO paper_snapshots (account_id, date, total_value, cash, stock_value, daily_pnl, daily_return, cumulative_return) VALUES (?, ?, 1000000, 1000000, 0, 0, 0, 0)`)
      .run(snap.id, utcDay(-1));
    await move(snap.id, 'deposit', 500_000);
    const s1 = recordSnapshot(snap.id, { totalValue: 1_510_000, cash: 1_510_000, stockValue: 0, initialBalance: 1_500_000 }).at(-1)!;
    check('오늘 점 — 그날 손익 +10,000(입금 50만 빼고)', near(s1.dailyPnl, 10_000), String(s1.dailyPnl));
    check('오늘 점 — 그날 수익률 = 1만 ÷ (어제 100만 + 입금 50만)', near(s1.dailyReturn, (10_000 / 1_500_000) * 100));
    check('오늘 점 — 입출금 칸 +500,000', s1.cashFlow === 500_000);

    // 오늘 점이 있는데 또 출금 — 그 점의 평가액 · 현금이 같은 만큼 옮겨지고 그날 손익은 그대로
    await move(snap.id, 'withdraw', 200_000);
    const s2 = listSnapshots(snap.id).at(-1)!;
    check('같은 날 점이 있으면 평가액 · 현금도 −200,000', near(s2.totalValue, 1_310_000) && near(s2.cash, 1_310_000), `${s2.totalValue}`);
    check('… 그날 손익은 그대로 +10,000', near(s2.dailyPnl, 10_000));
    check('… 누적 수익률 = 평가액 ÷ 새 원금', near(s2.cumulativeReturn, (1_310_000 / 1_300_000 - 1) * 100));
    // 다시 기록해도 같은 값(그날 입출금 합 +30만을 뺀다)
    const s3 = recordSnapshot(snap.id, { totalValue: 1_310_000, cash: 1_310_000, stockValue: 0, initialBalance: 1_300_000 }).at(-1)!;
    check('그날 다시 기록해도 손익 +10,000', near(s3.dailyPnl, 10_000), String(s3.dailyPnl));

    // 그래프 · 최대 낙폭 — 출금이 낙폭으로 잡히지 않는다
    const pts = [
      { totalValue: 1_000_000, cashFlow: 0 },
      { totalValue: 510_000, cashFlow: -500_000 }, // 50만 출금 + 1만 수익
      { totalValue: 505_000, cashFlow: 0 }, // 5천 손실
    ];
    const neutral = flowNeutralValues(pts);
    check('그래프 — 출금한 날은 +2%(1만 ÷ 50만)', near(neutral[1] / neutral[0] - 1, 0.02));
    check('최대 낙폭 — 출금(−49%)이 아니라 실제 손실(−0.98%)', near(maxDrawdown(neutral), (505_000 / 510_000 - 1) * 100), `${maxDrawdown(neutral)?.toFixed(3)}%`);
    const plain = [{ totalValue: 100, cashFlow: 0 }, { totalValue: 90, cashFlow: 0 }];
    check('입출금이 없으면 평가액 그대로(옛 계좌 값이 바뀌지 않는다)', JSON.stringify(flowNeutralValues(plain)) === '[100,90]');

    // 빈 날 채우기 — 사흘 전 점만 있고 그 뒤 입금이 있었던 계좌
    const bf = createAccount({ name: `${PREFIX} backfill`, initialBalance: 1_000_000, currency: 'KRW' });
    // 마지막 점 d0 과 오늘(KST) 사이에 평일이 둘 이상 끼게 — 첫 빈 날은 입금 전, 둘째 빈 날에 입금
    const kstDay = (k: number) => new Date(Date.now() + 9 * 3_600_000 - k * 86_400_000).toISOString().slice(0, 10);
    const weekday = (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    let d0 = kstDay(4);
    let gaps: string[] = [];
    for (let k = 4; k < 14; k++) {
      d0 = kstDay(k);
      gaps = Array.from({ length: k - 1 }, (_, i) => kstDay(k - 1 - i)).filter(weekday);
      if (weekday(d0) && gaps.length >= 2) break;
    }
    getDb()
      .prepare(`INSERT INTO paper_snapshots (account_id, date, total_value, cash, stock_value, daily_pnl, daily_return, cumulative_return) VALUES (?, ?, 1000000, 1000000, 0, 0, 0, 0)`)
      .run(bf.id, d0);
    // 둘째 빈 날(UTC 날짜)로 기록된 입금 30만 — 현금 · 원금은 이미 반영된 상태
    const depDay = `${gaps[1]}T03:00:00.000Z`;
    getDb().prepare(`INSERT INTO paper_cash_flows (account_id, type, amount, created_at) VALUES (?, 'deposit', 300000, ?)`).run(bf.id, depDay);
    getDb().prepare(`UPDATE paper_accounts SET current_cash = 1300000, initial_balance = 1300000 WHERE id = ?`).run(bf.id);
    await backfillSnapshots();
    const filled = listSnapshots(bf.id).filter((s) => s.date > d0);
    check('빈 날 채우기 — 입금 전 날 100만 · 입금 뒤 날 130만', filled.length >= 2 && filled.every((s) => (s.date >= depDay.slice(0, 10) ? near(s.totalValue, 1_300_000) : near(s.totalValue, 1_000_000))), filled.map((s) => `${s.date}:${s.totalValue}`).join(' '));
    check('빈 날 채우기 — 그날 손익 모두 0(입금이 손익으로 안 잡힘)', filled.every((s) => near(s.dailyPnl, 0)), filled.map((s) => `${s.date}:${s.dailyPnl}`).join(' '));
    check('빈 날 채우기 — 누적 수익률 모두 0%', filled.every((s) => near(s.cumulativeReturn, 0)), filled.map((s) => `${s.date}:${s.cumulativeReturn}`).join(' '));
  }

  // ── 하루 손실 한도 — 입출금으로 걸리거나 풀리지 않는다 ──
  const kill = { ...defaultStrategy(krw.id), symbols: ['AAPL'], dailyLossLimitPercent: 2 };
  const t0 = Date.parse('2026-10-20T15:00:00Z'); // 미국 거래일 안
  const savedLoss = readSetting<Record<string, unknown>>('autoTrading.dailyLoss', {});
  let flow = 0;
  const v = (n: number) => async () => n;
  const f = () => flow;
  await evaluateDailyLoss(kill, t0, v(100_000), f);
  flow = -10_000; // 1만 출금
  const afterWithdraw = await evaluateDailyLoss(kill, t0 + 60_000, v(90_000), f);
  check('출금 1만(−10%) 은 한도에 걸리지 않는다', afterWithdraw?.hit === false && near(afterWithdraw.drawdownPercent, 0), `${afterWithdraw?.drawdownPercent.toFixed(2)}%`);
  flow = 40_000; // 5만 입금
  const afterDeposit = await evaluateDailyLoss(kill, t0 + 120_000, v(137_000), f); // 실제로는 −3천(−2.14%)
  check('입금 뒤 실제 손실 −2.14% 는 걸린다(입금이 손실을 가리지 않는다)', afterDeposit?.hit === true, `${afterDeposit?.drawdownPercent.toFixed(2)}%`);
  check('기준 평가액이 입출금만큼 옮겨졌다(10만 −1만 +5만 = 14만)', near(afterDeposit?.base, 140_000) && readDailyLoss(krw.id)?.baseFlow === 40_000);
  flow = 140_000; // 10만 더 입금 — 걸린 것은 풀리지 않는다
  const still = await evaluateDailyLoss(kill, t0 + 180_000, v(237_000), f);
  check('같은 날 입금으로는 풀리지 않는다', still?.hit === true);
  const nextDay = await evaluateDailyLoss(kill, t0 + 86_400_000, v(237_000), f);
  check('다음 거래일은 지금 평가액이 새 기준(입출금 칸 = 지금 합)', nextDay?.hit === false && near(nextDay.base, 237_000));
  // 입출금 없는 계좌 — 저장 값에 baseFlow 칸이 생기지 않는다(예전과 같은 모양)
  flow = 0;
  const flatKill = { ...kill, accountId: flat.id };
  await evaluateDailyLoss(flatKill, t0, v(100_000), () => 0);
  check('입출금 없으면 저장 값에 baseFlow 칸 없음', !('baseFlow' in (readDailyLoss(flat.id) ?? {})));
  writeSetting('autoTrading.dailyLoss', savedLoss);

  // ── 복사 · 초기화 · 삭제 ──
  const copy = copyAccount(krw.id, `${PREFIX} copy`, () => true);
  check('복사 — 새 계좌 초기 자금 = 원래 계좌의 지금 원금', near(copy.initialBalance, getAccount(krw.id).initialBalance) && near(copy.currentCash, copy.initialBalance));
  check('복사 — 입출금 기록은 가져가지 않는다', listCashFlows(copy.id).length === 0);

  const principal = getAccount(krw.id).initialBalance;
  const reset = await fetch(`${BASE}/api/paper/accounts/${krw.id}/reset`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  check('초기화 200 → 입출금 기록 삭제', reset.status === 200 && listCashFlows(krw.id).length === 0);
  check('초기화 → 현금 = 지금 원금', near(getAccount(krw.id).currentCash, principal) && near(getAccount(krw.id).initialBalance, principal));

  const usdFlows = listCashFlows(usd.id).length;
  const del = await fetch(`${BASE}/api/paper/accounts/${usd.id}`, { method: 'DELETE', headers: { cookie } });
  const left = (getDb().prepare(`SELECT COUNT(*) AS n FROM paper_cash_flows WHERE account_id = ?`).get(usd.id) as { n: number }).n;
  check('삭제 → 그 계좌 입출금 기록도 삭제', del.status === 200 && usdFlows === 1 && left === 0, `${usdFlows} → ${left}`);
} catch (e) {
  fail++;
  console.log('FAIL  시험 중 오류 —', (e as Error).stack ?? (e as Error).message);
} finally {
  try {
    process.kill(-server.pid!, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  cleanup();
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
