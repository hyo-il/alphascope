import { useState } from 'react';
import type { PaperOrder, PaperTrade } from '../../types/paper';
import { cancelPaperOrder } from '../../hooks/usePaperTrading';
import { formatPrice } from '../../utils/formatters';
import StockName from '../common/StockName';

interface Props {
  trades: PaperTrade[];
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
const AUTO_MARKERS = ['AI 매수', 'AI 매도', '골든크로스', '데드크로스', 'RSI', '하드 손절', '트레일링 스톱', 'Gemini'];
const isAuto = (reason: string | null): boolean =>
  Boolean(reason) && AUTO_MARKERS.some((m) => reason!.includes(m));

/** 체결 내역 + 대기 중인 지정가 주문 */
export default function TradeHistory({ trades, orders, onChanged }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const pending = orders.filter((o) => o.status === 'PENDING');

  const filtered = trades.filter((t) => {
    if (filter === 'buy') return t.side === 'BUY';
    if (filter === 'sell') return t.side === 'SELL';
    if (filter === 'win') return t.pnl != null && t.pnl > 0;
    if (filter === 'loss') return t.pnl != null && t.pnl <= 0;
    return true;
  });

  const cancel = async (id: number) => {
    await cancelPaperOrder(id);
    onChanged();
  };

  return (
    <div className="space-y-3 p-3">
      {pending.length > 0 && (
        <section className="rounded-md border border-warning/30 bg-warning/5 p-2.5">
          <h4 className="mb-1.5 text-[11px] font-medium text-warning">
            대기 중인 지정가 주문 {pending.length}건
          </h4>
          <ul className="space-y-1">
            {pending.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-[11px] text-text-secondary">
                <span className={o.side === 'BUY' ? 'text-bearish' : 'text-bullish'}>
                  {o.side === 'BUY' ? '매수' : '매도'}
                </span>
                <StockName symbol={o.symbol} name={o.name} className="text-text-primary" />
                <span className="tabular-nums">{o.quantity}주</span>
                <span className="tabular-nums">@ {formatPrice(o.requestedPrice, o.currency)}</span>
                {o.reason && <span className="text-text-muted">· {o.reason}</span>}
                <button
                  type="button"
                  onClick={() => void cancel(o.id)}
                  className="ml-auto rounded border border-border px-2 py-0.5 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
                >
                  취소
                </button>
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
            className={`rounded px-2 py-1 text-[11px] transition-colors ${
              filter === f.id
                ? 'bg-accent/15 font-medium text-accent'
                : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-[11px] text-text-muted">{filtered.length}건</span>
      </div>

      {!filtered.length ? (
        <p className="py-8 text-center text-xs text-text-muted">거래 내역이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal">시각</th>
                <th className="px-3 py-2 text-left font-normal">종목</th>
                <th className="px-3 py-2 text-left font-normal">구분</th>
                <th className="px-3 py-2 text-right font-normal">수량</th>
                <th className="px-3 py-2 text-right font-normal">체결가</th>
                <th className="px-3 py-2 text-right font-normal">수수료</th>
                <th className="px-3 py-2 text-right font-normal">실현손익</th>
                <th className="px-3 py-2 text-left font-normal">사유</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id} className="border-b border-border/60 hover:bg-bg-tertiary/40">
                  <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                    {new Date(t.tradedAt).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-3 py-2 text-text-primary">
                    <StockName symbol={t.symbol} name={t.name} />
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
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
                      : `${t.pnl > 0 ? '+' : ''}${formatPrice(t.pnl, t.currency)} (${t.pnlPercent?.toFixed(2)}%)`}
                  </td>
                  {/*
                    사유는 길다 ("하드 손절 -10.13% — 기준 -7% 도달로 전량 청산").
                    폭을 묶고 말줄임한 뒤 전문은 title 로 — 안 묶으면 이 열 하나가 표를 늘린다.
                  */}
                  <td className="px-3 py-2 text-text-muted">
                    <span className="flex items-center gap-1.5">
                      {isAuto(t.reason) && (
                        <span className="shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[10px] text-accent">
                          자동
                        </span>
                      )}
                      <span className="block max-w-[22rem] truncate" title={t.reason ?? undefined}>
                        {t.reason ?? '—'}
                      </span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
