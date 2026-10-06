/**
 * 백테스트 AI 도움 두 가지 (v2.38.0, 「실험실 > 백테스트」) — **버튼 한 번에 Gemini 1회**, 버튼으로만 부른다.
 *
 * 1. 「AI에게 조건 물어보기」(`adviseBacktest`) — 고른 종목의 **시험 기간이 시작되기 바로 전 1년(252 완성 봉)** 숫자만 보낸다.
 *    ⚠️ 시험 기간의 자료를 보내지 않는다 — 같은 기간을 보고 고른 조건은 시험 결과를 실제보다 좋게 만든다.
 *    종목이 30개를 넘으면 분야별 평균 + 종목 수로 줄여 보낸다. 응답 중 **범위 밖 값은 버린다(고치지 않는다)**,
 *    단기 ≥ 장기면 이동평균 제안 전체를 버린다. 제안은 화면에서 [이 값으로 채우기]를 눌러야 칸에 들어간다.
 * 2. 「AI에게 결과 설명 듣기」(`explainBacktest`) — 그 결과의 숫자만 보낸다. 응답 문장 속 % 숫자가 입력 숫자(±0.05)에 없으면
 *    그 문장을 뺀다(뉴스 판정의 인용 검증과 같은 생각). 설명은 그 기록에 저장해 다시 열 때 Gemini 를 부르지 않는다.
 *
 * ⚠️ `gemini_analysis` 에 저장하지 않는다(매매 신호가 아니다). 주문·자동매매와 무관하다.
 * 프롬프트·스키마를 고치면 버전(`ADVICE_PROMPT_VERSION`·`EXPLAIN_PROMPT_VERSION`)을 올린다.
 */
import { callGemini, type GeminiCallOptions, type GeminiCallResult } from './client';
import { getCandles } from '../candleService';
import { completedDaily } from '../autoTrading/ruleEngine';
import { namesAndSectors, SEGMENT_DAYS } from '../autoTrading/ruleResearch';
import { ENGINE_MA_PERIODS, RULE_LIMITS } from '../../src/types/autoTrading';
import type { BacktestAdvice, BacktestCondition, BacktestCustomReport, BacktestExplain, BacktestInput, ConditionLabel } from '../../src/types/backtest';
import { CONDITION_LABELS } from '../../src/types/backtest';

// v2 (v2.39.0): 조언에 익절 추가 · 설명은 조건 비교 모양(조건 1개도 같은 모양) + MDD·Profit Factor 숫자
export const ADVICE_PROMPT_VERSION = 'bt-advice-v2';
export const EXPLAIN_PROMPT_VERSION = 'bt-explain-v2';
/** 이보다 많으면 분야별 평균으로 줄여 보낸다 */
const SUMMARIZE_OVER = 30;
const PRE_DAYS = 252;
/** 앞 1년의 첫날에도 60일선이 있어야 한다 */
const PRE_WARMUP = 60;

type Caller = <T>(o: GeminiCallOptions) => Promise<GeminiCallResult<T>>;
const defaultCaller: Caller = (o) => callGemini(o);

const r2 = (v: number) => Math.round(v * 100) / 100;

// ── 1. 조건 물어보기 ──────────────────────────────────────────────────────────

export interface PreYearFeatures {
  /** 연 변동성 % (일간 수익률 표준편차 × √252) */
  volatility: number;
  /** ATR% 평균 (그날 움직임 폭 ÷ 종가) */
  atrPct: number;
  /** 그 1년 수익률 % */
  return1y: number;
  /** 60일선 위에 있던 날 비율 % */
  aboveMa60Pct: number;
  /** 5·20일선 교차 횟수(위·아래 모두) */
  maCross5x20: number;
  /** RSI(14) 30 이하·70 이상이었던 날 비율 % */
  rsiLow30Pct: number;
  rsiHigh70Pct: number;
}

/** 종가 배열 → Wilder RSI(14) 시리즈 (앞쪽은 null) */
function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    gain += Math.max(d, 0);
    loss += Math.max(-d, 0);
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

const smaAt = (closes: number[], i: number, n: number) => {
  if (i < n - 1) return null;
  let s = 0;
  for (let k = i - n + 1; k <= i; k++) s += closes[k];
  return s / n;
};

