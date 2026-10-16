/**
 * 매매 규칙을 **쉬운 한 줄**로 — 한 곳 (v2.44.0). 계좌 「지금 조건」·자동매매 바·백테스트 히스토리·AI 결과 설명이 같은 문장을 쓴다.
 * ⚠️ 숫자는 규칙 값에서만 넣는다. 서버도 컴파일한다(DOM 없음).
 */
import { BUY_KEYS, gatesOf, maxScoreOf, type BuyKey, type RuleBody } from '../types/tradingRule';

export const BUY_CONDITION_NAME: Record<BuyKey, string> = {
  trend: '추세',
  timing: '타이밍',
  momentum: '모멘텀',
  volume: '거래량',
  riskReward: '손익비',
  maCross: '이동평균 교차',
  rsiRebound: 'RSI 반등',
};

type Num = (v: number) => string;
const plain: Num = (v) => String(v);

/** 매수 — "추세 30 · 타이밍 25 · … 합계 65점 이상" (켠 조건만) */
export function ruleBuyText(rule: RuleBody, n: Num = plain): string {
  const on = BUY_KEYS.filter((k) => rule.buy[k].on);
  if (!on.length) return '매수 조건 없음';
  const parts = on.map((k) => {
    const c = rule.buy[k];
    const extra =
      k === 'maCross' ? `(${n(rule.buy.maCross.short)}일·${n(rule.buy.maCross.long)}일)` : k === 'rsiRebound' ? `(RSI ${n(rule.buy.rsiRebound.below)} 이하)` : '';
    return `${BUY_CONDITION_NAME[k]}${extra} ${n(c.points)}`;
  });
  // 거름망(v2.50.0) — 켰을 때만 덧붙인다(끈 규칙·옛 규칙의 문장은 예전 그대로)
  const g = gatesOf(rule.buy);
  const gateParts = [g.above200.on ? '200일선 위일 때만' : '', g.marketAbove200.on ? '시장이 200일선 위일 때만' : ''].filter(Boolean);
  const gate = gateParts.length ? ` · 거름망: ${gateParts.join(' · ')}` : '';
  return `${parts.join(' · ')} — 합계 ${n(rule.buy.minScore)}점 이상(최대 ${n(maxScoreOf(rule.buy))}점)${gate}`;
}

/** 매도 — "점수 50점 아래 · 반대 신호 · 손절 −7% · 익절 끔 · 트레일링 끔" (v2.45.0 — 손절·트레일링 −, 익절 + : `ruleSafetyText` 와 같은 표기) */
export function ruleSellText(rule: RuleBody, n: Num = plain): string {
  const s = rule.sell;
  const parts: string[] = [];
  if (s.scoreBelow.on) parts.push(`점수 ${n(s.scoreBelow.value)}점 아래`);
  if (s.opposite.on) parts.push('반대 신호');
  parts.push(s.stopLoss.on ? `손절 −${n(s.stopLoss.percent)}%` : '손절 끔');
  parts.push(s.takeProfit.on ? `익절 +${n(s.takeProfit.percent)}%` : '익절 끔');
  parts.push(s.trailing.on ? `트레일링 −${n(s.trailing.percent)}%` : '트레일링 끔');
  return parts.join(' · ');
}

/** 손절·익절·트레일링 한 줄 */
export function ruleSafetyText(rule: RuleBody): string {
  const s = rule.sell;
  return [
    s.stopLoss.on ? `손절 −${s.stopLoss.percent}%` : '손절 끔',
    s.takeProfit.on ? `익절 +${s.takeProfit.percent}%` : '익절 끔',
    s.trailing.on ? `트레일링 −${s.trailing.percent}%` : '트레일링 끔',
  ].join(' · ');
}

/** 손절이 꺼진 규칙 — 계좌 화면이 경고한다 */
export const NO_STOP_WARNING = '이 규칙은 손절이 꺼져 있습니다 — 값이 계속 떨어져도 팔지 않습니다.';

/** 계좌·백테스트 공통 판단 시각 문장 */
/** 트레일링 최고가 기준 차이(v2.49.0 — 사용자 결정 A-3: 동작은 그대로, 알리기만) — 백테스트 안내 · 결과 위 한 줄 */
export const TRAILING_BASIS_TEXT = '트레일링은 계좌는 실시간 최고가, 백테스트는 하루 종가 최고가로 잽니다. 그래서 계좌가 조금 더 일찍 팔 수 있습니다.';

export const JUDGE_TIMING_TEXT = '시장이 열린 뒤 하루 한 번 판단(어제까지 끝난 봉 기준) · 손절·익절·트레일링은 1분마다';
