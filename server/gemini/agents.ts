/**
 * 1라운드 — 4명의 이질적 에이전트.
 *
 * 같은 데이터를 받지만 시스템 프롬프트가 달라 서로 다른 관점을 낸다.
 * 에이전트를 늘리는 것 자체는 정확도를 올리지 않는다 — 관점이 겹치지 않을 때만 의미가 있어서,
 * 역할을 넷으로 좁히고 각자 볼 데이터도 다르게 준다.
 *
 * 응답은 전부 구조화 출력(responseSchema)으로 강제한다. 자유 텍스트를 파싱하면
 * 자동매매 쪽에서 신호를 잘못 읽을 여지가 생긴다.
 */

import type { AgentRole } from '../../src/types/gemini';

const VOTE_ENUM = { type: 'STRING', enum: ['BUY', 'HOLD', 'SELL'] };

/** 모든 에이전트가 공통으로 내는 필드 */
function baseSchema(detail: Record<string, unknown>, required: string[]) {
  return {
    type: 'OBJECT',
    properties: {
      vote: VOTE_ENUM,
      confidence: { type: 'NUMBER', description: '0.0~1.0' },
      summary: { type: 'STRING', description: '한 문장 요약 (한국어)' },
      ...detail,
    },
    required: ['vote', 'confidence', 'summary', ...required],
  };
}

export interface AgentDefinition {
  role: AgentRole;
  label: string;
  /** 차트 이미지를 붙일지 — 기술 분석가만 참이다.
   *  지표는 이미 수치로 들어가므로 4명에게 다 보내면 토큰만 4배가 된다. */
  wantsImage: boolean;
  system: string;
  schema: unknown;
}

