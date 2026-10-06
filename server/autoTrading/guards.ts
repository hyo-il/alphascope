/**
 * 자동매매 **신규 매수** 안전장치 (v2.16.0) — 실적 발표 직전 회피 · 하루 손실 한도(킬 스위치).
 *
 * ⚠️ 둘 다 **새로 사는 것만** 막는다. 보유 종목의 하드 손절·트레일링·AI/규칙 매도는 그대로 돈다 —
 * "막혔으니 아무것도 안 한다" 가 되면 손실이 난 계좌의 손절까지 멈춘다.
 * ⚠️ 값(실적 3거래일, 손실 한도)은 **앱의 출발값이지 검증된 값이 아니다.**
 */

import { getAccount, valuePositions } from '../paperTradingService';
import { getEarningsDate } from '../earningsCalendar';
import { readSetting, writeSetting } from '../gemini/store';
import { isKrSymbol } from '../../src/utils/market';
import { isMarketClosed, type CalendarMarket } from '../marketCalendar';
import { marketDate } from '../../src/utils/marketDate';
import type { AccountStrategy } from '../../src/types/autoTrading';

// ── 실적 발표 직전 회피 ─────────────────────────────────────────────────────

/** YYYY-MM-DD 가 주말인가 (UTC 정오로 요일만 본다) */
const isWeekend = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/**
 * from(오늘) 다음 날부터 to(발표일)까지의 거래일 수 — 발표일이 오늘이면 0, 지났으면 음수.
 * 시장을 주면 토스 휴장 달력(`marketCalendar.ts`)의 휴장일도 뺀다 (v2.17.0 — 그전에는 주말만 뺐다).
 * 달력으로 확인한 범위 밖은 주말만 뺀다.
 */
