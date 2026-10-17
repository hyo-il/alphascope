/**
 * 전 거래일 종가(기준가) — 관심 목록 시세(`quoteService`) · 종목 지도(`heatmap`) · 차트 머리 현재가(`/api/prices`)가 함께 쓴다.
 *
 * ⚠️ 지키는 것 세 가지 (2026-10-15 사본 DB · 토스 응답으로 재현한 버그 — `npm run prevclose:test`):
 *  1. "오늘보다 앞선 마지막 캐시 봉" 을 쓰고 캐시가 5일 안이면 다시 받지 않으면 — 어제 봉이 캐시에 없을 때 **그저께 종가**를 쓴다
 *     (SK하이닉스 −10% 가 −21%). 그래서 **날짜로 확인한다.**
 *  2. 미국의 「오늘」 을 뉴욕 달력 날짜로 잡지 않는다 — 토스는 애프터마켓이 끝나는 **20:00 ET(한국 아침 9시)에 다음 거래일**로 넘어간다.
 *     그렇게 잡으면 한국 낮에 미국 등락률이 이틀치가 된다(NVDA −4.23% vs 토스 −1.10%).
 *  3. 국내 일봉 종가는 KRX+NXT 통합 종가(20:00)라 토스의 기준가(KRX 정규장 종가)와 다르다(000660 1,425,000 vs 1,419,000).
 *
 * 순서:
 *  ① **토스 `/rankings` 의 `basePrice`**(시장 거래대금·거래량 · 토스증권 거래대금·거래량 상위 — 명세: "항상 전일 기준가") — 거래소 기준가 그대로라 1순위.
 *     토스 `/prices` · `/price-limits` · `/stocks` 에는 기준가 칸이 없다(2026-10-15 실제 응답·명세 1.2.24 확인). 시장마다 `RANKING_TTL_MS` 캐시.
 *  ② (국내만) 순위에 없는 종목 — 토스 `/price-limits` 의 상·하한가에서 **기준가를 거꾸로 푼다**. KRX 가격제한 = 기준가 ± (기준가 × 30% 를 호가단위로 절사),
 *     상한가는 그 가격의 호가단위로 내림·하한가는 올림이라, 호가단위 표(`krTick`)로 두 값을 모두 만드는 기준가를 찾는다. 답이 하나면 그 값,
 *     인접 호가 둘 이상이면 일봉 종가에 가장 가까운 것, 답이 없으면(ETF·레버리지 등 다른 규칙) ③ 으로. 일봉 종가와 5% 넘게 다르면 쓰지 않는다.
 *     검증(2026-10-15, 국내 순위 199종목의 기준가와 비교): 답 하나 135 — 모두 일치(틀림 0) · 여럿 3 · 해 없음 61(ETF 등).
 *  ③ 「가격 날」 바로 앞 영업일의 일봉 종가. 가격 날 = 그 시장의 토스 거래일(국내 08:00 KST · 미국 20:00 ET 에 넘어간다),
 *     휴장일·주말이면 그 앞의 마지막 영업일. 영업일은 주말 + `marketCalendar.isMarketClosed`(확인 범위 밖은 주말만).
 *     종목·날마다 **한 번 일봉을 새로 받는다**(`getCandles` — 마지막 캐시 봉부터 겹쳐 받으므로 장중에 캐시된 봉도 마감 값이 된다).
 *     그 날짜 봉이 없으면 **null**(화면 「—」) — 그저께 값으로 대신하지 않는다. ①·② 가 둘 다 있고 다르면 서버 로그 한 줄.
 *     ⚠️ 미국 일봉 종가는 정규장 종가 = 토스 기준가(새로 받은 뒤 NVDA·MRVL·AAPL·BE 일치 확인). 국내 일봉 종가는 KRX+NXT 통합 종가라
 *     기준가와 0.5% 안팎 다를 수 있다(2026-10-15 국내 43종목 평균 0.50% · 최대 1.40%) — 순위에 없는 국내 종목만 해당한다.
 *  - 기억(`memo`)은 ① 이거나, ② 를 새로 받은 뒤 그 날짜 봉을 찾았을 때만. 아니면 `RETRY_MS` 뒤 다시.
 * 등락률은 화면 표시에만 쓰인다 — 자동매매·매매 규칙 엔진은 이 값을 읽지 않는다(2026-10-15 grep).
 */

