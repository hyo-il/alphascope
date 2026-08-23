import type { PaperPerformance, PaperSnapshot, PaperTrade } from '../src/types/paper';
import { getDb } from './db';
import { getAccountDetail, listTrades } from './paperTradingService';

/**
 * 모의투자 성과 분석.
 *
 * 스냅샷은 평가금액을 볼 때마다 그날 것을 갱신한다(UPSERT). 앱을 켜 둔 날만 점이 찍히므로
 * 연속된 시계열은 아니지만, 이 앱은 "내가 지켜본 구간"의 성과를 보는 것이 목적이라 충분하다.
 */

type Row = Record<string, unknown>;

const toSnapshot = (r: Row): PaperSnapshot => ({
  date: r.date as string,
  totalValue: r.total_value as number,
  cash: r.cash as number,
  stockValue: r.stock_value as number,
  dailyPnl: (r.daily_pnl as number) ?? null,
  dailyReturn: (r.daily_return as number) ?? null,
  cumulativeReturn: (r.cumulative_return as number) ?? null,
});

export function listSnapshots(accountId: number): PaperSnapshot[] {
  return (
    getDb()
      .prepare(`SELECT * FROM paper_snapshots WHERE account_id = ? ORDER BY date`)
      .all(accountId) as Row[]
  ).map(toSnapshot);
}

/** 장이 열리지 않는 날 — 스냅샷을 남기지 않는다. */
function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * 오늘자 스냅샷을 기록/갱신하고 전체 목록을 돌려준다.
 *
 * 주말에는 남기지 않는다. 거래가 없는 날에 점을 찍으면 "일일 수익률" 이 생기는데,
 * 그건 시장이 움직인 결과가 아니라 마지막 체결가가 그대로 이어진 것뿐이다.
 */
export function recordSnapshot(
  accountId: number,
  values: { totalValue: number; cash: number; stockValue: number; initialBalance: number },
): PaperSnapshot[] {
  const date = new Date().toISOString().slice(0, 10);
  if (isWeekend(date)) return listSnapshots(accountId);

  const db = getDb();

  const previous = db
    .prepare(`SELECT * FROM paper_snapshots WHERE account_id = ? AND date < ? ORDER BY date DESC LIMIT 1`)
    .get(accountId, date) as Row | undefined;

  const previousValue = previous ? (previous.total_value as number) : values.initialBalance;
  const dailyPnl = values.totalValue - previousValue;
  const dailyReturn = previousValue ? (dailyPnl / previousValue) * 100 : null;
  const cumulativeReturn = values.initialBalance
    ? (values.totalValue / values.initialBalance - 1) * 100
    : null;

  db.prepare(
    `INSERT INTO paper_snapshots
       (account_id, date, total_value, cash, stock_value, daily_pnl, daily_return, cumulative_return)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, date) DO UPDATE SET
       total_value = excluded.total_value,
       cash = excluded.cash,
       stock_value = excluded.stock_value,
       daily_pnl = excluded.daily_pnl,
       daily_return = excluded.daily_return,
       cumulative_return = excluded.cumulative_return`,
  ).run(
    accountId,
    date,
    values.totalValue,
    values.cash,
    values.stockValue,
    dailyPnl,
    dailyReturn,
    cumulativeReturn,
  );

  return listSnapshots(accountId);
}

/** 고점 대비 최대 낙폭 (%). 값이 하나뿐이면 계산할 수 없다. */
function maxDrawdown(series: number[]): number | null {
  if (series.length < 2) return null;
  let peak = series[0];
  let worst = 0;
  for (const value of series) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak);
  }
  return worst * 100;
}

/** 연율화 변동성 (%) — 일간 수익률 표준편차 × √252 */
function annualizedVolatility(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 2) return null;
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/** 연속 승/패 최대 길이 */
function streaks(results: boolean[]): { win: number; loss: number } {
  let win = 0;
  let loss = 0;
  let currentWin = 0;
  let currentLoss = 0;
  for (const isWin of results) {
    if (isWin) {
      currentWin += 1;
      currentLoss = 0;
    } else {
      currentLoss += 1;
      currentWin = 0;
    }
    win = Math.max(win, currentWin);
    loss = Math.max(loss, currentLoss);
  }
  return { win, loss };
}

