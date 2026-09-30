/**
 * 주요 일정 — `GET /api/calendar?from=&to=&scope=watchlist|universe` 한 곳으로 모은다 (v2.17.0).
 *
 * | 일정 | 출처 |
 * | 실적 발표 | `earnings_calendar`(v2.16.0) — 추정일은 isEstimate |
 * | FOMC | `src/data/fomc.ts` 상수(연준 공식 일정표) |
 * | 월간 옵션 만기 | 매월 셋째 금요일 — 미국 휴장이면 그 전 거래일 |
 * | 분기 동시 만기 | 3·6·9·12월 셋째 금요일 |
 * | 휴장일 | `market_holidays`(토스 market-calendar, `marketCalendar.ts`) |
 *
 * ⚠️ 판정은 없다 — 달력에 보여 줄 날짜만 모은다. 자동매매의 실적 회피는 `autoTrading/guards.ts` 가 따로 본다.
 */

import { getDb } from './db';
import { findStock } from './stockCatalog';
import { watchlistSymbols } from './analysis/targetHit';
import { readUniverse } from './universe';
import { coverageOf, isMarketClosed, listHolidays, usHolidayMismatches } from './marketCalendar';
import { NYSE_COVERAGE, NYSE_SOURCE, NYSE_STALE_AFTER } from '../src/data/nyseHolidays';
import { FOMC_MEETINGS, FOMC_SOURCE, FOMC_STALE_AFTER } from '../src/data/fomc';
import { marketDate } from '../src/utils/marketDate';
import type { CalendarEvent, CalendarResponse, CalendarScope } from '../src/types/calendar';

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 그 달의 셋째 금요일 */
export function thirdFriday(year: number, month: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (5 - first.getUTCDay() + 7) % 7; // 첫 금요일까지
  return new Date(Date.UTC(year, month - 1, 1 + offset + 14, 12)).toISOString().slice(0, 10);
}

/** 옵션 만기일 — 셋째 금요일, 미국 휴장이면 그 전 거래일 */
export function optionExpiry(year: number, month: number): { date: string; shifted: boolean } {
  let date = thirdFriday(year, month);
  let shifted = false;
  while (isMarketClosed('US', date)) {
    date = addDays(date, -1);
    shifted = true;
  }
  return { date, shifted };
}

function scopeSymbols(scope: CalendarScope): Set<string> {
  const set = new Set<string>();
  try {
    for (const s of watchlistSymbols()) set.add(s.toUpperCase());
  } catch {
    /* 관심 목록이 없으면 비어 있다 */
  }
  if (scope === 'universe') {
    try {
      const u = readUniverse();
      for (const e of [...u.us, ...u.kr]) set.add(e.symbol.toUpperCase());
    } catch {
      /* 유니버스 파일이 없으면 관심 목록만 */
    }
  }
  return set;
}

export function calendarEvents(from: string, to: string, scope: CalendarScope, now = Date.now()): CalendarResponse {
  const today = marketDate(now, '005930');
  const events: CalendarEvent[] = [];

  // 실적 발표
  const symbols = scopeSymbols(scope);
  const rows = getDb()
    .prepare(`SELECT symbol, earnings_date, is_estimate FROM earnings_calendar WHERE earnings_date BETWEEN ? AND ?`)
    .all(from, to) as { symbol: string; earnings_date: string; is_estimate: number | null }[];
  for (const r of rows) {
    if (!symbols.has(r.symbol)) continue;
    events.push({
      date: r.earnings_date,
      type: 'earnings',
      symbol: r.symbol,
      name: findStock(r.symbol)?.name ?? null,
      label: r.is_estimate === 1 ? '실적 발표 예정(추정 가능)' : '실적 발표',
      isEstimate: r.is_estimate === 1,
      past: r.earnings_date < today,
    });
  }

  // FOMC — 결정 발표일(둘째 날)에 둔다
  for (const m of FOMC_MEETINGS) {
    if (m.end < from || m.end > to) continue;
    const range = `${Number(m.start.slice(5, 7))}/${Number(m.start.slice(8))}–${Number(m.end.slice(8))}`;
    events.push({
      date: m.end,
      type: 'fomc',
      label: `FOMC 금리 결정 (${range} 회의)${m.sep ? ' · 경제전망 발표' : ''}`,
      past: m.end < today,
    });
  }

  // 옵션 만기 — 범위에 걸친 달마다
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const { date, shifted } = optionExpiry(y, m);
    if (date < from || date > to) continue;
    const quarterly = m % 3 === 0;
    events.push({
      date,
      type: 'expiry',
      label: `${quarterly ? '분기 동시 만기' : '월간 옵션 만기'}${shifted ? ' (셋째 금요일 휴장 → 전 거래일)' : ''}`,
      quarterly,
      past: date < today,
    });
  }

  // 휴장일
  for (const market of ['US', 'KR'] as const) {
    for (const date of listHolidays(market, from, to)) {
      events.push({ date, type: 'holiday', market, label: `${market === 'US' ? '미국' : '국내'} 휴장`, past: date < today });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  return {
    from,
    to,
    scope,
    events,
    meta: {
      today,
      fomcStale: today > FOMC_STALE_AFTER,
      fomcSource: FOMC_SOURCE,
      holidays: { US: coverageOf('US'), KR: coverageOf('KR') },
      nyse: {
        coverage: NYSE_COVERAGE,
        source: NYSE_SOURCE,
        stale: today > NYSE_STALE_AFTER,
        mismatches: usHolidayMismatches().map((m) => m.date),
      },
      scopeSize: symbols.size,
    },
  };
}
