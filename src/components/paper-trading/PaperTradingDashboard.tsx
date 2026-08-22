import { useState } from 'react';
import {
  usePaperAccountDetail,
  usePaperAccounts,
  usePaperOrders,
  usePaperPerformance,
  usePaperTrades,
} from '../../hooks/usePaperTrading';
import AccountManager from './AccountManager';
import OrderPanel from './OrderPanel';
import PerformanceChart from './PerformanceChart';
import PerformanceStats from './PerformanceStats';
import PositionList from './PositionList';
import TradeHistory from './TradeHistory';
import { formatPrice } from '../../utils/formatters';

interface Props {
  symbol: string;
  onSelectSymbol: (symbol: string) => void;
}

type Tab = 'positions' | 'trades' | 'performance';

const TABS: { id: Tab; label: string }[] = [
  { id: 'positions', label: '보유종목' },
  { id: 'trades', label: '거래내역' },
  { id: 'performance', label: '성과분석' },
];

/**
 * 모의투자 대시보드.
 *
 * ⚠️ 실제 주문은 어디에서도 나가지 않는다. 시세만 토스 실 API 를 읽고,
 * 주문·체결·잔고·손익은 전부 앱 내부 SQLite 에서만 움직인다.
 */
export default function PaperTradingDashboard({ symbol, onSelectSymbol }: Props) {
  const { accounts, selectedId, select, loading, create, remove, reset } = usePaperAccounts();
  const { detail, error, refresh } = usePaperAccountDetail(selectedId);
  const [tab, setTab] = useState<Tab>('positions');
  /** 주문·취소 후 목록을 다시 읽기 위한 카운터 */
  const [version, setVersion] = useState(0);
  const [orderSymbol, setOrderSymbol] = useState(symbol);

  const trades = usePaperTrades(selectedId, version);
  const orders = usePaperOrders(selectedId, version);
  const perf = usePaperPerformance(selectedId, version);

  const bump = () => {
    setVersion((n) => n + 1);
    refresh();
  };

  const currency = detail?.account.currency ?? 'KRW';

  const banner = (
    <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-xs text-warning">
      <span className="text-sm">⚠️</span>
      <span>
        <b>모의투자 — 실제 거래가 아닙니다.</b> 시세는 실시간이지만 주문·체결·잔고는 앱 안의
        가상 자금으로만 처리되며, 증권사에 주문이 전송되지 않습니다.
      </span>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        {banner}
        <p className="p-8 text-center text-xs text-text-muted">불러오는 중…</p>
      </div>
    );
  }

  if (!accounts.length) {
    return (
      <div className="flex h-full flex-col">
        {banner}
        <AccountManager
          accounts={accounts}
          selectedId={selectedId}
          onSelect={select}
          onCreate={create}
          onReset={reset}
          onDelete={remove}
        />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-center text-xs leading-relaxed text-text-muted">
            아직 모의투자 계좌가 없습니다.
            <br />
            위의 <b className="text-text-secondary">+ 새 계좌</b> 로 초기 자금을 정해 시작하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {banner}

      <AccountManager
        accounts={accounts}
        selectedId={selectedId}
        onSelect={select}
        onCreate={create}
        onReset={reset}
        onDelete={remove}
      />

      {error && (
        <div className="border-b border-bearish/30 bg-bearish/10 px-4 py-1.5 text-[11px] text-bearish">
          ❌ {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden p-3">
        {/* 왼쪽 — 주문 */}
        <div className="w-[280px] shrink-0 overflow-y-auto">
          {detail && (
            <OrderPanel
              account={detail.account}
              symbol={orderSymbol}
              onSymbolChange={setOrderSymbol}
              positions={detail.positions}
              onOrdered={bump}
            />
          )}
        </div>

        {/* 오른쪽 — 요약 + 탭 */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          {detail && (
            <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4">
              {[
                { label: '총 평가금액', value: formatPrice(detail.totalValue, currency), tone: 'text-text-primary' },
                {
                  label: '총 손익',
                  value: `${detail.totalPnl > 0 ? '+' : ''}${formatPrice(detail.totalPnl, currency)}`,
                  tone: detail.totalPnl > 0 ? 'text-bullish' : detail.totalPnl < 0 ? 'text-bearish' : 'text-text-primary',
                  hint: `${detail.totalReturn > 0 ? '+' : ''}${detail.totalReturn.toFixed(2)}%`,
                },
                { label: '현금', value: formatPrice(detail.account.currentCash, currency), tone: 'text-text-secondary' },
                {
                  label: '주식 평가액',
                  value: formatPrice(detail.stockValue, currency),
                  tone: 'text-text-secondary',
                  hint: detail.pendingOrders ? `대기 주문 ${detail.pendingOrders}건` : undefined,
                },
              ].map((c) => (
                <div key={c.label} className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
                  <p className="text-[11px] text-text-muted">{c.label}</p>
                  <p className={`text-base font-semibold tabular-nums ${c.tone}`}>{c.value}</p>
                  {c.hint && <p className="text-[10px] text-text-muted">{c.hint}</p>}
                </div>
              ))}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary">
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`rounded px-2.5 py-1 text-xs transition-colors ${
                    tab === t.id
                      ? 'bg-accent/15 font-medium text-accent'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {tab === 'positions' && detail && (
                <PositionList
                  positions={detail.positions}
                  onSelectSymbol={onSelectSymbol}
                  onSell={setOrderSymbol}
                />
              )}
              {tab === 'trades' && (
                <TradeHistory trades={trades} orders={orders} onChanged={bump} />
              )}
              {tab === 'performance' && (
                <div className="flex h-full min-h-0 flex-col gap-3 p-3">
                  {perf ? (
                    <>
                      <PerformanceStats performance={perf.performance} currency={currency} />
                      <div className="min-h-[220px] flex-1">
                        <PerformanceChart snapshots={perf.snapshots} />
                      </div>
                    </>
                  ) : (
                    <p className="py-8 text-center text-xs text-text-muted">성과를 계산하는 중…</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
