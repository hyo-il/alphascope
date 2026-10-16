/**
 * 매수 판단 계산 (v2.45.0) — 한 곳. 화면(`GET /api/buy-judge`) · [다시 계산] · 매일 자동 기록(`scheduler.ts`)이 같은 함수를 쓴다.
 *
 * - **마감 판단**: 계좌 자동매매와 같은 `rules/judge.judgeOnClose`(끝난 봉, `held: false`). 그래서 같은 종목·날·규칙이면 계좌와 같은 답.
 * - **참고 점수**: 진행 중인 봉이 있으면(장중 · 장 전 데이마켓 등) 그 봉의 종가를 지금 가격으로 바꿔 넣고 같은 엔진(`scoreAt`)을 한 번 더 —
 *   점수만 쓴다. 진행 중인 봉이 없으면(그날 봉이 끝난 뒤 · 다음 거래일 첫 봉이 생기기 전) 마감 점수와 같다. **확정 아님.**
 * - **경고**: 실적 발표 14일 안(실적 달력 → 없으면 캐시된 기업정보) · 변동성(ATR 4% 넘음) · 손익비 1~1.5 · RSI 60 넘음 · 1·2차 목표가 1% 안 —
 *   예전 매수 판단 카드의 경고와 같은 뜻. "손익비 1 미만" 은 이제 판단(「손익비 부족」) 자체다.
 */
import { judgeOnClose } from '../rules/judge';
import type { GateReason } from '../../src/types/autoTrading';
import { marketRefLoader, type MarketRefLoader } from '../rules/marketRef';
import { sortDayRows } from '../../src/utils/buyJudgeOrder';
import { completedDaily, scoreAt, type ConditionResult, type RuleEvaluation } from '../rules/engine';
import { computeIndicators } from '../indicatorService';
import { getRule } from '../rules/store';
import { getEarningsDate } from '../earningsCalendar';
import { cachedFundamentals } from '../companyService';
import { isMarketClosed, type CalendarMarket } from '../marketCalendar';
import { isSymbolMarketOpen, marketOf } from '../marketHours';
import { getCandles } from '../candleService';
import { loadCandles } from '../db';
import { ROUND_TRIP_COST } from '../analysis/targetHit';
import { isMockMode, mockPrice } from '../mockData';
import { tossGet } from '../../src/services/toss/httpClient';
import { marketDate } from '../../src/utils/marketDate';
import { BUY_CONDITION_NAME } from '../../src/utils/ruleText';
import type { BuyKey, RuleBody } from '../../src/types/tradingRule';
import {
  OUTCOME_DAYS,
  REASON_DAYS,
  SMALL_SAMPLE,
  HISTORY_DAYS_PAGE,
  verdictOf,
  type BoughtRecord,
  type BuyJudgeHistory,
  type BuyJudgeRow,
  type BuyJudgeDays,
  type BuyJudgeState,
  type HistoryDay,
  type JudgeDay,
  type JudgeReference,
  type ReasonSummary,
} from '../../src/types/buyJudge';
import * as store from './store';

export interface CurrentRule {
  id: number;
  name: string;
  body: RuleBody;
}

/** 지금 고른 규칙 — 없거나 지워졌으면 null */
export function currentRule(): CurrentRule | null {
  const id = store.getRuleId();
  if (id === null) return null;
  const r = getRule(id);
  if (!r) return null;
  const { id: _id, name, createdAt: _c, updatedAt: _u, usedBy: _b, ...body } = r;
  return { id: r.id, name, body: body as RuleBody };
}

// ── 시장 마감 뒤 기록 시각 ───────────────────────────────────────────────────
/**
 * 그 시장의 그날 판단을 기록하는 시각(현지 분). 마감 직후에는 일봉이 아직 바뀐다:
 * - 국내: 정규장 15:30 이후에도 NXT 애프터마켓이 20:00 까지 열려 토스 일봉 종가가 바뀐다(통합 종가) → **20:30 KST**
 * - 미국: 토스 일봉 종가는 정규장 종가(애프터마켓을 넣지 않는다 — v2.44.3 에서 확인) → 마감 16:00 + 30분 = **16:30 ET**
 */
export const RECORD_AT: Record<CalendarMarket, { tz: string; minutes: number }> = {
  KR: { tz: 'Asia/Seoul', minutes: 20 * 60 + 30 },
  US: { tz: 'America/New_York', minutes: 16 * 60 + 30 },
};

