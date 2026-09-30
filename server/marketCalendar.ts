/**
 * 휴장일 — 토스 `GET /api/v1/market-calendar/{US|KR}?date=YYYY-MM-DD` (v2.17.0).
 *
 * 응답은 그날·전 거래일·다음 거래일 셋뿐이다(범위 조회가 없다). 휴장일이면 그날의 세션이 전부 null
 * (미국 `regularMarket`, 국내 `integrated`) 이고, `nextBusinessDay` 가 다음 개장일을 준다.
 * 그래서 **다음 거래일을 따라가며** 거래일 목록을 만들고, 그 사이에 빠진 평일을 휴장일로 본다
 * (거래일 1개당 호출 1번, MARKET_INFO 3/s).
 *
 * - 범위: 지난달 1일 ~ 오늘 + 180일. **하루 1회** 갱신(`app_settings` 'marketCalendar.lastRefresh').
 * - 저장: `market_holidays(market, date)` + 확인한 범위(`app_settings` 'marketCalendar.coverage').
 * - 쓰는 곳: 실적 회피의 거래일 계산(`autoTrading/guards.ts`), 옵션 만기 "휴장이면 그 전 거래일", 일정 달력의 휴장 표시.
 * ⚠️ 범위 밖 날짜는 **주말만** 휴장으로 본다(모른다). `isMarketClosed` 는 범위 안에서만 확실하다.
 * - 미국은 **NYSE 공식 표(`src/data/nyseHolidays.ts`, 2026~2027)와 합친다** (v2.18.0) — 어느 한쪽이라도 휴장이면 휴장.
 *   둘 다 확인한 기간에 서로 다르면 `usHolidayMismatches()` 가 그 날짜를 돌려주고, 갱신 때 로그에 남긴다.
 */

import { getDb } from './db';
import { tossGet } from '../src/services/toss/httpClient';
import { isMockMode } from './mockData';
import { marketDate } from '../src/utils/marketDate';
import { NYSE_COVERAGE, NYSE_HOLIDAYS } from '../src/data/nyseHolidays';

const NYSE_SET = new Set(NYSE_HOLIDAYS.map((h) => h.date));

export type CalendarMarket = 'US' | 'KR';

const LAST_REFRESH_KEY = 'marketCalendar.lastRefresh';
const COVERAGE_KEY = 'marketCalendar.coverage';
const AHEAD_DAYS = 180;

