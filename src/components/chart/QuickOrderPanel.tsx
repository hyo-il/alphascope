import { useEffect, useMemo, useState } from 'react';
import type { OrderSide, OrderType, PaperAccount, PaperOrder, PaperPositionValued } from '../../types/paper';
import { cancelPaperOrder, submitOrder } from '../../hooks/usePaperTrading';
import { modal, toast } from '../../store/uiStore';
import { formatPrice } from '../../utils/formatters';
import SymbolLabel from '../common/SymbolLabel';
import { useStockNames } from '../../hooks/useStockNames';
import { stockNameOf } from '../../utils/stockNames';

interface Props {
  symbol: string;
  price: number | null;
  currency: 'KRW' | 'USD';
  /**
   * 차트 화면이 실제로 보이는 중인지.
   * 차트는 캡처 대상이라 다른 화면에서도 언마운트하지 않으므로, 이 가드가 없으면
   * 보이지도 않는 패널이 2초마다 계좌·주문을 계속 조회한다.
   */
  active?: boolean;
  /** 계좌를 만들러 보내기 */
  onGoToPaperTrading: () => void;
}

const ACCOUNT_KEY = 'alphascope.paperAccountId';
const REFRESH_MS = 2000;
const SHARE_PRESETS = [1, 10, 100];
const PERCENT_PRESETS = [10, 30, 50, 100];

/**
 * 차트 옆 빠른주문 (토스 WTS 의 빠른주문 위치).
 *
 * ⚠️ 모의투자 전용이다. 계좌 선택은 localStorage 로 모의투자 대시보드와 공유해
 * 두 화면이 서로 다른 계좌를 보고 있는 일이 없게 한다.
 */
