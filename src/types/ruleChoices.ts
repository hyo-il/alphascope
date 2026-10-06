import type { RuleConfig } from './autoTrading';

/**
 * 규칙형 쉬운 선택지 3개 (v2.31.0 — v2.37.0 에 `paper-trading/RuleChoices.tsx` 에서 옮겼다).
 * 화면(계좌의 판단 방식 고르기)과 서버 백테스트(`server/autoTrading/ruleResearch.ts`)가 **같은 값**을 쓴다 — 두 벌이면 백테스트가 다른 규칙을 시험한다.
 * 값은 **앱의 출발값(검증 전)** 이다 — "추천"·"검증된" 이라고 쓰지 않는다.
 */
export interface RuleChoice {
  id: 'trend' | 'dip' | 'both';
  title: string;
  buy: string;
  sell: string;
  why: string;
  weak: string;
  rule: Pick<RuleConfig, 'useMaCross' | 'useRsi' | 'maShort' | 'maLong' | 'rsiBuyBelow' | 'rsiSellAbove'>;
}

const BASE = { maShort: 5, maLong: 20, rsiBuyBelow: 30, rsiSellAbove: 70 };

export const RULE_CHOICES: RuleChoice[] = [
  {
    id: 'trend',
    title: '추세 따라가기',
    buy: '최근 5일 평균값이 20일 평균값을 위로 넘어설 때(오르는 흐름이 시작될 때)',
    sell: '5일 평균값이 20일 평균값 아래로 내려갈 때',
    why: '오르기 시작한 흐름에 올라타고, 꺾이면 내리려는 방법입니다.',
    weak: '오르락내리락만 하는 시기에는 매수·매도를 자주 반복하며 조금씩 잃기 쉽습니다.',
    rule: { ...BASE, useMaCross: true, useRsi: false },
  },
  {
    id: 'dip',
    title: '많이 떨어지면 매수',
    buy: '최근 많이 떨어져 RSI 가 30 이하였다가 다시 올라설 때',
    sell: 'RSI 가 70 이상으로 많이 올랐을 때',
    why: '지나치게 떨어진 뒤 되돌아오는 움직임을 노립니다.',
    weak: '계속 떨어지는 종목은 "싸 보여서" 매수했다가 더 떨어질 수 있습니다 — 그래서 손절이 꼭 필요합니다.',
    rule: { ...BASE, useMaCross: false, useRsi: true },
  },
  {
    id: 'both',
    title: '둘 다 (지금 기본값)',
    buy: '위 두 가지 중 하나라도 맞을 때',
    sell: '위 두 가지 중 하나라도 맞을 때',
    why: '기회가 많아집니다.',
    weak: '매수·매도한 이유가 섞여, 무엇 때문에 벌거나 잃었는지 알기 어려워집니다.',
    rule: { ...BASE, useMaCross: true, useRsi: true },
  },
];


/** 규칙 값이 세 선택지 중 어느 것과 같은지 — 없으면 null(화면 「직접 설정」). 계좌 설정·백테스트가 같은 함수 */
export function matchChoice(rule: RuleConfig): RuleChoice['id'] | null {
  return (
    RULE_CHOICES.find((c) =>
      (Object.keys(c.rule) as (keyof RuleChoice['rule'])[]).every((k) => rule[k] === c.rule[k]),
    )?.id ?? null
  );
}
