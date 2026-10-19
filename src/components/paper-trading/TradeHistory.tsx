import { formatDateTime } from '../../utils/dateFormat';
import Button from '../ui/Button';
import { useState } from 'react';
import { toast } from '../../store/uiStore';
import type { Currency, PaperCashFlow, PaperOrder, PaperTrade } from '../../types/paper';
import { cancelPaperOrder } from '../../hooks/usePaperTrading';
import { formatPrice, formatSignedMoney } from '../../utils/formatters';
import StockName from '../common/StockName';
import { TABLE_NAME_COL, TABLE_NUM_COL } from '../ui/tokens';

interface Props {
  trades: PaperTrade[];
  /** 입금 · 출금 기록 — 「전체」 에서 체결과 시간 순서로 섞어 보인다(종목 칸은 비우고 구분 칸에 「입금」 · 「출금」) */
  cashFlows: PaperCashFlow[];
  /** 계좌 통화 — 입출금 금액 표시 */
  currency: Currency;
  orders: PaperOrder[];
  onChanged: () => void;
}

type Filter = 'all' | 'buy' | 'sell' | 'win' | 'loss';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'buy', label: '매수' },
  { id: 'sell', label: '매도' },
  { id: 'win', label: '수익' },
  { id: 'loss', label: '손실' },
];

/**
 * 자동매매가 낸 주문인지 — 사유 문자열로 가른다.
 *
 * 주문에 출처 컬럼을 새로 두지 않았다. 사유는 이미 사람이 읽으라고 쓰는 문장이고,
 * 자동매매 쪽 문구는 엔진이 정해진 형태로 만든다 (`autoTrading/engine.ts`).
 * 손으로 낸 주문의 사유는 "차트 빠른주문 …" 이라 겹치지 않는다.
 */
// 사유 문장은 용어집 이름을 쓴다 — 옛 문장(하드 손절·트레일링 스톱)과 새 문장(손절 — 기준·트레일링 — 최고가·익절) 모두 잡는다
const AUTO_MARKERS = ['AI 매수', 'AI 매도', '골든크로스', '데드크로스', 'RSI', '하드 손절', '트레일링 스톱', 'Gemini', '손절 ', '익절 ', '트레일링 — '];
const isAuto = (reason: string | null): boolean =>
  Boolean(reason) && AUTO_MARKERS.some((m) => reason!.includes(m));

type Row = { kind: 'trade'; at: string; trade: PaperTrade } | { kind: 'flow'; at: string; flow: PaperCashFlow };

