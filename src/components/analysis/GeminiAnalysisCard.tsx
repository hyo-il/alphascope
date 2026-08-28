import { useState } from 'react';
import type { AgentOpinion, GeminiAnalysis } from '../../types/gemini';
import { formatUsd } from '../../utils/formatters';
import AISourceBadge from './AISourceBadge';
import { confidencePercent, SIGNAL_CLASS, SIGNAL_LABEL, VOTE_CLASS } from './signalStyle';

/** 에이전트 상세는 역할마다 모양이 달라서, 키를 그대로 풀어 보여 준다. */
function AgentDetail({ agent }: { agent: AgentOpinion }) {
  const entries = Object.entries(agent.detail ?? {}).filter(([, value]) => value != null);
  if (!entries.length) return null;

  return (
    <dl className="mt-1 space-y-0.5 text-[11px] text-text-muted">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-1.5">
          <dt className="shrink-0">{key}</dt>
          <dd className="text-text-secondary">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function GeminiAnalysisCard({
  analysis,
  currentPrice,
  onDelete,
}: {
  analysis: GeminiAnalysis;
  /** 저장 시점 대비 지금 얼마나 움직였는지 */
  currentPrice?: number | null;
  onDelete?: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const verdict = analysis.verdict ?? ({} as GeminiAnalysis['verdict']);
  const plan = verdict.action_plan;

  const change =
    currentPrice && analysis.priceAtAnalysis
      ? ((currentPrice - analysis.priceAtAnalysis) / analysis.priceAtAnalysis) * 100
      : null;

  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex flex-wrap items-center gap-2">
        <AISourceBadge source="gemini" suffix={analysis.trigger === 'auto' ? '자동' : '수동실행'} />
        <span className="font-medium text-text-primary">{analysis.symbol}</span>
        <span className={SIGNAL_CLASS[analysis.signal] ?? ''}>
          {SIGNAL_LABEL[analysis.signal] ?? analysis.signal}
        </span>
        <span className="text-xs text-text-muted">{confidencePercent(analysis.confidence)}</span>
        <span className="ml-auto text-xs text-text-muted">
          {new Date(analysis.createdAt).toLocaleString('ko-KR')}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-text-secondary">{analysis.summary}</p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
        {analysis.agents.map((agent) => (
          <span key={agent.role}>
            {agent.label}{' '}
            <span className={agent.error ? 'text-warning' : (VOTE_CLASS[agent.vote] ?? '')}>
              {agent.error ? '실패' : agent.vote}
            </span>
          </span>
        ))}
      </div>

      {analysis.tradeNote && (
        <p
          className={`mt-1.5 text-xs ${analysis.paperOrderId ? 'text-accent' : 'text-text-muted'}`}
        >
          {analysis.paperOrderId ? '💰 ' : '· '}
          {analysis.tradeNote}
        </p>
      )}

      {analysis.priceAtAnalysis != null && (
        <p className="mt-1 text-xs text-text-muted">
          분석 시점 {formatUsd(analysis.priceAtAnalysis)}
          {change != null && (
            <span className={change >= 0 ? 'text-bullish' : 'text-bearish'}>
              {' '}
              → 현재 {change >= 0 ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          )}
        </p>
      )}

      <div className="mt-2 flex gap-3 text-xs">
        <button onClick={() => setOpen(!open)} className="text-accent hover:underline">
          {open ? '접기' : '자세히'}
        </button>
        {onDelete && (
          <button
            onClick={() => onDelete(analysis.id)}
            className="text-text-muted hover:text-bearish"
          >
            삭제
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {plan && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-primary">액션 플랜</h4>
              <p className="text-xs text-text-secondary">{plan.action}</p>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-text-muted">
                {plan.entry_price != null && <span>진입 {formatUsd(plan.entry_price)}</span>}
                {plan.target_price != null && (
                  <span className="text-bullish">목표 {formatUsd(plan.target_price)}</span>
                )}
                {plan.stop_loss != null && (
                  <span className="text-bearish">손절 {formatUsd(plan.stop_loss)}</span>
                )}
                {plan.position_size_percent != null && (
                  <span>비중 {plan.position_size_percent}%</span>
                )}
              </div>
            </section>
          )}

          {verdict.consensus?.length ? (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-primary">의견 일치</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
                {verdict.consensus.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {verdict.conflicts?.length ? (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-primary">의견 충돌</h4>
              <ul className="space-y-1 text-xs text-text-secondary">
                {verdict.conflicts.map((item, index) => (
                  <li key={index}>
                    <span className="text-warning">{item.issue}</span> → {item.resolution}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h4 className="mb-1 text-xs font-medium text-text-primary">전문가 의견</h4>
            <div className="space-y-2">
              {analysis.agents.map((agent) => (
                <div key={agent.role} className="rounded bg-bg-tertiary p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-primary">{agent.label}</span>
                    {agent.error ? (
                      <span className="text-warning">분석 실패</span>
                    ) : (
                      <>
                        <span className={VOTE_CLASS[agent.vote] ?? ''}>{agent.vote}</span>
                        <span className="text-text-muted">
                          {confidencePercent(agent.confidence)}
                        </span>
                      </>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    {agent.error ?? agent.summary}
                  </p>
                  {!agent.error && <AgentDetail agent={agent} />}
                </div>
              ))}
            </div>
          </section>

          {verdict.monitoring?.length ? (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-primary">모니터링 포인트</h4>
              <ul className="list-disc space-y-0.5 pl-4 text-xs text-text-secondary">
                {verdict.monitoring.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="text-[11px] text-text-muted">
            {analysis.model} · 토큰 {analysis.tokens.toLocaleString()} ·{' '}
            {(analysis.elapsedMs / 1000).toFixed(1)}초
          </p>
          <p className="text-[11px] text-warning">
            ⚠️ 이 분석은 AI 의견이며 투자 조언이 아닙니다.
          </p>
        </div>
      )}
    </div>
  );
}
