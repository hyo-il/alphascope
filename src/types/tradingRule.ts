/**
 * 「매매 규칙」 (v2.43.0 — 퀀트 다시 만들기 1단계). 매수·매도 조건을 담은 묶음 하나.
 *
 * 계산기는 **점수형 하나**다(사용자 결정 2026-10-13): 매수 조건마다 [사용] · [점수] → 합계가 기준 점수 이상이면 매수.
 * 예전 두 계산기 — 점수 계산기(`server/swingAnalyzer.ts`, v2.45.0 에 지움)와 교차 계산기(`server/autoTrading/ruleEngine.ts` 의 `decideRule`) —
 * 는 3단계까지 그대로 남고, 새 엔진(`server/rules/engine.ts`)이 같은 판단을 내는지 `npm run rules:test` 가 시험한다.
 *
 * ⚠️ 1단계에서는 **어디에도 연결하지 않는다** — 매수 판단 · 계좌 · 백테스트는 예전 계산기 그대로다(2·3단계).
 * ⚠️ 이 파일은 서버도 컴파일한다 — React·DOM 을 들이지 않는다.
 */

/** 5그룹 점수 조건 — 그룹 안 작은 검사 3개(손익비는 비율 표)의 통과 수로 점수를 낸다 */
export interface GroupCondition {
  on: boolean;
  /** 이 그룹의 만점. 기본값이면 예전 점수표와 같고, 바꾸면 표를 비례로 늘리거나 줄인다(`scaledTable`) */
  points: number;
}

export interface TimingCondition extends GroupCondition {
  /** RSI 눌림 구간 (기본 35~45) */
  rsiLow: number;
  rsiHigh: number;
}

/** 순간 조건 — 단기선이 장기선을 위로 넘는 **그날**만 켜진다 */
export interface MaCrossCondition extends GroupCondition {
  short: number;
  long: number;
}

/** 순간 조건 — RSI 가 below 이하였다가 오르는 **그날**만 켜진다 */
export interface RsiReboundCondition extends GroupCondition {
  below: number;
}

/**
 * 「거름망」 (v2.50.0 — 사용자 결정 A-1) — 점수와 따로, **통과하지 못하면 점수가 높아도 사지 않는다.** 매도에는 쓰지 않는다.
 * 첫 항목 = 주가(끝난 봉 종가)가 200일선 위일 때만 매수. 다음 묶음의 시장 필터가 같은 자리에 들어온다.
 */
export interface RuleGates {
  above200: { on: boolean };
}

export interface RuleBuy {
  trend: GroupCondition;
  timing: TimingCondition;
  momentum: GroupCondition;
  volume: GroupCondition;
  riskReward: GroupCondition;
  maCross: MaCrossCondition;
  rsiRebound: RsiReboundCondition;
  /** 켠 조건의 점수 합계가 이 값 이상이면 매수 */
  minScore: number;
  /**
   * 거름망 (v2.50.0). ⚠️ v2.50.0 전에 저장한 규칙에는 없다 — 없으면 모두 꺼진 것으로 읽는다(`gatesOf`).
   * 옛 규칙의 저장 내용을 바꾸지 않아야 백테스트 기록·판단이 바이트까지 같다.
   */
  gates?: RuleGates;
}

/** 거름망 읽기 — 없으면(옛 규칙) 모두 꺼짐 */
export function gatesOf(buy: RuleBuy): RuleGates {
  return { above200: { on: Boolean(buy.gates?.above200?.on) } };
}

/** 이 규칙이 200일선을 쓰는가 — 거름망 또는 이동평균 교차에 200 (백테스트 준비 봉을 늘린다) */
export function usesMa200(body: RuleBody): boolean {
  return gatesOf(body.buy).above200.on || (body.buy.maCross.on && (body.buy.maCross.short === 200 || body.buy.maCross.long === 200));
}

export interface RuleSell {
  /** 점수가 value 점 아래로 떨어지면 매도 */
  scoreBelow: { on: boolean; value: number };
  /**
   * 반대 신호 — **켠 순간 조건의 반대**만 본다: 교차를 켰으면 데드크로스(같은 단기·장기선),
   * RSI 반등을 켰으면 RSI ≥ rsiAbove. 예전 교차 계산기(`decideRule`)와 같은 뜻이라 「교차만」·「RSI 만」 규칙도 그대로 옮겨진다.
   */
  opposite: { on: boolean; rsiAbove: number };
  stopLoss: { on: boolean; percent: number };
  takeProfit: { on: boolean; percent: number };
  /** 트레일링 = 최고가보다 percent% 내려가면 매도 */
  trailing: { on: boolean; percent: number };
}

/** 저장되는 규칙 내용 (이름·시각 제외) */
export interface RuleBody {
  buy: RuleBuy;
  sell: RuleSell;
  /** 손절 뒤 다시 사기까지 기다리는 거래일 수 (0 = 바로) */
  reentryWaitDays: number;
}