function local(market: CalendarMarket, now: number): { day: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: RECORD_AT[market].tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** 지금 기록할 수 있는 가장 최근 시장 날짜 — 오늘이 영업일이고 기록 시각이 지났으면 오늘, 아니면 그 앞의 마지막 영업일 */
export function latestRecordDay(market: CalendarMarket, now = Date.now()): string {
  const { day, minutes } = local(market, now);
  let d = !isMarketClosed(market, day) && minutes >= RECORD_AT[market].minutes ? day : dayBefore(day);
  for (let i = 0; i < 15 && isMarketClosed(market, d); i++) d = dayBefore(d);
  return d;
}

// ── 한 종목 ─────────────────────────────────────────────────────────────────
const last = (line: (number | null)[] | undefined): number | null => {
  if (!line) return null;
  for (let i = line.length - 1; i >= 0; i--) if (line[i] != null && Number.isFinite(line[i]!)) return line[i]!;
  return null;
};

function conditionsOf(breakdown: ConditionResult[]): BuyJudgeRow['conditions'] {
  return breakdown
    .filter((c) => c.on)
    .map((c) => ({ key: c.key, name: BUY_CONDITION_NAME[c.key as BuyKey] ?? c.key, score: c.score, max: c.max, checks: c.checks }));
}

function warningsOf(symbol: string, ev: RuleEvaluation, price: number | null, atr: number | null, rsi: number | null, now: number): string[] {
  const out: string[] = [];
  const earnings = getEarningsDate(symbol)?.date ?? cachedFundamentals(symbol)?.profile.earningsDate ?? null;
  if (earnings) {
    const days = Math.round((Date.parse(earnings) - now) / 86_400_000);
    if (days >= 0 && days <= 14) out.push(`${earnings} 실적 발표 예정(${days}일 뒤) — 발표 때 크게 움직일 수 있습니다`);
  }
  if (atr != null && price && atr / price > 0.04) out.push(`변동성이 높습니다(ATR ${((atr / price) * 100).toFixed(1)}%) — 비중을 줄이세요`);
  const r = ev.reference;
  if (r && r.ratio >= 1 && r.ratio < 1.5) out.push('손익비가 1:1.5 미만입니다 — 목표가까지 여유가 크지 않습니다');
  if (rsi != null && rsi > 60) out.push(`RSI ${rsi.toFixed(1)} — 이미 반등한 자리입니다`);
  if (r && r.entryPrice > 0 && ((r.target2 - r.target1) / r.entryPrice) * 100 < 1) out.push('1·2차 목표가 거의 같습니다 — 위쪽 여유 공간이 좁습니다');
  return out;
}

function referenceOf(ev: RuleEvaluation): JudgeReference | null {
  const r = ev.reference;
  return r ? { entryType: r.entryType, entryPrice: r.entryPrice, stop: r.stop, target1: r.target1, target2: r.target2, ratio: r.ratio, sizePercent: r.sizePercent } : null;
}

/** 한 종목의 표 한 줄 + 기록할 마감 판단 */
export async function judgeSymbol(
  symbol: string,
  rule: RuleBody,
  livePrice: number | null,
  now = Date.now(),
  /** 이번 실행이 같이 쓰는 시장 기준 받기(v2.51.0 — 시장마다 한 번) */
  refs?: MarketRefLoader,
): Promise<{ row: BuyJudgeRow; record: { marketDate: string; ev: RuleEvaluation } | null; unconfirmed?: boolean }> {
  const empty: BuyJudgeRow = {
    symbol, basisDate: null, verdict: null, code: null, score: null, maxScore: null, minScore: null, conditions: [], reference: null,
    reason: null, refScore: null, refLabel: null, warnings: [], error: null,
  };
  try {
    const j = await judgeOnClose(symbol, rule, { held: false }, now, undefined, refs);
    if (j.kind === 'short') return { row: { ...empty, error: `가격 데이터가 ${j.count}개뿐이라 판단하지 않았습니다` }, record: null };
    // 끝나지 않은 채 저장된 일봉(v2.51.1) — 끝나지 않은 값으로 판단하지 않는다. 다음 실행 · 다음 기록 때 다시 받는다
    if (j.kind === 'unconfirmed') return { row: { ...empty, error: `일봉(${j.dates.join(', ')})을 확정하지 못해 판단을 미룹니다` }, record: null, unconfirmed: true };
    const { ev, completed, series, candles } = j;
    const lastBar = completed.at(-1)!;
    const basisDate = marketDate(lastBar.timestamp, symbol);

    // 참고 점수 — 진행 중 봉이 있으면 지금 가격으로 한 번 더(점수만)
    let refScore = ev.score;
    const raw = candles.at(-1);
    if (raw && raw.timestamp > lastBar.timestamp) {
      const price = livePrice ?? raw.close;
      const bar = { ...raw, close: price, high: Math.max(raw.high, price), low: Math.min(raw.low, price) };
      const refCandles = [...completed, bar];
      const refSeries = await computeIndicators(refCandles);
      refScore = scoreAt({ symbol, candles: refCandles, series: refSeries }, refCandles.length - 1, rule).score;
    }

    const row: BuyJudgeRow = {
      symbol,
      basisDate,
      verdict: verdictOf(ev.code),
      code: ev.code,
      ...(ev.gateReason ? { gateReason: ev.gateReason } : {}),
      score: ev.score,
      maxScore: ev.maxScore,
      minScore: rule.buy.minScore,
      conditions: conditionsOf(ev.breakdown),
      reference: referenceOf(ev),
      reason: ev.reasons[0] ?? null,
      refScore,
      refLabel: isSymbolMarketOpen(symbol, new Date(now)) ? '장중' : '장 마감 가격',
      warnings: warningsOf(symbol, ev, lastBar.close, last(series.atr14), last(series.rsi14), now),
      error: null,
    };
    return { row, record: { marketDate: basisDate, ev } };
  } catch (e) {
    return { row: { ...empty, error: `판단하지 못했습니다: ${e instanceof Error ? e.message : String(e)}` }, record: null };
  }
}

/** 지금 가격 — 토스 /prices 30개씩. 실패하면 빈 값(참고 점수는 진행 중 봉의 종가로) */
async function livePrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (isMockMode()) {
    for (const s of symbols) out.set(s, mockPrice(s).close);
    return out;
  }
  for (let i = 0; i < symbols.length; i += 30) {
    try {
      const r = await tossGet<{ result?: { symbol: string; lastPrice: string }[] }>('/api/v1/prices', { symbols: symbols.slice(i, i + 30).join(',') }, 'MARKET_DATA');
      for (const x of r.result ?? []) {
        const p = Number(x.lastPrice);
        if (Number.isFinite(p) && p > 0) out.set(x.symbol, p);
      }
    } catch {
      /* 참고 점수만 영향 */
    }
  }
  return out;
}

