/**
 * 「매매 규칙」 엔진 — **한 곳** (v2.43.0, 퀀트 다시 만들기 1단계).
 *
 * 계산기는 점수형 하나다: 매수 조건마다 [사용] · [점수] → 켠 조건의 합계가 기준 이상이면 매수(사용자 결정 A-1).
 * - 신호는 **마감 기준** — 호출하는 쪽이 진행 중 봉을 뺀 끝난 일봉(`completedDaily`)을 넣는다(A-4).
 * - 지표는 **종목마다 한 번** 계산하고(`computeIndicators`), 날짜(봉 번호 i)마다 판단한다 — 예전 점수 계산기의
 *   「마지막 값」(`at(ind.x)`) 대신 **봉 i 의 값**을 읽는다. 20일 고점·120일 고점·거래량 평균도 i 까지만 본다(미래 정보 금지).
 * - 매수 = 보유 안 함 · 손절 뒤 대기 기간 아님 · **손익비 ≥ 1**(A-7, 끌 수 없다) · 점수 ≥ 기준 (상태 방식, A-5).
 * - 매도(보유 중) = 반대 신호 · 점수 N점 아래. **손절·익절·트레일링은 가격만 계산해 준다**(`exitLevels`) —
 *   실행 방식은 쓰는 곳이 정한다(계좌 = 장중 1분, 백테스트 = 일봉 고저). 2단계.
 *
 * 그룹 안 작은 검사와 점수표는 **예전 점수 계산기(`server/swingAnalyzer.ts`) 그대로** 옮겼다. 순간 조건(교차·RSI 반등)은
 * 예전 교차 계산기(`decideRule`, v2.44.0 에 지웠다)와 같은 정의다 — 같은 판단인지는 `npm run rules:test` ① 이 정답 파일과 비교한다.
 * ⚠️ 예전 점수 계산기(`swingAnalyzer`)는 3단계까지 그대로 둔다(② 가 같은 점수인지 본다).
 * ⚠️ 주문을 내지 않는다. 모의투자·주문 모듈을 import 하지 않는다.
 */
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import type { DecisionCode } from '../../src/types/autoTrading';
import type { EntryType } from '../../src/types/swing';
import { scaledTable, maxScoreOf, type GroupKey, type RuleBody, type BuyKey } from '../../src/types/tradingRule';
import { marketDate } from '../../src/utils/marketDate';
import { isFormingBar } from '../../src/utils/marketBar';
import { nearestEngineMa } from '../../src/types/autoTrading';

/** 진행 중인 일봉을 뺀 끝난 봉 (v2.31.0 → v2.44.0 에 예전 `ruleEngine.ts` 에서 옮겼다) — 신호는 마감 기준이다 */
export function completedDaily(candles: Candle[], symbol: string, now = Date.now()): Candle[] {
  return isFormingBar(candles, '1d', symbol, now) ? candles.slice(0, -1) : candles;
}

/** 이동평균 일수 → 엔진 시리즈 (5·20·60·120 — 다른 값은 가장 가까운 값). 예전 `ruleEngine.pickMa` 그대로 옮겼다 */
export function pickMa(series: IndicatorSeries, period: number): { line: (number | null)[]; used: number } {
  const used = nearestEngineMa(period);
  const line = { 5: series.sma5, 20: series.sma20, 60: series.sma60, 120: series.sma120 }[used];
  return { line, used };
}

// ── 봉 i 기준 시리즈 도우미 ─────────────────────────────────────────────────

/**
 * 봉 i 에서 거꾸로 offset 번째 **유효** 값 (0 = 봉 i 의 값). 예전 `at()` 을 i 까지 자른 시리즈에 쓴 것과 같다 —
 * null 을 건너뛰는 뜻까지 같아야 점수가 바이트 단위로 같다.
 */
function atI(series: (number | null)[] | undefined, i: number, offset = 0): number | null {
  if (!series?.length) return null;
  let seen = 0;
  for (let j = Math.min(i, series.length - 1); j >= 0; j--) {
    const value = series[j];
    if (value == null || !Number.isFinite(value)) continue;
    if (seen === offset) return value;
    seen++;
  }
  return null;
}

