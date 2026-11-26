import { TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP, TOUCH_TABLE_ROW } from '../ui/tokens';
import SymbolChartLink from '../common/SymbolChartLink';
import type { PaperPositionValued } from '../../types/paper';
import { formatPrice, formatSignedMoney, formatSigned } from '../../utils/formatters';
import ScrollTable from '../ui/ScrollTable';
import DataCard, { DataCardList, DataCardRow } from '../ui/DataCard';
import StockName from '../common/StockName';
import { useLayoutMode } from '../../hooks/useLayoutMode';

interface Props {
  positions: PaperPositionValued[];
  onSelectSymbol: (symbol: string) => void;
}

const tone = (value: number | null | undefined) =>
  value == null ? 'text-text-muted' : value > 0 ? 'text-bullish' : value < 0 ? 'text-bearish' : 'text-text-secondary';
/** 카드 위(bg-secondary)에는 `text-muted` 를 쓰지 않는다(테마 1-1) — 값이 없을 때만 secondary 로 */
const cardTone = (value: number | null | undefined) => (value == null ? 'text-text-secondary' : tone(value));
/** 수익률 글 — 표 칸과 카드가 같은 글(값이 없으면 「—」) */
const pctText = (value: number | null | undefined) => (value != null ? `${formatSigned(value, 2)}%` : '—');

/**
 * 보유 종목 — 현재가는 1초 폴링으로 갱신된다.
 *
 * ⚠️ **조회 전용이다.** 매도 버튼을 두지 않는다 — 계좌 화면에서 주문 패널을 걷어내
 * 매매를 차트 옆 빠른주문으로 모았기 때문이다. 동작하지 않는 버튼을 남겨 두면
 * 눌러 보고 나서야 알게 된다. 종목을 누르면 그 종목 차트로 간다.
 */
export default function PositionList({ positions, onSelectSymbol }: Props) {
  const phone = useLayoutMode() === 'phone';
  if (!positions.length) {
    return (
      <p className="px-4 py-8 text-center text-xs text-text-muted">
        보유 중인 종목이 없습니다.
      </p>
    );
  }

  const totalCost = positions.reduce((sum, p) => sum + p.totalCost, 0);
  const totalValue = positions.reduce((sum, p) => sum + (p.marketValue ?? p.totalCost), 0);
  const totalPnl = totalValue - totalCost;
  // 종목 통화가 섞이면 합계가 의미 없어진다 — 한 통화일 때만 합계를 보여 준다.
  const currencies = new Set(positions.map((p) => p.currency));
  const single = currencies.size === 1 ? [...currencies][0] : null;
  const totalPct = totalCost ? formatSigned((totalPnl / totalCost) * 100, 2, '%') : '—';

  /*
   * 폰(테마 4-1) — 표 대신 카드. 값 · 글은 아래 표와 **같은 함수 · 같은 식**(카드와 표가 늘 같은 값).
   * 카드를 누르면 표의 종목 칸을 누른 것과 같은 일(그 종목 차트 — `onSelectSymbol`). 패드 · 1280 이상은 표 그대로.
   */
  if (phone) {
    return (
      <div className="pt-2" data-testid="position-cards">
        <DataCardList>
          {positions.map((p) => (
            <DataCard key={p.symbol} label={`${p.name || p.symbol} 차트로 이동`} onOpen={() => onSelectSymbol(p.symbol)}>
              <DataCardRow
                left={<StockName symbol={p.symbol} name={p.name} keepTicker className="max-w-full text-sm font-semibold text-text-primary" />}
                right={<span className="text-sm font-semibold text-text-primary">{formatPrice(p.marketValue, p.currency)}</span>}
              />
              <DataCardRow
                left={
                  <span className="text-caption text-text-secondary">
                    {p.quantity}주 · 평균 {formatPrice(p.avgPrice, p.currency)}
                  </span>
                }
                right={
                  <span className="text-xs">
                    <span className={cardTone(p.unrealizedPnl)}>{formatSignedMoney(p.unrealizedPnl, p.currency)}</span>{' '}
                    <span className={cardTone(p.unrealizedPnlPercent)}>({pctText(p.unrealizedPnlPercent)})</span>
                  </span>
                }
              />
              <DataCardRow left={<span className="text-caption text-text-secondary">현재가 {formatPrice(p.currentPrice, p.currency)}</span>} />
            </DataCard>
          ))}
        </DataCardList>
        {/* 합계 — 한 통화일 때만(표와 같음) · 목록 아래 한 줄 */}
        {single && (
          <div className="flex items-start justify-between gap-3 px-4 py-3 tabular-nums" data-testid="position-cards-total">
            <div className="min-w-0">
              <p className="text-xs font-medium text-text-primary">합계</p>
              <p className="text-caption text-text-secondary">매수 {formatPrice(totalCost, single)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold text-text-primary">{formatPrice(totalValue, single)}</p>
              <p className={`text-xs ${tone(totalPnl)}`}>
                {formatSignedMoney(totalPnl, single)} ({totalPct})
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <ScrollTable deskScroll>
      <table className="w-full whitespace-nowrap text-xs">
        <thead className="text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} px-3 py-2 text-left font-normal`}>종목</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>수량</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>평균 매수가</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>현재가</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>평가금액</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>평가손익</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3 text-right font-normal`}>수익률</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.symbol} className={`border-b border-border/60 hover:bg-bg-tertiary/40 ${TOUCH_TABLE_ROW}`}>
              <td className="px-3 py-2">
                <SymbolChartLink symbol={p.symbol} name={p.name} onOpen={onSelectSymbol} />
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
                {formatSignedMoney(p.unrealizedPnl, p.currency)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(p.unrealizedPnlPercent)}`}>
                {pctText(p.unrealizedPnlPercent)}
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
                <span className="block text-caption text-text-muted">매수 {formatPrice(totalCost, single)}</span>
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(totalPnl)}`}>
                {formatSignedMoney(totalPnl, single)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${tone(totalPnl)}`}>
                {totalPct}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollTable>
  );
}