/** 순수 함수 — 캔들(완성 봉)과 시험 첫 봉 위치로 앞 1년 숫자를 낸다. 모자라면 null */
export function preYearFeatures(candles: { open: number; high: number; low: number; close: number }[], first: number): PreYearFeatures | null {
  const from = first - PRE_DAYS;
  if (from - PRE_WARMUP < 0) return null;
  const closes = candles.map((c) => c.close);
  const rsi = rsiSeries(closes);
  const rets: number[] = [];
  let trSum = 0;
  let above = 0;
  let crosses = 0;
  let low = 0;
  let high = 0;
  for (let i = from; i < first; i++) {
    const prev = closes[i - 1];
    rets.push(closes[i] / prev - 1);
    const c = candles[i];
    trSum += Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev)) / c.close;
    const ma60 = smaAt(closes, i, 60);
    if (ma60 != null && closes[i] > ma60) above++;
    const s0 = smaAt(closes, i - 1, 5);
    const l0 = smaAt(closes, i - 1, 20);
    const s1 = smaAt(closes, i, 5);
    const l1 = smaAt(closes, i, 20);
    if (s0 != null && l0 != null && s1 != null && l1 != null && Math.sign(s0 - l0) !== Math.sign(s1 - l1) && s1 !== l1) crosses++;
    const r = rsi[i];
    if (r != null && r <= 30) low++;
    if (r != null && r >= 70) high++;
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1));
  return {
    volatility: r2(sd * Math.sqrt(252) * 100),
    atrPct: r2((trSum / PRE_DAYS) * 100),
    return1y: r2((closes[first - 1] / closes[from - 1] - 1) * 100),
    aboveMa60Pct: r2((above / PRE_DAYS) * 100),
    maCross5x20: crosses,
    rsiLow30Pct: r2((low / PRE_DAYS) * 100),
    rsiHigh70Pct: r2((high / PRE_DAYS) * 100),
  };
}

interface RawAdvice {
  method?: string;
  maShort?: number;
  maLong?: number;
  rsiBuyBelow?: number;
  rsiSellAbove?: number;
  useMaCross?: boolean;
  useRsi?: boolean;
  hardStopLossPercent?: number;
  trailingStopEnabled?: boolean;
  trailingStopPercent?: number;
  takeProfitEnabled?: boolean;
  takeProfitPercent?: number;
  reasons?: string[];
  cautions?: string[];
}

const ADVICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    method: { type: 'STRING', enum: ['trend', 'dip', 'both', 'custom'] },
    maShort: { type: 'INTEGER', description: '5·20·60 중 하나' },
    maLong: { type: 'INTEGER', description: '20·60·120 중 하나, maShort 보다 커야 한다' },
    rsiBuyBelow: { type: 'NUMBER' },
    rsiSellAbove: { type: 'NUMBER' },
    useMaCross: { type: 'BOOLEAN' },
    useRsi: { type: 'BOOLEAN' },
    hardStopLossPercent: { type: 'NUMBER' },
    trailingStopEnabled: { type: 'BOOLEAN' },
    trailingStopPercent: { type: 'NUMBER' },
    takeProfitEnabled: { type: 'BOOLEAN' },
    takeProfitPercent: { type: 'NUMBER' },
    reasons: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 3 },
    cautions: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
  },
  required: ['method', 'useMaCross', 'useRsi', 'hardStopLossPercent', 'trailingStopEnabled', 'reasons', 'cautions'],
};

const ADVICE_SYSTEM = [
  '당신은 주식 초보자에게 자동매매 규칙의 시험 조건을 제안하는 도우미입니다.',
  '규칙: 1) 사용자가 보낸 숫자에 없는 사실(뉴스·실적·전망 등)을 쓰지 않습니다. 2) 수익을 약속하지 않습니다.',
  '3) 쉬운 한국어로, 이유(reasons)는 보낸 숫자를 근거로 3개 이하, 주의(cautions)는 2개 이하로 씁니다.',
  '4) 값은 주어진 범위 안에서만 고릅니다. 이동평균 단기는 5·20·60, 장기는 20·60·120 중 하나이며 단기 < 장기입니다.',
  '5) method: trend = 이동평균 교차만, dip = RSI 만, both = 둘 다, custom = 그 밖.',
].join('\n');