/** 여러 종목을 동시에 몇 개씩 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

function save(rule: CurrentRule, symbol: string, marketDate: string, ev: RuleEvaluation): void {
  store.upsertJudgment({
    marketDate,
    symbol,
    ruleId: rule.id,
    ruleName: rule.name,
    rule: rule.body,
    action: ev.action,
    code: ev.code,
    score: ev.score,
    maxScore: ev.maxScore,
    minScore: rule.body.buy.minScore,
    breakdown: ev.breakdown.filter((c) => c.on).map((c) => ({ key: c.key, score: c.score, max: c.max })),
    reference: referenceOf(ev),
    reason: ev.reasons[0] ?? '',
    gateReason: ev.gateReason ?? null,
  });
}

/** 화면 상태 — `write` 면 마감 판단을 그날 줄에 덮어쓴다([다시 계산]) */
export async function buildState(opts: { write?: boolean; now?: number } = {}): Promise<BuyJudgeState> {
  const now = opts.now ?? Date.now();
  const rule = currentRule();
  const symbols = store.getSymbols();
  const base = { ruleId: rule?.id ?? null, ruleName: rule?.name ?? null, symbols, retention: store.getRetention(), computedAt: new Date(now).toISOString() };
  if (!rule || !symbols.length) return { ...base, rows: [] };
  const prices = await livePrices(symbols);
  // 매수 판단은 계좌의 「5분 기다림」 을 쓰지 않는다 — 기다림 중이라 받지 않은 「시장 데이터 없음」 으로 그날 줄을 덮지 않게(v2.51.1)
  const refs = marketRefLoader(now, undefined, undefined, false);
  const results = await mapLimit(symbols, 4, (s) => judgeSymbol(s, rule.body, prices.get(s) ?? null, now, refs));
  if (opts.write) for (const r of results) if (r.record) save(rule, r.row.symbol, r.record.marketDate, r.record.ev);
  return { ...base, rows: results.map((r) => r.row) };
}

