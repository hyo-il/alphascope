/**
 * 규칙형 백테스트 — 두 가지가 같은 계산 부품을 쓴다.
 * - `runRuleResearch` — v2.37.0 「미리 정한 시험」(3가지 방법 · 3년 · 사전 등록). 지금은 `npm run research:rule` 로만 돈다(화면은 기록을 읽기만 한다).
 * - `runCustomBacktest` — v2.38.0 「실험실 > 백테스트」. 사용자가 고른 종목·조건·기간(1~3년). 판정 배지 없음.
 *   새 계산을 쓰지 않는다 — 아래의 구간 나누기·`simulateRule(…, end)`·`randomBaseline`·`leakCheck`·`completedDaily` 를 그대로 부른다.
 *
 * 아래 표는 v2.37.0 고정 시험의 사전 등록이다.
 *
 * ⚠️ **주문을 전혀 내지 않는다.** 모의투자·주문 모듈을 import 하지 않는다 — 캔들(`getCandles`)·지표(`computeIndicators`)·
 * 1년 재현의 `simulateRule`·`leakCheck`·`completedDaily`(그 안에서 실제 엔진과 같은 `decideRule`)만 쓴다. **복사하지 않는다** — 두 벌이면 숫자가 갈라진다.
 *
 * ── 사전 등록 (2026-10-04, 결과를 보기 전에 정했다. 결과를 보고 바꾸지 않는다 — 바꾸려면 PREREG_VERSION 을 올리고 새 실험으로) ──
 * | 항목              | 규칙 |
 * | 대상              | `server/data/universe.json` 미국 100 ∩ 7분야(기술·금융·헬스케어·산업재·경기소비재·필수소비재·에너지 — `stock_profiles.sector` 의 한글, 종목 지도와 같다).
 * |                   | 섹터가 비어 있으면 계산 전에 실적일 갱신과 같은 경로(`refreshEarnings`, yfinance info)로 한 번 채우고, 그래도 없으면 「미확인」 으로 빼고 이름을 적는다. |
 * | 기간              | 최근 완성 거래일 756개, 252개씩 3구간(1년차·2년차·3년차). 지표 워밍업으로 그 앞 140봉을 더 받는다 |
 * | 방법              | `RULE_CHOICES`(추세 따라가기·많이 떨어지면 사기·둘 다) × **손절 7% · 트레일링 끔** 고정 |
 * | 체결·비용·손절     | 1년 재현(`simulateRule`)과 같다 — 다음 날 시가, 같은 날이면 손절 먼저, 왕복 0.30%p. 구간마다 따로(시작 빈손, 끝 마지막 종가 정리) |
 * | 기준선 1          | 그냥 들고 있기 — 구간 첫날 시가 → 구간 마지막 종가, 비용 반영 |
 * | 기준선 2          | 아무 날이나 사고팔기 — 그 종목·구간에서 이 방법과 **같은 거래 횟수·같은 보유일 수**로 겹치지 않는 무작위 날짜에 진입.
 * |                   | 진입일 시가에 사서 보유일 뒤 시가에 판다(보유일 0 이면 그날 종가). 비용 반영, 손절 없음. 시드 고정, 200번 평균 |
 * | 비교 숫자         | 구간별 "이 방법 1년 전체 − 기준선" 의 종목 평균(동일 가중). 3년 = 세 구간 수익률을 복리로 이은 값 |
 * | "기준선보다 낫다"  | 기준선마다 세 가지 모두: ① 3구간 중 2구간 이상에서 차이 > 0 ② 3년 종목별 차이의 부트스트랩(2,000회, 시드 고정) 95% 구간 하한 > 0
 * |                   | ③ 3년 합계 거래 10회 이상 종목이 절반 이상. ③만 아니면 「판단 보류」, 그 밖은 「기준선 이하」.
 * |                   | 방법의 판정 = 두 기준선 모두 좋음이면 좋음 · 어느 하나라도 기준선 이하면 기준선 이하 · 그 밖 판단 보류(보수적) |
 * | 분야별            | 같은 숫자(3년 이 방법 − 들고 있기)를 분야별로. 분야 종목 5개 미만이면 「표본 적음」. 판정 배지 없음(설명용) |
 * | 미래 누설         | 첫 종목에서 `leakCheck` 를 756봉 전체에 — 실패하면 결과를 내지 않는다 |
 */

import { getCandles } from '../candleService';
import { computeIndicators, IndicatorEngineError } from '../indicatorService';
import { ROUND_TRIP_COST } from '../analysis/targetHit';
import { completedDaily } from './ruleEngine';
import { LeakError, equityCurve, holdCurve, leakCheck, MIN_TRADES, simulateRule, type BacktestOptions } from './ruleBacktest';
import { maxDrawdown } from '../../src/utils/drawdown';
import { readUniverse } from '../universe';
import { profiles, sectorKo } from '../heatmap';
import { findNames } from '../stockCatalog';
import { refreshEarnings } from '../earningsCalendar';
import { RULE_CHOICES } from '../../src/types/ruleChoices';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import type { RuleConfig } from '../../src/types/autoTrading';
import {
  BACKTEST_SECTORS,
  type BacktestCheck,
  type BacktestCondition,
  type BacktestConditionResult,
  type BacktestCustomReport,
  type BacktestCustomStats,
  type BacktestCustomSymbol,
  type BacktestExitName,
  type BacktestInput,
  type BacktestMethodId,
  type BacktestMethodResult,
  type BacktestReport,
  type BacktestSectorRow,
  type BacktestSegmentRow,
  type BacktestSymbolRow,
  type BacktestVerdictKind,
} from '../../src/types/backtest';

