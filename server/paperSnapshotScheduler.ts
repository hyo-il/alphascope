import type { Candle } from '../src/types/toss';
import { getCandles } from './candleService';
import { getDb, loadCandles } from './db';
import { cashFlowDates, listAccounts, listPositions, usdKrwRate } from './paperTradingService';
import { convertAmount } from '../src/utils/fx';
import type { Currency } from '../src/types/paper';
import { cashFlowBetween, computePerformance } from './paperPerformanceService';

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
export async function backfillAccount(accountId: number): Promise<number> {
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
  let previousDate = last.date;
  let filled = 0;
  // 입출금 — 빈 날의 현금은 마지막 점 현금 + 그날까지의 입출금, 그날 손익에서는 앞 점 이후 입출금을 뺀다(`recordSnapshot` 과 같은 식).
  // 누적 수익률의 원금은 그날 원금(지금 원금 − 그 뒤 입출금). 입출금이 없으면 모두 0 이라 예전 값과 같다.
  const flows = cashFlowDates(accountId);

  // 환율은 마지막 스냅샷에서 역산한 1달러 = N원 하나를 빈 날 모두에 쓴다 — 과거 환율을 다시 받아 오는 것은
  // 이 기능의 값어치에 비해 과하다. 역산이 안 되면 지금 환율, 그것도 없으면 통화가 섞인 계좌는 건너뛴다.
  const needsFx = positions.some((p) => p.currency !== account.currency);
  const usdKrw = needsFx
    ? (estimateUsdKrw(last, positions, seriesOf, account.currency) ?? (await usdKrwRate().catch(() => null)))
    : null;
  if (needsFx && usdKrw == null) return 0;

  for (const date of missing) {
    const native = nativeValues(positions, seriesOf, date);
    // 그날 가격을 모르는 종목이 있으면 건너뛴다. 추정값으로 곡선을 채우지 않는다.
    if (!native) continue;

    // 통화별 합을 계좌 통화로(convertAmount 하나 — 통화가 섞여도 원화와 달러를 그냥 더하지 않게).
    // 합이 0 인 통화는 바꾸지 않는다 — 한 통화만 들고 있거나 보유가 없는 계좌는 환율이 null 이라 던져서, 그 뒤 계좌까지 채우지 못했다
    const stockValue =
      (native.KRW ? convertAmount(native.KRW, 'KRW', account.currency, usdKrw) : 0) +
      (native.USD ? convertAmount(native.USD, 'USD', account.currency, usdKrw) : 0);
    const dayCash = cash + cashFlowBetween(flows, last.date, date);
    const totalValue = dayCash + stockValue;
    const flow = cashFlowBetween(flows, previousDate, date);
    const dailyPnl = totalValue - previousValue - flow;
    const base = previousValue + flow;
    const initial = account.initialBalance - cashFlowBetween(flows, date, null);

    insert.run(
      accountId,
      date,
      totalValue,
      dayCash,
      stockValue,
      dailyPnl,
      base ? (dailyPnl / base) * 100 : null,
      initial ? (totalValue / initial - 1) * 100 : null,
    );

    previousValue = totalValue;
    previousDate = date;
    filled += 1;
  }

  return filled;
}

/** 그날 종가로 낸 통화별 평가액 합(종목 통화 그대로). 가격을 모르는 종목이 있으면 null */
function nativeValues(
  positions: ReturnType<typeof listPositions>,
  seriesOf: Map<string, Candle[]>,
  date: string,
): Record<Currency, number> | null {
  const sum: Record<Currency, number> = { KRW: 0, USD: 0 };
  for (const position of positions) {
    const close = closeOn(seriesOf.get(position.symbol) ?? [], date);
    if (close == null) return null;
    sum[position.currency] += close * position.quantity;
  }
  return sum;
}

/**
 * 마지막 스냅샷에서 1달러 = N원을 역산한다(stock_value 는 계좌 통화).
 * 원화 계좌: stock_value = 원화 합 + 달러 합 × N → N = (stock_value − 원화 합) ÷ 달러 합.
 * 달러 계좌: stock_value = 달러 합 + 원화 합 ÷ N → N = 원화 합 ÷ (stock_value − 달러 합).
 * 「stock_value ÷ 종목 통화 합」 하나로 풀면 통화가 섞이거나 달러 계좌가 국내 종목만 들고 있을 때 틀린다.
 */
function estimateUsdKrw(
  last: SnapshotRow,
  positions: ReturnType<typeof listPositions>,
  seriesOf: Map<string, Candle[]>,
  accountCurrency: Currency,
): number | null {
  if (!last.stock_value) return null;
  const native = nativeValues(positions, seriesOf, last.date);
  if (!native) return null;
  const rate =
    accountCurrency === 'KRW'
      ? native.USD > 0 ? (last.stock_value - native.KRW) / native.USD : null
      : native.KRW > 0 ? native.KRW / (last.stock_value - native.USD) : null;
  return rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * 모든 계좌의 빠진 날짜를 채운다 (서버 기동 시 1회).
 * **계좌마다 따로** 감싼다(`recordToday` 와 같은 방식) — 하나로 감싸면 한 계좌가 실패할 때 그 뒤 계좌를 모두 건너뛰었다.
 * 실패한 계좌는 id 와 이유를 남기고 다음 계좌로. `fillOne` 은 시험이 실패를 만들 때만 넘긴다.
 */
export async function backfillSnapshots(
  fillOne: (accountId: number) => Promise<number> = backfillAccount,
): Promise<{ filledDays: number; filledAccounts: number; failed: number[] }> {
  const result = { filledDays: 0, filledAccounts: 0, failed: [] as number[] };
  let accounts: ReturnType<typeof listAccounts>;
  try {
    accounts = listAccounts();
  } catch (e) {
    // 보정 실패로 서버가 뜨지 않으면 안 된다.
    console.error('[paper] 스냅샷 보정 실패(계좌 목록):', e instanceof Error ? e.message : e);
    return result;
  }
  for (const account of accounts) {
    try {
      const days = await fillOne(account.id);
      if (days) {
        result.filledDays += days;
        result.filledAccounts += 1;
      }
    } catch (e) {
      result.failed.push(account.id);
      console.error(`[paper] 계좌 ${account.id} 스냅샷 보정 실패:`, e instanceof Error ? e.message : e);
    }
  }
  if (result.filledDays || result.failed.length) {
    console.log(`[paper] 스냅샷 보정 — ${result.filledAccounts}개 계좌 보정(${result.filledDays}일치) · ${result.failed.length}개 실패`);
  }
  return result;
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
export function startSnapshotScheduler(
  /**
   * 같은 10분 확인에 얹을 일 (지정 종목 Gemini 분석). 타이머를 새로 늘리지 않으려고 여기 얹는다.
   * 이 스케줄러는 AUTO_TRADING_ENABLED 와 무관하게 늘 돈다 — 얹는 쪽이 자기 스위치를 스스로 본다.
   */
  extra?: () => void,
): void {
  const check = () => {
    extra?.();
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
