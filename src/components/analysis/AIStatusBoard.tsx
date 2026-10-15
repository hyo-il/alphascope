import { formatDateTime } from '../../utils/dateFormat';
import AutoTradeIcon from '../ui/AutoTradeIcon';
import InfoTip from '../ui/InfoTip';
import { useEffect, useState, type ReactNode } from 'react';
import { SIDE_POLL_MS, useAutoTradingOverview } from '../../hooks/usePaperOverview';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { useTradingRules } from '../../hooks/useTradingRules';
import { autoTradeView } from '../../utils/autoTradeStatus';
import type { GeminiUsage } from '../../types/gemini';
import { formatNumber } from '../../utils/formatters';

/**
 * 「검증 기록 > AI 분석」 맨 위 상태 판 (v2.23.0 → v2.47.0) — "무엇이, 언제, 왜 Gemini 를 부르는가" 를 한눈에.
 *
 * - 계좌 자동매매: **기존 자동매매 상태 묶음 라우트**(`/api/auto-trading/overview`)를 그대로 쓴다.
 *   새 라우트·새 폴링을 만들지 않는다 — 오른쪽 계좌 탭과 같은 15초 주기 훅이다. 판단은 매매 규칙이 하고, Gemini 는 「AI 검증」 을 켠 계좌만 부른다(v2.46.0).
 * - 내가 지정한 종목: `scheduled` 로 받은 칸을 그대로 둔다(지정 종목 화면이 그린다).
 * - 오늘 Gemini 사용량: `/api/gemini/status` 의 usage — 기능별(v2.47.0, `server/gemini/usage.ts`).
 */

const time = (iso: string | null | undefined) =>
  iso
    ? formatDateTime(iso)
    : '—';

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl bg-bg-secondary p-3">
      <h3 className="mb-2 text-xs font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

export default function AIStatusBoard({ scheduled }: { scheduled?: ReactNode }) {
  const { items, error } = useAutoTradingOverview(true, SIDE_POLL_MS);
  const { accounts } = usePaperAccounts();
  const [usage, setUsage] = useState<{ usage: GeminiUsage | null; enabled: boolean } | null>(null);

  // 사용량은 화면을 열 때 한 번 — 폴링할 값이 아니다(분석은 길게는 한 시간에 한 바퀴다)
  useEffect(() => {
    let alive = true;
    void fetch('/api/gemini/status')
      .then((r) => r.json())
      .then((data: { enabled?: boolean; usage?: GeminiUsage }) => {
        if (alive) setUsage({ usage: data.usage ?? null, enabled: Boolean(data.enabled) });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (id: number) => accounts.find((a) => a.id === id)?.name ?? `계좌 ${id}`;
  const { rules } = useTradingRules();
  const ruleName = (id: number | null) => (id != null ? (rules?.find((r) => r.id === id)?.name ?? '—') : '없음');

  return (
    <div className="space-y-2">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        <Cell title="계좌 자동매매">
          {error && !items && <p className="text-caption text-danger">상태를 불러오지 못했습니다: {error}</p>}
          {items && items.length === 0 && (
            <p className="text-caption text-text-muted">자동매매를 설정한 계좌가 없습니다 (「계좌」 메뉴 &gt; 자동매매).</p>
          )}
          {!items && !error && <p className="text-caption text-text-muted">불러오는 중…</p>}
          <ul className="space-y-2">
            {(items ?? []).map(({ strategy, status }) => {
              const view = autoTradeView(strategy, status);
              const note = status.lastNotes?.[0];
              return (
                <li key={strategy.accountId} className="text-caption leading-relaxed">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-text-primary">{nameOf(strategy.accountId)}</span>
                    <span className="text-text-secondary">규칙 「{ruleName(strategy.ruleId)}」</span>
                    <span className={`inline-flex items-center gap-1 ${strategy.enabled ? 'text-bullish' : 'text-text-muted'}`}>
                      <AutoTradeIcon view={view} /> {strategy.enabled ? '켜짐' : '꺼짐'}
                    </span>
                    <span className="text-text-secondary">
                      대상 {strategy.symbols.length}종목 · 시장이 열린 뒤 하루 한 번
                    </span>
                  </div>
                  <div className="text-text-muted">
                    마지막 {time(status.lastRunAt)} · 오늘 판단 {status.judgedToday}/{strategy.symbols.length}종목 ·{' '}
                    {strategy.aiCheck ? 'AI 검증 켬(「사도 됨」 이면 사기 직전 Gemini 1회)' : 'AI 검증 끔 — Gemini 를 쓰지 않습니다'}
                    {status.blockedReason && strategy.enabled && (
                      <span className="text-warning"> · {status.blockedReason}</span>
                    )}
                  </div>
                  {note && (
                    // 긴 사유를 말줄임으로 숨기지 않는다 — 줄바꿈한다 (v2.34.0)
                    <div className="break-keep text-text-muted" title={note.reason}>
                      최근 판단: {note.symbol} {note.action} — {note.reason}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Cell>

        {scheduled && <Cell title="내가 지정한 종목">{scheduled}</Cell>}
      </div>

      <p className="text-caption text-text-muted">
        오늘 Gemini 사용{usage?.usage ? ` (${usage.usage.date}, 한국 시간)` : ''}:{' '}
        {usage?.usage ? (
          <>
            {usage.usage.items.map((item, i) => (
              <span key={item.key} className="whitespace-nowrap">
                {i > 0 && ' · '}
                {item.label} <b className="text-text-secondary">{formatNumber(item.calls, 0)}</b>회
              </span>
            ))}
            {' · '}
            <span className="whitespace-nowrap">
              합계 약 <b className="text-text-secondary">{formatNumber(usage.usage.totalCalls, 0)}</b>회
            </span>
            <InfoTip label="Gemini 사용량 세는 법">
              따로 세는 장치 없이 저장된 기록에서 셉니다. AI 분석·목표 수익 가능성은 한 번에 5회(에이전트 4 + 의장 1), 뉴스 AI 판정·백테스트 AI 설명은 1회, AI 검증은 실제로
              부른 수입니다. 저장되지 않은 실패 호출(한도 초과·오류)은 AI 검증 말고는 세지 않습니다. 백테스트 설명은 남아 있는 기록(최근 20개)에 붙은 것만 셉니다.
            </InfoTip>
            {!usage.enabled && ' · 이 서버에서는 Gemini 가 꺼져 있습니다'}
          </>
        ) : (
          '—'
        )}
      </p>
    </div>
  );
}
