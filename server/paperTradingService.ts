import type {
  CreateOrderInput,
  CreateOrderResult,
  Currency,
  PaperAccount,
  PaperAccountDetail,
  PaperOrder,
  PaperPosition,
  PaperPositionValued,
  PaperTrade,
} from '../src/types/paper';
import { getDb } from './db';
import { fetchQuotes } from './quoteService';
import { findStock } from './stockCatalog';
import { fetchExchangeRate } from '../src/services/toss/account';
import { isMockMode } from './mockData';

/**
 * 모의투자 체결 엔진.
 *
 * ⚠️ 이 파일은 토스 **주문** API 를 호출하지 않는다. 시세만 실제 값을 읽고,
 * 주문·체결·잔고·손익은 전부 SQLite 안에서만 움직인다.
 * (`src/services/toss/order.ts` 와는 완전히 분리돼 있다 — 거기에는 아무것도 없다.)
 *
 * 통화 규칙: 가격·손익은 종목 통화(미국 USD / 국내 KRW)로 저장하고, 계좌 현금만
 * 계좌 통화로 둔다. 환산 환율은 체결 기록에 남겨 현금 증감을 재현할 수 있게 한다.
 */

export class PaperTradingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperTradingError';
  }
}

const nowIso = () => new Date().toISOString();

/** 종목이 어느 통화로 거래되는지 — 카탈로그의 시장으로 판별한다. */
function currencyOfSymbol(symbol: string): Currency {
  const market = findStock(symbol)?.market;
  return market === 'KOSPI' || market === 'KOSDAQ' || market === 'KR_ETC' ? 'KRW' : 'USD';
}

function nameOfSymbol(symbol: string): string | null {
  return findStock(symbol)?.name ?? null;
}

/**
 * 종목 통화 → 계좌 통화 환율.
 * 같은 통화면 1. 모의 데이터 모드에서는 고정값을 쓴다(키 없이도 굴려 볼 수 있게).
 */
async function fxRateFor(from: Currency, to: Currency): Promise<number> {
  if (from === to) return 1;
  if (isMockMode()) return from === 'USD' ? 1380 : 1 / 1380;

  const rate = await fetchExchangeRate('USD', 'KRW');
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    throw new PaperTradingError('환율을 가져오지 못해 주문을 처리할 수 없습니다.');
  }
  return from === 'USD' ? rate.rate : 1 / rate.rate;
}

/** 현재가 한 종목 — 체결 기준가 */
async function currentPrice(symbol: string): Promise<number> {
  const [quote] = await fetchQuotes([symbol]);
  if (!quote || quote.price == null || !Number.isFinite(quote.price)) {
    throw new PaperTradingError(`${symbol} 현재가를 가져오지 못했습니다.`);
  }
  return quote.price;
}

// ── 행 매핑 ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const toAccount = (r: Row): PaperAccount => ({
  id: r.id as number,
  name: r.name as string,
  initialBalance: r.initial_balance as number,
  currentCash: r.current_cash as number,
  currency: r.currency as Currency,
  commissionRate: r.commission_rate as number,
  slippageRate: r.slippage_rate as number,
  createdAt: r.created_at as string,
  isActive: Boolean(r.is_active),
});

const toOrder = (r: Row): PaperOrder => ({
  id: r.id as number,
  accountId: r.account_id as number,
  symbol: r.symbol as string,
  name: (r.name as string) ?? null,
  side: r.side as PaperOrder['side'],
  orderType: r.order_type as PaperOrder['orderType'],
  requestedPrice: (r.requested_price as number) ?? null,
  executedPrice: (r.executed_price as number) ?? null,
  quantity: r.quantity as number,
  amount: (r.amount as number) ?? null,
  commission: (r.commission as number) ?? 0,
  slippage: (r.slippage as number) ?? 0,
  currency: r.currency as Currency,
  fxRate: r.fx_rate as number,
  status: r.status as PaperOrder['status'],
  reason: (r.reason as string) ?? null,
  orderedAt: r.ordered_at as string,
  filledAt: (r.filled_at as string) ?? null,
});

