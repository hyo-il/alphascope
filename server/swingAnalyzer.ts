/**
 * 스윙 투자 추천 (Step 10).
 *
 * 관심 종목을 5가지 퀀트 조건으로 채점하고, **매수 전에 팔 자리부터** 정한다.
 * 목표가·손절가·비중·보유 기간·무효 조건이 없는 추천은 만들지 않는다 —
 * "지금 사라" 만 있는 화면은 손실이 났을 때 무엇을 해야 할지 알려 주지 않는다.
 *
 * ⚠️ 실제 주문은 내지 않는다. 화면의 [모의 매수] 도 모의투자 계좌만 건드린다.
 */

import type { Candle } from '../src/types/toss';
import type { IndicatorSeries } from '../src/types/chart';
import type {
  ConditionScore,
  EntryType,
  SwingConditions,
  SwingGrade,
  SwingRecommendation,
} from '../src/types/swing';
import { getCandles } from './candleService';
import { cachedFundamentals } from './companyService';
import { loadCandles } from './db';
import { computeIndicators } from './indicatorService';
import { findNames } from './stockCatalog';

// ── 시리즈 도우미 ───────────────────────────────────────────────────────────

/** 뒤에서 offset 번째 유효 값 (0 = 마지막) */
function at(series: (number | null)[] | undefined, offset = 0): number | null {
  if (!series?.length) return null;
  let seen = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value == null || !Number.isFinite(value)) continue;
    if (seen === offset) return value;
    seen++;
  }
  return null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 통과한 항목 수 → 점수. 조건마다 배점표가 다르다. */
function tally(
  checks: { label: string; passed: boolean }[],
  table: number[],
  max: number,
  describe: (passed: number) => string,
): ConditionScore {
  const passed = checks.filter((c) => c.passed).length;
  return { score: table[passed] ?? 0, max, details: describe(passed), checks };
}

// ── 조건 1~4 ────────────────────────────────────────────────────────────────

function trendCondition(price: number, ind: IndicatorSeries): ConditionScore {
  const sma20 = at(ind.sma20);
  const sma60 = at(ind.sma60);
  // 기울기는 5봉 전과 비교한다 — 하루 차이로는 노이즈에 뒤집힌다.
  const sma60Past = at(ind.sma60, 5);

  const checks = [
    { label: '현재가 > 60일선', passed: sma60 != null && price > sma60 },
    { label: '20일선 > 60일선 (정배열)', passed: sma20 != null && sma60 != null && sma20 > sma60 },
    { label: '60일선 기울기 상승', passed: sma60 != null && sma60Past != null && sma60 > sma60Past },
  ];

  return tally(checks, [0, 10, 20, 30], 30, (passed) =>
    passed === 3
      ? '강한 상승 추세 — 정배열 + 60일선 상승'
      : passed === 0
        ? '상승 추세가 확인되지 않습니다 (역추세 매매는 추천하지 않습니다)'
        : `상승 추세 신호 ${passed}/3`,
  );
}

function timingCondition(price: number, ind: IndicatorSeries): ConditionScore {
  const rsi = at(ind.rsi14);
  const sma20 = at(ind.sma20);
  const bbLower = at(ind.bbLower);
  const bbMiddle = at(ind.bbMiddle);

  const checks = [
    { label: 'RSI 35~45 (눌림 구간)', passed: rsi != null && rsi >= 35 && rsi <= 45 },
    {
      label: '20일선 ±1.5% 이내',
      passed: sma20 != null && Math.abs(price - sma20) / sma20 <= 0.015,
    },
    {
      label: '볼린저 중단~하단',
      passed: bbLower != null && bbMiddle != null && price >= bbLower && price <= bbMiddle,
    },
  ];

  return tally(checks, [0, 8, 15, 25], 25, (passed) =>
    passed === 3
      ? '눌림 구간 — 진입 타이밍이 정렬됐습니다'
      : passed === 0
        ? '눌림이 아닙니다 — 고점 추격 위험'
        : `진입 신호 ${passed}/3`,
  );
}

