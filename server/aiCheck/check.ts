/**
 * AI 검증 (퀀트 다시 만들기 4단계) — **한 곳**.
 *
 * 계좌 자동매매의 매수 경로(`autoTrading/engine.tryBuy`)가 규칙 「사도 됨」 → 하루 손실 한도 → 실적 발표 전 → 최대 보유 → 수량·현금(`planBuy`)을
 * 모두 지난 **뒤**, 주문 **앞**에서 부른다(실제로 살 수 있을 때만 — 한도를 아낀다). 매도에는 쓰지 않는다.
 *
 * - 질문 1번(Gemini 1회, `AI_CHECK_PROMPT_VERSION`) · 답 = 「통과 / 위험」 + 이유 1~3줄. 주는 정보는 `input_json` 에 그대로 남긴다.
 * - 답을 못 하면(꺼짐 · 하루 한도 · 429 · 오류 · 60초 넘음 · 형식) **사지 않는다**(「검증 못 함」).
 * - 같은 날(그 종목 시장 날짜) 같은 종목은 한 번만 묻는다 — 저장된 줄이 있으면 그대로, 진행 중이면 그 Promise 를 같이 기다린다.
 * - 하루 최대 `AI_CHECK_DAILY_LIMIT` 번(한국 시간 날짜, 모든 계좌 합계) — 셈은 `ai_checks` 에서 + 지금 진행 중인 호출.
 *
 * ⚠️ 주문 모듈을 import 하지 않는다 — 판정만 돌려주고 사고 말고는 엔진이 정한다.
 */
import { callGemini, GeminiError, isGeminiEnabled, type GeminiCallOptions, type GeminiCallResult } from '../gemini/client';
import { getNews } from '../news';
import { getEarningsDate } from '../earningsCalendar';
import { tradingDaysUntil } from '../autoTrading/guards';
import { judgeOnClose } from '../rules/judge';
import { marketOf } from '../marketHours';
import { findStock } from '../stockCatalog';
import { marketDate } from '../../src/utils/marketDate';
import { BUY_CONDITION_NAME } from '../../src/utils/ruleText';
import {
  AI_CHECK_DAILY_LIMIT,
  AI_CHECK_TIMEOUT_MS,
  type AiUnavailableReason,
} from '../../src/types/aiCheck';
import type { RuleEvaluation } from '../rules/engine';
import type { RuleBody } from '../../src/types/tradingRule';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import { countCallsOn, findCheck, insertCheck, type AiCheckRow } from './store';

/** 질문·답 모양을 고치면 올린다 */
export const AI_CHECK_PROMPT_VERSION = 'ai-check-v1';

/** 한국 시간 날짜(하루 횟수 기준) — 앱의 다른 곳과 같은 관례 */
export const kstDate = (now: Date) => marketDate(now.getTime(), '005930');

// ── 시험용 바꿔치기 ──────────────────────────────────────────────────────
type RawAnswer = { verdict?: unknown; reasons?: unknown };
type Caller = (options: GeminiCallOptions) => Promise<GeminiCallResult<RawAnswer>>;
const defaultCaller: Caller = (o) => callGemini<RawAnswer>(o);
let caller: Caller = defaultCaller;
let enabledOverride: boolean | null = null;
let timeoutMs = AI_CHECK_TIMEOUT_MS;
let calls = 0;
type NewsLookup = typeof getNews;
type EarningsLookup = typeof getEarningsDate;
let newsLookup: NewsLookup = getNews;
let earningsLookup: EarningsLookup = getEarningsDate;
/** `autotrade:test` 전용 — 가짜 답 · Gemini 켬/끔 · 시간 제한 · 뉴스 · 실적일. null 이면 원래대로 */
export function setAiCheckForTest(opts: {
  caller?: Caller | null;
  enabled?: boolean | null;
  timeoutMs?: number | null;
  news?: NewsLookup | null;
  earnings?: EarningsLookup | null;
}): void {
  if (opts.caller !== undefined) caller = opts.caller ?? defaultCaller;
  if (opts.enabled !== undefined) enabledOverride = opts.enabled;
  if (opts.timeoutMs !== undefined) timeoutMs = opts.timeoutMs ?? AI_CHECK_TIMEOUT_MS;
  if (opts.news !== undefined) newsLookup = opts.news ?? getNews;
  if (opts.earnings !== undefined) earningsLookup = opts.earnings ?? getEarningsDate;
}
/** 시험용 — 이 프로세스에서 실제로 caller 를 부른 수 */
export const aiCheckCallsForTest = () => calls;

