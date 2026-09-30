/**
 * 뉴스 AI 판정 사후 검증 (v2.21.0) — `news_sentiment` 의 종합 판정(긍정·부정·중립)이 그 뒤 주가와 맞았나.
 * 진단 리포트의 5번째 카드가 쓴다. **Gemini 를 새로 부르지 않는다** — 저장된 판정만 본다.
 *
 * 채점 규칙 (여기 한 곳):
 * - 기준 거래일 D = v2.15.0 규칙(`scoringBaseIndex`) — 판정이 그 시장 정규장 마감 전이면 그날, 마감 후·휴장이면 다음 거래일.
 * - 기준 가격 = **D 직전 종가**(판정 시점에 이미 확정돼 있던 마지막 종가). 판정 행에 가격이 저장돼 있지 않아서다.
 *   n거래일 뒤 = D 부터 n번째 거래일 종가(1일 = D 의 종가, 5일 = D+4 의 종가).
 *   ⚠️ 장중 판정은 D 의 움직임이 일부 이미 보이는 상태라 1일 적중이 조금 유리할 수 있다(한계로 적는다).
 * - 적중: 긍정 = 상승 · 부정 = 하락 · 중립 = 1일 ±1% · 5일 ±2% 이내. '판단 불가' 는 채점하지 않고 따로 센다.
 * - 같은 종목·같은 날(시장 날짜)·같은 프롬프트 버전은 **마지막 1건** — `onePerDay`(Gemini 적중률과 같은 함수).
 * - 기준선 = 같은 종목·같은 날을 무조건 "상승" 으로 찍었을 때의 적중률. AI 가 이보다 높아야 의미가 있다.
 * - 캔들은 **SQLite 캐시만** 본다(Gemini 채점과 같다). 봉이 아직 없으면 대기.
 */

import { getDb } from './db';
import { dailyWithDates, onePerDay, scoringBaseIndex } from './gemini/accuracy';
import type { Candle } from '../src/types/toss';

export const NEWS_HORIZONS = [
  { days: 1, band: 1 },
  { days: 5, band: 2 },
] as const;
/** 이 건수(5일 채점 기준)가 모여야 결론을 적는다 — 다른 카드와 같은 30 */
export const NEWS_MIN_SAMPLE = 30;

type Overall = '긍정' | '부정' | '중립' | '판단 불가';

export interface NewsScoredItem {
  id: number;
  symbol: string;
  /** 판정 시각 (ISO) — onePerDay 가 쓰는 이름 */
  analyzedAt: string;
  promptVersion: string | null;
  overall: Overall;
  /** 기준 가격(D 직전 종가) — 없으면 대기 */
  base: number | null;
  /** 1·5거래일 수익률(%) — 아직 없으면 null */
  returns: { d1: number | null; d5: number | null };
  hits: { d1: boolean | null; d5: boolean | null };
}

/** 판정 하나를 채점한다 — 캔들을 받는 순수 함수(점검 스크립트가 손 검산에 쓴다) */
export function scoreNewsItem(
  item: { symbol: string; analyzedAt: string; overall: Overall },
  candles: Candle[],
  dates?: string[],
): Pick<NewsScoredItem, 'base' | 'returns' | 'hits'> {
  const empty = { base: null, returns: { d1: null, d5: null }, hits: { d1: null, d5: null } };
  const at = Date.parse(item.analyzedAt);
  if (!Number.isFinite(at) || item.overall === '판단 불가') return empty;
  const d = scoringBaseIndex(candles, at, item.symbol, dates);
  if (d < 1) return empty; // D 가 아직 없거나 그 앞 봉이 없다
  const base = candles[d - 1].close;
  const returns = { d1: null as number | null, d5: null as number | null };
  const hits = { d1: null as boolean | null, d5: null as boolean | null };
  for (const { days, band } of NEWS_HORIZONS) {
    const target = candles[d - 1 + days];
    if (!target || !base) continue;
    const r = ((target.close - base) / base) * 100;
    const hit = item.overall === '긍정' ? r > 0 : item.overall === '부정' ? r < 0 : Math.abs(r) <= band;
    returns[`d${days}`] = r;
    hits[`d${days}`] = hit;
  }
  return { base, returns, hits };
}

interface Row {
  id: number;
  symbol: string;
  created_at: string;
  output_json: string;
  prompt_version: string | null;
}

export interface NewsHorizonStats {
  judged: number;
  correct: number;
  rate: number;
  /** 무조건 "상승" 기준선 적중률(같은 표본) */
  baseline: number;
}

export interface NewsAccuracy {
  /** 묶기 전 원본 판정 수 */
  raw: number;
  /** 같은 종목·같은 날 1건으로 묶은 뒤 */
  total: number;
  /** '판단 불가' — 채점하지 않는다 */
  undetermined: number;
  d1: NewsHorizonStats;
  d5: NewsHorizonStats;
  byOverall: Record<'긍정' | '부정' | '중립', number>;
  /** 결론까지 더 필요한 5일 채점 건수 */
  need: number;
  weak: boolean;
  items: NewsScoredItem[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function stats(items: NewsScoredItem[], key: 'd1' | 'd5'): NewsHorizonStats {
  const judged = items.filter((i) => i.hits[key] !== null);
  const correct = judged.filter((i) => i.hits[key]).length;
  const up = judged.filter((i) => (i.returns[key] ?? 0) > 0).length;
  return {
    judged: judged.length,
    correct,
    rate: judged.length ? round2((correct / judged.length) * 100) : 0,
    baseline: judged.length ? round2((up / judged.length) * 100) : 0,
  };
}

export function newsAccuracy(): NewsAccuracy {
  let rows: Row[] = [];
  try {
    rows = getDb()
      .prepare(`SELECT id, symbol, created_at, output_json, prompt_version FROM news_sentiment ORDER BY created_at`)
      .all() as Row[];
  } catch {
    rows = []; // 표가 아직 없는 옛 DB
  }
  const parsed = rows.map((r) => {
    let overall: Overall = '판단 불가';
    try {
      overall = (JSON.parse(r.output_json)?.judgment?.overall as Overall) ?? '판단 불가';
    } catch {
      /* 깨진 행은 판단 불가로 */
    }
    return { id: r.id, symbol: r.symbol, analyzedAt: r.created_at, promptVersion: r.prompt_version, overall };
  });
  const daily = onePerDay(parsed);
  const items: NewsScoredItem[] = daily.map((p) => {
    const { candles, dates } = dailyWithDates(p.symbol);
    return { ...p, ...scoreNewsItem(p, candles, dates) };
  });
  const decided = items.filter((i) => i.overall !== '판단 불가');
  const d5 = stats(decided, 'd5');
  return {
    raw: rows.length,
    total: items.length,
    undetermined: items.length - decided.length,
    d1: stats(decided, 'd1'),
    d5,
    byOverall: {
      긍정: decided.filter((i) => i.overall === '긍정').length,
      부정: decided.filter((i) => i.overall === '부정').length,
      중립: decided.filter((i) => i.overall === '중립').length,
    },
    need: Math.max(0, NEWS_MIN_SAMPLE - d5.judged),
    weak: d5.judged < NEWS_MIN_SAMPLE,
    items,
  };
}