const toPosition = (r: Row): PaperPosition => ({
  id: r.id as number,
  accountId: r.account_id as number,
  symbol: r.symbol as string,
  name: (r.name as string) ?? null,
  quantity: r.quantity as number,
  avgPrice: r.avg_price as number,
  totalCost: r.total_cost as number,
  currency: r.currency as Currency,
  openedAt: r.opened_at as string,
  updatedAt: r.updated_at as string,
});

const toTrade = (r: Row): PaperTrade => ({
  id: r.id as number,
  accountId: r.account_id as number,
  orderId: r.order_id as number,
  symbol: r.symbol as string,
  name: (r.name as string) ?? null,
  side: r.side as PaperTrade['side'],
  price: r.price as number,
  quantity: r.quantity as number,
  commission: r.commission as number,
  slippage: r.slippage as number,
  currency: r.currency as Currency,
  fxRate: r.fx_rate as number,
  cashDelta: r.cash_delta as number,
  pnl: (r.pnl as number) ?? null,
  pnlPercent: (r.pnl_percent as number) ?? null,
  reason: (r.reason as string) ?? null,
  tradedAt: r.traded_at as string,
});

// ── 계좌 ─────────────────────────────────────────────────────────────────────

export function listAccounts(): PaperAccount[] {
  return (
    getDb().prepare(`SELECT * FROM paper_accounts ORDER BY id`).all() as Row[]
  ).map(toAccount);
}

export function getAccount(id: number): PaperAccount {
  const row = getDb().prepare(`SELECT * FROM paper_accounts WHERE id = ?`).get(id) as Row | undefined;
  if (!row) throw new PaperTradingError(`계좌 ${id} 을(를) 찾을 수 없습니다.`);
  return toAccount(row);
}

export function createAccount(input: {
  name: string;
  initialBalance: number;
  currency?: Currency;
  commissionRate?: number;
  slippageRate?: number;
}): PaperAccount {
  const name = input.name.trim();
  if (!name) throw new PaperTradingError('계좌 이름이 필요합니다.');
  if (!(input.initialBalance > 0)) throw new PaperTradingError('초기 자금은 0보다 커야 합니다.');

  const result = getDb()
    .prepare(
      `INSERT INTO paper_accounts
         (name, initial_balance, current_cash, currency, commission_rate, slippage_rate, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      name,
      input.initialBalance,
      input.initialBalance,
      input.currency ?? 'KRW',
      input.commissionRate ?? 0.001,
      input.slippageRate ?? 0.0005,
      nowIso(),
    );

  return getAccount(Number(result.lastInsertRowid));
}

export function deleteAccount(id: number): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM paper_trades WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_orders WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_positions WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_snapshots WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_accounts WHERE id = ?`).run(id);
  })();
}

/** 잔고를 초기 자금으로 되돌리고 주문·포지션·체결을 모두 비운다. */
export function resetAccount(id: number, initialBalance?: number): PaperAccount {
  const account = getAccount(id);
  const balance = initialBalance && initialBalance > 0 ? initialBalance : account.initialBalance;
  const db = getDb();

  db.transaction(() => {
    db.prepare(`DELETE FROM paper_trades WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_orders WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_positions WHERE account_id = ?`).run(id);
    db.prepare(`DELETE FROM paper_snapshots WHERE account_id = ?`).run(id);
    db.prepare(`UPDATE paper_accounts SET initial_balance = ?, current_cash = ? WHERE id = ?`).run(
      balance,
      balance,
      id,
    );
  })();

  return getAccount(id);
}

// ── 포지션 ───────────────────────────────────────────────────────────────────

export function listPositions(accountId: number): PaperPosition[] {
  return (
    getDb()
      .prepare(`SELECT * FROM paper_positions WHERE account_id = ? ORDER BY symbol`)
      .all(accountId) as Row[]
  ).map(toPosition);
}