// ── 주는 정보 ──────────────────────────────────────────────────────────────
export interface AiCheckInput {
  symbol: string;
  name: string | null;
  market: 'US' | 'KR';
  currency: 'USD' | 'KRW';
  /** 지금 가격(검증 때 가격) */
  price: number;
  /** 판단 기준 봉(끝난 봉) 날짜 */
  basisDate: string;
  /** 최근 60거래일(끝난 봉) — 날짜 · 종가 · 등락률(%) · 거래량 */
  bars: { date: string; close: number; changePct: number | null; volume: number }[];
  /** 엔진이 쓴 같은 지표의 기준 봉 값 */
  indicators: Record<string, number | null>;
  /** 이번 판단의 규칙 점수 · 참고 계획 */
  rule: {
    score: number;
    maxScore: number;
    minScore: number;
    conditions: { name: string; score: number; max: number }[];
    plan: { stop: number; target1: number; target2: number; ratio: number } | null;
  };
  /** 최근 7일 뉴스 제목(최대 10건 — 제목 · 발행처 · 시각). 뉴스 AI 판정은 넣지 않는다 */
  news: { no: number; title: string; publisher: string | null; publishedAt: string }[];
  newsNote: string | null;
  /** 다음 실적 발표일 · 남은 거래일 */
  earnings: { date: string; isEstimate: boolean; tradingDaysLeft: number } | null;
}

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const lastOf = (line: (number | null)[] | undefined, i: number) => (line ? r2(line[i]) : null);

async function buildInput(symbol: string, price: number, ev: RuleEvaluation, candles: Candle[], series: IndicatorSeries, rule: RuleBody, now: Date): Promise<AiCheckInput> {
  const i = candles.length - 1;
  const recent = candles.slice(-61);
  const bars = recent.slice(1).map((c, k) => ({
    date: marketDate(c.timestamp, symbol),
    close: r2(c.close)!,
    changePct: recent[k].close > 0 ? r2((c.close / recent[k].close - 1) * 100) : null,
    volume: Math.round(c.volume),
  }));
  const s = series as unknown as Record<string, (number | null)[]>;
  const indicators: Record<string, number | null> = {
    'RSI(14)': lastOf(s.rsi14, i),
    '20일선': lastOf(s.sma20, i),
    '60일선': lastOf(s.sma60, i),
    'MACD(12,26,9)': lastOf(s.macd, i),
    'MACD 시그널': lastOf(s.macdSignal, i),
    'MACD 히스토그램': lastOf(s.macdHistogram, i),
    '볼린저(20,2) 상단': lastOf(s.bbUpper, i),
    '볼린저(20,2) 중간': lastOf(s.bbMiddle, i),
    '볼린저(20,2) 하단': lastOf(s.bbLower, i),
  };
  let news: AiCheckInput['news'] = [];
  let newsNote: string | null = null;
  try {
    const list = await newsLookup(symbol);
    const since = now.getTime() - 7 * 86_400_000;
    news = list.items
      .filter((n) => n.publishedAt && Date.parse(n.publishedAt) >= since)
      .slice(0, 10)
      .map((n, k) => ({ no: k + 1, title: n.title, publisher: n.publisher, publishedAt: n.publishedAt! }));
    if (!news.length) newsNote = '최근 7일 뉴스 없음';
  } catch (error) {
    newsNote = `뉴스를 불러오지 못함 (${(error as Error).message})`;
  }
  const market = marketOf(symbol);
  const today = marketDate(now.getTime(), symbol);
  const e = earningsLookup(symbol);
  const earnings = e && e.date >= today ? { date: e.date, isEstimate: e.isEstimate, tradingDaysLeft: tradingDaysUntil(today, e.date, market) } : null;
  return {
    symbol,
    name: findStock(symbol)?.name ?? null,
    market,
    currency: market === 'KR' ? 'KRW' : 'USD',
    price: r2(price)!,
    basisDate: marketDate(candles[i].timestamp, symbol),
    bars,
    indicators,
    rule: {
      score: ev.score,
      maxScore: ev.maxScore,
      minScore: rule.buy.minScore,
      conditions: ev.breakdown.filter((c) => c.on).map((c) => ({ name: BUY_CONDITION_NAME[c.key], score: c.score, max: c.max })),
      plan: ev.reference ? { stop: r2(ev.reference.stop)!, target1: r2(ev.reference.target1)!, target2: r2(ev.reference.target2)!, ratio: r2(ev.reference.ratio)! } : null,
    },
    news,
    newsNote,
    earnings,
  };
}

