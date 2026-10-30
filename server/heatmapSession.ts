/**
 * 종목 지도 전용 「거래 시간대」 — 1일 지도를 10초마다 다시 받을지 · 등락률을 무엇에 견줄지 (v2.56.0).
 * ⚠️ 자동매매가 쓰는 정규장 판단(`marketHours.isMarketOpen` · `nextMarketOpen`)과 **다른 것**이다 — 그쪽은 바꾸지 않는다.
 *
 * 시간표 = 토스 `/market-calendar/{US|KR}?date=<한국 날짜>` 의 세션 칸(2026-10-22 실제 응답 — 시각은 한국 시간, 서머타임 중):
 * - 미국(토스 날짜 D 하나에 넷): dayMarket 주간거래 09:00~17:00 · preMarket 17:00~22:30 · regularMarket 22:30~05:00 · afterMarket 05:00~08:50.
 *   주간거래는 전날 20:00 ET 에 시작해 토스 날짜 D 에 속한다(가격 날 `previousClose.priceDay` 가 20:00 ET 에 넘어가는 것과 같다).
 * - 국내 integrated: preMarket 08:00~09:00(08:50 부터 단일가 — 「정규장 시작 전」) · regularMarket 09:00~15:30 · afterMarket 15:30~20:00.
 * - 응답은 전 · 오늘 · 다음 거래일 셋이라 한국 날짜로 하루 한 번(시장마다 MARKET_INFO 1번) 받으면 지금과 다음 세션이 다 들어 있다.
 *   휴장일 · 조기 마감은 토스 응답을 따른다. 받지 못하면(모의 · 실패, 5분 뒤 다시) **고정표**(`fixedSpanAt`)를 쓴다.
 * - 보조 판단: 시간표로는 닫혔는데 그 시장 종목의 토스 `/prices` `timestamp`(마지막 체결 시각)가 2분 안이면 「장외 거래」 로 연다
 *   (닫힌 동안에만 묻고 1분 캐시 — 화면은 닫힌 동안 1분마다 다시 묻는다).
 *
 * 등락률 기준(`basisOf` · `baseClose`): 미국 애프터마켓만 **오늘 정규장 종가**(오늘 일봉이 확정된 뒤 — 정규장 끝 + `CONFIRM_MARGIN_MS`).
 * 그 밖(미국 프리 · 정규 · 주간거래, 국내 모든 시간)은 전 거래일 종가 그대로. 공용 `previousClose` 의 결과는 바꾸지 않는다
 * (관심 목록 · 차트 머리 현재가는 애프터마켓에도 전일 종가 대비 — 지도와 다를 수 있다).
 */

import { getCandles } from './candleService';
import { CONFIRM_MARGIN_MS, dailyFetchedAt, loadCandles } from './db';
import { isMarketClosed, type CalendarMarket } from './marketCalendar';
import { marketDayTime, marketOf } from './marketHours';
import { previousClose, previousCloseForDay } from './previousClose';
import { readUniverse } from './universe';
import { isMockMode } from './mockData';
import { tossGet } from '../src/services/toss/httpClient';
import { marketDate } from '../src/utils/marketDate';
import type { HeatmapBasis, HeatmapSession } from '../src/types/heatmap';

/** 세션 한 칸 — [start, end) epoch ms. tradeDay = 그 세션이 속한 거래일(토스 날짜 · 고정표는 그 시장 날짜) */
export interface SessionSpan {
  session: HeatmapSession;
  label: string;
  start: number;
  end: number;
  tradeDay: string | null;
  /** 장외 거래(other)일 때 — 바로 앞에 끝난 시간표 세션(미국 애프터 뒤 틈이면 오늘 종가 기준을 이어 간다) */
  follows?: SessionSpan;
}

export interface SessionInfo {
  /** 지금 세션 — null 이면 닫힘(「장 마감」) */
  span: SessionSpan | null;
  /** 다음 세션 시작(epoch ms) — 닫힌 화면이 이 시각 5초 뒤 한 번 다시 묻는다 */
  nextStart: number;
  /** 시간표 출처 — toss: 토스 달력 · fixed: 고정표 */
  source: 'toss' | 'fixed';
}

