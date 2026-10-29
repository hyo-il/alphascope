/**
 * 오늘 시황 — 60일 안 실적 일정 + 전망치 4종 (Stockproject `earnings_collector.py` 를 옮김).
 *
 * - 대상: `earningsTargets()`(시총 상위 100 × 미 · 국 + 관심 + 자동매매 종목 — 사용자 결정). 원본 78종목 목록을 들이지 않는다.
 * - 실적일은 **`getEarningsDate()` 만** 읽는다(실적일 소스는 `earningsCalendar.ts` 한 곳 — 네트워크 없이 DB 에서). = 원본의 1단계.
 * - 60일 안에 실적이 있는 종목만 지표 엔진 `/earnings-estimates` 로 전망치를 받는다 = 원본의 2단계.
 *   10종목씩 묶어 1초 간격으로 차례로(`earningsCalendar.ts` 처럼 몰아 치지 않는다) · 전체 4분 상한(넘으면 남은 종목은 전망치 없이).
 * - sanity 규칙 · 표기는 원본 그대로(아래 `buildEarning`). 국내 종목(AlphaScope 6자리)은 원화 표기.
 * - 섹터 = 종목 지도와 같은 한국어 섹터(`stock_profiles.sector` → `data/sectors.sectorKo`). 주도 섹터 이름과 **같은 글자**여야
 *   후처리 ①(주도 섹터 거르기)이 맞는다 — 그래서 AI 에게도 이 이름 목록(`BRIEF_SECTORS`)에서만 고르게 한다.
 */

import { getDb } from '../db';
import { earningsTargets, getEarningsDate } from '../earningsCalendar';
import { findNames } from '../stockCatalog';
import { SECTOR_KO, sectorKo } from '../../src/data/sectors';
import { isKrSymbol } from '../../src/utils/market';
import type { BriefEarning } from '../../src/types/marketBrief';

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;
export const EARNINGS_DAYS_AHEAD = 60;
const CHUNK = 10;
const GAP_MS = 1000;
/** 전망치 받기 전체 상한 — 원본 2단계 상한(120초)보다 길다(대상이 원본 78종목보다 많고 나란히 4개만 받는다) */
const ESTIMATES_BUDGET_MS = 240_000;

/** 주도 섹터 이름으로 고를 수 있는 것 — 종목 지도와 같은 한국어 섹터(원본 EXTENDED_TICKERS 의 sector_kr 12개 자리) */
export const BRIEF_SECTORS = Object.values(SECTOR_KO);

/** 지표 엔진이 주는 전망치 원값 — 원본 4개 헬퍼의 결과를 한 줄로 */
export interface RawEstimate {
  symbol: string;
  ok: boolean;
  epsEstimate?: number | null;
  lastQuarterEps?: number | null;
  yearAgoEps?: number | null;
  revenueAvg?: number | null;
  yearAgoRevenue?: number | null;
  epsAvg?: number | null;
  epsHigh?: number | null;
  epsLow?: number | null;
  recommendation?: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
}

// ── 표기 (원본 _fmt_eps · _fmt_money · _fmt_recommendation) ─────────────────

const comma = (n: number) => n.toLocaleString('en-US');

export function fmtEps(value: number | null | undefined, kr: boolean): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return kr ? `₩${comma(Math.round(value))}` : `$${value.toFixed(2)}`;
}

