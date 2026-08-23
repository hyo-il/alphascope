/**
 * 투자 기간 정의 — 4개 프롬프트 빌더가 같은 문구를 쓰도록 한 곳에 모은다.
 *
 * 같은 차트라도 1주와 6개월은 다른 질문이다. 기간을 고르지 않으면 답이 뭉개지므로
 * 기간마다 "무엇을 중심으로 볼지"와 "액션 플랜의 시간축"을 함께 넘긴다.
 */

export type InvestmentHorizon = 'short' | 'swing' | 'mid' | 'long';

export interface HorizonSpec {
  id: InvestmentHorizon;
  /** 버튼 라벨 */
  label: string;
  /** 기간 요약 (버튼 보조 문구) */
  period: string;
  /** 프롬프트 첫머리에 들어가는 관점 선언 */
  directive: string;
  /** 이 기간에서 무게를 둘 분석 축 */
  focus: string;
  /** 참고할 차트 주기 */
  charts: string;
  /** 종합 의장의 액션 플랜이 따라야 할 시간축 */
  actionPlan: string;
}

export const HORIZONS: HorizonSpec[] = [
  {
    id: 'short',
    label: '단기',
    period: '1주 이내',
    directive: '1주 이내 단기 매매 관점에서 분석해 주세요.',
    focus:
      '기술적 지표를 중심으로 판단하세요. 진입·청산 타이밍과 변동성(ATR·밴드 폭)을 가장 무겁게 보고, 펀더멘탈은 급격한 이벤트(실적 발표 임박 등)가 아니면 비중을 낮추세요.',
    charts: '1분봉·5분봉 등 분봉 흐름',
    actionPlan:
      '액션 플랜은 며칠 단위로 구체적으로 적으세요. 예: "내일 장 시작 후 $198 돌파 시 진입, $195 이탈 시 손절".',
  },
  {
    id: 'swing',
    label: '스윙',
    period: '1개월',
    directive: '1개월 내 스윙 트레이딩(수일~수주 보유) 관점에서 분석해 주세요.',
    focus:
      '기술적 분석에 수급을 더해 판단하세요. 추세 전환점, 지지·저항, 캔들·차트 패턴을 가장 무겁게 보세요.',
    charts: '일봉 흐름',
    actionPlan:
      '액션 플랜은 수일~수주 단위로 적으세요. 예: "20일선 지지 확인 후 분할 진입, 목표 $215에서 절반 청산".',
  },
  {
    id: 'mid',
    label: '중기',
    period: '3개월',
    directive: '3개월 중기 투자 관점에서 분석해 주세요.',
    focus:
      '기술적 분석과 펀더멘탈을 비슷한 무게로 함께 보세요. 다음 분기 실적 전망, 밸류에이션(동종업계 대비), 업종 동향을 반드시 언급하세요.',
    charts: '일봉·주봉 흐름',
    actionPlan:
      '액션 플랜은 분기 단위 일정과 함께 적으세요. 예: "다음 실적 발표 전 비중 절반, 발표 후 재평가".',
  },
  {
    id: 'long',
    label: '장기',
    period: '6개월 이상',
    directive: '6개월 이상 장기 투자 관점에서 분석해 주세요.',
    focus:
      '펀더멘탈을 중심으로 판단하세요. 기업 경쟁력(해자), 재무 건전성, 성장성, 배당을 가장 무겁게 보고, 기술적 지표는 진입 시점을 다듬는 데만 쓰세요.',
    charts: '주봉·월봉 흐름',
    actionPlan:
      '액션 플랜은 분할 매수·보유 기준으로 적으세요. 예: "분기 실적 발표 후 $190 이하에서 3회 분할 매수, 성장률 둔화 시 재검토".',
  },
];

export const DEFAULT_HORIZON: InvestmentHorizon = 'swing';

export function horizonOf(id: InvestmentHorizon): HorizonSpec {
  return HORIZONS.find((h) => h.id === id) ?? HORIZONS[1];
}

/** 프롬프트 앞부분에 붙일 관점 블록 */
export function horizonBlock(id: InvestmentHorizon): string {
  const h = horizonOf(id);
  return `## 투자 기간: ${h.label} (${h.period})
${h.directive}
${h.focus}
참고할 차트 주기: ${h.charts}`;
}

/** 히스토리·요약에 남길 짧은 표기 */
export function horizonLabel(id: InvestmentHorizon): string {
  const h = horizonOf(id);
  return `${h.label}(${h.period})`;
}