function momentumCondition(ind: IndicatorSeries): ConditionScore {
  const hist = at(ind.macdHistogram);
  const histPrev = at(ind.macdHistogram, 1);
  const k = at(ind.stochK);
  const d = at(ind.stochD);
  const kPrev = at(ind.stochK, 1);
  const dPrev = at(ind.stochD, 1);
  const rsi = at(ind.rsi14);
  const rsi1 = at(ind.rsi14, 1);
  const rsi3 = at(ind.rsi14, 3);

  const checks = [
    {
      label: 'MACD 양전환 또는 전환 임박',
      passed:
        hist != null && histPrev != null && ((hist > 0 && histPrev <= 0) || (hist < 0 && hist > histPrev)),
    },
    {
      label: '스토캐스틱 %K가 %D 상향 돌파',
      passed: k != null && d != null && kPrev != null && dPrev != null && k > d && kPrev <= dPrev,
    },
    {
      label: 'RSI 상승 반전 (최근 3봉)',
      passed: rsi != null && rsi1 != null && rsi3 != null && rsi > rsi1 && rsi > rsi3,
    },
  ];

  return tally(checks, [0, 6, 12, 20], 20, (passed) =>
    passed === 3
      ? '하락 모멘텀이 꺾이고 상승 전환 신호가 겹쳤습니다'
      : passed === 0
        ? '전환 신호가 없습니다'
        : `전환 신호 ${passed}/3`,
  );
}

function volumeCondition(candles: Candle[], ind: IndicatorSeries): ConditionScore {
  const recent = mean(candles.slice(-3).map((c) => c.volume));
  const base = mean(candles.slice(-20).map((c) => c.volume));

  // 건강한 조정: 내린 날 거래량이 오른 날보다 적다 (투매가 아니라 쉬어 가는 것)
  const window = candles.slice(-10);
  const upVolumes: number[] = [];
  const downVolumes: number[] = [];
  for (let i = 1; i < window.length; i++) {
    (window[i].close >= window[i - 1].close ? upVolumes : downVolumes).push(window[i].volume);
  }

  const obv = at(ind.obv);
  const obvPast = at(ind.obv, 10);

  const checks = [
    { label: '최근 3일 거래량 ≥ 20일 평균의 120%', passed: base > 0 && recent >= base * 1.2 },
    {
      label: '하락 시 거래량 감소 · 반등 시 증가',
      passed: upVolumes.length > 0 && downVolumes.length > 0 && mean(downVolumes) < mean(upVolumes),
    },
    { label: 'OBV 상승 추세', passed: obv != null && obvPast != null && obv > obvPast },
  ];

  return tally(checks, [0, 5, 10, 15], 15, (passed) =>
    passed === 3
      ? '거래량이 가격 움직임을 뒷받침합니다'
      : passed === 0
        ? '거래량 뒷받침이 없습니다 — 속임수 반등일 수 있습니다'
        : `거래량 신호 ${passed}/3`,
  );
}

// ── 매매 계획 ───────────────────────────────────────────────────────────────

interface Plan {
  entry: SwingRecommendation['entry'];
  targets: SwingRecommendation['targets'];
  stopLoss: SwingRecommendation['stopLoss'];
  ratio: number;
}

/**
 * 손절가는 세 후보 중 **가장 높은(가까운)** 값을 쓴다.
 * 낮게 잡을수록 안 걸리지만 그만큼 손실이 커진다 — 정상 변동에 걸리지 않는 선에서
 * 가장 가까운 자리가 손실을 최소화한다.
 */
function stopLossOf(price: number, candles: Candle[], atr: number | null, sma60: number | null) {
  const support = Math.min(...candles.slice(-20).map((c) => c.low));
  const candidates: { price: number; reason: string }[] = [];

  if (atr) candidates.push({ price: price - atr * 2, reason: `ATR × 2 (일일 변동폭의 2배)` });
  if (Number.isFinite(support)) {
    candidates.push({ price: support * 0.99, reason: '최근 20일 지지선 아래 1%' });
  }
  if (sma60) candidates.push({ price: sma60 * 0.995, reason: '60일선 이탈' });

  // 현재가보다 낮은 후보만 손절가가 될 수 있다.
  const valid = candidates.filter((c) => c.price < price).sort((a, b) => b.price - a.price);
  return valid[0] ?? null;
}