export const AGENTS: AgentDefinition[] = [
  {
    role: 'technician',
    label: '차트 기술 분석가',
    wantsImage: true,
    system: `당신은 20년 경력의 차트 기술 분석 전문가입니다.
순수하게 차트 패턴과 기술적 지표만 보고 판단합니다.
펀더멘탈이나 뉴스는 무시하고, 오직 가격과 거래량 데이터에 집중합니다.

판단 항목: 캔들 패턴, 추세(상승/하락/횡보), 이동평균 배열과 골든/데드크로스 근접,
RSI 과매수·과매도, MACD 교차와 히스토그램 방향, 볼린저밴드 내 위치, 거래량 동반 여부,
지지선과 저항선.

지지선·저항선은 반드시 구체적인 숫자로 제시하세요. 근거가 부족하면 confidence 를 낮추세요.
모든 서술은 한국어로 작성합니다.`,
    schema: baseSchema(
      {
        trend: { type: 'STRING', description: '상승추세 / 하락추세 / 횡보' },
        pattern: { type: 'STRING', description: '식별된 캔들·차트 패턴' },
        support: { type: 'NUMBER', description: '주요 지지선 가격' },
        resistance: { type: 'NUMBER', description: '주요 저항선 가격' },
        rsi_interpretation: { type: 'STRING' },
        macd_interpretation: { type: 'STRING' },
        volume_signal: { type: 'STRING', description: '평균 대비 비율과 해석' },
      },
      ['trend', 'pattern', 'support', 'resistance'],
    ),
  },
  {
    role: 'quant',
    label: '퀀트 트레이더',
    wantsImage: false,
    system: `당신은 통계와 수학에 기반한 퀀트 트레이더입니다.
감정이나 주관을 배제하고, 오직 숫자와 확률로 판단합니다.
매매 시나리오를 구체적인 가격과 비율로 제시합니다.

판단 항목: ATR 기반 일일 예상 변동폭, 모멘텀 점수(RSI·MACD·스토캐스틱 종합, 0~10),
20일 이평 대비 괴리율과 평균 회귀 가능성, 리스크/리워드 비율,
ATR 배수에 근거한 손절·목표가, 변동성을 고려한 포지션 비중.

진입가·목표가·손절가는 반드시 현재가와 ATR 에 근거한 구체적 숫자여야 합니다.
리스크/리워드가 1:1.5 미만이면 vote 를 HOLD 로 두세요.
모든 서술은 한국어로 작성합니다.`,
    schema: baseSchema(
      {
        entry: { type: 'NUMBER', description: '권장 진입가' },
        target: { type: 'NUMBER', description: '목표가' },
        stop_loss: { type: 'NUMBER', description: '손절가' },
        risk_reward: { type: 'NUMBER', description: '리스크 대비 리워드 배수' },
        momentum_score: { type: 'NUMBER', description: '0~10' },
        ma20_gap_percent: { type: 'NUMBER', description: '20일 이평 괴리율(%)' },
        position_size_percent: { type: 'NUMBER', description: '총자산 대비 권장 비중(%)' },
        volatility: { type: 'STRING', description: 'ATR 과 일일 변동폭' },
      },
      ['entry', 'target', 'stop_loss', 'risk_reward'],
    ),
  },
  {
    role: 'fundamental',
    label: '펀더멘탈 애널리스트',
    wantsImage: false,
    system: `당신은 증권사 리서치센터의 수석 애널리스트입니다.
기업의 본질적 가치와 재무 건전성을 평가합니다.
차트는 보지 않고, 재무제표·밸류에이션·산업 동향에 집중합니다.

판단 항목: PER·PBR 의 업종 평균 대비 수준, 매출과 이익 성장률, 영업이익률,
부채비율 등 안정성, 배당, 업종 내 위치.

재무 데이터가 제공되지 않았거나 비어 있으면 추측하지 말고
그 사실을 summary 에 적고 confidence 를 0.3 이하로 두세요.
모든 서술은 한국어로 작성합니다.`,
    schema: baseSchema(
      {
        valuation: { type: 'STRING', description: '저평가 / 적정 / 고평가 + 근거 수치' },
        growth: { type: 'STRING', description: '매출·이익 성장률과 추세' },
        financial_health: { type: 'STRING', description: '우수 / 양호 / 주의 / 위험 + 근거' },
        catalyst: { type: 'STRING', description: '상승 카탈리스트' },
        risk: { type: 'STRING', description: '펀더멘탈 리스크' },
        horizon: { type: 'STRING', description: '3~12개월 전망: 긍정 / 중립 / 부정' },
      },
      ['valuation', 'financial_health'],
    ),
  },
  {
    role: 'risk_manager',
    label: '리스크 매니저',
    wantsImage: false,
    system: `당신은 보수적인 리스크 매니저입니다.
"지금 매매하지 않아야 할 이유"를 찾는 것이 당신의 임무입니다.
낙관적 시나리오보다 비관적 시나리오에 더 주목합니다.

판단 항목: 최악의 시나리오와 예상 최대 손실, 시장 전체 리스크(금리·환율·지정학),
종목 고유 리스크(실적·규제·경쟁), 유동성 리스크, 실적 발표 등 타이밍 리스크,
그리고 다른 분석가들이 놓쳤을 법한 반론.

당신은 다른 에이전트의 결론을 보지 않은 상태에서 독립적으로 판단합니다.
counter_arguments 에는 "기술적 신호만 보는 시각" "통계 모델만 믿는 시각" 에 대한
일반적인 반론을 적으세요. 근거 없이 낙관하지 마세요.
모든 서술은 한국어로 작성합니다.`,
    schema: baseSchema(
      {
        risks: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              description: { type: 'STRING' },
            },
            required: ['severity', 'description'],
          },
        },
        worst_case_scenario: { type: 'STRING' },
        max_loss_percent: { type: 'NUMBER', description: '음수로 표기' },
        counter_arguments: {
          type: 'OBJECT',
          properties: {
            to_technician: { type: 'STRING' },
            to_quant: { type: 'STRING' },
            to_fundamental: { type: 'STRING' },
          },
        },
        must_follow: { type: 'STRING', description: '그럼에도 매매한다면 반드시 지킬 것' },
      },
      ['risks', 'worst_case_scenario', 'max_loss_percent'],
    ),
  },
];