export function fmtMoney(value: number | null | undefined, kr: boolean): string {
  if (value == null || !Number.isFinite(value)) return '-';
  const a = Math.abs(value);
  if (kr) {
    if (a >= 1e12) return `₩${(value / 1e12).toFixed(1)}조`;
    if (a >= 1e8) return `₩${comma(Math.round(value / 1e8))}억`;
    return `₩${comma(Math.round(value))}`;
  }
  if (a >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(2)}`;
}

export function fmtRecommendation(rec: RawEstimate['recommendation']): string {
  if (!rec) return '-';
  const total = rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
  if (!total) return '-';
  const buy = rec.strongBuy + rec.buy;
  const sell = rec.sell + rec.strongSell;
  if (buy >= Math.max(rec.hold, sell)) return `Buy (${buy}/${total})`;
  if (sell >= rec.hold) return `Sell (${sell}/${total})`;
  return `Hold (${rec.hold}/${total})`;
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** YYYY-MM-DD → 「MM/DD(요일)」(원본 표기 — AI 입력 · 일정 날짜) */
export function dateLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${day.slice(5, 7)}/${day.slice(8, 10)}(${WEEKDAY[d.getUTCDay()]})`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export interface EarningBase {
  symbol: string;
  name: string;
  sector: string;
  date: string;
  daysUntil: number;
  isEstimateDate: boolean;
}

/** 원본 3단계 — 결과 조합 + sanity 검사 */
export function buildEarning(base: EarningBase, est: RawEstimate | null): BriefEarning {
  const kr = isKrSymbol(base.symbol);
  const e = est?.ok ? est : null;
  const eps = e?.epsEstimate ?? null;
  const lastQ = e?.lastQuarterEps ?? null;
  const high = e?.epsHigh ?? null;
  const low = e?.epsLow ?? null;
  const revAvg = e?.revenueAvg ?? null;
  const revYearAgo = e?.yearAgoRevenue ?? null;

  let epsSanityFlag = false;
  // 규칙 1: 직전 분기 실제 EPS 대비 2.5배 초과 또는 0.4배 미만
  if (eps != null && lastQ != null && lastQ > 0) {
    const ratio = eps / lastQ;
    if (ratio > 2.5 || ratio < 0.4) epsSanityFlag = true;
  }
  // 규칙 2: 컨센서스 분산 (최고 − 최저) / (2 × 평균) > 50%
  let epsDispersion = '-';
  if (high != null && low != null && eps != null && eps > 0) {
    const dispersion = (high - low) / (2 * eps);
    if (dispersion > 0.5) epsSanityFlag = true;
    // 30% 이상일 때만 보인다
    if (dispersion * 100 >= 30) epsDispersion = `분산 ±${(dispersion * 100).toFixed(0)}%`;
  }
  // 매출: 전년 동기 대비 3배 초과 또는 0.3배 미만이면 노이즈로 보고 숨긴다
  let revenueSanityFlag = false;
  if (revAvg != null && revYearAgo != null && revYearAgo > 0) {
    const ratio = revAvg / revYearAgo;
    if (ratio > 3 || ratio < 0.3) revenueSanityFlag = true;
  }

  return {
    ...base,
    epsEstimate: fmtEps(eps, kr),
    lastQuarterEps: fmtEps(lastQ, kr),
    yoyEps: fmtEps(e?.yearAgoEps ?? null, kr),
    revenueEstimate: revenueSanityFlag ? '-' : fmtMoney(revAvg, kr),
    recommendation: fmtRecommendation(e?.recommendation ?? null),
    epsDispersion,
    epsSanityFlag,
    revenueSanityFlag,
    estimatesOk: Boolean(e),
  };
}

/** 원본 earnings_text 한 줄 — `[D+N]` 을 붙여 AI 가 슬롯을 날짜로 고르게 한다(원본 주의사항 31) */
export function earningsLine(e: BriefEarning): string {
  const flag = e.epsSanityFlag ? ' ⚠️' : '';
  const disp = e.epsDispersion !== '-' ? `, ${e.epsDispersion}` : '';
  const rev = e.revenueEstimate !== '-' ? ` / 매출 ${e.revenueEstimate}` : '';
  return (
    `- ${dateLabel(e.date)} [D+${e.daysUntil}] [${e.sector}] ${e.name}(${e.symbol})\n` +
    `    예상 EPS ${e.epsEstimate}${flag} (직전분기 실제 ${e.lastQuarterEps}, 전년동기 실제 ${e.yoyEps}${disp})${rev}` +
    ` / 컨센서스 ${e.recommendation}`
  );
}

// ── 모으기 ──────────────────────────────────────────────────────────────

function sectorsOf(symbols: string[]): Record<string, string> {
  if (!symbols.length) return {};
  const rows = getDb()
    .prepare(`SELECT symbol, sector FROM stock_profiles WHERE symbol IN (${symbols.map(() => '?').join(',')})`)
    .all(...symbols) as { symbol: string; sector: string | null }[];
  return Object.fromEntries(rows.map((r) => [r.symbol, sectorKo(r.sector)]));
}

/** 1단계 — 60일(오늘 포함) 안에 실적일이 있는 대상. 네트워크 없음(저장된 실적일만) */
export function upcomingEarningBases(today: string, targets: string[] = earningsTargets()): EarningBase[] {
  const hits: { symbol: string; date: string; isEstimate: boolean }[] = [];
  for (const symbol of targets) {
    const e = getEarningsDate(symbol);
    if (!e) continue;
    const days = daysBetween(today, e.date);
    if (days >= 0 && days <= EARNINGS_DAYS_AHEAD) hits.push({ symbol, date: e.date, isEstimate: e.isEstimate });
  }
  const names = findNames(hits.map((h) => h.symbol));
  const sectors = sectorsOf(hits.map((h) => h.symbol));
  return hits
    .map((h) => ({
      symbol: h.symbol,
      name: names[h.symbol] ?? h.symbol,
      sector: sectors[h.symbol] ?? '기타',
      date: h.date,
      daysUntil: daysBetween(today, h.date),
      isEstimateDate: h.isEstimate,
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.symbol.localeCompare(b.symbol));
}

export type EstimatesFetcher = (symbols: string[]) => Promise<RawEstimate[]>;

export const fetchEstimates: EstimatesFetcher = async (symbols) => {
  const response = await fetch(`${ENGINE_URL}/earnings-estimates?symbols=${encodeURIComponent(symbols.join(','))}`, {
    signal: AbortSignal.timeout(120_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { estimates?: RawEstimate[]; error?: string };
  if (!response.ok || !payload.estimates) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
  return payload.estimates;
};

export interface EarningsCollection {
  earnings: BriefEarning[];
  /** 전망치를 받은 종목 수 / 요청한 종목 수 · 묶음 실패 */
  estimatesOk: number;
  estimatesTried: number;
  error: string | null;
}

/** 2 · 3단계 — 전망치를 받아 조합. 묶음 하나가 실패해도 나머지는 계속(그 묶음은 전망치 없이) */
export async function collectEarnings(
  today: string,
  deps: { bases?: EarningBase[]; fetcher?: EstimatesFetcher; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<EarningsCollection> {
  const bases = deps.bases ?? upcomingEarningBases(today);
  const fetcher = deps.fetcher ?? fetchEstimates;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const started = now();
  const estimates = new Map<string, RawEstimate>();
  let error: string | null = null;
  for (let i = 0; i < bases.length; i += CHUNK) {
    if (now() - started > ESTIMATES_BUDGET_MS) {
      error = `전망치 받기 상한(${ESTIMATES_BUDGET_MS / 60_000}분)을 넘어 ${bases.length - i}종목은 실적일만`;
      break;
    }
    const chunk = bases.slice(i, i + CHUNK).map((b) => b.symbol);
    try {
      for (const est of await fetcher(chunk)) estimates.set(est.symbol, est);
    } catch (e) {
      error = `전망치 일부 받기 실패: ${(e as Error).message}`;
    }
    if (i + CHUNK < bases.length) await sleep(GAP_MS);
  }
  const earnings = bases.map((b) => buildEarning(b, estimates.get(b.symbol) ?? null));
  return {
    earnings,
    estimatesOk: earnings.filter((e) => e.estimatesOk).length,
    estimatesTried: bases.length,
    error,
  };
}
