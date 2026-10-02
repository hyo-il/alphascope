/** Gemini 자동 분석 타입 — 서버와 프론트가 함께 쓴다. */


export type TradeSignal = 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
export type AgentVote = 'BUY' | 'HOLD' | 'SELL';
export type AgentRole = 'technician' | 'quant' | 'fundamental' | 'risk_manager';

/** 1라운드 — 에이전트 한 명의 독립 분석 */
export interface AgentOpinion {
  role: AgentRole;
  /** 역할 표시용 한글 이름 */
  label: string;
  vote: AgentVote;
  confidence: number;
  /** 한 줄 요약 */
  summary: string;
  /** 역할별 상세 — 모양이 다르므로 그대로 담아 화면에서 풀어 쓴다 */
  detail: Record<string, unknown>;
  /** 이 에이전트만 실패했을 때 */
  error?: string | null;
}

/** 2라운드 — 종합 의장의 최종 판단 */
export interface ModeratorVerdict {
  final_signal: TradeSignal;
  final_confidence: number;
  votes: { buy: number; hold: number; sell: number };
  consensus: string[];
  conflicts: { issue: string; resolution: string }[];
  action_plan: {
    action: string;
    entry_price: number | null;
    target_price: number | null;
    stop_loss: number | null;
    position_size_percent: number | null;
  };
  monitoring: string[];
  summary: string;
}

export type GeminiTrigger = 'auto' | 'scheduled' | 'manual';

/**
 * Gemini 분석의 출처 이름 (v2.23.0, v2.30.0 에 화면 파일에서 여기로 — 진단 리포트(서버)도 같은 이름을 쓴다).
 * 배지·「AI 분석 기록」 필터·진단 출처별 표가 **같은 이름**을 쓴다.
 * '자동 분석' 이라는 말은 쓰지 않는다 — 차트 탭의 버튼(바로 분석)을 자동으로 도는 것으로 오해하게 했다.
 */
export const GEMINI_TRIGGER_LABEL: Record<GeminiTrigger, string> = {
  auto: '계좌 자동',
  scheduled: '지정 종목',
  manual: '바로 분석',
};

/** 저장되는 분석 한 건 */
export interface GeminiAnalysis {
  id: number;
  symbol: string;
  createdAt: string;
  model: string;
  signal: TradeSignal;
  confidence: number;
  summary: string;
  /** 분석 시점 가격 — 사후 정확도 채점의 기준 */
  priceAtAnalysis: number | null;
  agents: AgentOpinion[];
  verdict: ModeratorVerdict;
  /** 자동 실행된 모의 주문 id (없으면 null) */
  paperOrderId: number | null;
  /** 주문을 걸지 않았다면 그 이유 */
  tradeNote: string | null;
  tokens: number;
  elapsedMs: number;
  /**
   * 분석 출처 (v2.23.0 에 셋으로 나눴다)
   * - 'auto' = 계좌 자동매매(AI형) — `accountId` 가 함께 저장된다(그 전 기록은 null)
   * - 'scheduled' = 내가 지정한 종목(하루 1번)
   * - 'manual' = 사용자가 버튼으로 바로 실행
   * 채점은 셋 다 똑같이 한다 (accuracy.ts 는 출처를 보지 않는다).
   */
  trigger: GeminiTrigger;
  /** 계좌 자동매매가 낸 분석이면 그 계좌 id. 그 밖·옛 기록은 null */
  accountId: number | null;
  /** 분석에 쓴 프롬프트 버전 (server/gemini/agents.ts 의 PROMPT_VERSION). 옛 기록은 'v1' */
  promptVersion: string;
}