import { getCandles } from './candleService';
import { loadCandles } from './db';
import { isMarketClosed } from './marketCalendar';
import { marketOf } from './marketHours';
import { marketDate } from '../src/utils/marketDate';
import { tossGet } from '../src/services/toss/httpClient';
import { isMockMode } from './mockData';

/** 다시 받기 실패·봉 없음일 때 다음 시도까지 — 1초 폴링마다 캔들 요청이 나가지 않게 */
const RETRY_MS = 5 * 60_000;
/** 순위 기준가 캐시 — 기준가는 하루 안에 바뀌지 않지만 순위에 새로 드는 종목을 잡으려고 10분마다 */
const RANKING_TTL_MS = 10 * 60_000;
/** 기준가를 주는 순위 — 명세상 `duration` 과 무관하게 늘 전일 기준가인 종류만(TOP_GAINERS/LOSERS 는 기간 시작 기준가라 뺀다) */
const BASE_RANKINGS = ['MARKET_TRADING_AMOUNT', 'MARKET_TRADING_VOLUME', 'TOSS_SECURITIES_TRADING_AMOUNT', 'TOSS_SECURITIES_TRADING_VOLUME'] as const;

type Market = 'US' | 'KR';

const memo = new Map<string, number>();
const tried = new Map<string, number>();
const inflight = new Map<string, Promise<number | null>>();
const warned = new Set<string>();

// ── 점검이 바꿔 끼울 수 있는 두 자리(서버는 늘 기본값) ──
let refresh: (symbol: string) => Promise<unknown> = (symbol) => getCandles(symbol, '1d', 5);
export function setCandleRefreshForTest(fn: ((symbol: string) => Promise<unknown>) | null): void {
  refresh = fn ?? ((symbol) => getCandles(symbol, '1d', 5));
}
let fetchRankingBases: (market: Market) => Promise<Map<string, number>> = defaultRankingBases;
export function setRankingBasesForTest(fn: ((market: Market) => Promise<Map<string, number>>) | null): void {
  fetchRankingBases = fn ?? defaultRankingBases;
  rankingCache.clear();
}

/** YYYY-MM-DD ± n 일 (날짜 산수) */
function shift(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 그 종목 시장에서 `day` 바로 앞의 영업일 — 주말·확인된 휴장일을 건너뛴다 */
export function previousTradingDay(symbol: string, day: string): string {
  const market = marketOf(symbol);
  let d = shift(day, -1);
  for (let i = 0; i < 15 && isMarketClosed(market, d); i++) d = shift(d, -1);
  return d;
}

/** 그 시장 시간대의 시(0~23) */
function localHour(market: Market, now: number): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: market === 'US' ? 'America/New_York' : 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(now);
  return Number(h) % 24;
}

/**
 * 「가격 날」 — 지금 시세가 속한 토스 거래일. 국내는 08:00 KST(NXT 장전)부터 그날, 미국은 20:00 ET(애프터마켓 끝)부터 다음 날로 넘어간다.
 * 그 날이 휴장일·주말이면 그 앞의 마지막 영업일(주말에는 금요일 시세를 보이므로 금요일의 등락).
 */
export function priceDay(symbol: string, now = Date.now()): string {
  const market = marketOf(symbol);
  let d = marketDate(now, symbol);
  const h = localHour(market, now);
  if (market === 'KR' && h < 8) d = shift(d, -1);
  if (market === 'US' && h >= 20) d = shift(d, 1);
  for (let i = 0; i < 15 && isMarketClosed(market, d); i++) d = shift(d, -1);
  return d;
}