/** 포지션에 실시간 시세를 붙여 평가손익을 채운다. */
export async function valuePositions(
  accountId: number,
  accountCurrency: Currency,
): Promise<{ positions: PaperPositionValued[]; stockValue: number; fxRate: number }> {
  const positions = listPositions(accountId);
  const fxRate = await fxRateFor('USD', accountCurrency);

  if (!positions.length) return { positions: [], stockValue: 0, fxRate };

  const quotes = await fetchQuotes(positions.map((p) => p.symbol));
  const priceOf = new Map(quotes.map((q) => [q.symbol, q.price]));

  let stockValue = 0;
  const valued = positions.map((position): PaperPositionValued => {
    const price = priceOf.get(position.symbol) ?? null;
    if (price == null || !Number.isFinite(price)) {
      return {
        ...position,
        currentPrice: null,
        marketValue: null,
        unrealizedPnl: null,
        unrealizedPnlPercent: null,
        marketValueInAccount: null,
      };
    }

    const marketValue = price * position.quantity;
    const unrealizedPnl = marketValue - position.totalCost;
    const toAccountRate = position.currency === accountCurrency ? 1 : fxRate;
    const marketValueInAccount = marketValue * toAccountRate;
    stockValue += marketValueInAccount;

    return {
      ...position,
      currentPrice: price,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent: position.totalCost ? (unrealizedPnl / position.totalCost) * 100 : null,
      marketValueInAccount,
    };
  });

  return { positions: valued, stockValue, fxRate };
}