const LABELS: Record<CalendarMarket, Partial<Record<HeatmapSession, string>>> = {
  US: { day: '주간거래', pre: '프리마켓', regular: '정규장', after: '애프터마켓' },
  KR: { pre: 'NXT 프리마켓', regular: '정규장', after: 'NXT 애프터마켓' },
};
const OTHER_LABEL = '장외 거래';
const KR_PRE_AUCTION_LABEL = '정규장 시작 전';

/** 보조 판단 — 마지막 체결이 이만큼 안이면 거래 중으로 본다 */
export const RECENT_TRADE_MS = 2 * 60_000;
/** 체결 시각이 서버 시계보다 이만큼 넘게 앞이면 믿지 않는다(이상한 값으로 밤새 「열림」 이 되지 않게) */
const FUTURE_TRADE_MS = 60_000;
const PROBE_TTL_MS = 60_000;
const PROBE_SYMBOLS = 5;
const CALENDAR_RETRY_MS = 5 * 60_000;
/** 토스 달력 한 번 받기 시간 제한 — 넘기면 받기 실패와 같이 고정표(종목 지도 · 거래정지 · 오늘 시황 「발표됨」 이 이 캐시를 기다린다) */
export const CALENDAR_TIMEOUT_MS = 10_000;
let calendarTimeoutMs = CALENDAR_TIMEOUT_MS;
const RETRY_MS = 5 * 60_000;

// ── 토스 달력 → 세션 칸 ─────────────────────────────────────────────────────

interface TossRange {
  startTime?: string;
  endTime?: string;
  singlePriceAuctionStartTime?: string;
}
interface TossDay {
  date?: string;
  dayMarket?: TossRange | null;
  preMarket?: TossRange | null;
  regularMarket?: TossRange | null;
  afterMarket?: TossRange | null;
  integrated?: { preMarket?: TossRange | null; regularMarket?: TossRange | null; afterMarket?: TossRange | null } | null;
}
export interface TossCalendarResponse {
  result?: { today?: TossDay | null; previousBusinessDay?: TossDay | null; nextBusinessDay?: TossDay | null };
}

/** 토스 달력 응답 → 세션 칸(시작 순). 모양이 다르거나 시각이 틀린 칸은 버린다 */
export function spansFromToss(market: CalendarMarket, res: TossCalendarResponse): SessionSpan[] {
  const out: SessionSpan[] = [];
  const push = (session: HeatmapSession, label: string, start: number, end: number, tradeDay: string) => {
    if (Number.isFinite(start) && Number.isFinite(end) && start < end) out.push({ session, label, start, end, tradeDay });
  };
  const days = [res.result?.previousBusinessDay, res.result?.today, res.result?.nextBusinessDay];
  for (const d of days) {
    if (!d?.date) continue;
    const range = (r: TossRange | null | undefined) => [Date.parse(r?.startTime ?? ''), Date.parse(r?.endTime ?? '')] as const;
    if (market === 'US') {
      for (const [key, session] of [['dayMarket', 'day'], ['preMarket', 'pre'], ['regularMarket', 'regular'], ['afterMarket', 'after']] as const) {
        const [s, e] = range(d[key]);
        push(session, LABELS.US[session]!, s, e, d.date);
      }
    } else {
      const i = d.integrated;
      const [ps, pe] = range(i?.preMarket);
      const auction = Date.parse(i?.preMarket?.singlePriceAuctionStartTime ?? '');
      // 08:50~09:00 은 정규장 시작 단일가 — 갱신은 계속하되 이름을 나눈다
      if (Number.isFinite(auction) && auction > ps && auction < pe) {
        push('pre', LABELS.KR.pre!, ps, auction, d.date);
        push('pre', KR_PRE_AUCTION_LABEL, auction, pe, d.date);
      } else push('pre', LABELS.KR.pre!, ps, pe, d.date);
      const [rs, re] = range(i?.regularMarket);
      push('regular', LABELS.KR.regular!, rs, re, d.date);
      const [as, ae] = range(i?.afterMarket);
      push('after', LABELS.KR.after!, as, ae, d.date);
    }
  }
  const seen = new Set<number>();
  return out.sort((a, b) => a.start - b.start).filter((s) => !seen.has(s.start) && seen.add(s.start));
}