const LIMIT_TEXT = [
  `이동평균 일수: ${ENGINE_MA_PERIODS.join('·')}일 중에서(단기 < 장기)`,
  `RSI 살 때 기준(이 값 이하에서 반등하면 산다): ${RULE_LIMITS.rsiBuyBelow.min}~${RULE_LIMITS.rsiBuyBelow.max}`,
  `RSI 팔 때 기준(이 값 이상이면 판다): ${RULE_LIMITS.rsiSellAbove.min}~${RULE_LIMITS.rsiSellAbove.max}`,
  `손절 %: ${RULE_LIMITS.hardStopLossPercent.min}~${RULE_LIMITS.hardStopLossPercent.max}`,
  `트레일링 %: ${RULE_LIMITS.trailingStopPercent.min}~${RULE_LIMITS.trailingStopPercent.max}`,
  `익절 %(산 값보다 이만큼 오르면 모두 판다, 끌 수 있다): ${RULE_LIMITS.takeProfitPercent.min}~${RULE_LIMITS.takeProfitPercent.max}`,
].join('\n');

const FEATURE_LABEL: Record<keyof PreYearFeatures, string> = {
  volatility: '연 변동성 %',
  atrPct: 'ATR% 평균',
  return1y: '그 1년 수익률 %',
  aboveMa60Pct: '60일선 위 날 비율 %',
  maCross5x20: '5·20일선 교차 횟수',
  rsiLow30Pct: 'RSI 30 이하 날 비율 %',
  rsiHigh70Pct: 'RSI 70 이상 날 비율 %',
};
const KEYS = Object.keys(FEATURE_LABEL) as (keyof PreYearFeatures)[];

/** 범위 밖 값은 **버린다** — 고쳐서 넣으면 AI 가 말하지 않은 값이 된다 */
export function validateAdvice(raw: RawAdvice): Pick<BacktestAdvice, 'method' | 'values' | 'reasons' | 'cautions' | 'dropped'> {
  const values: BacktestAdvice['values'] = {};
  const dropped: string[] = [];
  const inR = (v: unknown, l: { min: number; max: number }) => typeof v === 'number' && Number.isFinite(v) && v >= l.min && v <= l.max;
  const isMa = (v: unknown) => (ENGINE_MA_PERIODS as readonly number[]).includes(v as number);

  if (raw.maShort != null || raw.maLong != null) {
    const okS = raw.maShort == null || isMa(raw.maShort);
    const okL = raw.maLong == null || isMa(raw.maLong);
    if (!okS) dropped.push(`단기 이동평균 ${raw.maShort}일`);
    if (!okL) dropped.push(`장기 이동평균 ${raw.maLong}일`);
    if (okS && okL && raw.maShort != null && raw.maLong != null && raw.maShort >= raw.maLong) {
      // 단기 ≥ 장기면 이동평균 제안 전체를 버린다
      dropped.push(`이동평균 제안 전체(단기 ${raw.maShort}일 ≥ 장기 ${raw.maLong}일)`);
    } else {
      if (okS && raw.maShort != null) values.maShort = raw.maShort;
      if (okL && raw.maLong != null) values.maLong = raw.maLong;
      if (typeof raw.useMaCross === 'boolean') values.useMaCross = raw.useMaCross;
    }
  } else if (typeof raw.useMaCross === 'boolean') values.useMaCross = raw.useMaCross;

  if (raw.rsiBuyBelow != null) {
    if (inR(raw.rsiBuyBelow, RULE_LIMITS.rsiBuyBelow)) values.rsiBuyBelow = raw.rsiBuyBelow;
    else dropped.push(`RSI 살 때 기준 ${raw.rsiBuyBelow}`);
  }
  if (raw.rsiSellAbove != null) {
    if (inR(raw.rsiSellAbove, RULE_LIMITS.rsiSellAbove)) values.rsiSellAbove = raw.rsiSellAbove;
    else dropped.push(`RSI 팔 때 기준 ${raw.rsiSellAbove}`);
  }
  if (typeof raw.useRsi === 'boolean') values.useRsi = raw.useRsi;
  if (raw.hardStopLossPercent != null) {
    if (inR(raw.hardStopLossPercent, RULE_LIMITS.hardStopLossPercent)) values.hardStopLossPercent = raw.hardStopLossPercent;
    else dropped.push(`손절 ${raw.hardStopLossPercent}%`);
  }
  if (typeof raw.trailingStopEnabled === 'boolean') values.trailingStopEnabled = raw.trailingStopEnabled;
  if (raw.trailingStopPercent != null) {
    if (inR(raw.trailingStopPercent, RULE_LIMITS.trailingStopPercent)) values.trailingStopPercent = raw.trailingStopPercent;
    else dropped.push(`트레일링 ${raw.trailingStopPercent}%`);
  }
  if (typeof raw.takeProfitEnabled === 'boolean') values.takeProfitEnabled = raw.takeProfitEnabled;
  if (raw.takeProfitPercent != null) {
    if (inR(raw.takeProfitPercent, RULE_LIMITS.takeProfitPercent)) values.takeProfitPercent = raw.takeProfitPercent;
    else dropped.push(`익절 ${raw.takeProfitPercent}%`);
  }
  const method = (['trend', 'dip', 'both', 'custom'] as const).find((m) => m === raw.method) ?? null;
  const strs = (a: unknown, n: number) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, n) : []);
  return { method, values, reasons: strs(raw.reasons, 3), cautions: strs(raw.cautions, 2), dropped };
}

