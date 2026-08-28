/**
 * 2라운드 — 종합 의장.
 *
 * 교차검증 라운드(각 에이전트가 남의 의견을 보고 다시 답하는 단계)는 두지 않았다.
 * 호출이 9회로 늘어나는 것도 있지만, 더 큰 이유는 합의 편향이다 —
 * 리스크 매니저가 다른 셋의 낙관을 보고 반론을 스스로 약화시키면
 * 애초에 그를 둔 이유가 사라진다.
 */

import type { AgentOpinion } from '../../src/types/gemini';

export const MODERATOR_SYSTEM = `당신은 투자 분석 종합 의장입니다.
4명 전문가(차트 기술 분석가, 퀀트 트레이더, 펀더멘탈 애널리스트, 리스크 매니저)의
독립 분석을 검토하고 균형 잡힌 최종 판단을 내립니다.

작업:
1. 의견이 일치하는 영역을 식별합니다.
2. 충돌하는 영역을 찾고, 어느 쪽 근거가 더 강한지 판단합니다.
3. 리스크 매니저의 반론이 타당한지 평가합니다. 타당하면 신뢰도를 낮추세요.
4. 최종 signal 과 confidence 를 결정합니다.
5. 구체적인 액션 플랜을 제시합니다.

판단 원칙:
- 다수결이 아닙니다. 근거의 강도로 판단하세요.
- 에이전트 간 의견이 갈리면 final_confidence 를 0.6 이하로 두세요.
- 진입가·목표가·손절가는 퀀트의 수치를 기준으로 하되, 기술 분석가의
  지지선·저항선과 크게 어긋나면 조정하고 그 이유를 conflicts 에 적으세요.
- 실패했거나 데이터가 없는 에이전트의 의견은 무시하되, 그 사실을 반영해
  confidence 를 낮추세요.

모든 서술은 한국어로 작성합니다.
이 판단은 투자 조언이 아니며 최종 결정은 사용자가 내립니다.`;

export const MODERATOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    final_signal: {
      type: 'STRING',
      enum: ['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL'],
    },
    final_confidence: { type: 'NUMBER', description: '0.0~1.0' },
    votes: {
      type: 'OBJECT',
      properties: {
        buy: { type: 'NUMBER' },
        hold: { type: 'NUMBER' },
        sell: { type: 'NUMBER' },
      },
      required: ['buy', 'hold', 'sell'],
    },
    consensus: { type: 'ARRAY', items: { type: 'STRING' } },
    conflicts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { issue: { type: 'STRING' }, resolution: { type: 'STRING' } },
        required: ['issue', 'resolution'],
      },
    },
    action_plan: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: '지금 할 구체적 행동' },
        entry_price: { type: 'NUMBER' },
        target_price: { type: 'NUMBER' },
        stop_loss: { type: 'NUMBER' },
        position_size_percent: { type: 'NUMBER', description: '잔고 대비 %' },
      },
      required: ['action'],
    },
    monitoring: { type: 'ARRAY', items: { type: 'STRING' } },
    summary: { type: 'STRING', description: '한 줄 요약' },
  },
  required: ['final_signal', 'final_confidence', 'votes', 'action_plan', 'summary'],
};

/** 4명의 응답을 의장에게 넘길 텍스트로 정리한다. */
export function buildModeratorPrompt(symbol: string, agents: AgentOpinion[]): string {
  const lines: string[] = [`# ${symbol} 전문가 분석 결과`, ''];

  for (const agent of agents) {
    lines.push(`## ${agent.label}`);
    if (agent.error) {
      lines.push(`⚠️ 분석 실패: ${agent.error} — 이 의견은 판단에서 제외하세요.`, '');
      continue;
    }
    lines.push(`- 투표: ${agent.vote} (신뢰도 ${(agent.confidence * 100).toFixed(0)}%)`);
    lines.push(`- 요약: ${agent.summary}`);
    lines.push('- 상세:');
    lines.push('```json');
    lines.push(JSON.stringify(agent.detail, null, 2));
    lines.push('```', '');
  }

  const valid = agents.filter((a) => !a.error);
  const tally = (vote: string) => valid.filter((a) => a.vote === vote).length;
  lines.push('## 투표 현황');
  lines.push(`BUY ${tally('BUY')} / HOLD ${tally('HOLD')} / SELL ${tally('SELL')}`);
  if (valid.length < agents.length) {
    lines.push(`(${agents.length - valid.length}명은 분석에 실패해 집계에서 제외)`);
  }

  return lines.join('\n');
}
