import { useState } from 'react';
import { Button, Dialog, FormRow, NumberField, NumberUnitGroup } from '../ui';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { TRADE_DIGITS, decimalPlaces, nextAvgFx, tradeAfter, usdCostOf } from '../../utils/assetTrade';
import type { AssetCurrency, AssetHolding, AssetSection, AssetSheetData, AssetTradeRequest, AssetTradeSide } from '../../types/asset';

/**
 * 매수 · 매도 입력 창(v2.66.0 · 1차 — 시트에 줄이 있는 종목의 매수 · 일부 매도). 실제 주문은 없다 — 다른 증권사에서 사고판 것을 적는 창이다.
 * - 미리 보기는 서버와 같은 계산(`src/utils/assetTrade.ts`). 저장은 `POST /api/asset/trade` — 검사는 서버 `recordTrade` 한 곳.
 * - 미국 매수만 환율 칸(비워도 됨). 시트의 구매 평균 환율 칸이 수식이거나 숫자가 아니면 칸 대신 안내(서버도 거절).
 * - 모두 매도 수량 = [저장] 대신 안내(119차). 쓰기 스위치 꺼짐 = 안내 + [저장] 막음. 아직 모르면(요약 응답 전) 글 없이 막음.
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
  data,
  writeEnabled,
  onSend,
  onSaved,
  onClose,
}: {
  section: AssetSection;
  holding: AssetHolding;
  side: AssetTradeSide;
  data: AssetSheetData;
  /** 이 서버에서 시트 쓰기가 켜져 있나 — 아직 모르면 null */
  writeEnabled: boolean | null;
  /** 저장 — 실패 이유 또는 null */
  onSend: (req: AssetTradeRequest) => Promise<string | null>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fx, setFx] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = holding.currency;
  const digits = TRADE_DIGITS[currency];
  const beforeQty = holding.quantity as number;
  const beforeAvg = holding.avgPrice as number;
  const usBuy = side === 'buy' && currency === 'USD';
  const fxLocked = data.avgFxFormula || data.avgFxRate == null;

  const qtyN = Number(qty);
  const priceN = Number(price);
  const fxN = fx === '' ? null : Number(fx);
  const filled = qty !== '' && price !== '' && qtyN > 0 && priceN > 0;
  const sameAsHeld = side === 'sell' && qty !== '' && Math.abs(qtyN - beforeQty) < 1e-9;
  const over = side === 'sell' && qty !== '' && qtyN > beforeQty && !sameAsHeld;
  const fxBad = usBuy && !fxLocked && fxN != null && !(fxN > 0);
  const sendFx = usBuy && !fxLocked && fxN != null && fxN > 0 ? fxN : null;

  const after = filled && !over && !sameAsHeld ? tradeAfter({ side, currency, beforeQty, beforeAvg, qty: qtyN, price: priceN }) : null;
  const fxAfter = after && sendFx != null ? nextAvgFx(data.avgFxRate as number, usdCostOf(data.sections), sendFx, qtyN * priceN) : null;
  const canSave = writeEnabled === true && after != null && !fxBad && !busy;

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
      ...(usBuy ? { fx: sendFx } : {}),
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
          {sameAsHeld ? (
            <span className="text-xs text-text-muted keep-all" data-trade-sell-all>
              모두 파는 것은 다음 업데이트에서 돼요
            </span>
          ) : (
            <Button variant="primary" busy={busy} disabled={!canSave} onClick={() => void save()} data-trade-save>
              저장
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3" data-trade-dialog={side}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-text-muted">종목</dt>
          <dd className="min-w-0 truncate text-text-primary" title={holding.name}>
            {holding.name}
            <span className="ml-2 text-caption text-text-muted">{holding.symbol}</span>
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
            <FormRow label={currency === 'KRW' ? '가격(원)' : '가격(달러)'}>
              <NumberField kind="long" thousands decimals={digits.price} unit={currency === 'KRW' ? '원' : '$'} value={price} onValue={setPrice} aria-label="가격" data-trade-price />
            </FormRow>
            {usBuy && !fxLocked && (
              <FormRow label="환율(선택)" hint="모르면 비워 두세요 — 구매 평균 환율은 그대로 둡니다">
                <NumberField kind="long" thousands decimals={2} unit="원" value={fx} onValue={setFx} aria-label="환율" data-trade-fx />
              </FormRow>
            )}
          </div>
        </NumberUnitGroup>
        {usBuy && fxLocked && (
          <p className="text-caption text-text-muted keep-all" data-trade-fx-locked>
            시트의 구매 평균 환율 칸이 수식이라 여기서 바꾸지 않습니다 — 수량 · 달러 평균가만 바뀝니다.
          </p>
        )}

        <div className="min-h-9 space-y-0.5 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs tabular-nums text-text-primary" data-trade-preview>
          {after == null ? (
            <span className="text-text-muted">수량과 가격을 넣으면 결과가 여기에 보입니다.</span>
          ) : (
            <>
              <div data-trade-preview-main>
                {side === 'buy' ? `사고 나면 ${tradeQtyText(after.afterQty)}주 · 평균 ${tradeMoneyText(after.afterAvg, currency)}` : `팔고 나면 ${tradeQtyText(after.afterQty)}주 · 평균 그대로`}
              </div>
              {fxAfter != null && (
                <div data-trade-preview-fx>
                  구매 평균 환율 {tradeFxText(data.avgFxRate as number)} → {tradeFxText(fxAfter)}
                </div>
              )}
            </>
          )}
        </div>

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