export async function adviseBacktest(input: Pick<BacktestInput, 'symbols' | 'years'> & { current: Omit<BacktestCondition, 'label'> }, caller: Caller = defaultCaller): Promise<BacktestAdvice> {
  const days = SEGMENT_DAYS * input.years;
  const info = namesAndSectors(input.symbols);
  const rows: { symbol: string; sector: string; f: PreYearFeatures }[] = [];
  const excluded: BacktestAdvice['excluded'] = [];
  for (const symbol of input.symbols) {
    try {
      const candles = completedDaily(await getCandles(symbol, '1d', days + PRE_DAYS + PRE_WARMUP + 20), symbol);
      const f = preYearFeatures(candles, candles.length - days);
      if (!f) throw new Error(`시험 기간 앞 1년 일봉이 모자랍니다(${candles.length}개)`);
      rows.push({ symbol, sector: info.get(symbol)?.sector ?? '분야 미확인', f });
    } catch (e) {
      excluded.push({ symbol, reason: (e as Error).message });
    }
  }
  if (!rows.length) throw new AdviceInputError('앞 1년 일봉이 있는 종목이 없어 물어볼 수 없습니다.');

  const summarized = rows.length > SUMMARIZE_OVER;
  const head = `| ${summarized ? '분야 | 종목 수' : '종목 | 분야'} | ${KEYS.map((k) => FEATURE_LABEL[k]).join(' | ')} |`;
  const lines: string[] = [head];
  if (summarized) {
    const groups = new Map<string, PreYearFeatures[]>();
    for (const r of rows) groups.set(r.sector, [...(groups.get(r.sector) ?? []), r.f]);
    for (const [sector, fs] of groups) {
      lines.push(`| ${sector} | ${fs.length} | ${KEYS.map((k) => r2(fs.reduce((a, f) => a + f[k], 0) / fs.length)).join(' | ')} |`);
    }
  } else {
    for (const r of rows) lines.push(`| ${r.symbol} | ${r.sector} | ${KEYS.map((k) => r.f[k]).join(' | ')} |`);
  }
  const c = input.current;
  const text = [
    `시험 기간: 최근 ${input.years}년. 아래 숫자는 그 **시험 기간이 시작되기 전 1년(252거래일)** 의 숫자입니다(시험 기간 자료는 보내지 않습니다).`,
    summarized ? `종목이 ${rows.length}개라 분야별 평균으로 줄였습니다.` : `종목 ${rows.length}개.`,
    '',
    lines.join('\n'),
    '',
    '고를 수 있는 값의 범위:',
    LIMIT_TEXT,
    '',
    `지금 화면의 조건: 이동평균 사용 ${c.rule.useMaCross ? '예' : '아니오'}(단기 ${c.rule.maShort}일·장기 ${c.rule.maLong}일), ` +
      `RSI 사용 ${c.rule.useRsi ? '예' : '아니오'}(살 때 ${c.rule.rsiBuyBelow} 이하·팔 때 ${c.rule.rsiSellAbove} 이상), ` +
      `손절 ${c.hardStopLossPercent}%, 트레일링 ${c.trailingStopEnabled ? `${c.trailingStopPercent}%` : '끔'}, 익절 ${c.takeProfitEnabled ? `${c.takeProfitPercent}%` : '끔'}.`,
    '',
    '이 종목들을 시험할 때 어떤 조건이 어울릴지 제안해 주세요.',
  ].join('\n');

  const res = await caller<RawAdvice>({ system: ADVICE_SYSTEM, parts: [{ text }], schema: ADVICE_SCHEMA, temperature: 0.3 });
  return { ...validateAdvice(res.data ?? {}), summarized, excluded, sent: rows.length, promptVersion: ADVICE_PROMPT_VERSION, model: res.model };
}

