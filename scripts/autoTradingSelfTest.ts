/**
 * 계좌별 자동매매 자체 점검.
 * 실행: npm run autotrade:test
 *
 * 왜 필요한가 — 하드 손절·트레일링 스톱은 **가격이 실제로 빠져야** 발동한다.
 * 장중에 손실 난 포지션이 생기기를 기다릴 수는 없으므로, **임시 계좌**를 만들어
 * 평균 매입가를 손실 상태로 바꿔 놓고 청산 로직을 돌린다.
 *
 * ⚠️ 임시 계좌는 끝나고 지운다. 사용자의 계좌는 건드리지 않는다.
 * ⚠️ 여기서도 주문은 모의 계좌(SQLite)에만 들어간다.
 */
import { getDb } from '../server/db';
import {
  createAccount,
  createOrder,
  deleteAccount,
  listPositions,
  listTrades,
} from '../server/paperTradingService';
import { runExitChecks } from '../server/autoTrading/engine';
import { deleteStrategy, normalizeStrategy, saveStrategy, updatePeak } from '../server/autoTrading/store';
import type { AccountStrategy } from '../src/types/autoTrading';

const SYMBOL = 'AAPL';
let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✅' : '  ❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

/** 평균 매입가를 올려 손실 상태를 만든다 (가격이 빠지기를 기다리지 않기 위해) */
function inflateAvgPrice(accountId: number, symbol: string, factor: number): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT avg_price, quantity FROM paper_positions WHERE account_id = ? AND symbol = ?`)
    .get(accountId, symbol) as { avg_price: number; quantity: number } | undefined;
  if (!row) throw new Error('포지션이 없습니다');
  const next = row.avg_price * factor;
  db.prepare(
    `UPDATE paper_positions SET avg_price = ?, total_cost = ? WHERE account_id = ? AND symbol = ?`,
  ).run(next, next * row.quantity, accountId, symbol);
  return next;
}

async function main(): Promise<void> {
  console.log('계좌별 자동매매 자체 점검 — 임시 계좌를 만들어 청산 로직을 검증합니다\n');

  const account = createAccount({
    name: `__자동매매 점검 ${Date.now()}`,
    initialBalance: 100_000,
    currency: 'USD',
  });
  console.log(`임시 계좌 #${account.id} 생성 (USD 100,000)\n`);

  try {
    const base: AccountStrategy = normalizeStrategy(account.id, {
      enabled: true,
      mode: 'rule',
      symbols: [SYMBOL],
      hardStopLossPercent: 7,
      trailingStopEnabled: false,
      trailingStopPercent: 8,
    });
    saveStrategy(account.id, base);

    // ── 1. 하드 손절 ────────────────────────────────
    console.log('1) 하드 손절 (-7%)');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });

    // 손실이 기준에 못 미치면 청산되지 않아야 한다 (-3% 상태)
    inflateAvgPrice(account.id, SYMBOL, 1 / 0.97);
    const notHit = await runExitChecks(base);
    check('손실 -3% 는 청산하지 않는다', notHit.length === 0, `주문 ${notHit.length}건`);

    // 기준을 넘기면 즉시 전량 청산
    inflateAvgPrice(account.id, SYMBOL, 0.97 / 0.9);
    const hit = await runExitChecks(base);
    const stopNote = hit.find((n) => n.action === 'SELL');
    check('손실 -10% 는 전량 청산한다', Boolean(stopNote), stopNote?.reason ?? '주문 없음');
    check('사유에 "하드 손절" 이 적힌다', Boolean(stopNote?.reason.includes('하드 손절')), stopNote?.reason ?? '');
    check('포지션이 비었다', listPositions(account.id).every((p) => p.symbol !== SYMBOL || p.quantity === 0));

    // ── 2. 트레일링 스톱 ────────────────────────────
    console.log('\n2) 트레일링 스톱 (-8%)');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });
    const trailing: AccountStrategy = { ...base, trailingStopEnabled: true, trailingStopPercent: 8 };

    // 고점을 현재가보다 20% 높게 박아 둔다 = 고점 대비 -16.7% 하락 상태
    const position = listPositions(account.id).find((p) => p.symbol === SYMBOL)!;
    updatePeak(account.id, SYMBOL, position.avgPrice * 1.2);
    const trailed = await runExitChecks(trailing);
    const trailNote = trailed.find((n) => n.action === 'SELL');
    check('고점 대비 -8% 이상 하락하면 청산한다', Boolean(trailNote), trailNote?.reason ?? '주문 없음');
    check('사유에 "트레일링 스톱" 이 적힌다', Boolean(trailNote?.reason.includes('트레일링 스톱')), trailNote?.reason ?? '');

    // ── 3. 트레일링이 꺼져 있으면 작동하지 않는다 ──
    console.log('\n3) 트레일링 꺼짐');
    await createOrder({
      accountId: account.id,
      symbol: SYMBOL,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 10,
      reason: '점검용 매수',
    });
    updatePeak(account.id, SYMBOL, listPositions(account.id).find((p) => p.symbol === SYMBOL)!.avgPrice * 1.5);
    const off = await runExitChecks(base); // trailingStopEnabled: false
    check('꺼져 있으면 고점이 높아도 청산하지 않는다', off.length === 0, `주문 ${off.length}건`);

    // ── 4. 사유가 거래내역에 남는다 ────────────────
    console.log('\n4) 거래내역의 사유');
    const trades = listTrades(account.id);
    const sells = trades.filter((t) => t.side === 'SELL');
    check('매도 거래가 기록됐다', sells.length >= 2, `${sells.length}건`);
    check('모든 매도에 사유가 있다', sells.every((t) => Boolean(t.reason)), sells.map((t) => t.reason).join(' | ').slice(0, 120));
  } finally {
    deleteStrategy(account.id);
    deleteAccount(account.id);
    console.log(`\n임시 계좌 #${account.id} 삭제 완료`);
  }

  console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
  if (fail > 0) process.exit(1);
}

void main().catch((error) => {
  console.error('점검 실패:', error);
  process.exit(1);
});