// ── ① 토스 순위의 기준가 ─────────────────────────────────────────────────────
async function defaultRankingBases(market: Market): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (isMockMode()) return out;
  for (const type of BASE_RANKINGS) {
    const r = await tossGet<{ result?: { rankings?: { symbol: string; price?: { basePrice?: string } }[] } }>(
      '/api/v1/rankings',
      { type, marketCountry: market, duration: '1d' },
      'RANKING',
    );
    for (const x of r.result?.rankings ?? []) {
      const base = Number(x.price?.basePrice);
      if (Number.isFinite(base) && base > 0) out.set(x.symbol, base);
    }
  }
  return out;
}

const rankingCache = new Map<Market, { at: number; day: string; bases: Map<string, number>; pending?: Promise<void> }>();

/** 순위의 기준가 — 시장·가격 날마다, `RANKING_TTL_MS` 동안 재사용. 실패하면 빈 값(② 로 간다) */
async function rankingBase(symbol: string, day: string): Promise<number | null> {
  const market = marketOf(symbol);
  let c = rankingCache.get(market);
  if (!c || c.day !== day || Date.now() - c.at > RANKING_TTL_MS) {
    if (!c?.pending) {
      const entry = c && c.day === day ? c : { at: 0, day, bases: new Map<string, number>() };
      entry.pending = fetchRankingBases(market)
        .then((bases) => {
          entry.bases = bases;
          entry.at = Date.now();
        })
        .catch((e) => {
          entry.at = Date.now() - RANKING_TTL_MS + RETRY_MS; // 실패면 5분 뒤 다시
          console.warn(`[previousClose] ${market} 순위 기준가 받기 실패:`, e instanceof Error ? e.message : e);
        })
        .finally(() => {
          entry.pending = undefined;
        });
      rankingCache.set(market, entry);
      c = entry;
    }
    await c.pending;
  }
  return rankingCache.get(market)?.bases.get(symbol) ?? null;
}

// ── ② 국내 상·하한가에서 기준가 풀기 ───────────────────────────────────────────
/** KRX 호가단위(2023-01 부터 코스피·코스닥 같음) — ETF 등 다른 규칙 종목은 답이 없어 ③ 으로 간다 */
function krTick(p: number): number {
  return p < 2000 ? 1 : p < 5000 ? 5 : p < 20000 ? 10 : p < 50000 ? 50 : p < 200000 ? 100 : p < 500000 ? 500 : 1000;
}
/** 상·하한가를 모두 만드는 기준가 후보 */
export function solveKrBase(upper: number, lower: number): number[] {
  const mid = (upper + lower) / 2;
  const out: number[] = [];
  if (!(upper > lower && lower > 0)) return out;
  for (let b = Math.floor(mid * 0.97); b <= Math.ceil(mid * 1.03); b++) {
    const t = krTick(b);
    if (b % t) continue;
    const w = Math.floor((b * 0.3) / t) * t;
    const up = Math.floor((b + w) / krTick(b + w)) * krTick(b + w);
    const lo = Math.ceil((b - w) / krTick(b - w)) * krTick(b - w);
    if (up === upper && lo === lower) out.push(b);
  }
  return out;
}
let fetchLimits: (symbol: string) => Promise<{ upper: number; lower: number } | null> = async (symbol) => {
  if (isMockMode()) return null;
  const r = await tossGet<{ result?: { upperLimitPrice?: string; lowerLimitPrice?: string } }>('/api/v1/price-limits', { symbol }, 'MARKET_DATA');
  const upper = Number(r.result?.upperLimitPrice);
  const lower = Number(r.result?.lowerLimitPrice);
  return Number.isFinite(upper) && Number.isFinite(lower) ? { upper, lower } : null;
};
const defaultFetchLimits = fetchLimits;
export function setPriceLimitsForTest(fn: ((symbol: string) => Promise<{ upper: number; lower: number } | null>) | null): void {
  fetchLimits = fn ?? defaultFetchLimits;
}
/** 상·하한가로 푼 기준가 — 답이 없거나 일봉 종가와 5% 넘게 다르면 null */
async function limitBase(symbol: string, candleClose: number | null): Promise<number | null> {
  try {
    const lim = await fetchLimits(symbol);
    if (!lim) return null;
    const cands = solveKrBase(lim.upper, lim.lower);
    if (!cands.length || cands.length > 3) return null;
    const pick = cands.length === 1 || candleClose == null ? cands[0] : cands.reduce((a, b) => (Math.abs(b - candleClose) < Math.abs(a - candleClose) ? b : a));
    if (cands.length > 1 && candleClose == null) return null;
    if (candleClose != null && Math.abs(pick / candleClose - 1) > 0.05) return null;
    return pick;
  } catch (e) {
    console.warn(`[previousClose] ${symbol} 상·하한가 받기 실패:`, e instanceof Error ? e.message : e);
    return null;
  }
}

