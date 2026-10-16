/**
 * 「매매 규칙」 입력 검사 — **한 곳** (v2.43.0). 서버 저장(400)과 화면의 칸 오류가 같은 함수를 쓴다.
 *
 * 범위는 새로 정하지 않는다 — 기존 두 곳을 합친다:
 * - RSI 눌림 구간 = 10~70(예전 판단 기준 편집의 범위 — v2.45.0 에 그 창을 지우며 여기로 옮겼다)
 * - RSI 반등·과열 · 손절 · 익절 · 트레일링 = 계좌 설정의 `RULE_LIMITS`
 * - 이동평균 = 지표 엔진이 계산하는 `ENGINE_MA_PERIODS`(5·20·50·60·120·200 — v2.50.0 에 50·200)만
 * ⚠️ 서버도 컴파일한다 — DOM·React 를 들이지 않는다.
 */
import { ENGINE_MA_PERIODS, RULE_LIMITS } from '../types/autoTrading';
import { BUY_KEYS, emptyRuleBody, hasBuyCondition, maxScoreOf, type RuleBody } from '../types/tradingRule';

export const RULE_INPUT_LIMITS = {
  points: { min: 0, max: 100 },
  /** 기준 점수 — 조건 7개 × 만점 100 */
  minScore: { min: 1, max: 700 },
  scoreBelow: { min: 0, max: 700 },
  // 예전 판단 기준 편집의 RSI 범위(10~70)를 그대로 옮겼다(v2.45.0 — 그 편집 창과 타입은 지웠다)
  rsiBand: { min: 10, max: 70 },
  rsiBelow: RULE_LIMITS.rsiBuyBelow,
  rsiAbove: RULE_LIMITS.rsiSellAbove,
  stopLoss: RULE_LIMITS.hardStopLossPercent,
  takeProfit: RULE_LIMITS.takeProfitPercent,
  trailing: RULE_LIMITS.trailingStopPercent,
  reentryWaitDays: { min: 0, max: 60 },
  nameLength: 40,
} as const;

/** 칸 이름(예: 'buy.timing.rsiLow') → 오류 문장. 비어 있으면 저장할 수 있다 */
export type RuleFieldErrors = Record<string, string>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function range(errors: RuleFieldErrors, key: string, v: number, lim: { min: number; max: number }, integer = false): void {
  if (!isNum(v)) errors[key] = '숫자를 입력하세요';
  else if (integer && !Number.isInteger(v)) errors[key] = '정수로 입력하세요';
  else if (v < lim.min || v > lim.max) errors[key] = `${lim.min}~${lim.max} 사이로 입력하세요`;
}

export function ruleNameError(name: string): string | null {
  const n = name.trim();
  if (!n) return '이름을 입력하세요';
  if (n.length > RULE_INPUT_LIMITS.nameLength) return `이름은 ${RULE_INPUT_LIMITS.nameLength}자까지입니다`;
  return null;
}