// ── 고정표 (토스 달력을 못 받을 때) ─────────────────────────────────────────

const TZ: Record<CalendarMarket, string> = { US: 'America/New_York', KR: 'Asia/Seoul' };

function localParts(market: CalendarMarket, t: number): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ[market], year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(t);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

/** [시작 분, 끝 분, 세션, 이름] — 그 시장 시각. 미국 주간거래는 고정표에 없다(보조 판단으로만 연다) */
const FIXED: Record<CalendarMarket, [number, number, HeatmapSession, string][]> = {
  US: [
    [4 * 60, 9 * 60 + 30, 'pre', LABELS.US.pre!],
    [9 * 60 + 30, 16 * 60, 'regular', LABELS.US.regular!],
    [16 * 60, 20 * 60, 'after', LABELS.US.after!],
  ],
  KR: [
    [8 * 60, 8 * 60 + 50, 'pre', LABELS.KR.pre!],
    [8 * 60 + 50, 9 * 60, 'pre', KR_PRE_AUCTION_LABEL],
    [9 * 60, 15 * 60 + 30, 'regular', LABELS.KR.regular!],
    [15 * 60 + 30, 20 * 60, 'after', LABELS.KR.after!],
  ],
};

/** 고정표의 그 시각 세션 — 그 시장 날짜가 휴장(주말 포함)이면 null */
function fixedSpanAt(market: CalendarMarket, t: number): SessionSpan | null {
  const { day, minutes } = localParts(market, t);
  if (isMarketClosed(market, day)) return null;
  const row = FIXED[market].find(([s, e]) => minutes >= s && minutes < e);
  if (!row) return null;
  const [s, e, session, label] = row;
  return { session, label, start: marketDayTime(market, day, s * 60_000), end: marketDayTime(market, day, e * 60_000), tradeDay: day };
}

const FIXED_STEP_MS = 5 * 60_000;
/** 고정표에서 now 뒤 처음 시작하는 세션(그 조건에 맞는 것) — 경계는 모두 5분 단위라 5분씩 넘기며 찾는다(14일 안 · 없으면 null) */
function fixedNextSpan(market: CalendarMarket, now: number, match: (s: SessionSpan) => boolean = () => true): SessionSpan | null {
  let t = Math.floor(now / FIXED_STEP_MS) * FIXED_STEP_MS + FIXED_STEP_MS;
  for (let k = 0; k < 14 * 288; k++, t += FIXED_STEP_MS) {
    const f = fixedSpanAt(market, t);
    if (f?.start === t && match(f)) return f;
  }
  return null;
}

/** 고정표의 다음 세션 시작 — 14일 안에 없으면 찾기를 멈춘 시각 */
function fixedNextStart(market: CalendarMarket, now: number): number {
  return fixedNextSpan(market, now)?.start ?? Math.floor(now / FIXED_STEP_MS) * FIXED_STEP_MS + FIXED_STEP_MS * (14 * 288 + 1);
}

// ── 토스 달력 캐시 ──────────────────────────────────────────────────────────

let fetchCalendar: (market: CalendarMarket, day: string) => Promise<TossCalendarResponse | null> = async (market, day) =>
  isMockMode() ? null : tossGet<TossCalendarResponse>(`/api/v1/market-calendar/${market}`, { date: day }, 'MARKET_INFO');

const calendarCache = new Map<CalendarMarket, { day: string; spans: SessionSpan[] | null; retryAt: number; pending?: Promise<void> }>();