export const PREREG_VERSION = 'r1-2026-10-04';
export const RESEARCH_DAYS = 756;
export const SEGMENT_DAYS = 252;
export const SEGMENTS = 3;
const WARMUP = 140;
export const STOP_LOSS = 7;
const RANDOM_RUNS = 200;
const BOOTSTRAP = 2000;
const SECTOR_MIN = 5;

const round2 = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const compound = (rs: number[]) => round2((rs.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100);

/** 시드 고정 난수 — mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 기준선 2 — 같은 횟수·같은 보유일로 겹치지 않는 무작위 진입, 200번 평균 (사전 등록 표).
 * 거래 하나는 진입 봉 ~ 청산 봉(h+1 봉)을 차지한다. 남는 봉을 n+1 틈에 무작위로 나누고 거래 순서도 섞는다.
 */
export function randomBaseline(candles: Candle[], start: number, end: number, holdDays: number[], seed: number): number | null {
  const n = holdDays.length;
  if (!n) return 0;
  const span = end - start + 1;
  const used = holdDays.reduce((a, h) => a + h + 1, 0);
  const free = span - used;
  if (free < 0) return null;
  const cost = ROUND_TRIP_COST;
  const rand = rng(seed);
  let total = 0;
  for (let run = 0; run < RANDOM_RUNS; run++) {
    // 틈 나누기: free 개의 빈 봉을 n+1 칸에 (막대와 별 — n 개 칸막이 위치를 고른다)
    const cuts: number[] = [];
    for (let k = 0; k < n; k++) cuts.push(Math.floor(rand() * (free + 1)));
    cuts.sort((a, b) => a - b);
    const order = holdDays.map((h, i) => ({ h, key: rand(), i })).sort((a, b) => a.key - b.key);
    let pos = start;
    let prevCut = 0;
    let acc = 1;
    for (let k = 0; k < n; k++) {
      pos += cuts[k] - prevCut;
      prevCut = cuts[k];
      const h = order[k].h;
      const entry = candles[pos].open;
      const exit = h > 0 ? candles[pos + h].open : candles[pos].close;
      acc *= 1 + ((exit / entry - 1) * 100 - cost) / 100;
      pos += h + 1;
    }
    total += (acc - 1) * 100;
  }
  return round2(total / RANDOM_RUNS);
}

/** 부트스트랩 95% 구간(종목을 다시 뽑아 평균) — 시드 고정 */
export function bootstrapCi(values: number[], seed: number): { low: number | null; high: number | null } {
  if (values.length < 2) return { low: null, high: null };
  const rand = rng(seed);
  const means: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    let s = 0;
    for (let k = 0; k < values.length; k++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return { low: round2(means[Math.floor(0.025 * BOOTSTRAP)]), high: round2(means[Math.floor(0.975 * BOOTSTRAP) - 1]) };
}

const fmt = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%p`);

/** 기준선 하나에 대한 판정 — 사전 등록 표의 ①②③ 그대로, 비교식 문장도 같은 값에서 만든다 */
export function judge(
  segmentDiffs: (number | null)[],
  symbolDiffs3y: number[],
  enoughSymbols: number,
  symbols: number,
  seed: number,
  label: string,
): BacktestCheck {
  const positiveSegments = segmentDiffs.filter((d) => d != null && d > 0).length;
  const ci = bootstrapCi(symbolDiffs3y, seed);
  const m = mean(symbolDiffs3y);
  const c1 = positiveSegments >= 2;
  const c2 = ci.low != null && ci.low > 0;
  const c3 = symbols > 0 && enoughSymbols * 2 >= symbols;
  const verdict: BacktestVerdictKind = c1 && c2 && c3 ? 'good' : c1 && c2 && !c3 ? 'hold' : 'bad';
  const why =
    `${label}: ① 차이 > 0 인 구간 ${positiveSegments}/3 ${c1 ? '(통과)' : '(미달)'} · ` +
    `② 3년 차이 평균 ${fmt(m)}, 95% 구간 ${fmt(ci.low)} ~ ${fmt(ci.high)} ${c2 ? '(하한 > 0 통과)' : '(하한 ≤ 0 미달)'} · ` +
    `③ 3년 거래 10회 이상 종목 ${enoughSymbols}/${symbols} ${c3 ? '(절반 이상)' : '(절반 미만 — 판단 보류 사유)'}`;
  return { positiveSegments, mean: m, ciLow: ci.low, ciHigh: ci.high, enoughSymbols, symbols, verdict, why };
}

interface Target {
  symbol: string;
  name: string | null;
  sector: string;
}

/** 대상 고르기 — 섹터가 빈 종목은 한 번 채워 본다 */
export async function researchTargets(): Promise<{ asOf: string; included: Target[]; outOfSector: Target[]; unknown: { symbol: string; name: string | null }[] }> {
  const u = readUniverse();
  const list = u.us.map((e) => ({ symbol: e.symbol.toUpperCase(), name: e.name ?? null }));
  let prof = profiles(list.map((e) => e.symbol));
  const missing = list.filter((e) => !prof.get(e.symbol)?.sector).map((e) => e.symbol);
  if (missing.length) {
    try {
      await refreshEarnings(missing);
    } catch (e) {
      console.warn('[rule-research] 섹터 채우기 실패 — 미확인으로 뺍니다:', (e as Error).message);
    }
    prof = profiles(list.map((e) => e.symbol));
  }
  const included: Target[] = [];
  const outOfSector: Target[] = [];
  const unknown: { symbol: string; name: string | null }[] = [];
  for (const e of list) {
    const raw = prof.get(e.symbol)?.sector;
    if (!raw) {
      unknown.push(e);
      continue;
    }
    const sector = sectorKo(raw);
    if ((BACKTEST_SECTORS as readonly string[]).includes(sector)) included.push({ ...e, sector });
    else outOfSector.push({ ...e, sector });
  }
  return { asOf: u.asOf, included, outOfSector, unknown };
}

interface PerSymbol {
  target: Target;
  error?: string;
  /** 방법 → 구간 3개 */
  segs?: Record<BacktestMethodId, { rule: number; hold: number | null; random: number | null; trades: number; winRate: number | null; avgReturn: number | null }[]>;
  dates?: { from: string; to: string }[];
}

export interface ResearchProgress {
  (done: number, total: number, current: string): void;
}

/** 본체 — 웹(`POST /api/backtest/run`)과 명령어(`npm run research:rule`)가 같은 함수를 부른다 */
export async function runRuleResearch(onProgress?: ResearchProgress): Promise<BacktestReport> {
  const t0 = Date.now();
  let indicatorCalls = 0;
  let rssMax = process.memoryUsage().rss;
  const sample = () => (rssMax = Math.max(rssMax, process.memoryUsage().rss));

  const targets = await researchTargets();
  const rows: PerSymbol[] = [];
  let leak: BacktestReport['leakCheck'] = { symbol: '', bars: 0, ok: true };
  const total = targets.included.length;

  for (let n = 0; n < total; n++) {
    const target = targets.included[n];
    onProgress?.(n, total, target.symbol);
    try {
      // 캔들·지표는 종목당 **한 번** — 세 방법 × 3구간이 함께 쓴다
      const candles = completedDaily(await getCandles(target.symbol, '1d', RESEARCH_DAYS + WARMUP), target.symbol);
      if (candles.length < RESEARCH_DAYS + 30) throw new Error(`일봉이 ${candles.length}개뿐입니다(3년에 ${RESEARCH_DAYS}개 + 워밍업 필요)`);
      const series: IndicatorSeries = await computeIndicators(candles);
      indicatorCalls++;
      const first = candles.length - RESEARCH_DAYS;
      if (!leak.symbol) {
        const rule = RULE_CHOICES.find((c) => c.id === 'both')!.rule as RuleConfig; // 세 방법이 쓰는 선(MA5·MA20·RSI14)을 모두 본다
        const bad = await leakCheck(candles, series, first, rule);
        indicatorCalls += candles.length - first;
        leak = { symbol: target.symbol, bars: candles.length - first, ok: !bad };
        console.log(`[rule-research] 미래 누설 검사 ${target.symbol} ${leak.bars}봉: ${bad ? `실패 — ${bad}` : '통과'}`);
        if (bad) throw new LeakError(`미래 누설 검사 실패(${target.symbol}): ${bad}`);
      }
      const date = (i: number) => marketDate(candles[i].timestamp, target.symbol);
      const bounds = Array.from({ length: SEGMENTS }, (_, k) => {
        const start = first + k * SEGMENT_DAYS;
        return { start, end: start + SEGMENT_DAYS - 1 };
      });
      const segs = {} as NonNullable<PerSymbol['segs']>;
      for (const choice of RULE_CHOICES) {
        const opts: BacktestOptions = {
          rule: { ...choice.rule } as RuleConfig,
          hardStopLossPercent: STOP_LOSS,
          trailingStopEnabled: false,
          trailingStopPercent: 0,
        };
        segs[choice.id] = bounds.map((b, k) => {
          const r = simulateRule(target.symbol, candles, series, b.start, opts, b.end);
          const random = randomBaseline(candles, b.start, b.end, r.list.map((t) => t.holdDays), hashSeed(`${PREREG_VERSION}|${target.symbol}|${choice.id}|${k}`));
          return { rule: r.ruleReturn, hold: r.holdReturn, random, trades: r.trades, winRate: r.winRate, avgReturn: r.avgReturn };
        });
      }
      rows.push({ target, segs, dates: bounds.map((b) => ({ from: date(b.start), to: date(b.end) })) });
    } catch (e) {
      if (e instanceof LeakError || e instanceof IndicatorEngineError) throw e; // 엔진 꺼짐·누설은 결과로 꾸미지 않는다
      rows.push({ target, error: (e as Error).message });
    }
    sample();
  }
  onProgress?.(total, total, '');

  const ok = rows.filter((r) => r.segs);
  const segDates = ok[0]?.dates ?? [];
  const methods: BacktestMethodResult[] = RULE_CHOICES.map((choice) => {
    const id = choice.id;
    const segments: BacktestSegmentRow[] = Array.from({ length: SEGMENTS }, (_, k) => {
      const cells = ok.map((r) => r.segs![id][k]);
      return {
        segment: k + 1,
        from: segDates[k]?.from ?? '',
        to: segDates[k]?.to ?? '',
        symbols: cells.length,
        avgRule: mean(cells.map((c) => c.rule)),
        avgHold: mean(cells.map((c) => c.hold)),
        avgRandom: mean(cells.map((c) => c.random)),
        avgTradeReturn: mean(cells.map((c) => c.avgReturn)),
        avgWinRate: mean(cells.map((c) => c.winRate)),
        avgTrades: mean(cells.map((c) => c.trades)),
        weakSymbols: cells.filter((c) => c.trades < MIN_TRADES).length,
        diffHold: mean(cells.map((c) => (c.hold == null ? null : c.rule - c.hold))),
        diffRandom: mean(cells.map((c) => (c.random == null ? null : c.rule - c.random))),
      };
    });
    const per3y = ok.map((r) => {
      const s = r.segs![id];
      const hold = s.every((c) => c.hold != null) ? compound(s.map((c) => c.hold!)) : null;
      const random = s.every((c) => c.random != null) ? compound(s.map((c) => c.random!)) : null;
      return { rule: compound(s.map((c) => c.rule)), hold, random, trades: s.reduce((a, c) => a + c.trades, 0) };
    });
    const enough = per3y.filter((p) => p.trades >= MIN_TRADES).length;
    const vsHold = judge(
      segments.map((s) => s.diffHold),
      per3y.filter((p) => p.hold != null).map((p) => p.rule - p.hold!),
      enough, per3y.length, hashSeed(`${PREREG_VERSION}|boot|${id}|hold`), '들고 있기 대비',
    );
    const vsRandom = judge(
      segments.map((s) => s.diffRandom),
      per3y.filter((p) => p.random != null).map((p) => p.rule - p.random!),
      enough, per3y.length, hashSeed(`${PREREG_VERSION}|boot|${id}|random`), '아무 날이나 대비',
    );
    const verdict: BacktestVerdictKind =
      vsHold.verdict === 'good' && vsRandom.verdict === 'good' ? 'good' : vsHold.verdict === 'bad' || vsRandom.verdict === 'bad' ? 'bad' : 'hold';
    return { id, title: choice.title, segments, vsHold, vsRandom, verdict, why: `${vsHold.why}\n${vsRandom.why}` };
  });

  const symbols: BacktestSymbolRow[] = rows.map((r) => ({
    symbol: r.target.symbol,
    name: r.target.name,
    sector: r.target.sector,
    ...(r.error ? { error: r.error } : {}),
    byMethod: r.segs
      ? Object.fromEntries(
          RULE_CHOICES.map((c) => {
            const s = r.segs![c.id];
            return [
              c.id,
              {
                rule3y: compound(s.map((x) => x.rule)),
                hold3y: s.every((x) => x.hold != null) ? compound(s.map((x) => x.hold!)) : null,
                random3y: s.every((x) => x.random != null) ? compound(s.map((x) => x.random!)) : null,
                trades: s.reduce((a, x) => a + x.trades, 0),
              },
            ];
          }),
        )
      : {},
  }));

  const sectors: BacktestSectorRow[] = BACKTEST_SECTORS.map((sector) => {
    const inSector = symbols.filter((s) => s.sector === sector && !s.error);
    const byMethod = Object.fromEntries(
      RULE_CHOICES.map((c) => [
        c.id,
        mean(inSector.map((s) => {
          const v = s.byMethod[c.id];
          return v && v.hold3y != null ? v.rule3y - v.hold3y : null;
        })),
      ]),
    ) as Record<BacktestMethodId, number | null>;
    return { sector, symbols: inSector.length, weak: inSector.length < SECTOR_MIN, byMethod };
  });

  sample();
  return {
    version: PREREG_VERSION,
    universeAsOf: targets.asOf,
    segments: segDates.map((d, k) => ({ segment: k + 1, ...d })),
    conditions: { stopLossPercent: STOP_LOSS, trailing: false, costPct: ROUND_TRIP_COST, fill: '신호 다음 거래일 시가', days: RESEARCH_DAYS, segmentDays: SEGMENT_DAYS },
    targets: { included: targets.included, outOfSector: targets.outOfSector, unknown: targets.unknown },
    methods,
    sectors,
    symbols,
    leakCheck: leak,
    measure: { ms: Date.now() - t0, indicatorCalls, rssMaxMb: Math.round(rssMax / 1048576), symbols: total },
    computedAt: new Date().toISOString(),
  };
}

// ── 내가 고른 종목 · 내가 정한 조건 (v2.38.0) · 조건 비교·MDD·Profit Factor·익절 (v2.39.0) ─────────────

/** 이 시험이 필요로 하는 지표 워밍업 봉 수 — 장기 이동평균(최대 120)이 구간 첫날에 값을 가져야 한다. 조건 중 가장 긴 것. 고정 시험의 +30 보다 엄격하다 */
function customWarmupNeeded(input: BacktestInput): number {
  const ma = Math.max(0, ...input.conditions.map((c) => (c.rule.useMaCross ? Math.max(c.rule.maShort, c.rule.maLong) : 0)));
  return Math.max(30, ma + 1, 15 + 1);
}

/** 종목·기간·조건 전체가 같으면 같은 결과 — 같은 날 다시 계산하지 않는 비교 키(종목 순서는 무시) */
export function customInputKey(input: BacktestInput): string {
  return JSON.stringify([
    [...input.symbols].sort(),
    input.years,
    input.conditions.map((c) => [
      c.rule.useMaCross, c.rule.maShort, c.rule.maLong,
      c.rule.useRsi, c.rule.rsiBuyBelow, c.rule.rsiSellAbove,
      c.hardStopLossPercent, c.trailingStopEnabled, c.trailingStopEnabled ? c.trailingStopPercent : null,
      c.takeProfitEnabled, c.takeProfitEnabled ? c.takeProfitPercent : null,
    ]),
  ]);
}

/** 종목 이름·분야 — 이름은 카탈로그(한글) → 유니버스, 분야는 stock_profiles(없으면 null). 여기서 yfinance 를 부르지 않는다 */
export function namesAndSectors(symbols: string[]): Map<string, { name: string | null; sector: string | null }> {
  const catalog = findNames(symbols);
  let uni = new Map<string, string>();
  try {
    const u = readUniverse();
    uni = new Map([...u.us, ...u.kr].map((e) => [e.symbol.toUpperCase(), e.name]));
  } catch {
    /* 유니버스 파일이 없어도 이름만 비게 둔다 */
  }
  const prof = profiles(symbols);
  return new Map(
    symbols.map((sym) => {
      const raw = prof.get(sym)?.sector;
      return [sym, { name: catalog[sym] ?? uni.get(sym) ?? null, sector: raw ? sectorKo(raw) : null }];
    }),
  );
}

export type Cell = {
  rule: number;
  hold: number | null;
  random: number | null;
  trades: number;
  list: { returnPct: number; exitKind: string }[];
  /** 그 구간의 일별 자산 곡선(1 에서 시작) — MDD 용 (v2.39.0) */
  curve: number[];
};

const EXIT_NAMES = ['signal', 'stop', 'take_profit', 'trailing', 'end'] as const;

/** 조건 → 재현 옵션 */
export const conditionOptions = (c: BacktestCondition): BacktestOptions => ({
  rule: { ...c.rule },
  hardStopLossPercent: c.hardStopLossPercent,
  trailingStopEnabled: c.trailingStopEnabled,
  trailingStopPercent: c.trailingStopPercent,
  takeProfitEnabled: c.takeProfitEnabled,
  takeProfitPercent: c.takeProfitPercent,
});

/** 구간 곡선을 복리로 이어 붙인다(다음 구간은 앞 구간 끝 값에서 시작) */
function chainCurves(curves: number[][]): number[] {
  const out: number[] = [];
  let base = 1;
  for (const c of curves) {
    for (const v of c) out.push(base * v);
    base *= c[c.length - 1] ?? 1;
  }
  return out;
}

/**
 * 한 종목을 1년(252봉)씩 `years` 구간으로 — 순수 함수(합성 캔들 검산과 실제 시험이 같은 함수).
 * 시험 기간 = 마지막 `252 × years` 봉. 구간마다 `simulateRule(…, end)` 와 같은 횟수·보유일의 무작위 기준선.
 * 시드는 조건과 무관(`custom|종목|구간`) — 같은 거래 횟수·보유일이면 같은 기준선이 나와 조건끼리 공정하게 비교된다.
 */
export function simulateSegments(symbol: string, candles: Candle[], series: IndicatorSeries, years: number, opts: BacktestOptions) {
  const first = candles.length - SEGMENT_DAYS * years;
  const date = (i: number) => marketDate(candles[i].timestamp, symbol);
  const bounds = Array.from({ length: years }, (_, k) => {
    const start = first + k * SEGMENT_DAYS;
    return { start, end: start + SEGMENT_DAYS - 1 };
  });
  const segs = bounds.map((b, k): Cell => {
    const r = simulateRule(symbol, candles, series, b.start, opts, b.end);
    const random = randomBaseline(candles, b.start, b.end, r.list.map((t) => t.holdDays), hashSeed(`custom|${symbol}|${k}`));
    return {
      rule: r.ruleReturn,
      hold: r.holdReturn,
      random,
      trades: r.trades,
      list: r.list.map((t) => ({ returnPct: t.returnPct, exitKind: t.exitKind })),
      curve: equityCurve(candles, b.start, b.end, r.list),
    };
  });
  const holdCurves = bounds.map((b) => holdCurve(candles, b.start, b.end));
  return { segs, holdCurves, dates: bounds.map((b) => ({ from: date(b.start), to: date(b.end) })) };
}

const toMdd = (curve: number[]) => {
  const v = maxDrawdown(curve);
  return v == null ? null : round2(v);
};

/** 셀 묶음 → 종목 평균 숫자 (요약·구간 표 공용). 20차 칸(앞 8개)은 계산이 그대로다 */
export function customStats(cells: Cell[], who: { symbol: string; name: string | null }[]): BacktestCustomStats {
  const per = cells.map((c) => {
    const n = c.list.length;
    return {
      rule: c.rule,
      hold: c.hold,
      random: c.random,
      trades: c.trades,
      avg: n ? round2(c.list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
      win: n ? round2((c.list.filter((t) => t.returnPct > 0).length / n) * 100) : null,
      mdd: toMdd(c.curve),
    };
  });
  // MDD — 종목 평균과 가장 나쁜 종목
  let worst: BacktestCustomStats['mddWorst'] = null;
  per.forEach((p, i) => {
    if (p.mdd != null && (worst == null || p.mdd < worst.value)) worst = { ...who[i], value: p.mdd };
  });
  // Profit Factor — 모든 종목·모든 거래를 모아 (+ 합) ÷ |− 합|
  const all = cells.flatMap((c) => c.list);
  const gain = all.filter((t) => t.returnPct > 0).reduce((a, t) => a + t.returnPct, 0);
  const loss = Math.abs(all.filter((t) => t.returnPct < 0).reduce((a, t) => a + t.returnPct, 0));
  const exits = Object.fromEntries(
    EXIT_NAMES.map((k) => [k, all.length ? round2((all.filter((t) => t.exitKind === k).length / all.length) * 100) : 0]),
  ) as Record<BacktestExitName, number>;
  return {
    symbols: cells.length,
    rule: mean(per.map((p) => p.rule)),
    hold: mean(per.map((p) => p.hold)),
    random: mean(per.map((p) => p.random)),
    avgTradeReturn: mean(per.map((p) => p.avg)),
    winRate: mean(per.map((p) => p.win)),
    avgTrades: mean(per.map((p) => p.trades)),
    weakSymbols: per.filter((p) => p.trades < MIN_TRADES).length,
    mdd: mean(per.map((p) => p.mdd)),
    mddWorst: worst,
    profitFactor: all.length && loss > 0 ? round2(gain / loss) : null,
    profitFactorNote: !all.length ? '거래 없음' : loss === 0 ? '손실 거래 없음' : null,
    exits: all.length ? exits : null,
  };
}

/**
 * 사용자 시험 본체 — 같은 종목·같은 기간에 조건 1~3개. 종목마다 캔들·지표를 **한 번** 받아 모든 조건에 쓴다.
 * 구간 = 1년(252 완성 거래일)씩 `years` 개, 구간마다 빈손으로 시작해 끝 종가로 정리(고정 시험과 같다). 기간 전체 = 구간 수익률 복리.
 * 일봉이 모자라거나 오류가 난 종목은 `excluded` 에 이유와 함께 — 조용히 빼지 않는다.
 * 미래 누설: 첫 종목(계산되는)에서 `leakCheck` 한 번 — 조건들이 쓰는 이동평균을 모두 본다. 실패하면 결과를 내지 않는다(LeakError).
 * ⚠️ 주문을 내지 않는다.
 */
export async function runCustomBacktest(input: BacktestInput, onProgress?: ResearchProgress): Promise<BacktestCustomReport> {
  const t0 = Date.now();
  let indicatorCalls = 0;
  let rssMax = process.memoryUsage().rss;
  const sample = () => (rssMax = Math.max(rssMax, process.memoryUsage().rss));
  const days = SEGMENT_DAYS * input.years;
  const warmup = customWarmupNeeded(input);
  const info = namesAndSectors(input.symbols);
  const options = input.conditions.map(conditionOptions);
  // 누설 검사: 첫 조건의 선 + 다른 조건이 쓰는 이동평균 (조건 하나면 예전과 같은 검사)
  const extraMa = [...new Set(input.conditions.slice(1).flatMap((c) => [c.rule.maShort, c.rule.maLong]))];

  const done: { symbol: string; segsBy: Cell[][]; holdCurves: number[][]; dates: { from: string; to: string }[] }[] = [];
  const excluded: BacktestCustomReport['excluded'] = [];
  let leak: BacktestCustomReport['leakCheck'] = { symbol: '', bars: 0, ok: true };
  const total = input.symbols.length;

  for (let n = 0; n < total; n++) {
    const symbol = input.symbols[n];
    onProgress?.(n, total, symbol);
    try {
      const candles = completedDaily(await getCandles(symbol, '1d', days + WARMUP), symbol);
      if (candles.length < days + warmup) {
        throw new Error(`일봉이 ${candles.length}개뿐입니다 — ${input.years}년 시험에 ${days}개 + 지표 준비 ${warmup}개가 필요합니다(상장이 짧은 종목 등)`);
      }
      const series: IndicatorSeries = await computeIndicators(candles);
      indicatorCalls++;
      const first = candles.length - days;
      if (!leak.symbol) {
        const bad = await leakCheck(candles, series, first, options[0].rule, extraMa);
        indicatorCalls += candles.length - first;
        leak = { symbol, bars: candles.length - first, ok: !bad };
        console.log(`[backtest] 미래 누설 검사 ${symbol} ${leak.bars}봉: ${bad ? `실패 — ${bad}` : '통과'}`);
        if (bad) throw new LeakError(`미래 누설 검사 실패(${symbol}): ${bad}`);
      }
      const runs = options.map((o) => simulateSegments(symbol, candles, series, input.years, o));
      done.push({ symbol, segsBy: runs.map((r) => r.segs), holdCurves: runs[0].holdCurves, dates: runs[0].dates });
    } catch (e) {
      if (e instanceof LeakError || e instanceof IndicatorEngineError) throw e; // 엔진 꺼짐·누설은 결과로 꾸미지 않는다
      excluded.push({ symbol, name: info.get(symbol)?.name ?? null, reason: (e as Error).message });
    }
    sample();
  }
  onProgress?.(total, total, '');

  // 기간 전체 셀(구간 복리, 거래 목록·자산 곡선은 이어 붙인다)
  const whole = (segs: Cell[]): Cell => ({
    rule: compound(segs.map((c) => c.rule)),
    hold: segs.every((c) => c.hold != null) ? compound(segs.map((c) => c.hold!)) : null,
    random: segs.every((c) => c.random != null) ? compound(segs.map((c) => c.random!)) : null,
    trades: segs.reduce((a, c) => a + c.trades, 0),
    list: segs.flatMap((c) => c.list),
    curve: chainCurves(segs.map((c) => c.curve)),
  });
  const who = done.map((d) => ({ symbol: d.symbol, name: info.get(d.symbol)?.name ?? null }));
  const segDates = done[0]?.dates ?? [];

  const conditions: BacktestConditionResult[] = input.conditions.map((condition, ci) => {
    const wholeCells = done.map((d) => whole(d.segsBy[ci]));
    const summary = customStats(wholeCells, who);
    const segmentRows =
      input.years > 1 ? segDates.map((d, k) => ({ segment: k + 1, ...d, ...customStats(done.map((x) => x.segsBy[ci][k]), who) })) : [];
    const symbols: BacktestCustomSymbol[] = done.map((d, i) => {
      const c = wholeCells[i];
      const n = c.list.length;
      return {
        symbol: d.symbol,
        name: info.get(d.symbol)?.name ?? null,
        sector: info.get(d.symbol)?.sector ?? null,
        trades: c.trades,
        winRate: n ? round2((c.list.filter((t) => t.returnPct > 0).length / n) * 100) : null,
        avgReturn: n ? round2(c.list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
        stopRate: n ? round2((c.list.filter((t) => t.exitKind === 'stop').length / n) * 100) : null,
        rule: c.rule,
        hold: c.hold,
        random: c.random,
        mdd: toMdd(c.curve),
        holdMdd: toMdd(chainCurves(d.holdCurves)),
      };
    });
    return {
      label: condition.label,
      condition,
      summary: { ...summary, hardToTell: summary.symbols === 0 || summary.weakSymbols * 2 >= summary.symbols },
      segmentRows,
      symbols,
    };
  });

  // 그냥 들고 있기 — 조건과 무관
  const holdMdds = done.map((d) => toMdd(chainCurves(d.holdCurves)));
  let holdWorst: BacktestCustomReport['hold']['mddWorst'] = null;
  holdMdds.forEach((v, i) => {
    if (v != null && (holdWorst == null || v < holdWorst.value)) holdWorst = { ...who[i], value: v };
  });

  sample();
  return {
    kind: 'custom',
    input,
    segments: segDates.map((d, k) => ({ segment: k + 1, ...d })),
    conditions,
    hold: { rule: conditions[0]?.summary.hold ?? null, mdd: mean(holdMdds), mddWorst: holdWorst },
    excluded,
    leakCheck: leak,
    measure: { ms: Date.now() - t0, indicatorCalls, rssMaxMb: Math.round(rssMax / 1048576), symbols: total },
    computedAt: new Date().toISOString(),
  };
}

// ── 보고서(md) ───────────────────────────────────────────────────────────────

const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const VERDICT_LABEL: Record<BacktestVerdictKind, string> = { good: '기준선보다 좋음', bad: '기준선 이하', hold: '판단 보류' };

export function researchMarkdown(r: BacktestReport): string {
  const md: string[] = [];
  md.push(`# 규칙형 3가지 방법 — 3년 백테스트 (${r.computedAt.slice(0, 10)})`, '');
  md.push(`사전 등록 ${r.version} · 유니버스 기준 ${r.universeAsOf.slice(0, 10)} · 계산 ${Math.round(r.measure.ms / 1000)}초`, '');
  md.push('## 사전 등록 (결과를 보기 전에 고정)', '');
  md.push('| 항목 | 규칙 |', '|---|---|');
  md.push(`| 대상 | universe.json 미국 100 ∩ 7분야(${BACKTEST_SECTORS.join('·')}). 섹터 없음 → 한 번 채우고 그래도 없으면 「미확인」 으로 뺌 |`);
  md.push(`| 기간 | 최근 완성 거래일 ${RESEARCH_DAYS}개, ${SEGMENT_DAYS}개씩 ${SEGMENTS}구간 |`);
  md.push(`| 체결·비용·손절 | 다음 날 시가 · 같은 날이면 손절 먼저 · 왕복 ${ROUND_TRIP_COST}%p · 손절 ${STOP_LOSS}% · 트레일링 끔 · 구간마다 빈손으로 시작, 끝 종가 정리 |`);
  md.push('| 기준선 1 | 그냥 들고 있기(구간 첫날 시가 → 마지막 종가, 비용 반영) |');
  md.push(`| 기준선 2 | 아무 날이나 사고팔기 — 같은 거래 횟수·같은 보유일, 겹치지 않는 무작위 날짜, 시드 고정 ${RANDOM_RUNS}번 평균 |`);
  md.push('| 비교 숫자 | 구간별 "이 방법 1년 전체 − 기준선" 종목 평균. 3년 = 세 구간 복리 |');
  md.push(`| 판정 | 기준선마다 ① 3구간 중 2구간 이상 > 0 ② 3년 종목별 차이 부트스트랩(${BOOTSTRAP}회) 95% 하한 > 0 ③ 3년 거래 10회 이상 종목 절반 이상. ③만 아니면 판단 보류. 방법 = 두 기준선 모두 좋음일 때만 좋음 |`);
  md.push(`| 분야별 | 3년 이 방법 − 들고 있기, 분야 종목 ${SECTOR_MIN}개 미만 「표본 적음」, 판정 없음 |`);
  md.push(`| 미래 누설 | 첫 종목 ${RESEARCH_DAYS}봉 전체 \`leakCheck\` |`, '');
  md.push('## 대상', '');
  const bySector = BACKTEST_SECTORS.map((s) => `${s} ${r.targets.included.filter((t) => t.sector === s).length}`).join(' · ');
  md.push(`- 포함 ${r.targets.included.length}종목: ${bySector}`);
  md.push(`- 분야 밖이라 뺀 종목 ${r.targets.outOfSector.length}개: ${r.targets.outOfSector.map((t) => `${t.symbol}(${t.sector})`).join(', ') || '없음'}`);
  md.push(`- 분야를 확인하지 못한 종목 ${r.targets.unknown.length}개: ${r.targets.unknown.map((t) => t.symbol).join(', ') || '없음'}`);
  const errs = r.symbols.filter((s) => s.error);
  md.push(`- 계산하지 못한 종목 ${errs.length}개: ${errs.map((s) => `${s.symbol}(${s.error})`).join(', ') || '없음'}`);
  md.push(`- 구간: ${r.segments.map((s) => `${s.segment}년차 ${s.from} ~ ${s.to}`).join(' · ')}`, '');
  md.push('## 방법별 결과', '');
  for (const m of r.methods) {
    md.push(`### ${m.title} — ${VERDICT_LABEL[m.verdict]}`, '');
    md.push('| 구간 | 이 방법(1년 전체) | 들고 있기 | 아무 날이나 | 한 번 평균 | 이긴 거래 | 거래 10회 미만 종목 | − 들고 있기 | − 아무 날이나 |');
    md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of m.segments) {
      md.push(`| ${s.segment}년차 | ${pct(s.avgRule)} | ${pct(s.avgHold)} | ${pct(s.avgRandom)} | ${pct(s.avgTradeReturn)} | ${s.avgWinRate == null ? '—' : `${s.avgWinRate}%`} | ${s.weakSymbols}/${s.symbols} | ${fmt(s.diffHold)} | ${fmt(s.diffRandom)} |`);
    }
    md.push('', `- ${m.vsHold.why}`, `- ${m.vsRandom.why}`, '');
  }
  md.push('## 분야별 (3년 이 방법 − 들고 있기, 설명용 — 판정 없음)', '');
  md.push(`| 분야 | 종목 | ${r.methods.map((m) => m.title).join(' | ')} |`);
  md.push(`|---|---:|${r.methods.map(() => '---:').join('|')}|`);
  for (const s of r.sectors) {
    md.push(`| ${s.sector}${s.weak ? ' (표본 적음)' : ''} | ${s.symbols} | ${r.methods.map((m) => fmt(s.byMethod[m.id])).join(' | ')} |`);
  }
  md.push('', '분야별 숫자는 설명용입니다. 강한 분야가 다음에도 강한지는 확인되지 않았습니다(섹터 강세 지속성 시험은 6개 중 0개 통과, v2.21.0).', '');
  md.push('## 미래 누설 검사', '', `${r.leakCheck.symbol} ${r.leakCheck.bars}봉 — ${r.leakCheck.ok ? '통과' : '실패'}`, '');
  md.push('## 측정', '', `- 시간 ${Math.round(r.measure.ms / 1000)}초 · 지표 엔진 호출 ${r.measure.indicatorCalls}회 · 서버 메모리 최대 ${r.measure.rssMaxMb}MB · 종목 ${r.measure.symbols}`, '');
  md.push('## 한계', '');
  md.push('- 과거 결과이며 앞으로를 보장하지 않습니다.');
  md.push('- 오늘의 시가총액 상위 종목으로 과거를 시험했습니다 — 그동안 사라지거나 순위에서 밀린 종목이 빠져 실제보다 좋게 보일 수 있습니다(생존 편향).');
  md.push('- 종목마다 따로 계산했습니다 — 실제 계좌의 비중·동시 보유 한도는 반영하지 않았습니다.');
  md.push('- 어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.');
  md.push('- 참고: 섹터 강세 지속성 시험은 6개 중 0개 통과(v2.21.0).');
  return md.join('\n');
}