export function tradingDaysUntil(from: string, to: string, market?: CalendarMarket): number {
  if (to === from) return 0;
  if (to < from) return -1;
  let count = 0;
  const cursor = new Date(`${from}T12:00:00Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.toISOString().slice(0, 10);
    const closed = market ? isMarketClosed(market, day) : isWeekend(day);
    if (!closed) count += 1;
    if (day >= to) return count;
  }
}

/**
 * 실적 발표 N 거래일 전부터 발표일까지는 새로 사지 않는다.
 * - blocked: 매수를 건너뛸 사유
 * - note: 막지는 않지만 거래 사유에 덧붙일 말 ("실적일 미확인")
 *
 * 실적 전후 변동성 확대를 피하는 관행 — 값 3은 앱의 출발값(검증 전).
 */
export function earningsGuard(
  strategy: AccountStrategy,
  symbol: string,
  now = Date.now(),
): { blocked: string | null; note: string | null } {
  const days = strategy.earningsBlackoutDays;
  if (!days) return { blocked: null, note: null };
  const e = getEarningsDate(symbol);
  if (!e) return { blocked: null, note: '실적일 미확인' };
  const today = marketDate(now, symbol);
  const until = tradingDaysUntil(today, e.date, isKrSymbol(symbol) ? 'KR' : 'US');
  if (until < 0 || until > days) return { blocked: null, note: null };
  const label = `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8, 10))}${e.isEstimate ? '(예정)' : ''}`;
  const when = until === 0 ? '당일' : `${until}거래일 전`;
  return { blocked: `${symbol} 실적 발표 ${label} ${when} — 신규 매수 건너뜀`, note: null };
}

// ── 하루 손실 한도 (킬 스위치) ──────────────────────────────────────────────

const DAILY_LOSS_KEY = 'autoTrading.dailyLoss';

export interface DailyLossState {
  /** 이 기록의 거래일 (시장 날짜) */
  day: string;
  /** 그 거래일의 시작 평가액 */
  base: number;
  /** 마지막으로 잰 평가액 */
  current: number;
  /** (current − base) / base × 100 */
  drawdownPercent: number;
  /** 한도에 닿았나 — 닿으면 그 거래일 끝까지 유지된다 */
  hit: boolean;
  /** 닿았을 때의 하락률 */
  hitDrawdownPercent: number | null;
}

type LossMap = Record<string, DailyLossState>;

/**
 * 자동매매의 "하루" — 대상 종목이 전부 국내면 한국 거래일(KST), 아니면 미국 거래일(ET).
 * 자동매매 정규장 판정이 미국 기준이라 기본은 미국이다.
 */
export function strategyDay(strategy: AccountStrategy, now = Date.now()): string {
  const allKr = strategy.symbols.length > 0 && strategy.symbols.every(isKrSymbol);
  return marketDate(now, allKr ? '005930' : 'SPY');
}

export function readDailyLoss(accountId: number): DailyLossState | null {
  return readSetting<LossMap>(DAILY_LOSS_KEY, {})[String(accountId)] ?? null;
}

function writeDailyLoss(accountId: number, state: DailyLossState | null): void {
  const map = readSetting<LossMap>(DAILY_LOSS_KEY, {});
  if (state) map[String(accountId)] = state;
  else delete map[String(accountId)];
  writeSetting(DAILY_LOSS_KEY, map);
}

/** 계좌 평가액 (현금 + 주식, 계좌 통화) */
async function accountValue(accountId: number): Promise<number> {
  const account = getAccount(accountId);
  const { stockValue } = await valuePositions(accountId, account.currency);
  return account.currentCash + stockValue;
}

/**
 * 매 틱(청산 검사 뒤) 부른다. 한도 0 이면 기록을 지우고 null.
 *
 * **기준 평가액** = 그 거래일에 처음 잰 평가액. 스케줄러는 하루 종일 1분마다 돌아서, 거래일이 바뀐 직후
 * (미국은 ET 자정)의 첫 평가가 곧 **전 거래일 마감 평가액**이다. 재시작해도 기준이 바뀌지 않게 저장한다.
 * (`paper_snapshots` 는 KST 날짜 기준이라 미국 거래일과 맞지 않아 쓰지 않았다.)
 * 한도에 닿으면 그 거래일 끝까지 `hit` 를 유지하고, 날짜가 바뀌면 새 기록으로 저절로 풀린다.
 */
export async function evaluateDailyLoss(
  strategy: AccountStrategy,
  now = Date.now(),
  valueOf: (accountId: number) => Promise<number> = accountValue,
): Promise<DailyLossState | null> {
  const limit = strategy.dailyLossLimitPercent;
  if (!limit) {
    if (readDailyLoss(strategy.accountId)) writeDailyLoss(strategy.accountId, null);
    return null;
  }
  const day = strategyDay(strategy, now);
  const current = await valueOf(strategy.accountId);
  const previous = readDailyLoss(strategy.accountId);
  const base = previous && previous.day === day ? previous.base : current;
  const drawdownPercent = base > 0 ? ((current - base) / base) * 100 : 0;
  const alreadyHit = Boolean(previous && previous.day === day && previous.hit);
  const hit = alreadyHit || drawdownPercent <= -limit;
  const state: DailyLossState = {
    day,
    base,
    current,
    drawdownPercent,
    hit,
    hitDrawdownPercent: alreadyHit ? previous!.hitDrawdownPercent : hit ? drawdownPercent : null,
  };
  writeDailyLoss(strategy.accountId, state);
  return state;
}

/** 지금 이 계좌의 신규 매수가 킬 스위치로 막혔나 — 막혔으면 사람이 읽는 사유 */
export function dailyLossBlock(strategy: AccountStrategy, now = Date.now()): string | null {
  if (!strategy.dailyLossLimitPercent) return null;
  const state = readDailyLoss(strategy.accountId);
  if (!state || !state.hit || state.day !== strategyDay(strategy, now)) return null;
  return `하루 손실 한도 −${strategy.dailyLossLimitPercent}% 도달(현재 ${state.drawdownPercent.toFixed(2)}%) — 오늘은 새로 매수하지 않습니다`;
}
