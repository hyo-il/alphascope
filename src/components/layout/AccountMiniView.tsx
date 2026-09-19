import type { PaperAccount, PaperAccountDetail } from '../../types/paper';
import StockName from '../common/StockName';
import { useStockNames } from '../../hooks/useStockNames';
import { formatPrice } from '../../utils/formatters';

/**
 * 관심 목록 패널의 **계좌 탭** — 모의투자 계좌 요약.
 *
 * 차트를 보면서 "지금 현금이 얼마고 이 종목을 들고 있나" 를 탭 한 번으로 확인하는 자리다.
 * 매매는 하지 않는다 — 주문은 차트 옆 빠른주문, 계좌 관리는 계좌 화면이다.
 *
 * ⚠️ 폭이 250px 이라 카드가 아니라 **리스트**로 짠다. 열을 늘리는 대신 한 행을
 * 2줄(이름/수량 · 현재가/수익률)로 쌓는다 — 관심 목록 행과 같은 규칙이다.
 */
export default function AccountMiniView({
  accounts,
  selectedId,
  onSelectAccount,
  detail,
  loading,
  error,
  currentSymbol,
  onSelectSymbol,
  onGoToAccounts,
}: {
  accounts: PaperAccount[];
  selectedId: number | null;
  onSelectAccount: (id: number) => void;
  detail: PaperAccountDetail | null;
  loading: boolean;
  error: string | null;
  /** 지금 차트에서 보고 있는 종목 — 보유 목록에서 강조한다 */
  currentSymbol: string;
  onSelectSymbol: (symbol: string) => void;
  /** 계좌 관리 화면으로 이동 */
  onGoToAccounts: () => void;
}) {
  const positions = detail?.positions ?? [];
  // 티커만 있으면 어떤 종목인지 떠오르지 않는다 — 이름을 함께 적는다.
  useStockNames(positions.map((p) => p.symbol));

  if (loading && !detail) {
    return <p className="px-3 py-6 text-center text-xs text-text-muted">불러오는 중…</p>;
  }

  if (!accounts.length) {
    return (
      <div className="space-y-2.5 px-3 py-6 text-center">
        <p className="text-xs text-text-muted">모의투자 계좌가 없습니다.</p>
        <button
          type="button"
          onClick={onGoToAccounts}
          className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          계좌 관리로 이동
        </button>
      </div>
    );
  }

  const account = detail?.account;
  const currency = account?.currency ?? 'USD';
  /** 손익 색 — 0 은 중립으로 둔다 (빨강도 초록도 아니다) */
  const pnlTone = (value: number | null | undefined) =>
    value == null ? 'text-text-muted' : value > 0 ? 'text-bullish' : value < 0 ? 'text-bearish' : 'text-text-secondary';

  const signed = (value: number, currencyCode: typeof currency) =>
    `${value > 0 ? '+' : ''}${formatPrice(value, currencyCode)}`;

  return (
    <div className="flex flex-col">
      {/*
        계좌가 여럿이면 고르게 하고, 하나뿐이면 이름만 적는다.
        어느 쪽이든 **계좌명은 항상 보인다** — 어느 계좌를 보고 있는지 모르면 잔고도 의미가 없다.
      */}
      {accounts.length > 1 ? (
        <div className="border-b border-border px-3 py-2">
          <select
            value={selectedId ?? ''}
            onChange={(e) => onSelectAccount(Number(e.target.value))}
            aria-label="모의투자 계좌 선택"
            className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="truncate border-b border-border px-3 py-2 text-xs font-medium text-text-primary">
          {accounts[0]?.name}
        </p>
      )}

      {error && !detail && (
        <p className="px-3 py-3 text-[11px] text-bearish">계좌를 불러오지 못했습니다. {error}</p>
      )}

      {detail && account && (
        <>
          {/* 요약 — 총평가·총손익을 위에, 현금·주식을 아래에 둔다 */}
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2">
            <Cell label="총 평가" value={formatPrice(detail.totalValue, currency)} />
            <Cell
              label="총 손익"
              value={signed(detail.totalPnl, currency)}
              sub={`${detail.totalReturn > 0 ? '+' : ''}${detail.totalReturn.toFixed(2)}%`}
              tone={pnlTone(detail.totalPnl)}
            />
            <Cell label="현금" value={formatPrice(account.currentCash, currency)} muted />
            <Cell label="주식" value={formatPrice(detail.stockValue, currency)} muted />
          </div>

          {/* 미체결이 있으면 알린다 — 빠른주문으로 건 지정가가 어디 갔는지 보여야 한다 */}
          {detail.pendingOrders > 0 && (
            <p className="px-3 pb-2 text-[10px] text-warning">
              미체결 주문 {detail.pendingOrders}건
            </p>
          )}

          <div className="border-t border-border">
            <p className="px-3 py-1.5 text-[10px] font-medium text-text-muted">
              보유종목 ({positions.length})
            </p>

            {positions.length === 0 ? (
              <p className="px-3 pb-3 text-[11px] text-text-muted">보유 종목이 없습니다.</p>
            ) : (
              positions.map((p) => {
                const held = p.symbol === currentSymbol;
                return (
                  <button
                    key={p.symbol}
                    type="button"
                    onClick={() => onSelectSymbol(p.symbol)}
                    title={`${p.name ?? p.symbol} 차트로 이동`}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition-colors hover:bg-bg-tertiary/60 ${
                      held ? 'bg-accent/10' : ''
                    }`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <StockName
                        symbol={p.symbol}
                        name={p.name}
                        size="sm"
                        className={`truncate text-xs font-medium ${
                          held ? 'text-accent' : 'text-text-primary'
                        }`}
                        tickerClassName="text-text-muted"
                      />
                      <span className="text-[10px] text-text-muted">{p.quantity}주</span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-xs tabular-nums text-text-secondary">
                        {formatPrice(p.currentPrice, p.currency)}
                      </span>
                      <span
                        className={`block text-[10px] tabular-nums ${pnlTone(p.unrealizedPnlPercent)}`}
                      >
                        {p.unrealizedPnlPercent == null
                          ? '—'
                          : `${p.unrealizedPnlPercent > 0 ? '+' : ''}${p.unrealizedPnlPercent.toFixed(2)}%`}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 요약 칸 하나 — 라벨 위, 값 아래 (250px 에서 가로로 늘어놓을 자리가 없다) */
function Cell({
  label,
  value,
  sub,
  tone,
  muted = false,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  muted?: boolean;
}) {
  const valueTone = tone ?? (muted ? 'text-text-secondary' : 'text-text-primary');
  return (
    <div className="rounded border border-border/60 bg-bg-tertiary/40 px-2 py-1.5">
      <p className="text-[10px] text-text-muted">{label}</p>
      <p className={`text-xs font-semibold tabular-nums ${valueTone}`}>{value}</p>
      {sub && <p className={`text-[10px] tabular-nums ${valueTone}`}>{sub}</p>}
    </div>
  );
}