/** 한국 날짜로 하루 한 번 — 실패 · 빈 응답이면 null(고정표), 5분 뒤 다시 */
async function tossSpans(market: CalendarMarket, now: number): Promise<SessionSpan[] | null> {
  const day = marketDate(now, '005930');
  let c = calendarCache.get(market);
  if (!c || c.day !== day || (c.spans == null && Date.now() >= c.retryAt)) {
    if (!c?.pending || c.day !== day) {
      const entry: { day: string; spans: SessionSpan[] | null; retryAt: number; pending?: Promise<void> } = c && c.day === day ? c : { day, spans: null, retryAt: 0 };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${calendarTimeoutMs / 1000}초 안에 응답 없음`)), calendarTimeoutMs);
      });
      entry.pending = Promise.race([fetchCalendar(market, day), timeout])
        .then((res) => {
          const spans = res ? spansFromToss(market, res) : [];
          entry.spans = spans.length ? spans : null;
          if (res && !spans.length) console.warn(`[heatmapSession] ${market} 토스 달력에 세션 칸이 없습니다 — 고정표를 씁니다`);
        })
        .catch((e) => {
          entry.spans = null;
          console.warn(`[heatmapSession] ${market} 토스 달력 받기 실패 — 고정표를 씁니다:`, e instanceof Error ? e.message : e);
        })
        .finally(() => {
          clearTimeout(timer);
          entry.retryAt = Date.now() + CALENDAR_RETRY_MS;
          entry.pending = undefined;
        });
      calendarCache.set(market, entry);
      c = entry;
    }
    await c.pending;
  }
  return calendarCache.get(market)?.spans ?? null;
}

// ── 보조 판단: 최근 체결 ─────────────────────────────────────────────────────

/** 그 시장 대표 종목들(유니버스 앞 5개)의 가장 늦은 체결 시각(ms) — 모르면 null */
let probeLastTrade: (market: CalendarMarket) => Promise<number | null> = async (market) => {
  if (isMockMode()) return null;
  let symbols: string[] = [];
  try {
    const u = readUniverse();
    symbols = (market === 'US' ? u.us : u.kr).slice(0, PROBE_SYMBOLS).map((e) => e.symbol);
  } catch {
    return null;
  }
  if (!symbols.length) return null;
  const r = await tossGet<{ result?: { timestamp?: string }[] }>('/api/v1/prices', { symbols: symbols.join(',') }, 'MARKET_DATA');
  const ts = (r.result ?? []).map((x) => Date.parse(x.timestamp ?? '')).filter(Number.isFinite);
  return ts.length ? Math.max(...ts) : null;
};
const probeCache = new Map<CalendarMarket, { at: number; value: Promise<number | null> }>();

function lastTradeAt(market: CalendarMarket): Promise<number | null> {
  const hit = probeCache.get(market);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) return hit.value;
  const value = probeLastTrade(market).catch((e) => {
    console.warn(`[heatmapSession] ${market} 최근 체결 확인 실패:`, e instanceof Error ? e.message : e);
    return null;
  });
  probeCache.set(market, { at: Date.now(), value });
  return value;
}

// ── 지금 세션 ───────────────────────────────────────────────────────────────

/**
 * 종목 지도의 지금 세션 — **이 함수 한 곳**(지도 응답의 `marketOpen` · `session` · `nextOpen` · 캐시 길이 · 등락률 기준).
 * 시간표(토스 → 고정표)에 없으면 보조 판단(최근 2분 체결)으로 「장외 거래」 — 미국은 고정표일 때 20:00~04:00 ET 를 「주간거래」 로 부른다.
 */
export async function heatmapSession(market: CalendarMarket, now = Date.now(), options: { probe?: boolean } = {}): Promise<SessionInfo> {
  const spans = await tossSpans(market, now);
  const source = spans ? 'toss' : 'fixed';
  let span = spans ? (spans.find((s) => s.start <= now && now < s.end) ?? null) : fixedSpanAt(market, now);
  const nextFromToss = spans?.find((s) => s.start > now)?.start;
  const nextStart = nextFromToss ?? fixedNextStart(market, now);
  // 보조 판단은 1일 지도만(1주 이상은 /prices 를 부르지 않는다)
  if (!span && options.probe !== false) {
    const last = await lastTradeAt(market);
    if (last != null && now - last <= RECENT_TRADE_MS && last - now <= FUTURE_TRADE_MS) {
      const m = localParts(market, now).minutes;
      const day = market === 'US' && source === 'fixed' && (m >= 20 * 60 || m < 4 * 60);
      const follows = spans?.filter((s) => s.end <= now).at(-1);
      span = { session: day ? 'day' : 'other', label: day ? LABELS.US.day! : OTHER_LABEL, start: last, end: nextStart, tradeDay: null, follows };
    }
  }
  return { span, nextStart, source };
}

/**
 * 다음 그 세션 한 칸(지금 진행 중인 것은 빼고) — `heatmapSession` 과 **같은 시간표**(토스 달력 캐시 → 못 받으면 고정표)를 읽기만 한다.
 * 거래정지 화면 「다음 정규장 MM-DD HH:MM」 이 쓴다(판단은 `heatmapSession` 그대로 — 이 함수는 시각만 찾는다). 14일 안에 없으면 null.
 */
export async function nextSessionSpan(market: CalendarMarket, session: HeatmapSession, now = Date.now()): Promise<{ start: number; end: number } | null> {
  const spans = await tossSpans(market, now);
  const hit = spans?.find((s) => s.session === session && s.start > now);
  if (hit) return { start: hit.start, end: hit.end };
  // 토스 칸에 없으면 고정표(조기 마감은 모른다 — 끝 시각이 16:00 ET 로 나올 수 있다. 판단 regularOpen 은 heatmapSession 그대로)
  const f = fixedNextSpan(market, now, (x) => x.session === session);
  return f ? { start: f.start, end: f.end } : null;
}

/**
 * 그 거래일(tradeDay — 그 시장 날짜)의 정규장 끝 시각(epoch ms) — `heatmapSession` 과 **같은 시간표**(토스 달력 캐시 → 못 받으면 고정표)를 읽기만 한다.
 * 토스 칸은 조기 마감(미국 13:00 ET 등)을 반영한다 · 고정표는 모른다. 휴장일(주말 포함)이면 null.
 * 오늘 시황 「발표됨」(그 날 미국 정규장이 끝났나)이 쓴다(v2.59.4).
 */
export async function regularSessionEnd(market: CalendarMarket, tradeDay: string, now = Date.now()): Promise<number | null> {
  const spans = await tossSpans(market, now);
  const hit = spans?.find((s) => s.session === 'regular' && s.tradeDay === tradeDay);
  if (hit) return hit.end;
  if (isMarketClosed(market, tradeDay)) return null;
  const row = FIXED[market].find(([, , session]) => session === 'regular');
  return row ? marketDayTime(market, tradeDay, row[1] * 60_000) : null;
}

// ── 등락률 기준 ─────────────────────────────────────────────────────────────

export interface BasisInfo {
  basis: HeatmapBasis;
  /** 지도 아래 문구 — 「전일 종가 대비」 등 */
  label: string;
}

const BASIS_LABEL: Record<HeatmapBasis, string> = { prev: '전일 종가 대비', today: '오늘 종가 대비', recent: '최근 종가 대비' };

/** 기준을 정하는 세션 — 장외 거래가 미국 애프터 바로 뒤 틈(토스 19:50~20:00 ET)이면 그 애프터 */
const basisSpan = (span: SessionSpan | null): SessionSpan | null => (span?.session === 'other' && span.follows?.session === 'after' ? span.follows : span);

/**
 * 세션별 기준 — 미국 애프터마켓(과 그 바로 뒤 장외 거래)은 오늘 정규장 종가(정규장 끝 + 10분 뒤부터 — 그 전에는 오늘 봉이 확정 전이라 전일 종가 그대로),
 * 미국 주간거래 · 그 밖 장외 거래는 「최근 종가」(= 가장 최근 정규장 종가 — 가격 날이 20:00 ET 에 넘어가 `previousClose` 가 그 값), 그 밖(국내 장외 거래 포함)은 전일 종가.
 */
export function basisOf(market: CalendarMarket, info: SessionInfo, now: number): BasisInfo {
  const span = basisSpan(info.span);
  let basis: HeatmapBasis = 'prev';
  if (market === 'US' && span?.session === 'after' && now >= span.start + CONFIRM_MARGIN_MS) basis = 'today';
  else if (market === 'US' && (span?.session === 'day' || span?.session === 'other')) basis = 'recent';
  return { basis, label: BASIS_LABEL[basis] };
}

// 오늘 정규장 종가 — 종목 · 날짜마다 한 번(확정된 봉을 찾을 때까지 5분 간격으로 일봉을 다시 받는다)
let refreshDaily: (symbol: string) => Promise<unknown> = (symbol) => getCandles(symbol, '1d', 5);
const todayMemo = new Map<string, number>();
const todayTried = new Map<string, number>();
const todayInflight = new Map<string, Promise<number | null>>();

/** 캐시에서 그 날짜 일봉 종가 — `confirmAt` 뒤에 받은 값(마감 뒤 확정된 값)일 때만 */
function confirmedClose(symbol: string, day: string, confirmAt: number): number | null {
  const bar = loadCandles(symbol, '1d', 10).find((c) => marketDate(c.timestamp, symbol) === day);
  if (!bar || !(bar.close > 0)) return null;
  const fetched = dailyFetchedAt(symbol, bar.timestamp);
  return fetched != null && fetched >= confirmAt ? bar.close : null;
}

/** `day` 의 정규장 종가(토스 미국 일봉 종가 = 정규장 종가). 확정된 값이 없으면 null — 전일 종가로 대신하지 않는다(기준을 섞지 않는다) */
export async function regularCloseOn(symbol: string, day: string, confirmAt: number): Promise<number | null> {
  const key = `${symbol}|${day}`;
  const hit = todayMemo.get(key);
  if (hit !== undefined) return hit;
  const cached = confirmedClose(symbol, day, confirmAt);
  if (cached !== null) {
    todayMemo.set(key, cached);
    return cached;
  }
  const last = todayTried.get(key);
  if (last !== undefined && Date.now() - last < RETRY_MS) return null;
  let pending = todayInflight.get(key);
  if (!pending) {
    pending = (async () => {
      todayTried.set(key, Date.now());
      try {
        await refreshDaily(symbol);
      } catch (e) {
        console.warn(`[heatmapSession] ${symbol} 일봉 다시 받기 실패:`, e instanceof Error ? e.message : e);
      }
      const value = confirmedClose(symbol, day, confirmAt);
      if (value !== null) {
        todayTried.delete(key);
        todayMemo.set(key, value);
        if (todayMemo.size > 2000) todayMemo.clear();
      }
      return value;
    })().finally(() => todayInflight.delete(key));
    todayInflight.set(key, pending);
  }
  return pending;
}

/**
 * 1일 지도 한 종목의 기준 종가. 오늘 종가 기준이면 `regularCloseOn`, 미국은 세션의 거래일(토스 날짜) 바로 앞 영업일 종가,
 * 그 밖은 공용 `previousClose`(관심 목록 · 차트 머리와 같은 값).
 */
export async function baseClose(symbol: string, now: number, info: SessionInfo, basis: BasisInfo): Promise<number | null> {
  const span = basisSpan(info.span);
  if (basis.basis === 'today' && span?.tradeDay) return regularCloseOn(symbol, span.tradeDay, span.start + CONFIRM_MARGIN_MS);
  if (span?.tradeDay && span.session !== 'regular' && marketOf(symbol) === 'US') return previousCloseForDay(symbol, span.tradeDay);
  return previousClose(symbol, now);
}

// ── 시험용 ──────────────────────────────────────────────────────────────────

/** 점검(`npm run heatmapsession:test`)이 바꿔 끼우는 자리 — null 이면 기본(토스) */
export function setSessionHooksForTest(hooks: {
  calendar?: ((market: CalendarMarket, day: string) => Promise<TossCalendarResponse | null>) | null;
  lastTrade?: ((market: CalendarMarket) => Promise<number | null>) | null;
  refreshDaily?: ((symbol: string) => Promise<unknown>) | null;
  /** 달력 시간 제한(ms) — null 이면 기본 10초 */
  calendarTimeoutMs?: number | null;
}): void {
  if (hooks.calendar !== undefined) fetchCalendar = hooks.calendar ?? defaults.calendar;
  if (hooks.calendarTimeoutMs !== undefined) calendarTimeoutMs = hooks.calendarTimeoutMs ?? CALENDAR_TIMEOUT_MS;
  if (hooks.lastTrade !== undefined) probeLastTrade = hooks.lastTrade ?? defaults.lastTrade;
  if (hooks.refreshDaily !== undefined) refreshDaily = hooks.refreshDaily ?? defaults.refreshDaily;
  resetHeatmapSessionForTest();
}
const defaults = { calendar: fetchCalendar, lastTrade: probeLastTrade, refreshDaily };

export function resetHeatmapSessionForTest(): void {
  calendarCache.clear();
  probeCache.clear();
  todayMemo.clear();
  todayTried.clear();
  todayInflight.clear();
}