interface DayRaw {
  date: string;
  regularMarket?: unknown;
  integrated?: unknown;
}
interface CalendarResponse {
  result?: { today?: DayRaw; previousBusinessDay?: DayRaw | null; nextBusinessDay?: DayRaw | null };
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isWeekend = (day: string) => {
  const w = new Date(`${day}T12:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

function readSetting<T>(key: string): T | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}
function writeSetting(key: string, value: unknown): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

type Coverage = Partial<Record<CalendarMarket, { from: string; to: string }>>;

/** 이 범위(from~to)의 휴장일을 토스에서 받아 저장한다. 반환: 찾은 휴장일 수 */
export async function refreshHolidays(market: CalendarMarket, from: string, to: string): Promise<number> {
  const business = new Set<string>();
  let cursor = addDays(from, -1);
  let guard = 0;
  while (cursor <= to && guard < 400) {
    guard += 1;
    const res = await tossGet<CalendarResponse>(`/api/v1/market-calendar/${market}`, { date: cursor }, 'MARKET_INFO');
    const today = res.result?.today;
    const open = market === 'US' ? today?.regularMarket : today?.integrated;
    if (today?.date && open) business.add(today.date);
    const next = res.result?.nextBusinessDay?.date;
    if (!next || next <= cursor) break;
    business.add(next);
    cursor = next;
  }
  const holidays: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWeekend(d) && !business.has(d)) holidays.push(d);
  }
  const db = getDb();
  db.prepare(`DELETE FROM market_holidays WHERE market = ? AND date BETWEEN ? AND ?`).run(market, from, to);
  const put = db.prepare(`INSERT OR IGNORE INTO market_holidays (market, date) VALUES (?, ?)`);
  for (const h of holidays) put.run(market, h);
  const coverage = readSetting<Coverage>(COVERAGE_KEY) ?? {};
  coverage[market] = { from, to };
  writeSetting(COVERAGE_KEY, coverage);
  return holidays.length;
}

export function coverageOf(market: CalendarMarket): { from: string; to: string } | null {
  return readSetting<Coverage>(COVERAGE_KEY)?.[market] ?? null;
}

function tossHolidays(market: CalendarMarket, from: string, to: string): string[] {
  return (
    getDb()
      .prepare(`SELECT date FROM market_holidays WHERE market = ? AND date BETWEEN ? AND ? ORDER BY date`)
      .all(market, from, to) as { date: string }[]
  ).map((r) => r.date);
}

/** 확인한 범위 안의 휴장일 목록 — 미국은 토스 ∪ NYSE */
export function listHolidays(market: CalendarMarket, from: string, to: string): string[] {
  const days = new Set(tossHolidays(market, from, to));
  if (market === 'US') for (const h of NYSE_HOLIDAYS) if (h.date >= from && h.date <= to) days.add(h.date);
  return [...days].sort();
}

/** 그날 장이 닫혀 있나 — 주말이거나, 토스가 확인한 휴장일이거나, (미국) NYSE 공식 휴장일 */
export function isMarketClosed(market: CalendarMarket, day: string): boolean {
  if (isWeekend(day)) return true;
  if (market === 'US' && NYSE_SET.has(day)) return true;
  return Boolean(getDb().prepare(`SELECT 1 FROM market_holidays WHERE market = ? AND date = ?`).get(market, day));
}

/**
 * 토스·NYSE 가 서로 다르게 말하는 날 — **둘 다 확인한 기간**(토스 범위 ∩ NYSE 표 범위)의 평일만 본다.
 * 한쪽만 아는 기간을 비교하면 "토스가 아직 안 받은 날" 이 전부 불일치로 나온다.
 */
export function usHolidayMismatches(): { date: string; nyse: boolean; toss: boolean }[] {
  const toss = coverageOf('US');
  if (!toss) return [];
  const from = toss.from > NYSE_COVERAGE.from ? toss.from : NYSE_COVERAGE.from;
  const to = toss.to < NYSE_COVERAGE.to ? toss.to : NYSE_COVERAGE.to;
  if (from > to) return [];
  const tossSet = new Set(tossHolidays('US', from, to).filter((d) => !isWeekend(d)));
  const nyseIn = NYSE_HOLIDAYS.map((h) => h.date).filter((d) => d >= from && d <= to);
  const out = new Map<string, { date: string; nyse: boolean; toss: boolean }>();
  for (const d of nyseIn) if (!tossSet.has(d)) out.set(d, { date: d, nyse: true, toss: false });
  for (const d of tossSet) if (!NYSE_SET.has(d)) out.set(d, { date: d, nyse: false, toss: true });
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** 오늘(KST) 이미 받았으면 건너뛴다 — 재시작해도 하루 한 번 */
export async function ensureDailyHolidays(now = Date.now()): Promise<'skipped' | Record<CalendarMarket, number>> {
  const today = marketDate(now, '005930');
  if (readSetting<string>(LAST_REFRESH_KEY) === today) return 'skipped';
  // 지난달 1일부터 — 달력에서 지난달을 넘겨 봐도 휴장이 보이게
  const [y, m] = today.split('-').map(Number);
  const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const to = addDays(today, AHEAD_DAYS);
  const us = await refreshHolidays('US', from, to);
  const kr = await refreshHolidays('KR', from, to);
  writeSetting(LAST_REFRESH_KEY, today);
  const mismatches = usHolidayMismatches();
  if (mismatches.length) {
    console.warn(
      `[calendar] 토스·NYSE 휴장일 불일치: ${mismatches.map((m) => `${m.date}(${m.nyse ? 'NYSE만 휴장' : '토스만 휴장'})`).join(', ')}`,
    );
  }
  return { US: us, KR: kr };
}

let running = false;

/** 하루 1회 — 기동 2분 뒤(카탈로그·실적과 겹치지 않게) + 6시간마다 확인. 실패는 로그만 */
export function startMarketCalendarScheduler(): void {
  if (isMockMode()) return;
  const tick = () => {
    if (running) return;
    running = true;
    ensureDailyHolidays()
      .then((r) => {
        if (r !== 'skipped') console.log(`[calendar] 휴장일 갱신 — 미국 ${r.US}일 · 국내 ${r.KR}일`);
      })
      .catch((e) => console.warn('[calendar] 휴장일 갱신 실패 — 다음 확인 때 다시 시도:', e instanceof Error ? e.message : e))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 120_000);
  setInterval(tick, 6 * 60 * 60_000);
}