export async function getAccountDetail(accountId: number): Promise<PaperAccountDetail> {
  const account = getAccount(accountId);
  const { positions, stockValue, fxRate } = await valuePositions(accountId, account.currency);
  const totalValue = account.currentCash + stockValue;
  const pendingOrders = (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM paper_orders WHERE account_id = ? AND status = 'PENDING'`)
      .get(accountId) as { n: number }
  ).n;

  return {
    account,
    positions,
    stockValue,
    totalValue,
    totalPnl: totalValue - account.initialBalance,
    totalReturn: account.initialBalance
      ? (totalValue / account.initialBalance - 1) * 100
      : 0,
    fxRate,
    pendingOrders,
  };
}

// ── 주문 ─────────────────────────────────────────────────────────────────────

export function listOrders(accountId: number, limit = 200): PaperOrder[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM paper_orders WHERE account_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(accountId, limit) as Row[]
  ).map(toOrder);
}

export function listTrades(accountId: number, limit = 500): PaperTrade[] {
  return (
    getDb()
      .prepare(`SELECT * FROM paper_trades WHERE account_id = ? ORDER BY id DESC LIMIT ?`)
      .all(accountId, limit) as Row[]
  ).map(toTrade);
}

/** 지정가가 체결 가능한 상태인지 — 매수는 현재가가 지정가 이하, 매도는 이상. */
function limitTriggered(side: PaperOrder['side'], limitPrice: number, price: number): boolean {
  return side === 'BUY' ? price <= limitPrice : price >= limitPrice;
}

/**
 * 주문 생성.
 * 시장가는 즉시 체결하고, 지정가는 조건을 만족하면 즉시 / 아니면 PENDING 으로 남긴다.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const account = getAccount(input.accountId);
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new PaperTradingError('종목을 입력하세요.');

  const quantity = Number(input.quantity);
  if (!(quantity > 0)) throw new PaperTradingError('수량은 0보다 커야 합니다.');

  if (input.orderType === 'LIMIT' && !(Number(input.requestedPrice) > 0)) {
    throw new PaperTradingError('지정가 주문은 가격이 필요합니다.');
  }

  const currency = currencyOfSymbol(symbol);
  const name = nameOfSymbol(symbol);
  const price = await currentPrice(symbol);
  const fxRate = await fxRateFor(currency, account.currency);

  // 매도는 주문 시점에 보유 수량을 먼저 확인한다 — PENDING 으로 걸어 두는 경우도 마찬가지다.
  if (input.side === 'SELL') {
    const position = getDb()
      .prepare(`SELECT * FROM paper_positions WHERE account_id = ? AND symbol = ?`)
      .get(account.id, symbol) as Row | undefined;
    const held = position ? (position.quantity as number) : 0;
    if (held < quantity) {
      throw new PaperTradingError(
        `보유 수량이 부족합니다 (보유 ${held}, 주문 ${quantity}).`,
      );
    }
  }

  const shouldFill =
    input.orderType === 'MARKET' ||
    limitTriggered(input.side, Number(input.requestedPrice), price);

  const db = getDb();
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO paper_orders
           (account_id, symbol, name, side, order_type, requested_price, quantity,
            currency, fx_rate, status, reason, ordered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(
        account.id,
        symbol,
        name,
        input.side,
        input.orderType,
        input.orderType === 'LIMIT' ? Number(input.requestedPrice) : null,
        quantity,
        currency,
        fxRate,
        input.reason?.trim() || null,
        nowIso(),
      ).lastInsertRowid,
  );

  if (!shouldFill) {
    return { order: toOrder(db.prepare(`SELECT * FROM paper_orders WHERE id = ?`).get(orderId) as Row), trade: null, pending: true };
  }

  let trade: PaperTrade;
  try {
    trade = fillOrder(orderId, price, fxRate);
  } catch (e) {
    /*
     * 즉시 체결돼야 할 주문이 거부되면(현금 부족 등) 주문 자체를 없앤다.
     * 남겨 두면 PENDING 으로 장부에 앉아 있다가, 나중에 현금이 생긴 순간
     * 사용자가 낸 적 없는 주문이 체결된다.
     */
    db.prepare(`DELETE FROM paper_orders WHERE id = ?`).run(orderId);
    throw e;
  }

  return {
    order: toOrder(db.prepare(`SELECT * FROM paper_orders WHERE id = ?`).get(orderId) as Row),
    trade,
    pending: false,
  };
}

/**
 * 체결 처리 (트랜잭션).
 *
 * 시장가·지정가 모두 여기를 거친다. 지정가도 **기준가는 현재가**다 —
 * 지정가보다 유리한 가격에 닿았다면 그 가격에 체결되는 편이 현실에 가깝다.
 */
function fillOrder(orderId: number, marketPrice: number, fxRate: number): PaperTrade {
  const db = getDb();

  const run = db.transaction((): number => {
    const order = toOrder(db.prepare(`SELECT * FROM paper_orders WHERE id = ?`).get(orderId) as Row);
    if (order.status !== 'PENDING') {
      throw new PaperTradingError('이미 처리된 주문입니다.');
    }
    const account = getAccount(order.accountId);

    // 슬리피지 — 매수는 불리하게 위로, 매도는 아래로.
    const executedPrice =
      order.side === 'BUY'
        ? marketPrice * (1 + account.slippageRate)
        : marketPrice * (1 - account.slippageRate);
    const slippage = Math.abs(executedPrice - marketPrice) * order.quantity;
    const amount = executedPrice * order.quantity;
    const commission = amount * account.commissionRate;

    let pnl: number | null = null;
    let pnlPercent: number | null = null;
    let cashDelta: number;

    if (order.side === 'BUY') {
      cashDelta = -(amount + commission) * fxRate;
      if (account.currentCash + cashDelta < 0) {
        throw new PaperTradingError(
          `현금이 부족합니다 (필요 ${Math.abs(cashDelta).toFixed(0)}, 보유 ${account.currentCash.toFixed(0)}).`,
        );
      }

      const existing = db
        .prepare(`SELECT * FROM paper_positions WHERE account_id = ? AND symbol = ?`)
        .get(order.accountId, order.symbol) as Row | undefined;

      // 평균단가에 수수료를 포함시킨다 — 실제로 그 가격에 사들인 셈이므로
      // 손익분기점이 정직해진다.
      const addedCost = amount + commission;
      if (existing) {
        const quantity = (existing.quantity as number) + order.quantity;
        const totalCost = (existing.total_cost as number) + addedCost;
        db.prepare(
          `UPDATE paper_positions
              SET quantity = ?, total_cost = ?, avg_price = ?, updated_at = ?
            WHERE id = ?`,
        ).run(quantity, totalCost, totalCost / quantity, nowIso(), existing.id);
      } else {
        db.prepare(
          `INSERT INTO paper_positions
             (account_id, symbol, name, quantity, avg_price, total_cost, currency, opened_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          order.accountId,
          order.symbol,
          order.name,
          order.quantity,
          addedCost / order.quantity,
          addedCost,
          order.currency,
          nowIso(),
          nowIso(),
        );
      }
    } else {
      const existing = db
        .prepare(`SELECT * FROM paper_positions WHERE account_id = ? AND symbol = ?`)
        .get(order.accountId, order.symbol) as Row | undefined;
      const held = existing ? (existing.quantity as number) : 0;
      if (held < order.quantity) {
        throw new PaperTradingError(`보유 수량이 부족합니다 (보유 ${held}, 주문 ${order.quantity}).`);
      }

      const avgPrice = existing!.avg_price as number;
      const costBasis = avgPrice * order.quantity;
      pnl = amount - commission - costBasis;
      pnlPercent = costBasis ? (pnl / costBasis) * 100 : null;
      cashDelta = (amount - commission) * fxRate;

      const remaining = held - order.quantity;
      if (remaining <= 1e-9) {
        db.prepare(`DELETE FROM paper_positions WHERE id = ?`).run(existing!.id);
      } else {
        // 평균단가는 그대로 두고 수량·원가만 줄인다 (매도는 단가를 바꾸지 않는다).
        db.prepare(
          `UPDATE paper_positions SET quantity = ?, total_cost = ?, updated_at = ? WHERE id = ?`,
        ).run(remaining, avgPrice * remaining, nowIso(), existing!.id);
      }
    }

    db.prepare(`UPDATE paper_accounts SET current_cash = current_cash + ? WHERE id = ?`).run(
      cashDelta,
      order.accountId,
    );

    const filledAt = nowIso();
    db.prepare(
      `UPDATE paper_orders
          SET status = 'FILLED', executed_price = ?, amount = ?, commission = ?,
              slippage = ?, fx_rate = ?, filled_at = ?
        WHERE id = ?`,
    ).run(executedPrice, amount, commission, slippage, fxRate, filledAt, orderId);

    return Number(
      db
        .prepare(
          `INSERT INTO paper_trades
             (account_id, order_id, symbol, name, side, price, quantity, commission, slippage,
              currency, fx_rate, cash_delta, pnl, pnl_percent, reason, traded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.accountId,
          orderId,
          order.symbol,
          order.name,
          order.side,
          executedPrice,
          order.quantity,
          commission,
          slippage,
          order.currency,
          fxRate,
          cashDelta,
          pnl,
          pnlPercent,
          order.reason,
          filledAt,
        ).lastInsertRowid,
    );
  });

  const tradeId = run();
  return toTrade(db.prepare(`SELECT * FROM paper_trades WHERE id = ?`).get(tradeId) as Row);
}

export function cancelOrder(orderId: number): PaperOrder {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM paper_orders WHERE id = ?`).get(orderId) as Row | undefined;
  if (!row) throw new PaperTradingError(`주문 ${orderId} 을(를) 찾을 수 없습니다.`);
  if ((row.status as string) !== 'PENDING') {
    throw new PaperTradingError('대기 중인 주문만 취소할 수 있습니다.');
  }
  db.prepare(`UPDATE paper_orders SET status = 'CANCELLED' WHERE id = ?`).run(orderId);
  return toOrder(db.prepare(`SELECT * FROM paper_orders WHERE id = ?`).get(orderId) as Row);
}

