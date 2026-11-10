import { useState } from 'react';
import { Button, Dialog, FormRow, NumberField, NumberUnitGroup } from '../ui';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { modal } from '../../store/uiStore';
import { TRADE_DIGITS, decimalPlaces } from '../../utils/assetTrade';
import { tradeAfter } from '../../utils/assetAverage';
import type { AssetCurrency, AssetHolding, AssetSection, AssetTradeRequest, AssetTradeSide } from '../../types/asset';

/**
 * 매수 · 매도 입력 창(v2.66.0 — 시트에 줄이 있는 종목의 매수 · 일부 매도 · v2.67.0 모두 매도). 실제 주문은 없다 — 다른 증권사에서 사고판 것을 적는 창이다.
 * - 미리 보기는 서버와 같은 계산(`src/utils/assetAverage.ts` — 평균 식 한 곳). 저장은 `POST /api/asset/trade` — 검사는 서버 `recordTrade` 한 곳.
 * - 미국 매수는 환율을 받지 않는다 — 원화 매입 금액은 시트 「달러 환전」 탭이 계산(안내 한 줄 · v2.66.2).
 * - 모두 매도 수량 = 미리 보기에 「이 줄을 지웁니다」 · [저장] 뒤 확인 창 한 번(시트에서 보유 줄을 지운다 · 「티커」 줄은 남김). 쓰기 스위치 꺼짐 = 안내 + [저장] 막음. 아직 모르면(요약 응답 전) 글 없이 막음.
 * - 바깥 클릭으로 닫지 않는다(입력을 잃는다).
 */

/** 수량 — 쉼표 · 있는 소수만(6자리까지) */
export const tradeQtyText = (n: number) => formatNumber(n, Math.min(6, decimalPlaces(n)));
/** 가격 · 평균가 — 국내 원 · 미국 달러(소수 2~4자리) */
export const tradeMoneyText = (n: number, currency: AssetCurrency) => (currency === 'KRW' ? formatPrice(n, 'KRW') : `$${formatNumber(n, Math.max(2, Math.min(4, decimalPlaces(n))))}`);
export const tradeFxText = (n: number) => `₩${formatNumber(n, 2)}`;

const SIDE_LABEL: Record<AssetTradeSide, string> = { buy: '매수', sell: '매도' };

