import { useState } from 'react';
import { Skeleton, SkeletonCards, SkeletonTable } from '../common/SkeletonLoader';
import {
  usePaperAccountDetail,
  usePaperAccounts,
  usePaperOrders,
  usePaperPerformance,
  usePaperTrades,
} from '../../hooks/usePaperTrading';
import AccountManager from './AccountManager';
import AccountsOverview from './AccountsOverview';
import CreateAccountForm from './CreateAccountForm';
import { usePaperAccountsOverview, useAutoTradingOverview } from '../../hooks/usePaperOverview';
import { useGeminiStatus } from '../../hooks/useGemini';
import AutoTradeBar from './AutoTradeBar';
import PerformanceChart from './PerformanceChart';
import PerformanceStats from './PerformanceStats';
import PositionList from './PositionList';
import TradeHistory from './TradeHistory';
import { toast } from '../../store/uiStore';
import { formatPrice } from '../../utils/formatters';
import { autoTradeView } from '../../utils/autoTradeStatus';

interface Props {
  onSelectSymbol: (symbol: string) => void;
}

type Tab = 'positions' | 'trades' | 'performance';
/**
 * 계좌 관리는 **모아보기 → 상세** 두 화면이다 (2026-09-22).
 * 들어오면 전 계좌를 카드로 먼저 보여 준다 — 계좌가 여럿이면 "어느 계좌가 어떤가" 가 먼저 궁금하고,
 * 하나뿐이어도 카드 한 장이라 화면 구조가 달라지지 않는다.
 */