/** 체결 내역 + 입출금 + 대기 중인 지정가 주문 */
export default function TradeHistory({ trades, cashFlows, currency, orders, onChanged }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const pending = orders.filter((o) => o.status === 'PENDING');

  const filteredTrades = trades.filter((t) => {
    if (filter === 'buy') return t.side === 'BUY';
    if (filter === 'sell') return t.side === 'SELL';
    if (filter === 'win') return t.pnl != null && t.pnl > 0;
    if (filter === 'loss') return t.pnl != null && t.pnl <= 0;
    return true;
  });
  // 입출금은 「전체」 에만 — 매수 · 매도 · 수익 · 손실 거르기와 상관없는 줄이다. 최신이 위
  const filtered: Row[] = [
    ...filteredTrades.map((trade): Row => ({ kind: 'trade', at: trade.tradedAt, trade })),
    ...(filter === 'all' ? cashFlows.map((flow): Row => ({ kind: 'flow', at: flow.createdAt, flow })) : []),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  /** 대기 주문 취소 — 취소하는 동안 그 줄 버튼에 회전 아이콘, 실패하면 알린다 */
  const [cancelling, setCancelling] = useState<number | null>(null);
  const cancel = async (id: number) => {
    setCancelling(id);
    try {
      await cancelPaperOrder(id);
      onChanged();
    } catch (e) {
      toast.error('취소하지 못했습니다', (e as Error).message);
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="space-y-3 p-3">
      {pending.length > 0 && (
        <section className="rounded-lg bg-warning/10 p-2.5">
          <h4 className="mb-1.5 text-caption font-medium text-warning">
            대기 중인 지정가 주문 {pending.length}건
          </h4>
          <ul className="space-y-1">
            {pending.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-caption text-text-secondary">
                <span className={o.side === 'BUY' ? 'text-bearish' : 'text-bullish'}>
                  {o.side === 'BUY' ? '매수' : '매도'}
                </span>
                <StockName symbol={o.symbol} name={o.name} className="text-text-primary" />
                <span className="tabular-nums">{o.quantity}주</span>
                <span className="tabular-nums">@ {formatPrice(o.requestedPrice, o.currency)}</span>
                {o.reason && <span className="text-text-muted">· {o.reason}</span>}
                <Button variant="secondary" size="sm"
                  busy={cancelling === o.id}
                  onClick={() => void cancel(o.id)}
                  className="ml-auto">
                  {cancelling === o.id ? '취소 중…' : '취소'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded px-2 py-1 text-caption transition-colors ${
              filter === f.id
                ? 'bg-bg-elevated font-medium text-text-primary'
                : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-caption text-text-muted">{filtered.length}건</span>
      </div>

      {!filtered.length ? (
        <p className="py-8 text-center text-xs text-text-muted">거래 내역이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-text-muted">
              {/* 숫자 · 짧은 칸은 내용 폭(TABLE_NUM_COL), 남는 폭은 사유 칸 — 넓은 창에서 숫자 칸이 벌어지지 않게 */}
              <tr className="border-b border-border/50">
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-left font-normal`}>시각</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-left font-normal`}>종목</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-left font-normal`}>구분</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-right font-normal`}>수량</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-right font-normal`}>체결가</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-right font-normal`}>수수료</th>
                <th className={`${TABLE_NUM_COL} px-3 py-2 text-right font-normal`}>실현손익</th>
                <th className={`${TABLE_NAME_COL} px-3 py-2 text-left font-normal`}>사유</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                if (row.kind === 'flow') {
                  const f = row.flow;
                  return (
                    <tr key={`f-${f.id}`} className="border-b border-border/60 hover:bg-bg-tertiary/40">
                      <td className="px-3 py-2 whitespace-nowrap text-text-muted">{formatDateTime(f.createdAt)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2">
                        {/* 매수(빨강) · 매도(초록)와 다른 중립 바탕 — 돈을 넣고 뺀 것이지 거래가 아니다 */}
                        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-caption text-text-primary">
                          {f.type === 'deposit' ? '입금' : '출금'}
                        </span>
                      </td>
                      {/* 금액은 「체결가」 칸 — 세 칸을 합쳐 오른쪽 끝에 두면 「수수료」 머리 아래라 수수료로 읽혔다 */}
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 text-right tabular-nums text-text-primary">{formatPrice(f.amount, currency)}</td>
                      <td className="px-3 py-2 text-right text-text-muted">—</td>
                      <td className="px-3 py-2 text-right text-text-muted">—</td>
                      <td className="px-3 py-2 text-text-muted">원금도 함께 {f.type === 'deposit' ? '늘림' : '줄임'}</td>
                    </tr>
                  );
                }
                const t = row.trade;
                return (
                  <tr key={`t-${t.id}`} className="border-b border-border/60 hover:bg-bg-tertiary/40">
                    <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                      {formatDateTime(t.tradedAt)}
                    </td>
                    <td className="px-3 py-2 text-text-primary">
                      <StockName symbol={t.symbol} name={t.name} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-caption ${
                          t.side === 'BUY' ? 'bg-bearish/15 text-bearish' : 'bg-bullish/15 text-bullish'
                        }`}
                      >
                        {t.side === 'BUY' ? '매수' : '매도'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                      {formatPrice(t.price, t.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                      {formatPrice(t.commission, t.currency)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        t.pnl == null ? 'text-text-muted' : t.pnl > 0 ? 'text-bullish' : 'text-bearish'
                      }`}
                    >
                      {t.pnl == null
                        ? '—'
                        : `${formatSignedMoney(t.pnl, t.currency)} (${t.pnlPercent?.toFixed(2)}%)`}
                    </td>
                    {/*
                      사유는 길다 ("하드 손절 -10.13% — 기준 -7% 도달로 전량 청산").
                      폭을 묶고 말줄임한 뒤 전문은 title 로 — 안 묶으면 이 열 하나가 표를 늘린다.
                    */}
                    <td className="px-3 py-2 text-text-muted">
                      <span className="flex items-center gap-1.5">
                        {isAuto(t.reason) && (
                          <span className="shrink-0 rounded bg-bg-tertiary px-1 py-0.5 text-caption text-text-secondary">
                            자동
                          </span>
                        )}
                        <span className="block max-w-[22rem] truncate" title={t.reason ?? undefined}>
                          {t.reason ?? '—'}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