export default function QuickOrderPanel({
  symbol,
  price,
  currency,
  active = true,
  onGoToPaperTrading,
}: Props) {
  const [accounts, setAccounts] = useState<PaperAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(ACCOUNT_KEY));
    return saved > 0 ? saved : null;
  });
  const [positions, setPositions] = useState<PaperPositionValued[]>([]);
  const [orders, setOrders] = useState<PaperOrder[]>([]);
  const [cash, setCash] = useState(0);
  /** USD → 계좌 통화 환율 (서버가 계좌 상세와 함께 준다) */
  /** null = 환율을 아직/끝내 못 받았다. 1 로 때우면 원화 계좌 수량이 1,000배가 된다. */
  const [fxRate, setFxRate] = useState<number | null>(1);
  const [quantity, setQuantity] = useState(10);
  const [unit, setUnit] = useState<'shares' | 'percent'>('shares');
  const [percent, setPercent] = useState(30);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  useStockNames([symbol, ...positions.map((p) => p.symbol)]);

  /*
   * 계좌 목록과 잔고·보유·미체결을 같은 주기로 읽는다.
   * 계좌 목록을 마운트 시 한 번만 읽으면, 모의투자 화면에서 계좌를 만들고 돌아왔을 때
   * 이 패널은 여전히 "계좌를 먼저 만드세요" 를 붙들고 있는다.
   */
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async (force = false) => {
      if (document.hidden && !force) return;
      try {
        const list = await fetch('/api/paper/accounts').then((r) => r.json());
        if (cancelled) return;
        const fetched: PaperAccount[] = list.accounts ?? [];
        setAccounts(fetched);

        const active =
          fetched.find((a) => a.id === accountId) ?? fetched[0] ?? null;
        if (!active) {
          setPositions([]);
          setOrders([]);
          setCash(0);
          return;
        }
        if (active.id !== accountId) setAccountId(active.id);

        const [detail, orderList] = await Promise.all([
          fetch(`/api/paper/accounts/${active.id}`).then((r) => r.json()),
          fetch(`/api/paper/orders?accountId=${active.id}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setPositions(detail.positions ?? []);
        setCash(detail.account?.currentCash ?? 0);
        setFxRate(typeof detail.fxRate === 'number' && detail.fxRate > 0 ? detail.fxRate : null);
        setOrders(orderList.orders ?? []);
      } catch {
        // 다음 주기에 자연스럽게 재시도된다.
      }
    };

    void load(true);
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [accountId, version, active]);

  const selectAccount = (id: number) => {
    setAccountId(id);
    localStorage.setItem(ACCOUNT_KEY, String(id));
  };

  const position = positions.find((p) => p.symbol === symbol) ?? null;
  const pending = orders.filter((o) => o.status === 'PENDING');
  /*
   * 종목 통화로 환산한 현금.
   * 보유 종목에서 환율을 역산하면 첫 매수 전에는 값이 없어 "구매가능 0주" 가 된다 —
   * 서버가 계좌 상세와 함께 주는 환율을 쓴다.
   */
  const cashInSymbolCurrency = useMemo(() => {
    if (!account) return 0;
    if (account.currency === currency) return cash;
    // 계좌 KRW · 종목 USD 가 사실상 전부다. fxRate 는 USD → 계좌 통화 기준이다.
    // 환율이 없으면 환산할 방법이 없다 — 0 으로 두어 수량이 부풀지 않게 한다.
    if (fxRate == null) return 0;
    return currency === 'USD' ? cash / fxRate : cash * fxRate;
  }, [account, cash, currency, fxRate]);

  /** 통화가 달라 환산이 필요한데 환율이 없는 상태 — 매수 수량을 낼 수 없다. */
  const fxMissing = Boolean(account) && account!.currency !== currency && fxRate == null;

  const commissionRate = account?.commissionRate ?? 0.001;
  const held = position?.quantity ?? 0;
  const maxBuyable =
    price && price > 0 ? Math.floor(cashInSymbolCurrency / (price * (1 + commissionRate))) : 0;

  /*
   * % 는 매수·매도에서 기준이 다르다.
   *   매수 — 현금 잔고의 N% 로 살 수 있는 수량
   *   매도 — 보유 수량의 N%
   * 하나의 값으로 뭉뚱그리면 "50% 매도" 가 잔고 기준으로 계산돼 엉뚱한 수량이 된다.
   * 매수 환산에는 수수료를 포함한다 — 그러지 않으면 100% 가 잔고를 넘겨 거부된다.
   */
  const quantityFor = (side: OrderSide): number => {
    if (unit === 'shares') return quantity;
    if (side === 'BUY') {
      if (!price || price <= 0) return 0;
      const budget = (cashInSymbolCurrency * percent) / 100;
      return Math.max(0, Math.floor(budget / (price * (1 + commissionRate))));
    }
    return Math.max(0, Math.floor((held * percent) / 100));
  };

  const buyQuantity = quantityFor('BUY');
  const sellQuantity = quantityFor('SELL');

  const buyEstimate = price ? buyQuantity * price * (1 + commissionRate) : 0;
  const sellEstimate = price ? sellQuantity * price * (1 - commissionRate) : 0;

  /** 입력한 %가 몇 주가 되는지 — 방향이 다르면 둘 다 보여 준다. */
  const percentHint = (() => {
    if (unit !== 'percent') return null;
    if (percent >= 100 && held > 0) return `매수 ${buyQuantity}주 · 매도 전량 (${held}주)`;
    if (buyQuantity === sellQuantity) return `= 약 ${buyQuantity}주`;
    return `매수 약 ${buyQuantity}주 · 매도 약 ${sellQuantity}주`;
  })();

  const refresh = () => setVersion((n) => n + 1);

  const order = (side: OrderSide, orderType: OrderType) => {
    const orderQuantity = quantityFor(side);
    if (!account || !price || orderQuantity <= 0) return;

    const label = side === 'BUY' ? '구매' : '판매';
    const typeLabel = orderType === 'MARKET' ? '시장가' : '현재가 지정가';

    modal.confirm({
      title: `${symbol}${stockNameOf(symbol) ? ` ${stockNameOf(symbol)}` : ''} ${orderQuantity}주 ${typeLabel} ${label}`,
      message: '모의투자 주문입니다. 증권사로 주문이 전송되지 않습니다.',
      rows: [
        { label: '계좌', value: account.name },
        { label: '현재가', value: formatPrice(price, currency) },
        {
          label: '예상 금액',
          value: formatPrice(side === 'BUY' ? buyEstimate : sellEstimate, currency),
        },
        ...(orderType === 'LIMIT'
          ? [{ label: '지정가', value: formatPrice(price, currency), tone: 'muted' as const }]
          : []),
      ],
      confirmText: `${label} 주문`,
      onConfirm: async () => {
        setBusy(true);
        try {
          const result = await submitOrder({
            accountId: account.id,
            symbol,
            side,
            orderType,
            quantity: orderQuantity,
            requestedPrice: orderType === 'LIMIT' ? price : null,
            reason: `차트 빠른주문 (${typeLabel})`,
          });

          if (result.pending) {
            toast.info('지정가 주문을 접수했습니다.', '조건에 닿으면 자동으로 체결됩니다.');
          } else {
            const t = result.trade!;
            const pnl =
              t.pnl != null
                ? ` · 실현손익 ${formatPrice(t.pnl, currency)} (${t.pnlPercent?.toFixed(2)}%)`
                : '';
            toast.success(
              `${label} 체결`,
              `${t.symbol} ${t.quantity}주 @ ${formatPrice(t.price, currency)}${pnl}`,
            );
          }
          refresh();
        } catch (e) {
          toast.error('주문에 실패했습니다.', e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const cancelAll = () => {
    if (!pending.length) return;
    modal.confirm({
      title: '미체결 주문 전체 취소',
      message: `대기 중인 지정가 주문 ${pending.length}건을 모두 취소합니다.`,
      confirmText: '전체 취소',
      danger: true,
      onConfirm: async () => {
        await Promise.allSettled(pending.map((o) => cancelPaperOrder(o.id)));
        toast.success(`주문 ${pending.length}건을 취소했습니다.`);
        refresh();
      },
    });
  };

  const header = (
    <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
      <span className="text-xs font-medium text-text-secondary">빠른주문</span>
      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
        모의
      </span>
      {/* 어떤 종목을 주문하는지 패널 안에서 바로 보이게 한다 */}
      <SymbolLabel
        symbol={symbol}
        className="ml-auto min-w-0 text-[11px] text-text-primary"
        nameClassName="text-text-muted"
      />
    </div>
  );

  if (!accounts.length) {
    return (
      <div className="shrink-0 border-t border-border">
        {header}
        <div className="space-y-2 px-2.5 py-3">
          <p className="text-[11px] leading-relaxed text-text-muted">
            모의투자 계좌를 먼저 만드세요.
          </p>
          <button
            type="button"
            onClick={onGoToPaperTrading}
            className="w-full rounded-md bg-accent px-2 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            계좌 생성
          </button>
        </div>
      </div>
    );
  }

  const info = (label: string, value: string, tone = 'text-text-secondary') => (
    <div className="flex justify-between text-[11px]">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular-nums ${tone}`}>{value}</span>
    </div>
  );

  return (
    <div className="flex shrink-0 flex-col border-t border-border">
      {header}

      <div className="space-y-2 px-2.5 py-2">
        <select
          value={accountId ?? ''}
          onChange={(e) => selectAccount(Number(e.target.value))}
          className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        {/* 수량 */}
        <div className="space-y-1.5 rounded-md bg-bg-tertiary/50 px-2 py-2">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              max={unit === 'percent' ? 100 : undefined}
              value={unit === 'shares' ? quantity : percent}
              onChange={(e) =>
                unit === 'shares'
                  ? setQuantity(Math.max(0, Number(e.target.value)))
                  : setPercent(Math.min(100, Math.max(0, Number(e.target.value))))
              }
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1.5 py-1 text-right text-[11px] tabular-nums text-text-primary focus:border-accent focus:outline-none"
            />
            {(['shares', 'percent'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={`rounded px-1.5 py-1 text-[11px] transition-colors ${
                  unit === u ? 'bg-accent/15 font-medium text-accent' : 'text-text-muted hover:bg-bg-tertiary'
                }`}
              >
                {u === 'shares' ? '주' : '%'}
              </button>
            ))}
          </div>

          {/* 프리셋은 단위에 따라 통째로 바뀐다 */}
          <div className="flex gap-1">
            {unit === 'shares' ? (
              <>
                {SHARE_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setQuantity(n)}
                    className="flex-1 rounded border border-border py-0.5 text-[10px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    {n}주
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setQuantity(maxBuyable)}
                  className="flex-1 rounded border border-border py-0.5 text-[10px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-accent"
                >
                  최대
                </button>
              </>
            ) : (
              PERCENT_PRESETS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPercent(n)}
                  className={`flex-1 rounded border py-0.5 text-[10px] transition-colors ${
                    percent === n
                      ? 'border-accent text-accent'
                      : 'border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`}
                >
                  {n}%
                </button>
              ))
            )}
          </div>

          {percentHint && (
            <p className="text-right text-[10px] text-text-muted">{percentHint}</p>
          )}
        </div>

        {/* 가능 수량 · 예상 금액 */}
        <div className="space-y-0.5">
          {info('판매가능', `${held}주`)}
          {/* 환율을 못 받았으면 0 주라고 단언하지 않는다 — 잔고가 없다는 뜻으로 읽힌다. */}
          {info('구매가능', fxMissing ? '환율 조회 실패' : `${maxBuyable}주`)}
          {info(
            unit === 'percent' ? `판매예상 (${percent}%)` : '판매예상',
            formatPrice(sellEstimate, currency),
          )}
          {info(
            unit === 'percent' ? `구매예상 (${percent}%)` : '구매예상',
            formatPrice(buyEstimate, currency),
          )}
        </div>

        {/* 주문 버튼 — 매도 파랑 / 매수 빨강 (국내 관례) */}
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => order('SELL', 'LIMIT')}
            disabled={busy || !price || sellQuantity <= 0}
            className="rounded bg-accent/80 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-40"
          >
            현재가 판매
          </button>
          <button
            type="button"
            onClick={() => order('BUY', 'LIMIT')}
            disabled={busy || !price || buyQuantity <= 0}
            className="rounded bg-bearish/80 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-bearish disabled:opacity-40"
          >
            현재가 구매
          </button>
          <button
            type="button"
            onClick={() => order('SELL', 'MARKET')}
            disabled={busy || !price || sellQuantity <= 0}
            className="rounded border border-accent/60 py-1.5 text-[11px] text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
          >
            시장가 판매
          </button>
          <button
            type="button"
            onClick={() => order('BUY', 'MARKET')}
            disabled={busy || !price || buyQuantity <= 0}
            className="rounded border border-bearish/60 py-1.5 text-[11px] text-bearish transition-colors hover:bg-bearish/10 disabled:opacity-40"
          >
            시장가 구매
          </button>
        </div>

        <button
          type="button"
          onClick={cancelAll}
          disabled={!pending.length}
          className="w-full rounded border border-border py-1 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
        >
          전체 취소 {pending.length > 0 && `(${pending.length})`}
        </button>

        {/* 내 정보 */}
        <div className="space-y-0.5 border-t border-border pt-2">
          {position ? (
            <>
              {info('내 주식 평균', formatPrice(position.avgPrice, currency))}
              {info(
                '현재 수익',
                position.unrealizedPnl != null
                  ? `${position.unrealizedPnl > 0 ? '+' : ''}${formatPrice(position.unrealizedPnl, currency)}`
                  : '—',
                position.unrealizedPnl == null
                  ? 'text-text-muted'
                  : position.unrealizedPnl > 0
                    ? 'text-bullish'
                    : 'text-bearish',
              )}
            </>
          ) : (
            <p className="text-[11px] text-text-muted">보유하지 않은 종목입니다</p>
          )}
          {info('미체결 주문', `${pending.length}건`)}
        </div>
      </div>
    </div>
  );
}