function buildPlan(
  price: number,
  candles: Candle[],
  ind: IndicatorSeries,
  timing: ConditionScore,
): Plan | null {
  const atr = at(ind.atr14);
  const sma20 = at(ind.sma20);
  const sma60 = at(ind.sma60);
  const bbUpper = at(ind.bbUpper);
  const bbMiddle = at(ind.bbMiddle);

  const recentHigh = Math.max(...candles.slice(-20).map((c) => c.high));
  const longHigh = Math.max(...candles.slice(-120).map((c) => c.high));

  /*
   * 진입 자리를 **먼저** 정한다.
   * 목표·손절을 현재가 기준으로 잡으면, 돌파 매수(저항 위에서 진입)에서
   * "1차 목표가 매수가보다 낮은" 계획이 나온다 — 실제로 그렇게 나왔다.
   */
  let type: EntryType = 'NOW';
  let entryPrice = price;
  let reason = '';

  const nearResistance = recentHigh > price && (recentHigh - price) / price <= 0.015;
  const extended = sma20 != null && price > sma20 * 1.015;

  if (nearResistance && timing.score < 15) {
    type = 'BREAKOUT';
    entryPrice = recentHigh * 1.002;
    reason = `$${round(recentHigh)} 저항선 돌파 시 진입 — 거래량 동반 확인 필요`;
  } else if (extended) {
    type = 'PULLBACK';
    entryPrice = sma20 ?? bbMiddle ?? price;
    reason = `현재가가 20일선 대비 ${round(((price - sma20!) / sma20!) * 100, 1)}% 위 — $${round(entryPrice)} 눌림 시 진입 권장`;
  } else {
    type = 'NOW';
    entryPrice = price;
    reason = '조건이 정렬돼 현재가 부근에서 진입 가능합니다';
  }

  // 이하 모든 계산의 기준은 현재가가 아니라 **매수가** 다.
  const stop = stopLossOf(entryPrice, candles, atr, sma60);
  if (!stop) return null;

  // 1차 목표 = 매수가 위의 가장 가까운 저항 (최근 20일 고점 / 볼린저 상단).
  const resistances = [recentHigh, bbUpper ?? Infinity].filter((v) => v > entryPrice * 1.005);
  const fallback = atr ?? entryPrice * 0.02;
  const target1 = resistances.length ? Math.min(...resistances) : entryPrice + fallback * 2;
  // 2차 목표 = 더 먼 구조적 고점 또는 ATR × 3. 1차보다는 반드시 위에 둔다.
  const target2 = Math.max(
    target1 * 1.005,
    longHigh > target1 ? longHigh : entryPrice + fallback * 3,
  );

  const risk = entryPrice - stop.price;
  /*
   * 리워드는 1·2차 목표의 평균이다 — 계획 자체가 "1차에서 절반, 2차에서 절반" 이므로
   * 1차만으로 재면 과소, 2차만으로 재면 과대 평가된다.
   */
  const reward = (target1 - entryPrice) * 0.5 + (target2 - entryPrice) * 0.5;
  const ratio = risk > 0 ? reward / risk : 0;

  return {
    entry: { price: round(entryPrice), type, reason, detailedReason: '' },
    targets: {
      target1: {
        price: round(target1),
        percent: round(((target1 - entryPrice) / entryPrice) * 100),
        reason: resistances.length ? '최근 저항선·볼린저 상단' : 'ATR × 2',
      },
      target2: {
        price: round(target2),
        percent: round(((target2 - entryPrice) / entryPrice) * 100),
        reason: longHigh > target1 ? '최근 120일 고점' : 'ATR × 3',
      },
    },
    stopLoss: {
      price: round(stop.price),
      reason: stop.reason,
      maxLossPercent: round(((stop.price - entryPrice) / entryPrice) * 100),
    },
    ratio: round(ratio, 2),
  };
}

/** 리스크/리워드 배점 — 1.0 미만은 아예 추천하지 않는다 */
function riskRewardCondition(ratio: number): SwingConditions['riskReward'] {
  const score = ratio >= 2 ? 10 : ratio >= 1.5 ? 7 : ratio >= 1 ? 3 : 0;
  return {
    score,
    max: 10,
    ratio,
    details:
      ratio >= 2
        ? `1 : ${ratio} — 우수`
        : ratio >= 1.5
          ? `1 : ${ratio} — 양호`
          : ratio >= 1
            ? `1 : ${ratio} — 보통 (최소 1:1.5 를 권장합니다)`
            : `1 : ${ratio} — 잃을 금액이 벌 금액보다 큽니다`,
    checks: [
      { label: '비율 ≥ 1.5', passed: ratio >= 1.5 },
      { label: '비율 ≥ 2.0', passed: ratio >= 2 },
    ],
  };
}

/**
 * 1% 리스크 룰 → 총자산 대비 비중.
 *
 * 한 거래에서 총자산의 1% 만 잃도록 수량을 정하면, 투자 금액은
 * `총자산 × 리스크% × 현재가/(현재가−손절가)` 가 된다. 변동성이 큰 종목은
 * 손절 폭이 넓어 자동으로 비중이 줄어든다.
 */