export function ruleFieldErrors(body: RuleBody): RuleFieldErrors {
  const L = RULE_INPUT_LIMITS;
  const e: RuleFieldErrors = {};
  const { buy, sell } = body;
  for (const k of BUY_KEYS) range(e, `buy.${k}.points`, buy[k].points, L.points, true);
  range(e, 'buy.minScore', buy.minScore, L.minScore, true);

  range(e, 'buy.timing.rsiLow', buy.timing.rsiLow, L.rsiBand);
  range(e, 'buy.timing.rsiHigh', buy.timing.rsiHigh, L.rsiBand);
  if (!e['buy.timing.rsiLow'] && !e['buy.timing.rsiHigh'] && buy.timing.rsiLow >= buy.timing.rsiHigh) {
    e['buy.timing.rsiHigh'] = '위쪽 값이 아래쪽 값보다 커야 합니다';
  }

  const ma = ENGINE_MA_PERIODS as readonly number[];
  if (!ma.includes(buy.maCross.short)) e['buy.maCross.short'] = `${ma.join('·')}일 중에서 고르세요`;
  if (!ma.includes(buy.maCross.long)) e['buy.maCross.long'] = `${ma.join('·')}일 중에서 고르세요`;
  if (!e['buy.maCross.short'] && !e['buy.maCross.long'] && buy.maCross.short >= buy.maCross.long) {
    e['buy.maCross.long'] = '장기선이 단기선보다 길어야 합니다';
  }
  range(e, 'buy.rsiRebound.below', buy.rsiRebound.below, L.rsiBelow);

  range(e, 'sell.scoreBelow.value', sell.scoreBelow.value, L.scoreBelow, true);
  // 매도 점수가 매수 기준 이상이면 산 다음 날 바로 판다 — 켰을 때만 막는다
  if (sell.scoreBelow.on && !e['sell.scoreBelow.value'] && !e['buy.minScore'] && sell.scoreBelow.value >= buy.minScore) {
    e['sell.scoreBelow.value'] = `매수 기준(${buy.minScore}점)보다 낮아야 합니다`;
  }
  range(e, 'sell.opposite.rsiAbove', sell.opposite.rsiAbove, L.rsiAbove);
  range(e, 'sell.stopLoss.percent', sell.stopLoss.percent, L.stopLoss);
  range(e, 'sell.takeProfit.percent', sell.takeProfit.percent, L.takeProfit);
  range(e, 'sell.trailing.percent', sell.trailing.percent, L.trailing);
  range(e, 'reentryWaitDays', body.reentryWaitDays, L.reentryWaitDays, true);
  return e;
}

/** 저장은 되지만 알려야 하는 것 */
export function ruleWarnings(body: RuleBody): string[] {
  const out: string[] = [];
  if (!hasBuyCondition(body.buy)) {
    out.push('매수 조건이 없습니다 — 이 규칙으로는 매수하지 않습니다.');
  } else if (maxScoreOf(body.buy) < body.buy.minScore) {
    out.push(`켠 조건의 최대 점수(${maxScoreOf(body.buy)}점)가 기준(${body.buy.minScore}점)보다 낮아 매수하지 않습니다.`);
  }
  if (body.sell.opposite.on && !body.buy.maCross.on && !body.buy.rsiRebound.on) {
    out.push('반대 신호는 이동평균 교차나 RSI 반등을 켰을 때만 동작합니다.');
  }
  return out;
}

/**
 * 서버가 받은 JSON → 규칙 내용. 모양이 다른 칸은 빈 규칙 값으로 채우지 않고 **오류로** 돌려준다
 * (조용히 고치면 사용자가 보낸 것과 다른 규칙이 저장된다).
 */
export function parseRuleBody(raw: unknown): { body: RuleBody } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: '규칙 내용이 없습니다.' };
  const r = raw as Record<string, any>;
  const template = emptyRuleBody();
  const body = emptyRuleBody();
  const shapeError = (path: string) => ({ error: `규칙 모양이 올바르지 않습니다: ${path}` });

  // v2.50.0 전에 만든 규칙(거름망 칸 없음)도 받는다 — 없으면 빈 규칙 값(꺼짐) 그대로
  const OPTIONAL = new Set(['buy.gates']);
  const copy = (src: any, dst: any, tpl: any, path: string): string | null => {
    if (!src || typeof src !== 'object') return path;
    for (const key of Object.keys(tpl)) {
      const t = tpl[key];
      const v = src[key];
      if (v === undefined && OPTIONAL.has(`${path}.${key}`)) continue;
      if (typeof t === 'object') {
        const bad = copy(v, dst[key], t, `${path}.${key}`);
        if (bad) return bad;
      } else if (typeof v !== typeof t) {
        return `${path}.${key}`;
      } else {
        dst[key] = v;
      }
    }
    return null;
  };
  for (const part of ['buy', 'sell'] as const) {
    const bad = copy(r[part], body[part], template[part], part);
    if (bad) return shapeError(bad);
  }
  if (typeof r.reentryWaitDays !== 'number') return shapeError('reentryWaitDays');
  body.reentryWaitDays = r.reentryWaitDays;
  return { body };
}