export class AdviceInputError extends Error {}

// ── 2. 결과 설명 듣기 ─────────────────────────────────────────────────────────

interface RawExplain {
  summary?: string[];
  byCondition?: { label?: string; good?: string[]; bad?: string[] }[];
  cautions?: string[];
}

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 3 },
    byCondition: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING', enum: ['A', 'B', 'C'] },
          good: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
          bad: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
        },
        required: ['label', 'good', 'bad'],
      },
      maxItems: 3,
    },
    cautions: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
  },
  required: ['summary', 'byCondition', 'cautions'],
};

const EXPLAIN_SYSTEM = [
  '당신은 주식 초보자에게 자동매매 규칙의 과거 시험(백테스트) 결과를 쉬운 한국어로 설명하는 도우미입니다.',
  '규칙: 1) 입력 표에 없는 숫자를 쓰지 않습니다. 숫자를 쓸 때는 표의 값을 그대로 옮깁니다(새로 계산하지 않습니다).',
  '2) 미래를 말하지 않습니다(앞으로 오른다·벌 것이다 금지). 3) 수익을 약속하지 않습니다.',
  '4) "조건을 바꾸면 더 좋아진다" 식의 권유는 "여러 조건을 바꿔 보며 고르면 우연에 속기 쉽다" 와 함께만 씁니다.',
  '5) 조건이 여러 개면 어느 조건이 가장 좋다고 고르지 않습니다 — 차이를 설명하고, 여러 조건을 비교해 고르면 우연에 속기 쉽다는 점을 함께 말합니다.',
  '6) MDD 는 "가장 크게 떨어졌던 폭", Profit Factor 는 "번 돈 ÷ 잃은 돈" 이라고 풀어 씁니다.',
  '7) summary 는 3문장 이하, byCondition 은 조건마다 good·bad 각 2개 이하, cautions 는 2개 이하.',
].join('\n');

const ruleText = (c: BacktestCondition, n: (v: number | null | undefined) => string) =>
  `이동평균 ${c.rule.useMaCross ? `사용(단기 ${n(c.rule.maShort)}일·장기 ${n(c.rule.maLong)}일)` : '안 씀'} · ` +
  `RSI ${c.rule.useRsi ? `사용(살 때 ${n(c.rule.rsiBuyBelow)} 이하 반등·팔 때 ${n(c.rule.rsiSellAbove)} 이상)` : '안 씀'} · ` +
  `손절 ${n(c.hardStopLossPercent)}% · 트레일링 ${c.trailingStopEnabled ? `${n(c.trailingStopPercent)}%` : '끔'} · 익절 ${c.takeProfitEnabled ? `${n(c.takeProfitPercent)}%` : '끔'}`;