function positionOf(price: number, stop: number, atr: number | null) {
  const volatility = atr ? atr / price : 0.02;
  const riskPercent = volatility > 0.04 ? 0.5 : volatility < 0.02 ? 1.5 : 1;
  const lossPerShare = price - stop;
  const raw = lossPerShare > 0 ? riskPercent * (price / lossPerShare) : 0;
  // 한 종목이 포트폴리오를 지배하지 않도록 상한을 둔다.
  const recommendedPercent = round(Math.min(25, Math.max(1, raw)), 1);

  return {
    recommendedPercent,
    reason:
      volatility > 0.04
        ? `변동성이 높아(ATR ${round(volatility * 100, 1)}%) 리스크 0.5% 룰로 소규모 진입`
        : volatility < 0.02
          ? `변동성이 낮아(ATR ${round(volatility * 100, 1)}%) 리스크 1.5% 룰 적용`
          : `리스크 1% 룰 — 손절 시 총자산의 약 1% 손실`,
  };
}

function gradeOf(score: number): SwingGrade {
  if (score >= 80) return 'STRONG';
  if (score >= 65) return 'BUY';
  if (score >= 50) return 'WATCH';
  if (score >= 35) return 'HOLD';
  return 'AVOID';
}

/** 추천하지 않는 종목의 한 줄 이유 — 가장 크게 모자란 조건을 집는다 */
function rejectionOf(conditions: SwingConditions, ind: IndicatorSeries, price: number): string {
  const rsi = at(ind.rsi14);
  const sma60 = at(ind.sma60);

  if (conditions.riskReward.ratio < 1) {
    return `리스크/리워드 1:${conditions.riskReward.ratio} — 잃을 금액이 더 큽니다`;
  }
  if (sma60 != null && price < sma60) return '60일선 아래 — 추세 미확인';
  if (rsi != null && rsi > 60) return `RSI ${round(rsi, 1)} — 과매수 근접, 눌림 대기 필요`;
  if (conditions.timing.score === 0) return '눌림 구간이 아닙니다 — 진입 타이밍 대기';
  if (conditions.momentum.score === 0) return '상승 전환 신호 없음';
  if (conditions.volume.score === 0) return '거래량 뒷받침 없음';
  return '조건 충족도가 낮습니다';
}

// ── 종목 하나 분석 ──────────────────────────────────────────────────────────

/** 캔들 확보 — 실시간이 막히면 캐시로 내려간다 (summaryService 와 같은 방침) */
async function candlesOf(symbol: string): Promise<Candle[]> {
  return getCandles(symbol, '1d', 300).catch((error) => {
    const cached = loadCandles(symbol, '1d', 300);
    if (!cached.length) throw error;
    return cached;
  });
}