/**
 * 매일 기록 — 그 시장 종목 전부를 `day`(기록할 시장 날짜) 기준으로 판단해 쓴다. 기준 봉이 `day` 가 아닌 종목(데이터가 아직 없음 등)은 건너뛴다.
 * `unconfirmed` = 그날 다시 시도할 종목(일봉 확정 못 함 · 시장 데이터 없음) — 스케줄러가 그 날짜를 「기록함」 으로 두지 않는다. 나머지는 로그용.
 */
export async function recordMarket(market: CalendarMarket, day: string, now = Date.now()): Promise<{ written: number; skipped: string[]; unconfirmed: string[] }> {
  const rule = currentRule();
  const symbols = store.getSymbols().filter((s) => marketOf(s) === market);
  if (!rule || !symbols.length) return { written: 0, skipped: [], unconfirmed: [] };
  let written = 0;
  const skipped: string[] = [];
  const refs = marketRefLoader(now, undefined, undefined, false);
  const unconfirmed: string[] = [];
  await mapLimit(symbols, 4, async (s) => {
    const { record, unconfirmed: notYet } = await judgeSymbol(s, rule.body, null, now, refs);
    if (record && record.marketDate === day) {
      save(rule, s, day, record.ev);
      written++;
      // 시장 기준(SPY · KODEX 200)을 받지 못했거나 그날 봉이 없다(v2.51.2 — 계좌와 같은 규칙) — 줄은 쓰되 그날을 「기록함」 으로 두지 않고 다시 시도한다(다시 쓰면 같은 줄을 덮는다)
      if (record.ev.gateReason === 'market_nodata') unconfirmed.push(s);
    } else {
      skipped.push(s);
      if (notYet) unconfirmed.push(s);
    }
  });
  return { written, skipped, unconfirmed };
}

// ── 히스토리 ─────────────────────────────────────────────────────────────────
/**
 * 「사도 됨」 다음 거래일 시가에 샀다면 N거래일 뒤 종가 수익률(%) − 왕복 비용 `ROUND_TRIP_COST`(0.30%p, 백테스트와 같다).
 * N거래일 뒤 = 기준 봉에서 N번째 거래일(그 봉이 끝났을 때만). 저장하지 않고 읽을 때마다 캔들에서 구한다 — 기준을 바꿔도 다시 맞고,
 * 채점용 캔들은 매일 기록이 받아 둔다(목표 수익 가능성 · Gemini 적중률과 같은 방식).
 */