// ── 질문 ──────────────────────────────────────────────────────────────────
const SYSTEM = [
  '너는 주식을 사기 직전에 위험만 점검하는 보조자다. 매매 규칙이 이 종목을 「사도 됨」 으로 골랐다.',
  '너의 일은 하나다: 이 종목을 지금 사서 며칠~몇 주 들고 가는 것이 위험한지만 판단한다.',
  '- 주어진 정보(가격 흐름 · 지표 · 규칙 점수 · 뉴스 제목 · 실적 발표일)에 있는 근거로만 RISK 라고 한다. 근거가 없으면 PASS.',
  '- 주어지지 않은 사실 · 숫자 · 사건을 지어내지 않는다. 뉴스는 제목뿐이다 — 제목에 없는 내용을 쓰지 않는다.',
  '- 이유는 1~3개, 한국어 한 줄씩(80자 이내). 이유마다 근거를 괄호로 적는다: 뉴스는 [뉴스 번호], 지표는 지표 이름(예: RSI(14)), 실적일은 (실적일).',
  '- PASS 여도 이유를 1개 이상 적는다(위험 근거가 왜 없는지).',
  '- 매수 · 매도를 권유하지 않는다. 투자 조언이 아니다.',
].join('\n');

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['PASS', 'RISK'], description: 'PASS = 위험 근거 없음 · RISK = 주어진 정보에 위험 근거가 있음' },
    reasons: { type: 'ARRAY', items: { type: 'STRING' }, description: '1~3개, 한국어 한 줄(80자 이내), 근거를 괄호로' },
  },
  required: ['verdict', 'reasons'],
};

export function promptText(input: AiCheckInput): string {
  const money = (v: number) => (input.currency === 'KRW' ? `₩${Math.round(v).toLocaleString('ko-KR')}` : `$${v.toFixed(2)}`);
  const lines: string[] = [];
  lines.push(`# 종목: ${input.name ? `${input.name} ` : ''}(${input.symbol}) · 시장 ${input.market} · 지금 가격 ${money(input.price)} · 기준 봉 ${input.basisDate}`);
  lines.push('', `## 최근 ${input.bars.length}거래일 일봉 (날짜 · 종가 · 등락률 · 거래량)`);
  for (const b of input.bars) lines.push(`${b.date} · ${b.close} · ${b.changePct == null ? '—' : `${b.changePct}%`} · ${b.volume}`);
  lines.push('', '## 지표 (기준 봉)');
  for (const [k, v] of Object.entries(input.indicators)) lines.push(`- ${k}: ${v ?? '—'}`);
  lines.push('', `## 매매 규칙 점수: 합계 ${input.rule.score}/${input.rule.maxScore} (기준 ${input.rule.minScore}점 이상이면 「사도 됨」)`);
  for (const c of input.rule.conditions) lines.push(`- ${c.name} ${c.score}/${c.max}`);
  if (input.rule.plan) lines.push(`- 참고 계획: 손절 ${money(input.rule.plan.stop)} · 1차 목표 ${money(input.rule.plan.target1)} · 2차 목표 ${money(input.rule.plan.target2)} · 손익비 ${input.rule.plan.ratio}`);
  lines.push('', '## 최근 7일 뉴스 제목');
  if (input.news.length) for (const n of input.news) lines.push(`[${n.no}] ${n.title} — ${n.publisher ?? '발행처 모름'} · ${n.publishedAt}`);
  else lines.push(input.newsNote ?? '없음');
  lines.push('', '## 실적 발표일');
  lines.push(input.earnings ? `${input.earnings.date}${input.earnings.isEstimate ? '(추정)' : ''} · 남은 거래일 ${input.earnings.tradingDaysLeft}` : '알 수 없음(예정일 정보 없음)');
  lines.push('', '위 정보만으로 판단해 verdict(PASS/RISK) 와 reasons 를 답하라.');
  return lines.join('\n');
}

/** 답 검사 — 모양이 틀리거나 이유가 비면 null(「못 함(형식)」). 이유는 3개까지, 줄마다 80자로 자른다 */
export function validateAnswer(raw: RawAnswer | null | undefined): { verdict: 'pass' | 'risk'; reasons: string[] } | null {
  if (!raw || (raw.verdict !== 'PASS' && raw.verdict !== 'RISK') || !Array.isArray(raw.reasons)) return null;
  const reasons = raw.reasons
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((x) => (x.length > 80 ? `${x.slice(0, 79)}…` : x));
  if (!reasons.length) return null;
  return { verdict: raw.verdict === 'PASS' ? 'pass' : 'risk', reasons };
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`${Math.round(ms / 1000)}초 안에 답이 없었습니다`)), ms);
    }),
  ]);
}