type View = 'overview' | 'detail';

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
export default function PaperTradingDashboard({ onSelectSymbol }: Props) {
  const {
    accounts,
    selectedId,
    select,
    loading,
    error: accountsError,
    reload: reloadAccounts,
    create,
    remove,
    reset,
  } = usePaperAccounts();
  const { detail, error, refresh } = usePaperAccountDetail(selectedId);
  const [tab, setTab] = useState<Tab>('positions');
  const [view, setView] = useState<View>('overview');
  /** 모아보기 헤더의 생성 폼 펼침 여부 */
  const [creatingInOverview, setCreatingInOverview] = useState(false);
  // 모아보기가 보일 때만 폴링한다 — 상세로 들어가면 그쪽이 1초로 본다.
  const overview = usePaperAccountsOverview(view === 'overview');
  const autoOverview = useAutoTradingOverview(view === 'overview');
  const { state: gemini } = useGeminiStatus(60_000);
  /** 주문·취소 후 목록을 다시 읽기 위한 카운터 */
  const [version, setVersion] = useState(0);

  const trades = usePaperTrades(selectedId, version);
  const orders = usePaperOrders(selectedId, version);
  const perf = usePaperPerformance(selectedId, version);

  const openAccount = (id: number) => {
    select(id);
    setView('detail');
  };

  /** 카드에서 바로 켜고 끈다 — 저장은 계좌별 설정 API 하나뿐이다 (Step 12) */
  const toggleAuto = async (accountId: number, enabled: boolean) => {
    const res = await fetch(`/api/auto-trading/strategies/${accountId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? '저장에 실패했습니다.');
    await autoOverview.refresh();
  };

  const bump = () => {
    setVersion((n) => n + 1);
    refresh();
  };

  const currency = detail?.account.currency ?? 'KRW';

  /** 모아보기 헤더의 자동매매 요약 — 카드와 **같은 분류**를 센다 */
  const autoCounts = (autoOverview.items ?? []).reduce(
    (acc, s) => {
      acc[autoTradeView(s.strategy, s.status).state] += 1;
      return acc;
    },
    { running: 0, waiting: 0, blocked: 0, off: 0 },
  );

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
    // 계좌 목록이 오기 전에도 **실제와 같은 배치**를 그려 둔다.
    // 빈 화면을 잠깐 보여 주면 계좌가 없는 것으로 오해하게 된다.
    return (
      <div className="flex h-full flex-col">
        {banner}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Skeleton className="h-4 w-10" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
          <SkeletonCards count={4} className="grid-cols-2 md:grid-cols-4" />
          <SkeletonTable rows={6} columns={5} />
        </div>
      </div>
    );
  }

  /*
   * ⚠️ **"불러오지 못했다" 와 "계좌가 없다" 를 절대 같은 화면으로 그리지 않는다.**
   * 앱 재실행 직후에는 API(4000)가 vite(5173)보다 늦게 떠서 첫 조회가 실패하는데,
   * 그때 '계좌 없음' 화면을 보여 주면 저장된 계좌가 지워진 것처럼 보인다.
   * (실제로 그 화면을 보고 계좌를 새로 만든 흔적이 DB 에 남아 있었다.)
   */
  if (accountsError && !accounts.length) {
    return (
      <div className="flex h-full flex-col">
        {banner}
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-center text-xs leading-relaxed text-text-secondary">
            계좌 목록을 불러오지 못했습니다.
            <br />
            <span className="text-text-muted">{accountsError}</span>
            <br />
            <span className="text-text-muted">
              저장된 계좌·보유 종목·거래 내역은 그대로 있습니다 (지워지지 않습니다).
            </span>
          </p>
          <button
            type="button"
            onClick={() => void reloadAccounts()}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            다시 시도
          </button>
        </div>
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

  // 계좌가 있으면 **모아보기가 먼저**다 (계좌가 하나여도 카드 한 장).
  if (view === 'overview') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {banner}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <h2 className="text-sm font-medium text-text-primary">계좌 모아보기</h2>
          {/*
            카드를 다 훑지 않아도 전체 자동매매 상태를 알 수 있게 한 줄로 센다.
            분류는 `utils/autoTradeStatus` 한 곳이라 카드와 숫자가 갈라지지 않는다.
          */}
          <span className="flex items-center gap-1 text-[11px] text-text-muted">
            자동매매
            <span className="text-bullish">가동 {autoCounts.running}</span>
            <span className="text-border">·</span>
            <span className="text-text-secondary">대기 {autoCounts.waiting}</span>
            <span className="text-border">·</span>
            <span className="text-warning">멈춤 {autoCounts.blocked}</span>
            <span className="text-border">·</span>
            <span className="text-text-muted">꺼짐 {autoCounts.off}</span>
          </span>
          <span className="text-[11px] text-text-muted">
            카드를 누르면 그 계좌의 잔고·거래·자동매매 설정으로 들어갑니다
          </span>
          {/*
            계좌를 만드는 자리는 **전 계좌를 보는 화면**에도 있어야 한다 — 전략별로 계좌를
            나눠 비교하는 앱이라, 새 계좌를 만들고 싶어지는 순간이 바로 이 화면이다.
            ⚠️ 모아보기 조회가 실패해도 이 버튼은 그대로 보인다 (헤더는 대시보드에 있다).
          */}
          <button
            type="button"
            onClick={() => setCreatingInOverview((v) => !v)}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            + 새 계좌
          </button>
          {creatingInOverview && (
            <CreateAccountForm
              onCreate={create}
              onDone={(account) => {
                setCreatingInOverview(false);
                /*
                  ⚠️ 5초 폴링을 기다리지 않는다 — "만들었는데 안 보인다" 가 된다.
                  `create` 가 이미 계좌 목록을 다시 읽고 선택까지 하지만,
                  모아보기 카드는 별도 묶음 라우트라 여기서 따로 받아야 한다.
                */
                void overview.refresh();
                void autoOverview.refresh();
                toast.success('계좌를 만들었습니다', account?.name);
                // 상세로 넘기지 않는다 — 새 카드가 목록에 보이는 것이 곧 확인이다.
              }}
              onCancel={() => setCreatingInOverview(false)}
            />
          )}
        </div>
        <AccountsOverview
          accounts={overview.items}
          strategies={autoOverview.items}
          geminiEnabled={gemini?.enabled ?? false}
          error={overview.error ?? autoOverview.error}
          hasAccounts={accounts.length > 0}
          selectedId={selectedId}
          onOpen={openAccount}
          onToggleAuto={toggleAuto}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {banner}

      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <button
          type="button"
          onClick={() => setView('overview')}
          className="rounded px-2 py-0.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          ← 계좌 모아보기
        </button>
      </div>

      <AccountManager
        accounts={accounts}
        selectedId={selectedId}
        onSelect={select}
        onCreate={create}
        onReset={reset}
        onDelete={remove}
      />

      {/* 계좌마다 독립된 자동매매 — 설정·상태는 서버가 단일 출처다 (Step 12) */}
      <AutoTradeBar accountId={selectedId} />

      {error && (
        <div className="border-b border-bearish/30 bg-bearish/10 px-4 py-1.5 text-[11px] text-bearish">
          ❌ {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
          {!detail && <SkeletonCards count={4} className="shrink-0 grid-cols-2 md:grid-cols-4" />}
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
              {tab === 'positions' && !detail && (
                <div className="p-3">
                  <SkeletonTable rows={4} columns={5} />
                </div>
              )}
              {tab === 'positions' && detail && (
                <PositionList
                  positions={detail.positions}
                  onSelectSymbol={onSelectSymbol}
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
                    <>
                      <SkeletonCards count={4} className="grid-cols-2 md:grid-cols-4" />
                      <Skeleton className="min-h-[220px] flex-1 rounded-lg" />
                    </>
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