export function outcomes(candles: { timestamp: number; open: number; close: number }[], symbol: string, marketDateStr: string, completedCount: number): Record<number, number | null> {
  const idx = candles.findIndex((c) => marketDate(c.timestamp, symbol) === marketDateStr);
  const out: Record<number, number | null> = {};
  for (const n of OUTCOME_DAYS) {
    const entry = idx >= 0 ? candles[idx + 1] : undefined;
    const exitIdx = idx + n;
    const exit = idx >= 0 && exitIdx < completedCount ? candles[exitIdx] : undefined;
    out[n] = entry && exit && entry.open > 0 ? Math.round(((exit.close / entry.open - 1) * 100 - ROUND_TRIP_COST) * 100) / 100 : null;
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

/**
 * 「사도 됨」 기록의 5·10·20거래일 뒤 수익률을 읽는다 — 성과가 아직 다 안 나온 종목만 일봉을 새로 받는다(종목마다 한 번).
 * 히스토리 요약 한 줄과 날짜별 목록이 같은 계산을 쓴다.
 */
async function outcomeReader(rows: store.JudgmentRow[], now: number): Promise<(r: store.JudgmentRow) => Record<number, number | null>> {
  const pending = new Set(rows.filter((r) => r.market_date >= marketDate(now - 45 * 86_400_000, r.symbol)).map((r) => r.symbol));
  await mapLimit([...pending], 4, (s) => getCandles(s, '1d', 60).catch(() => []));
  const bySymbol = new Map<string, { candles: ReturnType<typeof loadCandles>; completed: number }>();
  const candlesOf = (s: string) => {
    let c = bySymbol.get(s);
    if (!c) {
      const all = loadCandles(s, '1d', 400);
      // 진행 중 봉은 채점에 쓰지 않는다 — 끝난 봉은 앞에서부터 이어진다
      c = { candles: all, completed: completedDaily(all, s, now).length };
      bySymbol.set(s, c);
    }
    return c;
  };
  return (r) => {
    const c = candlesOf(r.symbol);
    return outcomes(c.candles, r.symbol, r.market_date, c.completed);
  };
}

export async function history(now = Date.now()): Promise<BuyJudgeHistory> {
  const rows = store.listBought();
  const read = await outcomeReader(rows, now);
  const bought: BoughtRecord[] = rows.map((r) => {
    const o = read(r);
    return { id: r.id, marketDate: r.market_date, symbol: r.symbol, ruleName: r.rule_name, score: r.score, maxScore: r.max_score, r5: o[5], r10: o[10], r20: o[20] };
  });
  const n = (k: 'r5' | 'r10' | 'r20') => bought.map((b) => b[k]).filter((v): v is number => v !== null);
  const stats = {
    n5: n('r5').length, n10: n('r10').length, n20: n('r20').length,
    avg5: avg(n('r5')), avg10: avg(n('r10')), avg20: avg(n('r20')),
    smallSample: n('r5').length < SMALL_SAMPLE,
  };
  return { stats, reasons: reasonSummaries(), counts: store.countRows() };
}

/** 날짜별 히스토리 (v2.48.0 — 사용자 결정) — 최근 날짜부터 `limit` 일씩. 「사도 됨」 줄에는 5·10·20거래일 뒤 수익률 */
export async function historyDays(offset = 0, limit = HISTORY_DAYS_PAGE, now = Date.now()): Promise<BuyJudgeDays> {
  const dates = store.listDates(limit, offset);
  const rows = store.listOnDates(dates);
  const read = await outcomeReader(rows.filter((r) => r.code === 'score_buy'), now);
  const days: HistoryDay[] = dates.map((d) => {
    // 순서: 사도 됨 → 손익비 부족 → 기준 미달, 각각 총점 높은 순(`sortDayRows` — 화면의 날짜 줄 제목도 같은 파일)
    const list = sortDayRows(
      rows
        .filter((r) => r.market_date === d)
        .map((r) => {
          const verdict = verdictOf(r.code);
          const o = verdict === 'buy' ? read(r) : null;
          return { symbol: r.symbol, ruleName: r.rule_name, verdict, ...(r.gate_reason ? { gateReason: r.gate_reason as GateReason } : {}), score: r.score, maxScore: r.max_score, r5: o?.[5] ?? null, r10: o?.[10] ?? null, r20: o?.[20] ?? null };
        }),
    );
    const buys = list.filter((x) => x.verdict === 'buy').length;
    return { marketDate: d, rows: list, buys, nonBuys: list.length - buys };
  });
  return { days, totalDays: store.countDates() };
}

/** 종목별 「사지 않은 이유」 — 최근 `REASON_DAYS` 개 기록(날짜) */
export function reasonSummaries(): ReasonSummary[] {
  return store.judgedSymbols().map((symbol) => {
    const rows = store.listForSymbol(symbol, REASON_DAYS);
    let below = 0;
    let rrBlock = 0;
    let gateBlock = 0;
    const gateReasons: Partial<Record<GateReason, number>> = {};
    let buy = 0;
    const missing = new Map<string, number>();
    for (const r of rows) {
      const v = verdictOf(r.code);
      if (v === 'buy') buy++;
      else if (v === 'rr_block') rrBlock++;
      else if (v === 'gate_block') {
        gateBlock++;
        if (r.gate_reason) gateReasons[r.gate_reason as GateReason] = (gateReasons[r.gate_reason as GateReason] ?? 0) + 1;
      }
      else {
        below++;
        for (const c of JSON.parse(r.breakdown_json) as { key: string; score: number; max: number }[]) {
          if (c.score < c.max) missing.set(c.key, (missing.get(c.key) ?? 0) + 1);
        }
      }
    }
    const top = [...missing.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return { symbol, days: rows.length, below, rrBlock, gateBlock, gateReasons, buy, mostMissing: top ? (BUY_CONDITION_NAME[top[0] as BuyKey] ?? top[0]) : null };
  });
}

export function daysFor(symbol: string): JudgeDay[] {
  return store.listForSymbol(symbol, REASON_DAYS).map((r) => ({
    marketDate: r.market_date,
    ruleName: r.rule_name,
    verdict: verdictOf(r.code),
    ...(r.gate_reason ? { gateReason: r.gate_reason as GateReason } : {}),
    score: r.score,
    maxScore: r.max_score,
    minScore: r.min_score,
    reason: r.reason,
  }));
}
