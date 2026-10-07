import { useEffect, useMemo, useState } from 'react';
import type { OrderSide, OrderType, PaperOrder, PaperPositionValued } from '../../types/paper';
import { cancelPaperOrder, submitOrder, usePaperAccounts } from '../../hooks/usePaperTrading';
import { modal, toast } from '../../store/uiStore';
import { formatPrice } from '../../utils/formatters';
import StockName from '../common/StockName';
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
  /** 호가 가격 칸을 누른 값 — 가격 칸을 그 가격으로 채운다(nonce 가 바뀔 때만) */
  pickedPrice?: { price: number; nonce: number } | null;
}

/** 가격 칸 표시 — 국내 원 정수 / 미국 소수 둘째 자리 */
function priceText(value: number, currency: 'KRW' | 'USD'): string {
  return currency === 'KRW' ? String(Math.round(value)) : value.toFixed(2);
}

/** 가격 칸 값 읽기 — 국내 원 정수 / 미국 소수 둘째 자리로 맞춘다(호가 단위 검사는 하지 않는다) */
function parsePrice(text: string, currency: 'KRW' | 'USD'): number | null {
  const n = Number(text.replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return currency === 'KRW' ? Math.round(n) : Math.round(n * 100) / 100;
}

const REFRESH_MS = 2000;
const SHARE_PRESETS = [1, 10, 100];
const PERCENT_PRESETS = [10, 30, 50, 100];

/**
 * 차트 옆 빠른주문 (토스 WTS 의 빠른주문 위치).
 *
 * ⚠️ 모의투자 전용이다. 계좌 목록·선택은 `usePaperAccounts()` 의 **앱 공유 상태**를 쓴다 —
 * 여기서 따로 조회하면 다른 화면에서 만들거나 지운 계좌가 이 패널에 반영되지 않는다.
 */
export default function QuickOrderPanel({
  symbol,
  price,
  currency,
  active = true,
  onGoToPaperTrading,
  pickedPrice = null,
}: Props) {
  const { accounts, selectedId: accountId, select: selectAccount } = usePaperAccounts();
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
  /**
   * 지정가 가격 칸 (v2.41.0). 처음 값 = 현재가, 종목이 바뀌면 현재가로. 사용자가 고친 뒤에는(`touched`)
   * 시세가 바뀌어도 덮지 않는다. 호가 가격 칸을 누르면 그 가격으로 채운다.
   */
  const [limitText, setLimitText] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setTouched(false);
    setLimitText(price != null ? priceText(price, currency) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  useEffect(() => {
    if (!touched && price != null) setLimitText(priceText(price, currency));
  }, [price, touched, currency]);
  useEffect(() => {
    if (!pickedPrice) return;
    setLimitText(priceText(pickedPrice.price, currency));
    setTouched(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedPrice?.nonce]);
  const limitPrice = parsePrice(limitText, currency);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  useStockNames([symbol, ...positions.map((p) => p.symbol)]);

  /*
   * 잔고·보유·미체결만 이 주기로 읽는다.
   * **계좌 목록은 더 이상 여기서 받지 않는다** — 공유 상태가 들고 있고, 다른 화면의
   * 생성·삭제가 그쪽에서 방송돼 이 패널에도 바로 반영된다.
   */
  useEffect(() => {
    if (!active) return;
    if (!accountId) {
      setPositions([]);
      setOrders([]);
      setCash(0);
      return;
    }
    let cancelled = false;

    const load = async (force = false) => {
      if (document.hidden && !force) return;
      try {
        const [detail, orderList] = await Promise.all([
          fetch(`/api/paper/accounts/${accountId}`).then((r) => r.json()),
          fetch(`/api/paper/orders?accountId=${accountId}`).then((r) => r.json()),
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

  const position = positions.find((p) => p.symbol === symbol) ?? null;
  /*
   * ⚠️ 이 패널은 **한 종목 전용**이다 (헤더·수량·예상금액이 전부 그 종목 기준).
   * 계좌 전체의 미체결을 세면 건수가 엉뚱하고, [전체 취소] 가 다른 종목의
   * 지정가 주문까지 지운다. 계좌 전체 취소가 필요하면 모의투자 대시보드에서 한다.
   */
  const pending = orders.filter((o) => o.status === 'PENDING' && o.symbol === symbol);
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
  /** 가능 수량·예상 금액은 지정가 칸 값으로 낸다(시장가 주문은 확인 창에서 현재가로 다시 낸다) */
  const basis = limitPrice;
  const maxBuyableAt = (p: number | null) => (p && p > 0 ? Math.floor(cashInSymbolCurrency / (p * (1 + commissionRate))) : 0);
  const maxBuyable = maxBuyableAt(basis);

  /*
   * % 는 매수·매도에서 기준이 다르다.
   *   매수 — 현금 잔고의 N% 로 살 수 있는 수량
   *   매도 — 보유 수량의 N%
   * 하나의 값으로 뭉뚱그리면 "50% 매도" 가 잔고 기준으로 계산돼 엉뚱한 수량이 된다.
   * 매수 환산에는 수수료를 포함한다 — 그러지 않으면 100% 가 잔고를 넘겨 거부된다.
   */
  const quantityFor = (side: OrderSide, at: number | null = basis): number => {
    if (unit === 'shares') return quantity;
    if (side === 'BUY') {
      if (!at || at <= 0) return 0;
      const budget = (cashInSymbolCurrency * percent) / 100;
      return Math.max(0, Math.floor(budget / (at * (1 + commissionRate))));
    }
    return Math.max(0, Math.floor((held * percent) / 100));
  };
  const estimateFor = (side: OrderSide, qty: number, at: number | null) =>
    at ? qty * at * (side === 'BUY' ? 1 + commissionRate : 1 - commissionRate) : 0;

  const buyQuantity = quantityFor('BUY');
  const sellQuantity = quantityFor('SELL');
  const marketBuyQuantity = quantityFor('BUY', price);
  const marketSellQuantity = quantityFor('SELL', price);

  const buyEstimate = estimateFor('BUY', buyQuantity, basis);
  const sellEstimate = estimateFor('SELL', sellQuantity, basis);

  /** 입력한 %가 몇 주가 되는지 — 방향이 다르면 둘 다 보여 준다. */
  const percentHint = (() => {
    if (unit !== 'percent') return null;
    if (percent >= 100 && held > 0) return `매수 ${buyQuantity}주 · 매도 전량 (${held}주)`;
    if (buyQuantity === sellQuantity) return `= 약 ${buyQuantity}주`;
    return `매수 약 ${buyQuantity}주 · 매도 약 ${sellQuantity}주`;
  })();

  const refresh = () => setVersion((n) => n + 1);

  const order = (side: OrderSide, orderType: OrderType) => {
    // 지정가 = 가격 칸 값, 시장가 = 지금 현재가
    const at = orderType === 'LIMIT' ? limitPrice : price;
    const orderQuantity = quantityFor(side, at);
    if (!account || !price || !at || orderQuantity <= 0) return;

    const label = side === 'BUY' ? '매수' : '매도';
    const typeLabel = orderType === 'MARKET' ? '시장가' : '지정가';

    modal.confirm({
      title: `${symbol}${stockNameOf(symbol) ? ` ${stockNameOf(symbol)}` : ''} ${orderQuantity}주 ${typeLabel} ${label}`,
      message:
        orderType === 'LIMIT'
          ? `모의투자 주문입니다. 증권사로 주문이 전송되지 않습니다.\n지정가 — ${side === 'BUY' ? '현재가가 이 가격 이하' : '현재가가 이 가격 이상'}이면 체결되고, 아니면 대기합니다.`
          : '모의투자 주문입니다. 증권사로 주문이 전송되지 않습니다.',
      rows: [
        { label: '계좌', value: account.name },
        { label: '현재가', value: formatPrice(price, currency) },
        ...(orderType === 'LIMIT' ? [{ label: '지정가', value: formatPrice(at, currency) }] : []),
        {
          label: orderType === 'LIMIT' ? '예상 금액 (지정가 기준)' : '예상 금액 (현재가 기준)',
          value: formatPrice(estimateFor(side, orderQuantity, at), currency),
        },
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
            requestedPrice: orderType === 'LIMIT' ? at : null,
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
      title: `${symbol} 미체결 주문 취소`,
      message: `${symbol} 의 대기 중인 지정가 주문 ${pending.length}건을 취소합니다. 다른 종목의 주문은 그대로 남습니다.`,
      confirmText: `${symbol} 주문 취소`,
      danger: true,
      onConfirm: async () => {
        await Promise.allSettled(pending.map((o) => cancelPaperOrder(o.id)));
        toast.success(`${symbol} 주문 ${pending.length}건을 취소했습니다.`);
        refresh();
      },
    });
  };

  const header = (
    <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
      <span className="text-xs font-medium text-text-secondary">빠른주문</span>
      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[13px] font-medium text-warning">
        모의
      </span>
      {/* 어떤 종목을 주문하는지 패널 안에서 바로 보이게 한다 */}
      <StockName
        symbol={symbol}
        className="ml-auto min-w-0 text-[13px] text-text-primary"
        tickerClassName="text-text-muted"
      />
    </div>
  );

  if (!accounts.length) {
    return (
      <div className="shrink-0 border-t border-border">
        {header}
        <div className="space-y-2 px-2.5 py-3">
          <p className="text-[13px] leading-relaxed text-text-muted">
            모의투자 계좌를 먼저 만드세요.
          </p>
          <button
            type="button"
            onClick={onGoToPaperTrading}
            className="w-full rounded-md bg-accent px-2 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
          >
            계좌 생성
          </button>
        </div>
      </div>
    );
  }

  const info = (label: string, value: string, tone = 'text-text-secondary') => (
    <div className="flex justify-between text-[13px]">
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
          className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-[13px] text-text-primary focus:border-accent focus:outline-none"
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
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1.5 py-1 text-right text-[13px] tabular-nums text-text-primary focus:border-accent focus:outline-none"
            />
            {(['shares', 'percent'] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => setUnit(u)}
                className={`rounded px-1.5 py-1 text-[13px] transition-colors ${
                  unit === u ? 'bg-bg-elevated font-medium text-text-primary' : 'text-text-muted hover:bg-bg-tertiary'
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
                    className="flex-1 rounded-md bg-bg-tertiary py-0.5 text-[13px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    {n}주
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setQuantity(maxBuyable)}
                  className="flex-1 rounded-md bg-bg-tertiary py-0.5 text-[13px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-accent"
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
                  className={`flex-1 rounded-md py-0.5 text-[13px] transition-colors ${
                    percent === n
                      ? 'bg-bg-elevated text-text-primary'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {n}%
                </button>
              ))
            )}
          </div>

          {percentHint && (
            <p className="text-right text-[13px] text-text-muted">{percentHint}</p>
          )}
        </div>

        {/* 가격 칸 (지정가) — 호가 가격을 누르면 그 가격으로 채워진다 */}
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[13px] text-text-muted">가격</span>
          <input
            type="text"
            inputMode="decimal"
            value={limitText}
            onChange={(e) => {
              setLimitText(e.target.value);
              setTouched(true);
            }}
            aria-label="지정가 가격"
            title="지정가 — 매수는 현재가가 이 가격 이하, 매도는 이 가격 이상이면 체결됩니다"
            className={`min-w-0 flex-1 rounded border bg-bg-primary px-1.5 py-1 text-right text-[13px] tabular-nums text-text-primary focus:border-accent focus:outline-none ${
              limitText && limitPrice == null ? 'border-bearish' : 'border-border'
            }`}
          />
          <button
            type="button"
            onClick={() => {
              if (price != null) setLimitText(priceText(price, currency));
              setTouched(false);
            }}
            disabled={price == null}
            className="shrink-0 whitespace-nowrap rounded bg-bg-tertiary px-1.5 py-1 text-[13px] text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-40"
          >
            현재가
          </button>
        </div>

        {/* 가능 수량 · 예상 금액 — 가격 칸(지정가) 기준. 시장가 주문은 확인 창에서 현재가로 다시 낸다 */}
        <div className="space-y-0.5">
          {info('매도 가능', `${held}주`)}
          {/* 환율을 못 받았으면 0 주라고 단언하지 않는다 — 잔고가 없다는 뜻으로 읽힌다. */}
          {info('매수 가능', fxMissing ? '환율 조회 실패' : `${maxBuyable}주`)}
          {info(unit === 'percent' ? `매도 예상 (${percent}%)` : '매도 예상', formatPrice(sellEstimate, currency))}
          {info(unit === 'percent' ? `매수 예상 (${percent}%)` : '매수 예상', formatPrice(buyEstimate, currency))}
          <p className="text-right text-[13px] text-text-muted">지정가 {basis != null ? formatPrice(basis, currency) : '—'} 기준</p>
        </div>

        {/* 주문 버튼 — 매도 파랑 / 매수 빨강 (국내 관례) */}
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => order('SELL', 'LIMIT')}
            disabled={busy || !price || !limitPrice || sellQuantity <= 0}
            className="rounded-md bg-accent/80 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent disabled:opacity-40"
          >
            지정가 매도
          </button>
          <button
            type="button"
            onClick={() => order('BUY', 'LIMIT')}
            disabled={busy || !price || !limitPrice || buyQuantity <= 0}
            className="rounded-md bg-bearish/80 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-bearish disabled:opacity-40"
          >
            지정가 매수
          </button>
          <button
            type="button"
            onClick={() => order('SELL', 'MARKET')}
            disabled={busy || !price || marketSellQuantity <= 0}
            className="rounded-md bg-accent/15 py-1.5 text-[13px] text-accent transition-colors hover:bg-accent/25 disabled:opacity-40"
          >
            시장가 매도
          </button>
          <button
            type="button"
            onClick={() => order('BUY', 'MARKET')}
            disabled={busy || !price || marketBuyQuantity <= 0}
            className="rounded-md bg-bearish/15 py-1.5 text-[13px] text-bearish transition-colors hover:bg-bearish/25 disabled:opacity-40"
          >
            시장가 매수
          </button>
        </div>

        <button
          type="button"
          onClick={cancelAll}
          disabled={!pending.length}
          className="w-full rounded-md bg-bg-tertiary py-1 text-[13px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
        >
          {symbol} 주문 취소 {pending.length > 0 && `(${pending.length})`}
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
            <p className="text-[13px] text-text-muted">보유하지 않은 종목입니다</p>
          )}
          {info(`미체결 (${symbol})`, `${pending.length}건`)}
        </div>
      </div>
    </div>
  );
}