export default function AssetTradeDialog({
  section,
  holding,
  side,
  writeEnabled,
  onSend,
  onSaved,
  onClose,
}: {
  section: AssetSection;
  holding: AssetHolding;
  side: AssetTradeSide;
  /** 이 서버에서 시트 쓰기가 켜져 있나 — 아직 모르면 null */
  writeEnabled: boolean | null;
  /** 저장 — 실패 이유 또는 null */
  onSend: (req: AssetTradeRequest) => Promise<string | null>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = holding.currency;
  const digits = TRADE_DIGITS[currency];
  const beforeQty = holding.quantity as number;
  const beforeAvg = holding.avgPrice as number;
  const usBuy = side === 'buy' && currency === 'USD';

  const qtyN = Number(qty);
  const priceN = Number(price);
  const filled = qty !== '' && price !== '' && qtyN > 0 && priceN > 0;
  const sameAsHeld = side === 'sell' && qty !== '' && Math.abs(qtyN - beforeQty) < 1e-9;
  const over = side === 'sell' && qty !== '' && qtyN > beforeQty && !sameAsHeld;

  const after = filled && !over ? tradeAfter({ side, currency, beforeQty, beforeAvg, qty: qtyN, price: priceN }) : null;
  const canSave = writeEnabled === true && after != null && !busy;

  /** 모두 매도는 시트에서 줄을 지우므로 한 번 더 묻는다 */
  const askSave = () => {
    if (!canSave) return;
    if (!sameAsHeld) return void save();
    modal.confirm({
      title: '모두 매도',
      message: `「${section.key}」 의 이 종목 줄을 시트에서 지웁니다(「티커」 줄은 남깁니다). 되돌리려면 시트의 버전 기록을 써야 합니다.`,
      confirmText: '지우기',
      onConfirm: save,
    });
  };

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const message = await onSend({
      section: section.key as string,
      row: holding.row,
      side,
      qty: qtyN,
      price: priceN,
      expect: { name: holding.name, code: holding.code as string, quantity: beforeQty, avgPrice: beforeAvg },
    });
    setBusy(false);
    if (message) setError(message);
    else onSaved();
  };

  return (
    <Dialog
      title={`${SIDE_LABEL[side]} 입력`}
      titleAside="다른 증권사에서 사고판 것을 적어 시트를 갱신합니다"
      onClose={() => !busy && onClose()}
      closeOnBackdrop={false}
      size="md"
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose} data-trade-cancel>
            취소
          </Button>
          <Button variant={side} busy={busy} disabled={!canSave} onClick={askSave} data-trade-save>
            저장
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-trade-dialog={side}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-text-muted">종목</dt>
          {/* 긴 이름만 말줄임 · 티커는 자르지 않는다(v2.68.0 캡처 검토) */}
          <dd className="flex min-w-0 items-baseline gap-2 text-text-primary">
            <span className="min-w-0 truncate" title={holding.name}>
              {holding.name}
            </span>
            <span className="shrink-0 text-caption text-text-muted" data-trade-symbol>{holding.symbol}</span>
          </dd>
          <dt className="text-text-muted">계좌</dt>
          <dd className="min-w-0 truncate text-text-primary" title={section.name}>
            {section.name}
          </dd>
          <dt className="text-text-muted">지금 수량</dt>
          <dd className="text-text-primary tabular-nums" data-trade-now-qty>
            {tradeQtyText(beforeQty)}주
          </dd>
          <dt className="text-text-muted">지금 평균가</dt>
          <dd className="text-text-primary tabular-nums" data-trade-now-avg>
            {tradeMoneyText(beforeAvg, currency)}
          </dd>
        </dl>

        <NumberUnitGroup w="sm">
          <div className="space-y-2">
            <FormRow label="수량" error={over ? '가진 수량보다 많아요' : undefined}>
              <NumberField kind="long" thousands decimals={digits.qty} unit="주" value={qty} onValue={setQty} invalid={over} aria-label="수량" data-trade-qty autoFocus />
            </FormRow>
            <FormRow label="가격">
              <NumberField kind="long" thousands decimals={digits.price} unit={currency === 'KRW' ? '원' : '$'} value={price} onValue={setPrice} aria-label="가격" data-trade-price />
            </FormRow>
          </div>
        </NumberUnitGroup>
        {usBuy && (
          <p className="text-caption text-text-muted keep-all" data-trade-fx-note>
            원화 매입 금액은 시트 「달러 환전」 탭의 구매 평균 환율로 계산돼요
          </p>
        )}

        {!over && (
        <div className="min-h-9 space-y-0.5 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs tabular-nums text-text-primary" data-trade-preview>
          {after == null ? (
            <span className="text-text-muted">수량과 가격을 넣으면 결과가 여기에 보입니다.</span>
          ) : (
            <div data-trade-preview-main {...(sameAsHeld ? { 'data-trade-sell-all': true } : {})}>
              {side === 'buy'
                ? `사고 나면 ${tradeQtyText(after.afterQty)}주 · 평균 ${tradeMoneyText(after.afterAvg, currency)}`
                : sameAsHeld
                  ? '팔고 나면 0주 — 시트에서 이 줄을 지웁니다(「티커」 줄은 남김)'
                  : `팔고 나면 ${tradeQtyText(after.afterQty)}주 · 평균 그대로`}
            </div>
          )}
        </div>
        )}

        {writeEnabled === false && (
          <p className="text-caption text-text-muted keep-all" data-trade-write-off>
            이 서버에서는 시트 쓰기가 꺼져 있습니다.
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-trade-error>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