/** 봉 i 까지의 마지막 n 개 — 예전 `candles.slice(-n)` 을 i 까지 자른 배열에 쓴 것과 같다 */
function lastN(candles: Candle[], i: number, n: number): Candle[] {
  return candles.slice(Math.max(0, i + 1 - n), i + 1);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ── 결과 모양 ───────────────────────────────────────────────────────────────

export interface CheckResult {
  label: string;
  passed: boolean;
}

export interface ConditionResult {
  key: BuyKey;
  on: boolean;
  /** 켠 조건만 점수가 붙는다(꺼진 조건은 0 — 검사 결과는 참고로 남긴다) */
  score: number;
  max: number;
  checks: CheckResult[];
}

export interface RuleReference {
  /** 「지금/눌림/돌파」 진입 제안 — **참고만**(실행에 쓰지 않는다, A-8) */
  entryType: EntryType;
  entryPrice: number;
  stop: number;
  target1: number;
  target2: number;
  /** 손익비 (리워드 = 1·2차 목표 평균, 리스크 = 매수가 − 손절가) */
  ratio: number;
  /** 1% 위험 비중(표준 리스크 1.5/1/0.5%) — 참고 */
  sizePercent: number;
}

export interface RuleEvaluation {
  action: 'BUY' | 'SELL' | 'HOLD';
  score: number;
  maxScore: number;
  breakdown: ConditionResult[];
  reasons: string[];
  code: DecisionCode;
  /** 손익비 안전장치로 매수하지 않았는지 (점수는 기준 이상) */
  rrBlocked: boolean;
  /** 매매 계획을 세울 수 없으면 null (손절 자리 없음) */
  reference: RuleReference | null;
}

export interface RuleState {
  held: boolean;
  avgPrice?: number;
  peak?: number;
  /** 마지막 손절 날짜(시장 날짜 YYYY-MM-DD) — 다시 사기 대기(A-5) */
  lastStopDate?: string | null;
}

export interface RuleContext {
  symbol: string;
  /** 끝난 일봉만 (진행 중 봉 제외) */
  candles: Candle[];
  /** `candles` 전체로 한 번 계산한 지표 */
  series: IndicatorSeries;
}

export interface EvaluateOptions {
  /**
   * ⚠️ **시험 전용** — 손익비 안전장치(A-7)를 끈다. 예전 교차 계산기에는 이 안전장치가 없어 그와 비교할 때만 쓴다(`rules:test` ①).
   * 화면·API 어디서도 넘기지 않는다.
   */
  testOnlySkipRrGuard?: boolean;
}

// ── 그룹 검사 (예전 점수 계산기 그대로, 봉 i 기준) ─────────────────────────

function trendChecks(price: number, s: IndicatorSeries, i: number): CheckResult[] {
  const sma20 = atI(s.sma20, i);
  const sma60 = atI(s.sma60, i);
  const sma60Past = atI(s.sma60, i, 5);
  return [
    { label: '현재가 > 60일선', passed: sma60 != null && price > sma60 },
    { label: '20일선 > 60일선 (정배열)', passed: sma20 != null && sma60 != null && sma20 > sma60 },
    { label: '60일선 기울기 상승', passed: sma60 != null && sma60Past != null && sma60 > sma60Past },
  ];
}

function timingChecks(price: number, s: IndicatorSeries, i: number, low: number, high: number): CheckResult[] {
  const rsi = atI(s.rsi14, i);
  const sma20 = atI(s.sma20, i);
  const bbLower = atI(s.bbLower, i);
  const bbMiddle = atI(s.bbMiddle, i);
  return [
    { label: `RSI ${low}~${high} (눌림 구간)`, passed: rsi != null && rsi >= low && rsi <= high },
    { label: '20일선 ±1.5% 이내', passed: sma20 != null && Math.abs(price - sma20) / sma20 <= 0.015 },
    { label: '볼린저 중단~하단', passed: bbLower != null && bbMiddle != null && price >= bbLower && price <= bbMiddle },
  ];
}

function momentumChecks(s: IndicatorSeries, i: number): CheckResult[] {
  const hist = atI(s.macdHistogram, i);
  const histPrev = atI(s.macdHistogram, i, 1);
  const k = atI(s.stochK, i);
  const d = atI(s.stochD, i);
  const kPrev = atI(s.stochK, i, 1);
  const dPrev = atI(s.stochD, i, 1);
  const rsi = atI(s.rsi14, i);
  const rsi1 = atI(s.rsi14, i, 1);
  const rsi3 = atI(s.rsi14, i, 3);
  return [
    {
      label: 'MACD 양전환 또는 전환 임박',
      passed: hist != null && histPrev != null && ((hist > 0 && histPrev <= 0) || (hist < 0 && hist > histPrev)),
    },
    { label: '스토캐스틱 %K가 %D 상향 돌파', passed: k != null && d != null && kPrev != null && dPrev != null && k > d && kPrev <= dPrev },
    { label: 'RSI 상승 반전 (최근 3봉)', passed: rsi != null && rsi1 != null && rsi3 != null && rsi > rsi1 && rsi > rsi3 },
  ];
}

function volumeChecks(candles: Candle[], s: IndicatorSeries, i: number): CheckResult[] {
  const recent = mean(lastN(candles, i, 3).map((c) => c.volume));
  const base = mean(lastN(candles, i, 20).map((c) => c.volume));
  const window = lastN(candles, i, 10);
  const upVolumes: number[] = [];
  const downVolumes: number[] = [];
  for (let j = 1; j < window.length; j++) {
    (window[j].close >= window[j - 1].close ? upVolumes : downVolumes).push(window[j].volume);
  }
  const obv = atI(s.obv, i);
  const obvPast = atI(s.obv, i, 10);
  return [
    { label: '최근 3일 거래량 ≥ 20일 평균의 120%', passed: base > 0 && recent >= base * 1.2 },
    { label: '하락 시 거래량 감소 · 반등 시 증가', passed: upVolumes.length > 0 && downVolumes.length > 0 && mean(downVolumes) < mean(upVolumes) },
    { label: 'OBV 상승 추세', passed: obv != null && obvPast != null && obv > obvPast },
  ];
}

/** 손익비 → 점수표의 칸 (예전 `riskRewardCondition`: <1 → 0 · ≥1 → 3 · ≥1.5 → 7 · ≥2 → 10) */
const rrStep = (ratio: number): number => (ratio >= 2 ? 3 : ratio >= 1.5 ? 2 : ratio >= 1 ? 1 : 0);

// ── 참고 계획 (예전 `buildPlan`·`stopLossOf`·`positionOf` 그대로, 봉 i 기준) ──

function stopLossOf(price: number, candles: Candle[], i: number, atr: number | null, sma60: number | null): number | null {
  const support = Math.min(...lastN(candles, i, 20).map((c) => c.low));
  const candidates: number[] = [];
  if (atr) candidates.push(price - atr * 2);
  if (Number.isFinite(support)) candidates.push(support * 0.99);
  if (sma60) candidates.push(sma60 * 0.995);
  const valid = candidates.filter((c) => c < price).sort((a, b) => b - a);
  return valid[0] ?? null;
}

/**
 * 참고 계획. 돌파 판정은 예전처럼 「타이밍 점수 < 15」 — 기본 점수표에서 **통과 2개 미만**과 같아서
 * 사용자가 타이밍 점수를 바꿔도(꺼도) 같은 뜻이 되도록 통과 수로 본다.
 */
function planOf(candles: Candle[], s: IndicatorSeries, i: number, timingPassed: number): RuleReference | null {
  const price = candles[i].close;
  const atr = atI(s.atr14, i);
  const sma20 = atI(s.sma20, i);
  const sma60 = atI(s.sma60, i);
  const bbUpper = atI(s.bbUpper, i);
  const bbMiddle = atI(s.bbMiddle, i);
  const recentHigh = Math.max(...lastN(candles, i, 20).map((c) => c.high));
  const longHigh = Math.max(...lastN(candles, i, 120).map((c) => c.high));

  let entryType: EntryType = 'NOW';
  let entryPrice = price;
  const nearResistance = recentHigh > price && (recentHigh - price) / price <= 0.015;
  const extended = sma20 != null && price > sma20 * 1.015;
  if (nearResistance && timingPassed < 2) {
    entryType = 'BREAKOUT';
    entryPrice = recentHigh * 1.002;
  } else if (extended) {
    entryType = 'PULLBACK';
    entryPrice = sma20 ?? bbMiddle ?? price;
  }

  const stop = stopLossOf(entryPrice, candles, i, atr, sma60);
  if (stop == null) return null;
  const resistances = [recentHigh, bbUpper ?? Infinity].filter((v) => v > entryPrice * 1.005);
  const fallback = atr ?? entryPrice * 0.02;
  const target1 = resistances.length ? Math.min(...resistances) : entryPrice + fallback * 2;
  const target2 = Math.max(target1 * 1.005, longHigh > target1 ? longHigh : entryPrice + fallback * 3);
  /*
    볼린저 상단이 아직 없으면(봉 20개 미만) 예전 코드는 목표를 무한대로 잡아 손익비가 무한대가 됐다 — 그러면 손익비 안전장치(A-7)를
    지나간다. 그래서 목표가 유한하지 않으면 **계획 없음**(손익비 0 → 매수 안 함)으로 본다. 예전 점수 계산기는 봉 60개 미만을 받지 않아
    봉 20개 이상에서는 결과가 같다.
  */
  if (!Number.isFinite(target1) || !Number.isFinite(target2)) return null;
  const risk = entryPrice - stop;
  const reward = (target1 - entryPrice) * 0.5 + (target2 - entryPrice) * 0.5;
  const ratio = round(risk > 0 ? reward / risk : 0, 2);

  // 비중: 1% 위험 룰 — 표준 리스크(변동성 높음 0.5 · 보통 1 · 낮음 1.5%), 상한 25%.
  // 예전 `positionOf` 처럼 **반올림한** 매수가·손절가로 낸다(반올림 전 값이면 0.1%p 어긋난다)
  const entryR = round(entryPrice);
  const stopR = round(stop);
  const volatility = atr ? atr / entryR : 0.02;
  const riskPercent = volatility > 0.04 ? 0.5 : volatility < 0.02 ? 1.5 : 1;
  const lossPerShare = entryR - stopR;
  const raw = lossPerShare > 0 ? riskPercent * (entryR / lossPerShare) : 0;

  return {
    entryType,
    entryPrice: entryR,
    stop: stopR,
    target1: round(target1),
    target2: round(target2),
    ratio,
    sizePercent: round(Math.min(25, Math.max(1, raw)), 1),
  };
}

// ── 순간 조건 (예전 교차 계산기와 같은 정의) ────────────────────────────────

function pairAt(line: (number | null)[] | undefined, i: number): [number, number] | null {
  if (!Array.isArray(line) || i < 1 || i >= line.length) return null;
  const a = line[i - 1];
  const b = line[i];
  return a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? null : [a, b];
}

interface Instant {
  golden: boolean;
  dead: boolean;
  rsiRebound: boolean;
  rsiHot: boolean;
  rsiPair: [number, number] | null;
  maLabel: string;
}

function instantSignals(s: IndicatorSeries, i: number, rule: RuleBody): Instant {
  const { maCross, rsiRebound } = rule.buy;
  const short = pickMa(s, maCross.short);
  const long = pickMa(s, maCross.long);
  const sp = pairAt(short.line, i);
  const lp = pairAt(long.line, i);
  const rsiPair = pairAt(s.rsi14, i);
  return {
    golden: maCross.on && !!sp && !!lp && sp[0] <= lp[0] && sp[1] > lp[1],
    dead: maCross.on && !!sp && !!lp && sp[0] >= lp[0] && sp[1] < lp[1],
    rsiRebound: rsiRebound.on && !!rsiPair && rsiPair[0] <= rsiRebound.below && rsiPair[1] > rsiPair[0],
    rsiHot: rsiRebound.on && !!rsiPair && rsiPair[1] >= rule.sell.opposite.rsiAbove,
    rsiPair,
    maLabel: `MA${short.used}·MA${long.used}`,
  };
}

// ── 판단 ────────────────────────────────────────────────────────────────────

const CONDITION_NAME: Record<BuyKey, string> = {
  trend: '추세',
  timing: '타이밍',
  momentum: '모멘텀',
  volume: '거래량',
  riskReward: '손익비',
  maCross: '이동평균 교차',
  rsiRebound: 'RSI 반등',
};

/** 손절 날 뒤로 봉 i 까지 지난 거래일 수 (끝난 봉 기준) */
function tradingDaysSince(ctx: RuleContext, i: number, stopDate: string): number {
  let n = 0;
  for (let j = i; j >= 0; j--) {
    if (marketDate(ctx.candles[j].timestamp, ctx.symbol) <= stopDate) break;
    n++;
  }
  return n;
}

/** 점수만 (그룹별 + 합계) — 매수·매도 판단과 화면 설명이 같은 값을 쓴다 */
export function scoreAt(ctx: RuleContext, i: number, rule: RuleBody): { score: number; breakdown: ConditionResult[]; reference: RuleReference | null; instant: Instant } {
  const { candles, series } = ctx;
  const price = candles[i].close;
  const b = rule.buy;
  const groupChecks: Record<Exclude<GroupKey, 'riskReward'>, CheckResult[]> = {
    trend: trendChecks(price, series, i),
    timing: timingChecks(price, series, i, b.timing.rsiLow, b.timing.rsiHigh),
    momentum: momentumChecks(series, i),
    volume: volumeChecks(candles, series, i),
  };
  const reference = planOf(candles, series, i, groupChecks.timing.filter((c) => c.passed).length);
  const ratio = reference?.ratio ?? 0;
  const instant = instantSignals(series, i, rule);

  const breakdown: ConditionResult[] = [];
  for (const key of ['trend', 'timing', 'momentum', 'volume'] as const) {
    const passed = groupChecks[key].filter((c) => c.passed).length;
    const c = b[key];
    breakdown.push({ key, on: c.on, score: c.on ? scaledTable(key, c.points)[passed] : 0, max: c.points, checks: groupChecks[key] });
  }
  breakdown.push({
    key: 'riskReward',
    on: b.riskReward.on,
    score: b.riskReward.on ? scaledTable('riskReward', b.riskReward.points)[rrStep(ratio)] : 0,
    max: b.riskReward.points,
    checks: [
      { label: '비율 ≥ 1.5', passed: ratio >= 1.5 },
      { label: '비율 ≥ 2.0', passed: ratio >= 2 },
    ],
  });
  breakdown.push({
    key: 'maCross',
    on: b.maCross.on,
    score: instant.golden ? b.maCross.points : 0,
    max: b.maCross.points,
    checks: [{ label: `${instant.maLabel} 골든크로스`, passed: instant.golden }],
  });
  breakdown.push({
    key: 'rsiRebound',
    on: b.rsiRebound.on,
    score: instant.rsiRebound ? b.rsiRebound.points : 0,
    max: b.rsiRebound.points,
    checks: [{ label: `RSI ${b.rsiRebound.below} 이하에서 반등`, passed: instant.rsiRebound }],
  });
  const score = breakdown.reduce((sum, c) => sum + c.score, 0);
  return { score, breakdown, reference, instant };
}

/**
 * 봉 i 에서의 판단. `ctx.candles` 는 끝난 일봉, `ctx.series` 는 그 전체로 한 번 계산한 지표.
 * 진행 순서 — 보유 중: 반대 신호 → 점수 매도 → 보유 / 보유 안 함: 매수 조건 없음 → 다시 사기 대기 → 점수 미달 → 손익비 → 매수.
 */
export function evaluateRule(ctx: RuleContext, i: number, rule: RuleBody, state: RuleState, opts: EvaluateOptions = {}): RuleEvaluation {
  const { score, breakdown, reference, instant } = scoreAt(ctx, i, rule);
  const maxScore = maxScoreOf(rule.buy);
  const basis = ` (${marketDate(ctx.candles[i].timestamp, ctx.symbol).slice(5)} 마감 기준)`;
  const parts = breakdown.filter((c) => c.on).map((c) => `${CONDITION_NAME[c.key]} ${c.score}`).join(' · ');
  const scoreText = `점수 ${score}/${maxScore}${parts ? ` (${parts})` : ''}`;
  const out = (action: RuleEvaluation['action'], code: DecisionCode, reason: string, rrBlocked = false): RuleEvaluation => ({
    action,
    score,
    maxScore,
    breakdown,
    reasons: [reason + basis],
    code,
    rrBlocked,
    reference,
  });

  if (state.held) {
    if (rule.sell.opposite.on) {
      if (instant.dead) return out('SELL', 'dead', `${instant.maLabel} 데드크로스 — 반대 신호로 매도`);
      if (instant.rsiHot) {
        return out('SELL', 'rsi_hot', `RSI ${instant.rsiPair![1].toFixed(1)} — 과열(${rule.sell.opposite.rsiAbove} 이상)로 매도`);
      }
    }
    if (rule.sell.scoreBelow.on && score < rule.sell.scoreBelow.value) {
      return out('SELL', 'score_sell', `${scoreText} — ${rule.sell.scoreBelow.value}점 아래로 떨어져 매도`);
    }
    return out('HOLD', 'no_signal_hold', `${scoreText} — 매도 조건 없음, 보유 유지`);
  }

  if (maxScore === 0) return out('HOLD', 'no_signal_buy', '매수 조건이 없습니다');
  if (state.lastStopDate && rule.reentryWaitDays > 0) {
    const waited = tradingDaysSince(ctx, i, state.lastStopDate);
    if (waited < rule.reentryWaitDays) {
      return out('HOLD', 'reentry_wait', `손절 뒤 ${waited}거래일 — ${rule.reentryWaitDays}거래일이 지나야 다시 매수합니다`);
    }
  }
  if (score < rule.buy.minScore) return out('HOLD', 'no_signal_buy', `${scoreText} — 기준 ${rule.buy.minScore}점 미만`);
  // A-7 — 잃을 돈이 벌 돈보다 큰 거래는 어떤 규칙이든 사지 않는다(끌 수 없다. 시험 코드만 예외)
  const ratio = reference?.ratio ?? 0;
  if (!opts.testOnlySkipRrGuard && ratio < 1) {
    return out('HOLD', 'rr_block', `${scoreText} — 손익비 1:${ratio} 로 1 미만이라 매수하지 않습니다`, true);
  }
  return out('BUY', 'score_buy', `${scoreText} ≥ 기준 ${rule.buy.minScore}점 — 매수`);
}

/**
 * 손절·익절·트레일링 **가격** (켠 것만). 실행 방식(장중 1분·일봉 고저)은 쓰는 곳이 정한다 — 2단계.
 * 트레일링 = 보유 중 최고가 × (1 − %).
 */
export function exitLevels(rule: RuleBody, state: RuleState): { stop: number | null; takeProfit: number | null; trailing: number | null } {
  const avg = state.avgPrice ?? null;
  const s = rule.sell;
  return {
    stop: s.stopLoss.on && avg != null ? avg * (1 - s.stopLoss.percent / 100) : null,
    takeProfit: s.takeProfit.on && avg != null ? avg * (1 + s.takeProfit.percent / 100) : null,
    trailing: s.trailing.on && state.peak != null ? state.peak * (1 - s.trailing.percent / 100) : null,
  };
}
