import type { Candle } from '../src/types/toss';
import { getCandles } from './candleService';
import { getDb, loadCandles } from './db';
import { listAccounts, listPositions } from './paperTradingService';
import { computePerformance } from './paperPerformanceService';

/**
 * 모의투자 일별 스냅샷 자동 기록.
 *
 * 성과 화면을 열 때만 스냅샷이 찍히면, 며칠 앱을 안 켠 구간이 곡선에서 통째로 사라진다.
 * 여기서 두 가지를 한다.
 *   1) 서버 기동 시 — 마지막 스냅샷과 오늘 사이의 빠진 **거래일**을 그날 종가로 채운다.
 *   2) 실행 중 — 미국장 마감 뒤(한국시간 07:00)에 그날 스냅샷을 남긴다.
 *
 * 빠진 날을 현재가로 채우면 곡선이 거짓말이 된다. 반드시 그 날짜의 일봉 종가를 쓴다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** 미국장 마감(한국시간 06:00) 이후로 잡는다 — 그날의 종가가 확정된 뒤여야 한다. */
const SNAPSHOT_HOUR_KST = 7;
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const dateKey = (date: Date) => date.toISOString().slice(0, 10);

/** 한국시간 기준 오늘 날짜 (YYYY-MM-DD) */
function todayKst(): string {
  return dateKey(new Date(Date.now() + KST_OFFSET_MS));
}