/** 설명에 보낼 숫자 표 — 검증도 이 숫자로 한다(차이 숫자도 미리 계산해 넣는다 — 모델이 새로 빼지 않게) */
export function explainPayload(r: BacktestCustomReport): { text: string; numbers: number[] } {
  const numbers: number[] = [];
  const n = (v: number | null | undefined) => {
    if (v == null) return '—';
    numbers.push(v);
    return String(v);
  };
  const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : r2(a - b));
  const lines: string[] = [];
  lines.push(`기간 ${n(r.input.years)}년 · 종목 ${n(r.conditions[0]?.summary.symbols ?? 0)}개 · 수수료 왕복 ${n(0.3)}%p 포함 · 숫자는 모두 종목 평균(%)`);
  lines.push(`그냥 들고 있기: 기간 전체 ${n(r.hold.rule)} · MDD ${n(r.hold.mdd)}`);
  for (const c of r.conditions) {
    const s = c.summary;
    lines.push('', `조건 ${c.label}: ${ruleText(c.condition, n)}`);
    lines.push(`- 기간 전체 ${n(s.rule)} · 아무 날이나 사고팔기 ${n(s.random)} · 이 조건 − 들고 있기 ${n(diff(s.rule, s.hold))} · 이 조건 − 아무 날이나 ${n(diff(s.rule, s.random))}`);
    lines.push(`- MDD(가장 크게 떨어졌던 폭) ${n(s.mdd)}${s.mddWorst ? ` · 가장 나쁜 종목 ${s.mddWorst.name ?? s.mddWorst.symbol} ${n(s.mddWorst.value)}` : ''} · Profit Factor(번 돈 ÷ 잃은 돈) ${s.profitFactor != null ? n(s.profitFactor) : (s.profitFactorNote ?? '—')}`);
    lines.push(`- 한 번 사고팔 때 평균 ${n(s.avgTradeReturn)} · 이긴 거래 ${n(s.winRate)} · 종목당 거래 ${n(s.avgTrades)}회 · 거래 10회 미만 종목 ${n(s.weakSymbols)}개`);
    if (s.exits) {
      lines.push(`- 판 이유 비율: 신호 ${n(s.exits.signal)} · 손절 ${n(s.exits.stop)} · 익절 ${n(s.exits.take_profit)} · 트레일링 ${n(s.exits.trailing)} · 기간 끝 ${n(s.exits.end)}`);
    }
    if (c.segmentRows.length) {
      lines.push(`- 구간별(이 조건 / 들고 있기): ${c.segmentRows.map((g) => `${g.segment}년차 ${n(g.rule)} / ${n(g.hold)}`).join(' · ')}`);
    }
  }
  // 조건이 하나일 때만 종목별 표를 보낸다(여럿이면 조건별 숫자표만 — 지시서 B-4)
  if (r.conditions.length === 1) {
    lines.push('', '종목별(기간 전체):', '| 종목 | 분야 | 횟수 | 이긴 거래 | 한 번 평균 | 손절 비율 | 이 방법 | 들고 있기 | 아무 날이나 | MDD |');
    for (const x of r.conditions[0].symbols) {
      lines.push(
        `| ${x.name ?? x.symbol}(${x.symbol}) | ${x.sector ?? '분야 미확인'} | ${n(x.trades)} | ${n(x.winRate)} | ${n(x.avgReturn)} | ${n(x.stopRate)} | ${n(x.rule)} | ${n(x.hold)} | ${n(x.random)} | ${n(x.mdd)} |`,
      );
    }
  }
  if (r.excluded.length) lines.push('', `계산하지 못한 종목 ${n(r.excluded.length)}개`);
  return { text: lines.join('\n'), numbers };
}

/** 문장 속 % 숫자가 입력 숫자(반올림 ±0.05, 부호 무시)에 모두 있으면 통과 */
export function sentenceOk(sentence: string, numbers: number[]): boolean {
  const found = [...sentence.matchAll(/([+\-−]?\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Math.abs(Number(m[1].replace('−', '-').replace(',', '.'))));
  return found.every((x) => numbers.some((v) => Math.abs(Math.abs(v) - x) <= 0.05 + 1e-9));
}

export async function explainBacktest(report: BacktestCustomReport, caller: Caller = defaultCaller): Promise<BacktestExplain> {
  const { text, numbers } = explainPayload(report);
  const ask = report.conditions.length > 1 ? '조건들의 차이를 초보자에게 설명해 주세요(어느 조건이 가장 좋다고 고르지 마세요).' : '이 결과를 초보자에게 설명해 주세요.';
  const res = await caller<RawExplain>({ system: EXPLAIN_SYSTEM, parts: [{ text: `${text}\n\n${ask}` }], schema: EXPLAIN_SCHEMA, temperature: 0.3 });
  let removed = 0;
  const keep = (a: unknown, max: number) => {
    const list = Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max) : [];
    const ok = list.filter((s) => sentenceOk(s, numbers));
    removed += list.length - ok.length;
    return ok;
  };
  const d = res.data ?? {};
  const labels = new Set<ConditionLabel>(report.conditions.map((c) => c.label));
  // 입력에 없는 조건 이름은 버린다 · 조건마다 하나만
  const seen = new Set<string>();
  const byCondition = (Array.isArray(d.byCondition) ? d.byCondition : [])
    .filter((x) => x && CONDITION_LABELS.includes(x.label as ConditionLabel) && labels.has(x.label as ConditionLabel) && !seen.has(x.label!) && seen.add(x.label!))
    .map((x) => ({ label: x.label as ConditionLabel, good: keep(x.good, 2), bad: keep(x.bad, 2) }));
  return {
    summary: keep(d.summary, 3),
    byCondition,
    cautions: keep(d.cautions, 2),
    removed,
    promptVersion: EXPLAIN_PROMPT_VERSION,
    model: res.model,
    createdAt: new Date().toISOString(),
  };
}
