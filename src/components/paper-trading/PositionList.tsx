import type { PaperPositionValued } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';

interface Props {
  positions: PaperPositionValued[];
  onSelectSymbol: (symbol: string) => void;
  onSell: (symbol: string) => void;
}

const tone = (value: number | null | undefined) =>
  value == null ? 'text-text-muted' : value > 0 ? 'text-bullish' : value < 0 ? 'text-bearish' : 'text-text-secondary';

/** 보유 종목 — 현재가는 1초 폴링으로 갱신된다. */
export default function PositionList({ positions, onSelectSymbol, onSell }: Props) {
  if (!positions.length) {
    return (
      <p className="px-4 py-8 text-center text-xs text-text-muted">
        보유 중인 종목이 없습니다. 왼쪽에서 매수 주문을 넣어 보세요.
      </p>
    );
  }

  const totalCost = positions.reduce((sum, p) => sum + p.totalCost, 0);
  const totalValue = positions.reduce((sum, p) => sum + (p.marketValue ?? p.totalCost), 0);
  const totalPnl = totalValue - totalCost;
  // 종목 통화가 섞이면 합계가 의미 없어진다 — 한 통화일 때만 합계를 보여 준다.
  const currencies = new Set(positions.map((p) => p.currency));
  const single = currencies.size === 1 ? [...currencies][0] : null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-text-muted">
          <tr className="border-b border-border">
            <th className="px-3 py-2 text-left font-normal">종목</th>
            <th className="px-3 py-2 text-right font-normal">수량</th>
            <th className="px-3 py-2 text-right font-normal">평균매입가</th>
            <th className="px-3 py-2 text-right font-normal">현재가</th>
            <th className="px-3 py-2 text-right font-normal">평가금액</th>
            <th className="px-3 py-2 text-right font-normal">평가손익</th>
            <th className="px-3 py-2 text-right font-normal">수익률</th>
            <th className="px-3 py-2 text-right font-normal"> </th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol} className="border-b border-border/60 hover:bg-bg-tertiary/40">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => onSelectSymbol(p.symbol)}
                  className="font-medium text-text-primary hover:underline"
                >
                  {p.name || p.symbol}
                </button>
                {p.name && <span className="ml-1.5 text-[11px] text-accent">{p.symbol}</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{p.quantity}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                {formatPrice(p.avgPrice, p.currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                {formatPrice(p.currentPrice, p.currency)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                {formatPrice(p.marketValue, p.currency)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(p.unrealizedPnl)}`}>
                {p.unrealizedPnl != null && p.unrealizedPnl > 0 ? '+' : ''}
                {formatPrice(p.unrealizedPnl, p.currency)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(p.unrealizedPnlPercent)}`}>
                {p.unrealizedPnlPercent != null
                  ? `${p.unrealizedPnlPercent > 0 ? '+' : ''}${p.unrealizedPnlPercent.toFixed(2)}%`
                  : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onSell(p.symbol)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-bullish"
                >
                  매도
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        {single && (
          <tfoot>
            <tr className="text-text-secondary">
              <td className="px-3 py-2" colSpan={4}>
                합계
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPrice(totalValue, single)}
                <span className="ml-1 text-text-muted">/ 매입 {formatPrice(totalCost, single)}</span>
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(totalPnl)}`}>
                {totalPnl > 0 ? '+' : ''}
                {formatPrice(totalPnl, single)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(totalPnl)}`}>
                {totalCost ? `${totalPnl > 0 ? '+' : ''}${((totalPnl / totalCost) * 100).toFixed(2)}%` : '—'}
              </td>
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
