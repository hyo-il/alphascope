import { useEffect, useState } from 'react';
import { FormRow, NumberField } from '../ui';
import { InlineSpinner } from '../common/LoadingOverlay';
import { formatNumber } from '../../utils/formatters';
import { formatAssetWon } from '../../utils/assetFormat';
import { ASSET_CASH_MAX, type AssetCashPairView, type AssetCurrency, type AssetTradeSide } from '../../types/asset';

/**
 * 매수 · 매도 창의 예수금 줄(v2.71.0 · 현금 자동 반영 ①) — `AssetTradeDialog` · `AssetNewBuyDialog`(확인 화면)가 함께 쓴다.
 * - 열 때 `GET /api/asset/cash/pair?section=` 로 그 계좌의 짝 · 켜짐 · 지금 환율을 받는다. 받기 전에는 「확인 중」(짝 없음을 먼저 그리지 않는다) · 저장을 막는다.
 * - 짝이 있으면 「○○ ₩… 줄어듭니다(매도 늘어납니다)」 + 금액 입력칸. 처음 값 = 수량 × 가격(국내 원 · 미국 × 지금 환율 · 반올림) — 사용자가 고치면 그 값을 그대로 쓴다(0 = 예수금은 안 바꿈).
 * - 짝이 없거나 꺼졌으면 안내 한 줄만(지금과 같게 저장 — 예수금 금액을 보내지 않는다). 받기 실패도 보내지 않는다(이유 한 줄).
 * - 저장 결과(예수금만 실패)는 창을 부른 쪽이 안내한다.
 */
export interface CashTradeValue {
  /** 보낼 예수금 금액(원) — null 이면 보내지 않음(예수금 그대로) */
  send: number | null;
  /** 저장해도 되나 — 짝을 받는 중 · 금액 칸이 비었으면 false */
  ready: boolean;
}

/** 환율 — 소수 끝 0 은 빼고 둘째 자리까지(1,380.5) */
const fxText = (fx: number) => {
  const r = Math.round(fx * 100) / 100;
  return formatNumber(r, Number.isInteger(r) ? 0 : Number.isInteger(r * 10) ? 1 : 2);
};

type Load = { state: 'loading' } | { state: 'error' } | { state: 'done'; view: AssetCashPairView };

export default function AssetCashTradeLine({
  section,
  side,
  currency,
  qty,
  price,
  onValue,
}: {
  section: string;
  side: AssetTradeSide;
  currency: AssetCurrency;
  /** 수량 · 가격(원래 통화) — 모르면 0 */
  qty: number;
  price: number;
  onValue: (v: CashTradeValue) => void;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoad({ state: 'loading' });
    setEdited(false);
    fetch(`/api/asset/cash/pair?section=${encodeURIComponent(section)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('응답 실패');
        const view = (await res.json()) as AssetCashPairView;
        if (alive) setLoad({ state: 'done', view });
      })
      .catch(() => alive && setLoad({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [section]);

  const view = load.state === 'done' ? load.view : null;
  const pair = view?.enabled ? view.pair : null;
  const usd = currency === 'USD';
  const fx = view?.usdKrw ?? null;
  const auto = qty > 0 && price > 0 && (!usd || fx != null) ? Math.round(qty * price * (usd ? (fx as number) : 1)) : null;

  // 고치지 않았으면 수량 · 가격 · 환율을 따라간다
  useEffect(() => {
    if (!edited) setText(auto == null ? '' : String(auto));
  }, [auto, edited]);

  const amount = text === '' ? null : Number(text);
  useEffect(() => {
    if (load.state === 'loading') onValue({ send: null, ready: false });
    else if (!pair) onValue({ send: null, ready: true });
    else onValue({ send: amount, ready: amount != null && Number.isInteger(amount) && amount >= 0 });
    // onValue 는 부르는 쪽이 매번 새로 만든다 — 값이 바뀔 때만 알린다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.state, pair, amount]);

  if (load.state === 'loading') {
    return (
      <div className="flex min-h-5 items-center gap-2 text-caption text-text-muted" data-testid="asset-cash-trade" data-cash-state="loading">
        <InlineSpinner />
        <span>예수금 줄 확인 중…</span>
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <p className="text-caption text-text-muted keep-all" data-testid="asset-cash-trade" data-cash-state="error">
        예수금 줄 짝을 확인하지 못했어요 — 예수금은 바꾸지 않습니다.
      </p>
    );
  }
  if (!pair) {
    return (
      <p className="text-caption text-text-muted keep-all" data-testid="asset-cash-trade" data-cash-state={view?.enabled ? 'no-pair' : 'off'}>
        {view?.enabled ? '설정에서 예수금 줄 짝을 정하면 예수금도 함께 바뀝니다.' : '「현금 자동 반영」 을 켜고 예수금 줄 짝을 정하면 예수금도 함께 바뀝니다.'}
      </p>
    );
  }

  const verb = side === 'buy' ? '줄어듭니다' : '늘어납니다';
  return (
    <div className="space-y-1 rounded-lg bg-bg-tertiary/40 px-3 py-2" data-testid="asset-cash-trade" data-cash-state="pair">
      <p className="flex min-w-0 items-baseline gap-1 text-xs text-text-primary" data-testid="asset-cash-trade-preview">
        <span className="min-w-0 truncate" data-tip-clip={pair.label}>
          {pair.label}
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {amount != null && amount > 0 ? `${formatAssetWon(amount)} ${verb}` : '바꾸지 않습니다'}
        </span>
      </p>
      <FormRow label="예수금 금액" labelW="sm" error={amount == null ? '금액을 넣어 주세요(0 이면 예수금은 바꾸지 않습니다)' : undefined}>
        <NumberField
          kind="long"
          thousands
          decimals={0}
          unit="원"
          max={ASSET_CASH_MAX}
          value={text}
          invalid={amount == null}
          onValue={(v) => {
            setEdited(true);
            setText(v);
          }}
          aria-label="예수금 금액"
          data-testid="asset-cash-trade-amount"
        />
      </FormRow>
      {usd && (
        <p className="text-caption text-text-muted" data-testid="asset-cash-trade-fx">
          {fx != null ? `환율 ${fxText(fx)} 기준 · 고칠 수 있어요` : '환율을 받지 못했어요 — 금액을 넣어 주세요'}
        </p>
      )}
    </div>
  );
}