export async function evaluateSwing(symbol: string): Promise<SwingRecommendation> {
  const upper = symbol.toUpperCase();
  const candles = await candlesOf(upper);
  if (candles.length < 60) {
    throw new Error('일봉이 60개 미만이라 60일선을 계산할 수 없습니다.');
  }

  const ind = await computeIndicators(candles);
  const price = candles.at(-1)!.close;
  const atr = at(ind.atr14);

  const trend = trendCondition(price, ind);
  const timing = timingCondition(price, ind);
  const momentum = momentumCondition(ind);
  const volume = volumeCondition(candles, ind);

  const plan = buildPlan(price, candles, ind, timing);
  const riskReward = riskRewardCondition(plan?.ratio ?? 0);

  const conditions: SwingConditions = { trend, timing, momentum, volume, riskReward };
  const score =
    trend.score + timing.score + momentum.score + volume.score + riskReward.score;

  /*
   * 리스크/리워드가 1 미만이면 점수와 무관하게 매수 추천에서 뺀다.
   * 조건이 아무리 좋아도 잃을 금액이 벌 금액보다 크면 반복할수록 잃는 거래다.
   */
  let grade = gradeOf(score);
  const unprofitable = riskReward.ratio < 1;
  if (unprofitable && (grade === 'STRONG' || grade === 'BUY')) grade = 'WATCH';

  const sma20 = at(ind.sma20);
  const sma60 = at(ind.sma60);
  const rsi = at(ind.rsi14);

  const warnings: string[] = [];
  if (atr && atr / price > 0.04) {
    warnings.push(`변동성이 높습니다 (ATR ${round((atr / price) * 100, 1)}%) — 비중을 줄이세요`);
  }
  if (unprofitable) warnings.push('리스크/리워드가 1 미만이라 매수 추천에서 제외했습니다');
  if (riskReward.ratio >= 1 && riskReward.ratio < 1.5) {
    warnings.push('리스크/리워드가 1:1.5 미만입니다 — 목표가까지 여유가 크지 않습니다');
  }
  if (rsi != null && rsi > 60) warnings.push(`RSI ${round(rsi, 1)} — 이미 반등한 자리입니다`);
  /*
   * 1·2차 목표가 붙어 있으면 위쪽 공간이 좁다는 뜻이다.
   * 이럴 때 2차를 억지로 밀어 올리면 리스크/리워드만 좋아 보이므로, 사실대로 알린다.
   */
  if (plan && plan.targets.target2.percent - plan.targets.target1.percent < 1) {
    warnings.push('1·2차 목표가 거의 같습니다 — 위쪽 여유 공간이 좁습니다');
  }

  // 실적 발표는 캐시된 기업정보에서만 본다 (네트워크를 새로 타지 않는다).
  const earnings = cachedFundamentals(upper)?.profile.earningsDate ?? null;
  if (earnings) {
    const days = Math.round((Date.parse(earnings) - Date.now()) / 86_400_000);
    if (days >= 0 && days <= 14) {
      warnings.push(`${earnings} 실적 발표 예정 (${days}일 후) — 발표 전 포지션 축소 권장`);
    }
  }

  const invalidation = sma20
    ? `20일선($${round(sma20)}) 아래로 종가 마감 시 전략 무효`
    : sma60
      ? `60일선($${round(sma60)}) 이탈 시 전략 무효`
      : '추세선 이탈 시 전략 무효';

  const detailedReason = [
    trend.details,
    timing.details,
    momentum.details,
    volume.details,
    riskReward.details,
  ].join(' · ');

  // 보유 기간은 매수가에서 목표까지 걸리는 거리를 일일 변동폭(ATR)으로 나눈 값이다.
  const entryBase = plan?.entry.price ?? price;
  const holdMin =
    plan && atr ? Math.max(3, Math.ceil((plan.targets.target1.price - entryBase) / atr)) : 5;
  const holdMax =
    plan && atr
      ? Math.min(30, Math.max(holdMin + 2, Math.ceil((plan.targets.target2.price - entryBase) / atr)))
      : 20;

  const recommendation: SwingRecommendation = {
    symbol: upper,
    name: findNames([upper])[upper] ?? null,
    currentPrice: round(price),
    score,
    grade,
    conditions,
    entry: plan?.entry ?? {
      price: round(price),
      type: 'NOW',
      reason: '손절 자리를 잡을 수 없어 매매 계획을 만들지 못했습니다',
      detailedReason,
    },
    targets: plan?.targets ?? {
      target1: { price: 0, percent: 0, reason: '계산 불가' },
      target2: { price: 0, percent: 0, reason: '계산 불가' },
    },
    stopLoss: plan?.stopLoss ?? { price: 0, reason: '계산 불가', maxLossPercent: 0 },
    position: plan
      ? positionOf(plan.entry.price, plan.stopLoss.price, atr)
      : { recommendedPercent: 0, reason: '매매 계획이 없어 비중을 제시하지 않습니다' },
    holdingPeriod: {
      min: holdMin,
      max: holdMax,
      reason: atr
        ? `일일 변동폭(ATR $${round(atr)}) 기준으로 목표가까지 걸리는 기간`
        : '스윙 기본값',
    },
    warnings,
    invalidation,
    rejection: null,
    indicators: {
      rsi14: rsi,
      sma20,
      sma60,
      atr14: atr,
      macdHistogram: at(ind.macdHistogram),
      stochK: at(ind.stochK),
      stochD: at(ind.stochD),
      bbLower: at(ind.bbLower),
      bbMiddle: at(ind.bbMiddle),
      bbUpper: at(ind.bbUpper),
    },
  };

  recommendation.entry.detailedReason = detailedReason;
  if (grade !== 'STRONG' && grade !== 'BUY') {
    /*
     * 추천 구간이 아닌 종목에도 계획은 함께 낸다 (관찰용). 다만 매수 이유 자리에
     * "진입 가능합니다" 만 남으면 카드가 스스로와 모순된다 — 왜 아닌지를 앞에 세운다.
     */
    recommendation.rejection = rejectionOf(conditions, ind, price);
    recommendation.entry.reason = `지금은 매수 추천 구간이 아닙니다 — ${recommendation.rejection}` +
      (plan ? ` (조건이 갖춰질 경우의 계획: ${plan.entry.reason})` : '');
  }

  return recommendation;
}
