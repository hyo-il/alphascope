/**
 * 2라운드 토론 오케스트레이션.
 *
 *   1라운드: 4개 에이전트 병렬 (4 호출)  → 서로의 의견을 보지 못한다
 *   2라운드: 종합 의장 1명       (1 호출)
 *   합계 5 호출 / 1종목
 *
 * 종목 단위로는 순차로 돈다 (scheduler 참고). 종목까지 병렬로 돌리면
 * 동시 요청이 종목 수 × 4 가 되어 분당 한도에 바로 걸린다.
 */

import type {
  AgentOpinion,
  GeminiAnalysis,
  ModeratorVerdict,
  TradeSignal,
} from '../../src/types/gemini';
import { AGENTS } from './agents';
import { callGemini, DEFAULT_MODEL, GeminiError } from './client';
import { buildContext } from './context';
import { DEFAULT_HORIZON, horizonBlock, type InvestmentHorizon } from '../../src/services/analysis/horizons';
import { buildModeratorPrompt, MODERATOR_SCHEMA, MODERATOR_SYSTEM } from './moderator';
import { insertAnalysis } from './store';

export interface RunOptions {
  symbol: string;
  trigger: 'auto' | 'manual';
  /** 판단의 시간축. 수동 분석과 같은 정의를 쓴다. */
  horizon?: InvestmentHorizon;
  /** 차트 이미지 (data URL 또는 순수 base64). 기술 분석가에게만 붙는다. */
  chartImage?: string | null;
  model?: string;
}

/** 에이전트 응답에서 공통 필드를 떼고 나머지를 detail 로 남긴다 */
function splitOpinion(role: AgentOpinion['role'], label: string, data: any): AgentOpinion {
  const { vote, confidence, summary, ...detail } = data ?? {};
  return {
    role,
    label,
    vote: vote === 'BUY' || vote === 'SELL' ? vote : 'HOLD',
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, Number(confidence))) : 0.5,
    summary: typeof summary === 'string' ? summary : '',
    detail,
    error: null,
  };
}

function parseDataUrl(image: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(image.trim());
  if (match) return { mimeType: match[1], data: match[2] };
  // 순수 base64 로 들어오는 경우도 받아 준다
  if (/^[A-Za-z0-9+/=\s]+$/.test(image) && image.length > 100) {
    return { mimeType: 'image/png', data: image.replace(/\s/g, '') };
  }
  return null;
}

/** 5개 신호를 모의주문용 방향으로 좁힌다 */
export function signalDirection(signal: TradeSignal): 'BUY' | 'SELL' | null {
  if (signal === 'STRONG_BUY' || signal === 'BUY') return 'BUY';
  if (signal === 'STRONG_SELL' || signal === 'SELL') return 'SELL';
  return null;
}

/**
 * 한 종목을 분석하고 DB 에 저장한다.
 * 자동매매 연결은 여기서 하지 않는다 — 신호 생성과 주문 실행을 분리해야
 * 주문 로직을 끄고도 분석 정확도를 계속 쌓을 수 있다.
 */
export async function runAnalysis(options: RunOptions): Promise<GeminiAnalysis> {
  const symbol = options.symbol.trim().toUpperCase();
  const model = options.model ?? DEFAULT_MODEL;
  const startedAt = Date.now();

  const context = await buildContext(symbol);
  const image = options.chartImage ? parseDataUrl(options.chartImage) : null;

  // 같은 차트라도 1주와 6개월은 다른 질문이다. 기간 블록을 데이터 앞에 둬서
  // 네 에이전트와 의장이 같은 시간축으로 판단하게 한다.
  const horizon = options.horizon ?? DEFAULT_HORIZON;
  const horizonText = horizonBlock(horizon);

  let tokens = 0;

  // ── 1라운드: 독립 분석 ────────────────────────────────
  const opinions = await Promise.all(
    AGENTS.map(async (agent): Promise<AgentOpinion> => {
      try {
        const parts = [{ text: horizonText }, { text: context.text }];
        if (agent.wantsImage && image) {
          parts.push({ inlineData: image } as any);
          parts.push({ text: '위 이미지는 이 종목의 차트 캡처입니다. 패턴 판단에 함께 참고하세요.' });
        }
        const result = await callGemini<any>({
          system: agent.system,
          parts,
          schema: agent.schema,
          model,
          temperature: 0.3,
        });
        tokens += result.tokens;
        return splitOpinion(agent.role, agent.label, result.data);
      } catch (error) {
        // 한 명이 실패해도 나머지로 종합한다. 의장에게 실패 사실을 알려
        // 신뢰도를 낮추게 한다.
        return {
          role: agent.role,
          label: agent.label,
          vote: 'HOLD',
          confidence: 0,
          summary: '',
          detail: {},
          error: (error as Error).message,
        };
      }
    }),
  );

  if (opinions.every((opinion) => opinion.error)) {
    throw new GeminiError(`4개 에이전트가 모두 실패했습니다: ${opinions[0].error}`);
  }

  // ── 2라운드: 종합 ────────────────────────────────────
  const moderator = await callGemini<ModeratorVerdict>({
    system: MODERATOR_SYSTEM,
    parts: [
      { text: horizonText },
      { text: context.text },
      { text: buildModeratorPrompt(symbol, opinions) },
    ],
    schema: MODERATOR_SCHEMA,
    model,
    temperature: 0.2,
  });
  tokens += moderator.tokens;

  const verdict = moderator.data;

  const record: Omit<GeminiAnalysis, 'id'> = {
    symbol,
    createdAt: new Date().toISOString(),
    model,
    signal: verdict.final_signal,
    confidence: Math.min(1, Math.max(0, Number(verdict.final_confidence) || 0)),
    summary: verdict.summary ?? '',
    priceAtAnalysis: context.price,
    agents: opinions,
    verdict,
    paperOrderId: null,
    tradeNote: null,
    tokens,
    elapsedMs: Date.now() - startedAt,
    trigger: options.trigger,
  };

  const id = insertAnalysis(record);
  return { ...record, id };
}