// ── ③ 일봉 ──────────────────────────────────────────────────────────────────
/** 캐시에서 정확히 그 날짜의 봉 종가 */
function closeOn(symbol: string, day: string): number | null {
  const bar = loadCandles(symbol, '1d', 10).find((c) => marketDate(c.timestamp, symbol) === day);
  return bar && bar.close > 0 ? bar.close : null;
}

/** 지금 시세의 기준가 */
export async function previousClose(symbol: string, now = Date.now()): Promise<number | null> {
  return previousCloseForDay(symbol, priceDay(symbol, now));
}

/**
 * `day` 의 시세에 대한 기준가 — 그 날 바로 앞 영업일. 관심 목록이 토스에 닿지 않을 때(캐시 봉을 보여 줄 때)는 그 봉의 날짜로 부른다.
 * 순위 기준가(①)는 「지금」 의 가격 날일 때만 쓴다(지난 날의 기준가는 순위에 없다).
 */
export async function previousCloseForDay(symbol: string, day: string): Promise<number | null> {
  const key = `${symbol}|${day}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const expected = previousTradingDay(symbol, day);

  const last = tried.get(key);
  if (last !== undefined && Date.now() - last < RETRY_MS) return closeOn(symbol, expected);

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      // ① 순위 기준가 — 지금의 가격 날일 때만
      const ranked = day === priceDay(symbol) ? await rankingBase(symbol, day) : null;
      if (ranked !== null) {
        const cached = closeOn(symbol, expected);
        if (cached !== null && Math.abs(cached - ranked) / ranked > 0.0005 && !warned.has(`${key}|diff`)) {
          warned.add(`${key}|diff`);
          console.log(`[previousClose] ${symbol} 기준가 토스 순위 ${ranked} · 캐시 일봉(${expected}) ${cached} — 순위 값을 씁니다(국내 일봉은 NXT 포함 종가 · 캐시 봉은 장중에 받은 것일 수 있다)`);
        }
        remember(key, ranked);
        return ranked;
      }
      // ② 일봉 — 한 번 새로 받고 그 날짜 봉만
      tried.set(key, Date.now());
      let refreshed = false;
      try {
        await refresh(symbol);
        refreshed = true;
      } catch (e) {
        console.warn(`[previousClose] ${symbol} 일봉 다시 받기 실패:`, e instanceof Error ? e.message : e);
      }
      const candle = closeOn(symbol, expected);
      // 국내 — 지금의 가격 날이면 상·하한가로 거래소 기준가를 푼다(일봉은 NXT 포함 종가라 기준가와 다를 수 있다)
      const solved = marketOf(symbol) === 'KR' && day === priceDay(symbol) ? await limitBase(symbol, candle) : null;
      const value = solved ?? candle;
      if (value !== null && (refreshed || solved !== null)) {
        tried.delete(key);
        remember(key, value);
      } else if (value === null && !warned.has(key)) {
        warned.add(key);
        console.warn(`[previousClose] ${symbol} 전 거래일(${expected}) 봉이 없어 등락률을 비웁니다`);
      }
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

function remember(key: string, value: number): void {
  memo.set(key, value);
  if (memo.size > 3000) memo.clear();
}

/** 점검(`npm run prevclose:test`)용 — 기억·시도 기록을 비운다 */
export function resetPreviousCloseForTest(): void {
  memo.clear();
  tried.clear();
  inflight.clear();
  warned.clear();
  rankingCache.clear();
}
