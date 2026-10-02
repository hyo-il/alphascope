import { useEffect, useState, type ReactNode } from 'react';
import { SIDE_POLL_MS, useAutoTradingOverview } from '../../hooks/usePaperOverview';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { autoTradeView } from '../../utils/autoTradeStatus';

/**
 * 「AI 분석 기록」 맨 위 상태 판 (v2.23.0) — "무엇이, 언제, 왜 분석되는가" 를 한눈에.
 *
 * - 계좌 자동 분석: **기존 자동매매 상태 묶음 라우트**(`/api/auto-trading/overview`)를 그대로 쓴다.
 *   새 라우트·새 폴링을 만들지 않는다 — 오른쪽 계좌 탭과 같은 15초 주기 훅이다.
 * - 내가 지정한 종목: `scheduled` 로 받은 칸을 그대로 둔다(지정 종목 화면이 그린다).
 * - 오늘 Gemini 사용량: `/api/gemini/status` 의 analysesToday (1종목 = 5호출로 환산).
 */

const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

function Cell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-border bg-bg-secondary p-3">
      <h3 className="mb-2 text-xs font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  );
}

export default function AIStatusBoard({ scheduled }: { scheduled?: ReactNode }) {
  const { items, error } = useAutoTradingOverview(true, SIDE_POLL_MS);
  const { accounts } = usePaperAccounts();
  const [usage, setUsage] = useState<{ analyses: number; enabled: boolean } | null>(null);

  // 사용량은 화면을 열 때 한 번 — 폴링할 값이 아니다(분석은 길게는 한 시간에 한 바퀴다)
  useEffect(() => {
    let alive = true;
    void fetch('/api/gemini/status')
      .then((r) => r.json())
      .then((data: { enabled?: boolean; analysesToday?: number }) => {
        if (alive) setUsage({ analyses: data.analysesToday ?? 0, enabled: Boolean(data.enabled) });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const nameOf = (id: number) => accounts.find((a) => a.id === id)?.name ?? `계좌 ${id}`;

  return (
    <div className="space-y-2">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(360px,1fr))]">
        <Cell title="계좌 자동 분석">
          {error && !items && <p className="text-[14px] text-bearish">상태를 불러오지 못했습니다: {error}</p>}
          {items && items.length === 0 && (
            <p className="text-[14px] text-text-muted">자동매매를 설정한 계좌가 없습니다 (「계좌」 메뉴 &gt; 자동매매).</p>
          )}
          {!items && !error && <p className="text-[14px] text-text-muted">불러오는 중…</p>}
          <ul className="space-y-2">
            {(items ?? []).map(({ strategy, status }) => {
              const view = autoTradeView(strategy, status);
              const note = status.lastNotes?.[0];
              return (
                <li key={strategy.accountId} className="text-[14px] leading-relaxed">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-text-primary">{nameOf(strategy.accountId)}</span>
                    <span className="text-text-secondary">{strategy.mode === 'ai' ? 'AI형' : '규칙형'}</span>
                    <span className={strategy.enabled ? 'text-bullish' : 'text-text-muted'}>
                      {view.symbol} {strategy.enabled ? '켜짐' : '꺼짐'}
                    </span>
                    <span className="text-text-secondary">
                      대상 {strategy.symbols.length}종목 · {strategy.intervalMinutes}분마다
                      {strategy.marketHoursOnly ? ' · 정규장만' : ''}
                    </span>
                  </div>
                  <div className="text-text-muted">
                    마지막 {time(status.lastRunAt)} · 다음 {strategy.enabled ? time(status.nextRunAt) : '—'}
                    {strategy.mode === 'rule' && <span> · Gemini 를 쓰지 않습니다</span>}
                    {status.blockedReason && strategy.enabled && (
                      <span className="text-warning"> · {status.blockedReason}</span>
                    )}
                  </div>
                  {note && (
                    <div className="truncate text-text-muted" title={note.reason}>
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

      <p className="text-[14px] text-text-muted">
        오늘 Gemini 사용:{' '}
        {usage ? (
          <>
            분석 <b className="text-text-secondary">{usage.analyses}</b>건 ≈ 약{' '}
            <b className="text-text-secondary">{usage.analyses * 5}</b>호출 (1종목 = 에이전트 4 + 의장 1)
            {!usage.enabled && ' · 이 서버에서는 Gemini 가 꺼져 있습니다'}
          </>
        ) : (
          '—'
        )}
      </p>
    </div>
  );
}
