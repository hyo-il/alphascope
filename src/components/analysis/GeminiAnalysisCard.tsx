import Button from '../ui/Button';
import TrashIcon from '../common/TrashIcon';
import DisclosureButton from '../ui/DisclosureButton';
import WarnIcon from '../ui/WarnIcon';
import { useState } from 'react';
import type { AgentOpinion, GeminiAnalysis } from '../../types/gemini';
import { formatPrice } from '../../utils/formatters';
import { currencyOfSymbol } from '../../utils/market';
import AISourceBadge, { GEMINI_TRIGGER_LABEL } from './AISourceBadge';
import StockName from '../common/StockName';
import { confidencePercent, SIGNAL_CLASS, SIGNAL_LABEL, VOTE_CLASS } from './signalStyle';

/** 에이전트 상세는 역할마다 모양이 달라서, 키를 그대로 풀어 보여 준다. */
function AgentDetail({ agent }: { agent: AgentOpinion }) {
  const entries = Object.entries(agent.detail ?? {}).filter(([, value]) => value != null);
  if (!entries.length) return null;

  return (
    <dl className="mt-1 space-y-0.5 text-caption text-text-muted">
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
  isNew = false,
  onDelete,
  accountName,
}: {
  analysis: GeminiAnalysis;
  /** 저장 시점 대비 지금 얼마나 움직였는지 */
  currentPrice?: number | null;
  /** 방금 나온 결과 — 목록에서 눈에 띄게 한다 */
  isNew?: boolean;
  onDelete?: (id: number) => void;
  /** 계좌 자동 분석이면 그 계좌 이름 — 배지에 함께 적는다 */
  accountName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const verdict = analysis.verdict ?? ({} as GeminiAnalysis['verdict']);
  const plan = verdict.action_plan;

  const change =
    currentPrice && analysis.priceAtAnalysis
      ? ((currentPrice - analysis.priceAtAnalysis) / analysis.priceAtAnalysis) * 100
      : null;

  return (
    <div
      // 테두리 없이 바탕색으로 구역을 나눈다(디자인 기준 — 상자 안에 상자 금지). 방금 생긴 결과만 잠깐 파란 ring
      className={`rounded-xl bg-bg-secondary p-3 transition-shadow ${isNew ? 'ring-1 ring-accent' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isNew && (
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-caption text-text-secondary">
            NEW
          </span>
        )}
        <AISourceBadge
          source="gemini"
          suffix={
            analysis.trigger === 'auto' && accountName
              ? `${GEMINI_TRIGGER_LABEL.auto} · ${accountName}`
              : GEMINI_TRIGGER_LABEL[analysis.trigger]
          }
        />
        <StockName symbol={analysis.symbol} className="text-text-primary" />
        <span className={SIGNAL_CLASS[analysis.signal] ?? ''}>
          {SIGNAL_LABEL[analysis.signal] ?? analysis.signal}
        </span>
        <span className="text-xs text-text-muted">{confidencePercent(analysis.confidence)}</span>
        <span className="ml-auto text-xs text-text-muted">
          {new Date(analysis.createdAt).toLocaleString('ko-KR')}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-text-secondary">{analysis.summary}</p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-caption text-text-muted">
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
          className={`mt-1.5 text-xs ${analysis.paperOrderId ? 'text-text-secondary' : 'text-text-muted'}`}
        >
          {analysis.paperOrderId ? '모의 주문 · ' : '· '}
          {analysis.tradeNote}
        </p>
      )}

      {analysis.priceAtAnalysis != null && (
        <p className="mt-1 text-xs text-text-muted">
          분석 시점 {formatPrice(analysis.priceAtAnalysis, currencyOfSymbol(analysis.symbol))}
          {change != null && (
            <span className={change >= 0 ? 'text-bullish' : 'text-bearish'}>
              {' '}
              → 현재 {change >= 0 ? '+' : ''}
              {change.toFixed(2)}%
            </span>
          )}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 text-xs">
        <DisclosureButton open={open} onToggle={() => setOpen(!open)} label="상세 보기" controls={`gemini-card-${analysis.id}`} />
        {onDelete && (
          <Button variant="danger-text" size="sm" className="ml-auto"
            onClick={() => onDelete(analysis.id)}>
            <TrashIcon className="h-3.5 w-3.5" />
            삭제
          </Button>
        )}
      </div>

      {open && (
        <div id={`gemini-card-${analysis.id}`} className="mt-3 space-y-3 border-t border-border pt-3">
          {plan && (
            <section>
              <h4 className="mb-1 text-xs font-medium text-text-primary">액션 플랜</h4>
              <p className="text-xs text-text-secondary">{plan.action}</p>
              <div className="mt-1 flex flex-wrap gap-3 text-caption text-text-muted">
                {plan.entry_price != null && <span>진입 {formatPrice(plan.entry_price, currencyOfSymbol(analysis.symbol))}</span>}
                {plan.target_price != null && (
                  <span className="text-bullish">목표 {formatPrice(plan.target_price, currencyOfSymbol(analysis.symbol))}</span>
                )}
                {plan.stop_loss != null && (
                  <span className="text-bearish">손절 {formatPrice(plan.stop_loss, currencyOfSymbol(analysis.symbol))}</span>
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

          <p className="text-caption text-text-muted">
            {analysis.model} · 토큰 {analysis.tokens.toLocaleString()} ·{' '}
            {(analysis.elapsedMs / 1000).toFixed(1)}초
          </p>
          <p className="text-caption text-warning">
            <WarnIcon />이 분석은 AI 의견이며 투자 조언이 아닙니다.
          </p>
        </div>
      )}
    </div>
  );
}