/**
 * 대기 중인 지정가 주문을 현재가와 대조해 체결한다.
 *
 * 프론트가 1초 폴링으로 부르는 경로다. 종목당 한 번만 시세를 받아
 * 같은 종목의 주문들을 함께 처리한다.
 */
export async function settlePendingOrders(accountId: number): Promise<PaperTrade[]> {
  const pending = (
    getDb()
      .prepare(`SELECT * FROM paper_orders WHERE account_id = ? AND status = 'PENDING' ORDER BY id`)
      .all(accountId) as Row[]
  ).map(toOrder);

  if (!pending.length) return [];

  const symbols = [...new Set(pending.map((o) => o.symbol))];
  const quotes = await fetchQuotes(symbols);
  const priceOf = new Map(quotes.map((q) => [q.symbol, q.price]));

  const filled: PaperTrade[] = [];
  for (const order of pending) {
    const price = priceOf.get(order.symbol);
    if (price == null || !Number.isFinite(price)) continue;
    if (order.requestedPrice == null) continue;
    if (!limitTriggered(order.side, order.requestedPrice, price)) continue;

    try {
      filled.push(fillOrder(order.id, price, order.fxRate));
    } catch (e) {
      // 잔고 부족 등으로 더 이상 체결할 수 없는 주문은 취소해 무한 재시도를 막는다.
      const message = e instanceof Error ? e.message : String(e);
      getDb()
        .prepare(`UPDATE paper_orders SET status = 'CANCELLED', reason = ? WHERE id = ?`)
        .run(`${order.reason ?? ''} [자동 취소: ${message}]`.trim(), order.id);
    }
  }
  return filled;
}
