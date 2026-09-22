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
  /** 'auto' = 스케줄러, 'manual' = 사용자가 버튼으로 실행 */
  trigger: 'auto' | 'manual';
}