export async function computePerformance(accountId: number): Promise<{
  performance: PaperPerformance;
  snapshots: PaperSnapshot[];
}> {
  const detail = await getAccountDetail(accountId);
  const { account, positions } = detail;

  const snapshots = recordSnapshot(accountId, {
    totalValue: detail.totalValue,
    cash: account.currentCash,
    stockValue: detail.stockValue,
    initialBalance: account.initialBalance,
  });

  const trades = listTrades(accountId, 5000);
  // 실현 손익이 있는 것 = 청산된 거래. 승률·손익비는 여기서만 나온다.
  const closed = trades.filter((t): t is PaperTrade & { pnl: number } => t.pnl != null);
  // 시간순으로 뒤집는다 (listTrades 는 최신순).
  const closedAsc = [...closed].reverse();

  const wins = closedAsc.filter((t) => t.pnl > 0);
  const losses = closedAsc.filter((t) => t.pnl <= 0);
  const avgWin = wins.length ? wins.reduce((a, t) => a + t.pnl, 0) / wins.length : null;
  const avgLoss = losses.length ? losses.reduce((a, t) => a + t.pnl, 0) / losses.length : null;
  const { win: maxWinStreak, loss: maxLossStreak } = streaks(closedAsc.map((t) => t.pnl > 0));

  const values = snapshots.map((s) => s.totalValue);
  const dailyReturns = snapshots
    .map((s) => s.dailyReturn)
    .filter((v): v is number => v != null);
  const today = snapshots.at(-1) ?? null;

  // 종목별 — 실현 손익은 체결 기록에서, 평가 손익은 현재 포지션에서 모은다.
  const realizedBySymbol = new Map<string, number>();
  for (const trade of closedAsc) {
    realizedBySymbol.set(trade.symbol, (realizedBySymbol.get(trade.symbol) ?? 0) + trade.pnl);
  }

  const symbols = new Set([...realizedBySymbol.keys(), ...positions.map((p) => p.symbol)]);
  const bySymbol = [...symbols].map((symbol) => {
    const position = positions.find((p) => p.symbol === symbol) ?? null;
    const realizedPnl = realizedBySymbol.get(symbol) ?? 0;
    const unrealizedPnl = position?.unrealizedPnl ?? null;
    const cost = position?.totalCost ?? 0;
    return {
      symbol,
      name: position?.name ?? closedAsc.find((t) => t.symbol === symbol)?.name ?? null,
      realizedPnl,
      unrealizedPnl,
      returnPercent: cost ? ((unrealizedPnl ?? 0) / cost) * 100 : null,
      weight:
        detail.totalValue && position?.marketValueInAccount != null
          ? (position.marketValueInAccount / detail.totalValue) * 100
          : null,
    };
  });

  const performance: PaperPerformance = {
    initialBalance: account.initialBalance,
    totalValue: detail.totalValue,
    cash: account.currentCash,
    stockValue: detail.stockValue,
    totalPnl: detail.totalPnl,
    totalReturn: detail.totalReturn,
    dailyPnl: today?.dailyPnl ?? null,
    dailyReturn: today?.dailyReturn ?? null,

    mdd: maxDrawdown(values),
    volatility: annualizedVolatility(dailyReturns),

    tradeCount: trades.length,
    closedCount: closedAsc.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closedAsc.length ? (wins.length / closedAsc.length) * 100 : null,
    avgWin,
    avgLoss,
    // 손익비는 평균 손실이 0 이면 정의되지 않는다 (전부 이겼거나 청산이 없는 경우).
    profitFactor: avgWin != null && avgLoss != null && avgLoss !== 0
      ? Math.abs(avgWin / avgLoss)
      : null,
    maxWinStreak,
    maxLossStreak,

    bySymbol: bySymbol.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)),
  };

  return { performance, snapshots };
}