/** 이 규칙을 쓰는 곳 — 1단계에서는 늘 비어 있다(2단계에서 채운다) */
export interface RuleUsage {
  buyJudge: boolean;
  accounts: number[];
  backtest: boolean;
}

export interface TradingRule extends RuleBody {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  usedBy: RuleUsage;
}

export const EMPTY_USAGE: RuleUsage = { buyJudge: false, accounts: [], backtest: false };

export const isUsed = (u: RuleUsage): boolean => u.buyJudge || u.backtest || u.accounts.length > 0;

/** 점수를 내는 매수 조건 키 (표에 그리는 순서) */
export const BUY_KEYS = ['trend', 'timing', 'momentum', 'volume', 'riskReward', 'maCross', 'rsiRebound'] as const;
export type BuyKey = (typeof BUY_KEYS)[number];

/**
 * 그룹 점수표 — **예전 점수 계산기(`swingAnalyzer.ts`, v2.45.0 에 지움) 그대로**: 작은 검사 0·1·2·3개 통과 → 점수.
 * 손익비는 비율 표다(<1 → 0 · ≥1 → 3 · ≥1.5 → 7 · ≥2 → 10).
 */
export const GROUP_TABLES = {
  trend: [0, 10, 20, 30],
  timing: [0, 8, 15, 25],
  momentum: [0, 6, 12, 20],
  volume: [0, 5, 10, 15],
  riskReward: [0, 3, 7, 10],
} as const;
export type GroupKey = keyof typeof GROUP_TABLES;

/**
 * 그룹 만점을 바꾸면 점수표를 **비례로** 늘리거나 줄인다(반올림). 기본 만점이면 예전 표와 같다.
 * 예: 추세 만점 50 → [0, 17, 33, 50] · 타이밍 만점 10 → [0, 3, 6, 10].
 */
export function scaledTable(key: GroupKey, points: number): number[] {
  const base = GROUP_TABLES[key];
  const max = base[base.length - 1];
  return base.map((v) => Math.round((v * points) / max));
}

/** 켠 조건의 최대 점수 합계 */
export function maxScoreOf(buy: RuleBuy): number {
  return BUY_KEYS.reduce((sum, k) => sum + (buy[k].on ? buy[k].points : 0), 0);
}

export const hasBuyCondition = (buy: RuleBuy): boolean => BUY_KEYS.some((k) => buy[k].on);

/**
 * 새 규칙 = **빈 규칙** — 모든 조건 꺼짐(사용자 결정 A-3). 숫자는 켰을 때의 출발값이다.
 * 교차·RSI 반등의 출발 점수 10 은 앱이 정한 값이다(근거 검증 전).
 */
export function emptyRuleBody(): RuleBody {
  return {
    buy: {
      trend: { on: false, points: 30 },
      timing: { on: false, points: 25, rsiLow: 35, rsiHigh: 45 },
      momentum: { on: false, points: 20 },
      volume: { on: false, points: 15 },
      riskReward: { on: false, points: 10 },
      maCross: { on: false, points: 10, short: 5, long: 20 },
      rsiRebound: { on: false, points: 10, below: 30 },
      minScore: 65,
      gates: { above200: { on: false } },
    },
    sell: {
      scoreBelow: { on: false, value: 50 },
      opposite: { on: false, rsiAbove: 70 },
      stopLoss: { on: false, percent: 7 },
      takeProfit: { on: false, percent: 10 },
      trailing: { on: false, percent: 5 },
    },
    reentryWaitDays: 5,
  };
}

/**
 * 「기본 규칙」 — 지금 매수 판단(표준 기준)와 같은 5그룹 점수 · 65점 이상 매수.
 * 50점 아래 매도 · 손절 7%(계좌 기본값과 같다) · 다시 사기까지 5거래일. 처음 한 번만 만든다(`server/rules/store.ts`).
 */
export function defaultRuleBody(): RuleBody {
  const body = emptyRuleBody();
  for (const k of ['trend', 'timing', 'momentum', 'volume', 'riskReward'] as const) body.buy[k].on = true;
  body.sell.scoreBelow.on = true;
  body.sell.stopLoss.on = true;
  return body;
}

export const DEFAULT_RULE_NAME = '기본 규칙';

/**
 * 예시 규칙 「기본 규칙 + 200일선」 (v2.50.0 — 사용자 결정 A-3) — 기본 규칙과 같고 거름망(200일선 위일 때만 매수)만 켬.
 * 처음 한 번만 만든다(`server/rules/store.ts`). 「기본 규칙」 은 바꾸지 않는다.
 */
export const ABOVE200_RULE_NAME = '기본 규칙 + 200일선';
export function above200RuleBody(): RuleBody {
  const body = defaultRuleBody();
  body.buy.gates = { above200: { on: true } };
  return body;
}

export function cloneRuleBody(b: RuleBody): RuleBody {
  return JSON.parse(JSON.stringify({ buy: b.buy, sell: b.sell, reentryWaitDays: b.reentryWaitDays })) as RuleBody;
}