// ── 본체 ──────────────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<AiCheckRow>>();
/** 지금 Gemini 를 부르고 있는 수 — 아직 저장 전이라 하루 셈에 더한다(동시에 21번째가 나가지 않게) */
let pendingCalls = 0;

export interface CheckArgs {
  symbol: string;
  /** 지금 가격(검증 때 가격) */
  price: number;
  rule: RuleBody;
  /** 이번 판단의 결과·끝난 봉·지표 — 엔진이 이미 계산한 것을 그대로(없으면 여기서 다시 계산) */
  context?: { ev: RuleEvaluation; candles: Candle[]; series: IndicatorSeries };
  now?: Date;
}

/** 검증 한 번 — 같은 날 같은 종목이면 저장된 결과·진행 중 요청을 같이 쓴다. `reused` = 새로 묻지 않았다 */
export async function checkBeforeBuy(args: CheckArgs): Promise<{ row: AiCheckRow; reused: boolean }> {
  const now = args.now ?? new Date();
  const day = marketDate(now.getTime(), args.symbol);
  const saved = findCheck(day, args.symbol);
  if (saved) return { row: saved, reused: true };
  const key = `${day}|${args.symbol}`;
  const running = inflight.get(key);
  if (running) return { row: await running, reused: true };
  const p = runCheck(args, day, now).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return { row: await p, reused: false };
}

async function runCheck(args: CheckArgs, day: string, now: Date): Promise<AiCheckRow> {
  const base = {
    market_date: day,
    symbol: args.symbol,
    price_at_check: r2(args.price),
    prompt_version: AI_CHECK_PROMPT_VERSION,
    model: null as string | null,
    input_json: null as string | null,
    raw_output: null as string | null,
    tokens: null as number | null,
    elapsed_ms: null as number | null,
  };
  const unavailable = (reason: AiUnavailableReason, extra: Partial<typeof base> = {}) =>
    insertCheck({ ...base, ...extra, verdict: 'unavailable', reasons_json: '[]', unavailable_reason: reason }, now);

  const enabled = enabledOverride ?? isGeminiEnabled();
  if (!enabled) return unavailable('disabled');
  if (countCallsOn(kstDate(now)) + pendingCalls >= AI_CHECK_DAILY_LIMIT) return unavailable('daily_limit');

  pendingCalls += 1;
  const started = Date.now();
  let input: AiCheckInput | null = null;
  try {
    let ctx = args.context;
    if (!ctx) {
      const judged = await judgeOnClose(args.symbol, args.rule, { held: false }, now.getTime());
      if (judged.kind !== 'ok') return unavailable('error', { elapsed_ms: Date.now() - started });
      ctx = { ev: judged.ev, candles: judged.completed, series: judged.series };
    }
    input = await buildInput(args.symbol, args.price, ctx.ev, ctx.candles, ctx.series, args.rule, now);
    const inputJson = JSON.stringify(input);
    try {
      calls += 1;
      const result = await withTimeout(caller({ system: SYSTEM, parts: [{ text: promptText(input) }], schema: SCHEMA, temperature: 0.2 }), timeoutMs);
      const answer = validateAnswer(result.data);
      const meta = { input_json: inputJson, raw_output: result.raw, model: result.model, tokens: result.tokens, elapsed_ms: Date.now() - started };
      if (!answer) return unavailable('format', meta);
      return insertCheck({ ...base, ...meta, verdict: answer.verdict, reasons_json: JSON.stringify(answer.reasons), unavailable_reason: null }, now);
    } catch (error) {
      const reason: AiUnavailableReason =
        error instanceof TimeoutError ? 'timeout' : error instanceof GeminiError && (error.rateLimited || error.status === 429) ? 'rate_limit' : 'error';
      return unavailable(reason, { input_json: inputJson, raw_output: (error as Error).message, elapsed_ms: Date.now() - started });
    }
  } catch (error) {
    // 정보 모으기(캔들·지표·뉴스 밖의 것) 실패 — 부르지 못했지만 시도한 것이므로 오류로 남긴다
    return unavailable('error', { input_json: input ? JSON.stringify(input) : null, raw_output: (error as Error).message, elapsed_ms: Date.now() - started });
  } finally {
    pendingCalls -= 1;
  }
}