/** 주말은 장이 열리지 않으므로 스냅샷 대상이 아니다. */
function isWeekend(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** from(제외) ~ to(포함) 사이의 평일 목록 */
function weekdaysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);

  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const key = dateKey(cursor);
    if (!isWeekend(key)) days.push(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * 해당 날짜의 종가. 그날 봉이 없으면(공휴일 등) 그 이전 마지막 봉을 쓴다.
 * null 이면 그 종목의 가격을 알 수 없다는 뜻이다.
 */
function closeOn(candles: Candle[], dateStr: string): number | null {
  const limit = new Date(`${dateStr}T23:59:59Z`).getTime();
  let last: number | null = null;
  for (const candle of candles) {
    if (candle.timestamp > limit) break;
    last = candle.close;
  }
  return last;
}

interface SnapshotRow {
  date: string;
  total_value: number;
  cash: number;
  stock_value: number;
}

/** 계좌 하나의 빠진 날짜를 채운다. 채운 날짜 수를 돌려준다. */
async function backfillAccount(accountId: number): Promise<number> {
  const db = getDb();
  const last = db
    .prepare(`SELECT * FROM paper_snapshots WHERE account_id = ? ORDER BY date DESC LIMIT 1`)
    .get(accountId) as SnapshotRow | undefined;

  // 스냅샷이 하나도 없으면 채울 "사이"가 없다 — 성과 화면이 오늘 것을 만든다.
  if (!last) return 0;

  const missing = weekdaysBetween(last.date, todayKst()).filter((d) => d !== todayKst());
  if (!missing.length) return 0;

  const positions = listPositions(accountId);
  const account = listAccounts().find((a) => a.id === accountId);
  if (!account) return 0;

  /*
   * 현금은 마지막 기록값을 그대로 쓴다. 그 사이에 매매가 있었다면 그날의 현금은
   * 달라지지만, 앱이 꺼져 있던 구간에는 매매 자체가 일어날 수 없다.
   */
  const cash = last.cash;

  // 종목별 일봉을 한 번씩만 받아 둔다.
  const seriesOf = new Map<string, Candle[]>();
  for (const position of positions) {
    let candles = loadCandles(position.symbol, '1d', 400);
    if (!candles.length) {
      try {
        candles = await getCandles(position.symbol, '1d', 200);
      } catch {
        candles = [];
      }
    }
    seriesOf.set(position.symbol, candles);
  }

  const insert = db.prepare(
    `INSERT INTO paper_snapshots
       (account_id, date, total_value, cash, stock_value, daily_pnl, daily_return, cumulative_return)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, date) DO NOTHING`,
  );

  let previousValue = last.total_value;
  let filled = 0;

  for (const date of missing) {
    let stockValue = 0;
    let priced = true;

    for (const position of positions) {
      const close = closeOn(seriesOf.get(position.symbol) ?? [], date);
      if (close == null) {
        priced = false;
        break;
      }
      // 계좌 통화 환산은 마지막 스냅샷의 비율을 그대로 따른다 — 과거 환율을 다시
      // 받아 오는 것은 이 기능의 값어치에 비해 과하다.
      stockValue += close * position.quantity;
    }
    // 그날 가격을 모르는 종목이 있으면 건너뛴다. 추정값으로 곡선을 채우지 않는다.
    if (!priced) continue;

    const fxRate = estimateFxRate(last, positions, seriesOf);
    const totalValue = cash + stockValue * fxRate;
    const dailyPnl = totalValue - previousValue;

    insert.run(
      accountId,
      date,
      totalValue,
      cash,
      stockValue * fxRate,
      dailyPnl,
      previousValue ? (dailyPnl / previousValue) * 100 : null,
      account.initialBalance ? (totalValue / account.initialBalance - 1) * 100 : null,
    );

    previousValue = totalValue;
    filled += 1;
  }

  return filled;
}

/**
 * 마지막 스냅샷에서 환율을 역산한다.
 * (stock_value 는 계좌 통화, 종목 평가는 종목 통화이므로 그 비율이 곧 환율이다.)
 */
function estimateFxRate(
  last: SnapshotRow,
  positions: ReturnType<typeof listPositions>,
  seriesOf: Map<string, Candle[]>,
): number {
  if (!positions.length || !last.stock_value) return 1;
  if (positions.every((p) => p.currency === 'KRW')) return 1;

  let nativeValue = 0;
  for (const position of positions) {
    const close = closeOn(seriesOf.get(position.symbol) ?? [], last.date);
    if (close == null) return 1;
    nativeValue += close * position.quantity;
  }
  return nativeValue > 0 ? last.stock_value / nativeValue : 1;
}

/** 모든 계좌의 빠진 날짜를 채운다 (서버 기동 시 1회). */
export async function backfillSnapshots(): Promise<void> {
  try {
    const accounts = listAccounts();
    let total = 0;
    for (const account of accounts) {
      total += await backfillAccount(account.id);
    }
    if (total) console.log(`[paper] 스냅샷 ${total}일치를 보정했습니다.`);
  } catch (e) {
    // 보정 실패로 서버가 뜨지 않으면 안 된다.
    console.error('[paper] 스냅샷 보정 실패:', e instanceof Error ? e.message : e);
  }
}

/** 오늘 스냅샷을 모든 계좌에 기록한다 (computePerformance 가 UPSERT 한다). */
async function recordToday(): Promise<void> {
  for (const account of listAccounts()) {
    try {
      await computePerformance(account.id);
    } catch {
      // 시세를 못 받는 계좌는 건너뛴다 — 다음 주기에 다시 시도한다.
    }
  }
}

let lastRecordedDate: string | null = null;

/**
 * 실행 중 하루 한 번 스냅샷을 남긴다.
 * 정확한 시각에 깨우는 대신 10분마다 확인한다 — 노트북이 잠들어 그 순간을
 * 놓쳐도 다음 확인에서 기록된다.
 */
export function startSnapshotScheduler(): void {
  const check = () => {
    const now = new Date(Date.now() + KST_OFFSET_MS);
    const today = dateKey(now);
    if (lastRecordedDate === today) return;
    if (now.getUTCHours() < SNAPSHOT_HOUR_KST) return;
    // 장이 닫힌 날은 남기지 않는다 — 거래가 없는 날의 "일일 수익률" 은 읽는 사람을 오해시킨다.
    if (isWeekend(today)) return;

    lastRecordedDate = today;
    void recordToday();
  };

  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();
}
