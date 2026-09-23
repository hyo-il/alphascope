import { useState } from 'react';
import type { AccountOverviewItem, StrategyOverviewItem } from '../../hooks/usePaperOverview';
import { formatPrice } from '../../utils/formatters';
import { toast } from '../../store/uiStore';

/**
 * 계좌 **모아보기** — 계좌 관리에 들어가면 먼저 보이는 화면.
 *
 * 마스터-디테일이다: 여기는 "어느 계좌가 어떤가" 를 한눈에 보는 자리이고,
 * 카드를 누르면 지금까지의 상세 화면(잔고·보유·거래·자동매매 설정)으로 들어간다.
 * 계좌가 하나뿐이어도 카드 한 장을 그린다 — 계좌가 늘어날 때 화면이 달라지면
 * "내 계좌가 어디 갔나" 가 된다.
 *
 * ⚠️ 카드의 [켜기] 는 `AutoTradeBar` 와 **같은 가드**를 쓴다. 종목이 없거나 키 없는 AI형이면
 * 켜 봐야 서버가 매 틱 `blockedReason` 만 돌려준다 — 그래서 켜지 말고 상세로 보낸다.
 */
export default function AccountsOverview({
  accounts,
  strategies,
  geminiEnabled,
  error,
  hasAccounts,
  onOpen,
  onToggleAuto,
}: {
  accounts: AccountOverviewItem[] | null;
  strategies: StrategyOverviewItem[] | null;
  geminiEnabled: boolean;
  error: string | null;
  /**
   * 계좌 목록(`/api/paper/accounts`) 조회는 성공했는가.
   * 그쪽은 되는데 모아보기 묶음 라우트만 실패했다면 **서버가 옛 버전**일 가능성이 가장 높다
   * (옛 서버에는 `/accounts/overview` 가 없어 `/:id` 에 걸리고 'accountId 가 필요합니다' 가 난다).
   */
  hasAccounts: boolean;
  onOpen: (accountId: number) => void;
  /** 켜기/끄기 — 실패는 이 컴포넌트가 토스트로 알린다 */
  onToggleAuto: (accountId: number, enabled: boolean) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const strategyOf = (accountId: number) =>
    strategies?.find((s) => s.strategy.accountId === accountId) ?? null;

  const toggle = async (item: AccountOverviewItem, on: boolean) => {
    const found = strategyOf(item.account.id);
    if (on && found) {
      // 켤 수 없는 이유가 있으면 켜지 말고 그 계좌를 열어 준다 (AutoTradeBar 와 같은 판단).
      if (found.strategy.symbols.length === 0) {
        toast.warning('대상 종목이 없습니다', '계좌를 열어 [자동매매 설정] 에서 담아 주세요');
        onOpen(item.account.id);
        return;
      }
      if (found.strategy.mode === 'ai' && !geminiEnabled) {
        toast.warning('Gemini 키가 설정되지 않았습니다', '규칙형으로 바꾸면 키 없이 동작합니다');
        onOpen(item.account.id);
        return;
      }
    }
    setBusyId(item.account.id);
    try {
      await onToggleAuto(item.account.id, on);
      toast.success(on ? '자동매매를 켰습니다' : '자동매매를 껐습니다', item.account.name);
    } catch (e) {
      toast.error('바꾸지 못했습니다', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  /*
    ⚠️ "불러오지 못했다" 와 "계좌가 없다" 를 같은 화면으로 그리지 않는다 —
    API 가 늦게 뜬 것뿐인데 계좌가 지워진 것처럼 보인다 (대시보드와 같은 규칙).
  */
  if (accounts === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-xs leading-relaxed text-text-muted">
          {error ? (
            <>
              계좌 목록을 불러오지 못했습니다.
              <br />
              <span className="text-text-muted">{error}</span>
              <br />
              저장된 계좌·보유 종목·거래 내역은 그대로 있습니다.
              {hasAccounts && (
                <>
                  <br />
                  <span className="text-warning">
                    서버가 옛 버전일 수 있습니다 — 서버를 다시 시작해 보세요.
                  </span>
                </>
              )}
            </>
          ) : (
            '계좌를 불러오는 중…'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {error && (
        <p className="mb-2 rounded border border-warning/40 bg-warning/10 px-3 py-1.5 text-[11px] text-warning">
          최신 값을 받지 못했습니다 ({error}) — 아래는 마지막으로 받은 값입니다.
        </p>
      )}

      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((item) => {
          const found = strategyOf(item.account.id);
          const strategy = found?.strategy;
          const status = found?.status;
          const on = Boolean(strategy?.enabled);
          const blocked = on && Boolean(status?.blockedReason);
          const currency = item.account.currency;
          const pnl = item.totalPnl;

          return (
            <article
              key={item.account.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(item.account.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpen(item.account.id);
              }}
              className="rounded-lg border border-border bg-bg-secondary p-3 text-left transition-colors hover:border-accent/60"
            >
              <header className="flex items-center gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium text-text-primary">
                  {item.account.name}
                </h3>
                <span className="shrink-0 text-[10px] text-text-muted">{currency}</span>
              </header>

              {item.error ? (
                <p className="mt-2 text-[11px] text-bearish">평가 실패: {item.error}</p>
              ) : (
                <>
                  <p className="mt-2 text-lg font-semibold tabular-nums text-text-primary">
                    {formatPrice(item.totalValue ?? 0, currency)}
                  </p>
                  <p
                    className={`text-xs tabular-nums ${
                      (pnl ?? 0) > 0 ? 'text-bullish' : (pnl ?? 0) < 0 ? 'text-bearish' : 'text-text-secondary'
                    }`}
                  >
                    {(pnl ?? 0) > 0 ? '+' : ''}
                    {formatPrice(pnl ?? 0, currency)} ({(item.totalReturn ?? 0) > 0 ? '+' : ''}
                    {(item.totalReturn ?? 0).toFixed(2)}%)
                  </p>
                  <p className="mt-1 text-[11px] text-text-muted">
                    현금 {formatPrice(item.account.currentCash, currency)} · 주식{' '}
                    {formatPrice(item.stockValue ?? 0, currency)}
                    {item.pendingOrders > 0 && ` · 대기 주문 ${item.pendingOrders}건`}
                  </p>
                </>
              )}

              {/* 자동매매는 세 가지 상태다 — 가동 중 / 멈춤(이유 있음) / 꺼짐 */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <span
                  title={status?.blockedReason ?? undefined}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    blocked
                      ? 'bg-warning/15 text-warning'
                      : on
                        ? 'bg-bullish/15 text-bullish'
                        : 'bg-bg-tertiary text-text-muted'
                  }`}
                >
                  {blocked ? `멈춤: ${status?.blockedReason}` : on ? '가동 중' : '꺼짐'}
                </span>

                {strategy && (
                  <span className="text-[10px] text-text-muted">
                    {strategy.mode === 'ai' ? 'AI형' : '규칙형'} · 대상 {strategy.symbols.length}종목 ·
                    비중 {strategy.positionSizePercent}%
                  </span>
                )}

                <button
                  type="button"
                  disabled={busyId === item.account.id || !strategy}
                  onClick={(e) => {
                    // 카드 클릭(상세 열기)과 겹치면 켜려다 화면이 바뀐다.
                    e.stopPropagation();
                    void toggle(item, !on);
                  }}
                  className={`ml-auto rounded px-2 py-0.5 text-[10px] font-medium text-white transition-colors disabled:opacity-50 ${
                    on ? 'bg-bearish hover:bg-bearish/90' : 'bg-accent hover:bg-accent-hover'
                  }`}
                >
                  {busyId === item.account.id ? '…' : on ? '끄기' : '켜기'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
