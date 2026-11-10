import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Dialog, FormRow, ListRemoveButton, NumberField, NumberUnitGroup } from '../ui';
import { Skeleton } from '../common/SkeletonLoader';
import { changeColor, formatNumber, formatSigned } from '../../utils/formatters';
import { TRADE_DIGITS, TRADE_MAX, roundTo } from '../../utils/assetTrade';
import { addBuys, buysToTarget, type AverageHolding } from '../../utils/assetAverage';
import { tradeMoneyText, tradeQtyText } from './AssetTradeDialog';
import type { AssetHolding, AssetSection } from '../../types/asset';

/**
 * 물타기 계산기(v2.68.0) — 가진 종목을 「얼마에 몇 주 더 사면 평균 단가가 얼마가 되나」 계산만 한다.
 * - **계산만**: 저장 · 시트 쓰기 · 기록 · 주문 · 서버 요청 없음. 입력은 이 창 안에만 있고 닫으면 사라진다(다시 열면 첫 줄 지금 가격만).
 * - 평균 식은 `src/utils/assetAverage.ts` 한 곳(매수 창 미리 보기 · 서버 `recordTrade` 와 같은 함수 — 여러 줄은 한 줄씩 차례로 더한다).
 * - 지금 가격 = 「자산 현황」 이 계산에 쓴 summary 의 가격(미국은 달러) — 새 가격 요청 없음. 받기 전에는 뼈대 · 못 받았으면 「지금 가격 없음」.
 *   첫 줄 가격 칸에 지금 가격을 미리 넣는다(가격이 늦게 오면 그 칸을 아직 건드리지 않았을 때만 넣는다).
 * - 국내 원(정수 · 쉼표) · 미국 달러($ · 소수) — 매수 창과 같은 표시 함수. 미국은 원화 환산을 보이지 않는다.
 */

interface Line {
  id: number;
  price: string;
  qty: string;
}

/** 돈(더 드는 돈 · 필요한 돈) — 국내 원 · 미국 달러는 소수 2자리로 맞춘다(평균 단가 · 가격은 매수 창과 같은 `tradeMoneyText`) */
const costText = (n: number, currency: AssetHolding['currency']) => (currency === 'KRW' ? tradeMoneyText(n, currency) : `$${formatNumber(n, 2)}`);

/** 수익률 — 「−12.3%」(소수 한 자리 · 부호) */
const pctText = (r: number) => formatSigned(r * 100, 1, '%');

function ReturnText({ value, data }: { value: number | null; data: string }) {
  if (value == null) return <span className="text-text-muted" {...{ [data]: '' }}>—</span>;
  return (
    <span className={changeColor(Math.round(value * 1000))} {...{ [data]: '' }}>
      {pctText(value)}
    </span>
  );
}

export default function AssetAverageCalculator({
  section,
  holding,
  price,
  onClose,
}: {
  section: AssetSection;
  holding: AssetHolding;
  /** 지금 가격(원래 통화) — 받는 중이면 undefined · 못 받았으면 null */
  price: number | null | undefined;
  onClose: () => void;
}) {
  const currency = holding.currency;
  const digits = TRADE_DIGITS[currency];
  const unit = currency === 'KRW' ? '원' : '$';
  const priceText = (p: number) => String(roundTo(p, digits.price));

  const nextId = useRef(2);
  const [lines, setLines] = useState<Line[]>(() => [{ id: 1, price: price != null ? priceText(price) : '', qty: '' }]);
  const [target, setTarget] = useState('');
  /** 첫 줄 가격 칸을 사용자가 건드렸나 — 건드렸으면 늦게 온 지금 가격으로 덮지 않는다 */
  const firstTouched = useRef(false);

  useEffect(() => {
    if (price == null || firstTouched.current) return;
    setLines((ls) => (ls[0].price === '' ? [{ ...ls[0], price: priceText(price) }, ...ls.slice(1)] : ls));
  }, [price]); // 가격이 처음 올 때만(그 뒤 폴링으로 바뀌어도 칸은 그대로)

  const setLine = (id: number, patch: Partial<Line>) => {
    if (id === lines[0].id && patch.price !== undefined) firstTouched.current = true;
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLines((ls) => [...ls, { id: nextId.current++, price: '', qty: '' }]);
  const removeLine = (id: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

  const base: AverageHolding = { currency, qty: holding.quantity as number, avg: holding.avgPrice as number, price: price ?? null };
  const buys = lines.flatMap((l) => {
    const p = Number(l.price);
    const q = Number(l.qty);
    return l.price !== '' && l.qty !== '' && p > 0 && q > 0 ? [{ price: p, qty: q }] : [];
  });
  const skipped = lines.length - buys.length;
  const result = buys.length > 0 ? addBuys(base, buys) : null;

  const targetN = Number(target);
  const reverse = target !== '' && targetN > 0 && price !== undefined ? buysToTarget(base, targetN) : null;

  return (
    <Dialog
      title="물타기 계산기"
      titleAside="더 사면 평균 단가가 어떻게 되는지 계산합니다"
      onClose={onClose}
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose} data-avgcalc-close>
          닫기
        </Button>
      }
    >
      <div className="space-y-4" data-avgcalc>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          <dt className="text-text-muted">종목</dt>
          {/* 긴 이름만 말줄임 · 티커는 자르지 않는다 */}
          <dd className="flex min-w-0 items-baseline gap-2 text-text-primary">
            <span className="min-w-0 truncate" title={holding.name}>
              {holding.name}
            </span>
            {holding.symbol && <span className="shrink-0 text-caption text-text-muted" data-avgcalc-symbol>{holding.symbol}</span>}
          </dd>
          <dt className="text-text-muted">계좌</dt>
          <dd className="min-w-0 truncate text-text-primary" title={section.name}>
            {section.name}
          </dd>
          <dt className="text-text-muted">지금 수량</dt>
          <dd className="text-text-primary tabular-nums" data-avgcalc-now-qty>
            {tradeQtyText(base.qty)}주
          </dd>
          <dt className="text-text-muted">지금 평균 단가</dt>
          <dd className="text-text-primary tabular-nums" data-avgcalc-now-avg>
            {tradeMoneyText(base.avg, currency)}
          </dd>
          <dt className="text-text-muted">지금 가격</dt>
          <dd className="text-text-primary tabular-nums" data-avgcalc-now-price>
            {price === undefined ? (
              <Skeleton className="inline-block h-3.5 w-20 align-middle" />
            ) : price == null ? (
              <span className="text-text-muted" data-avgcalc-no-price>
                지금 가격 없음
              </span>
            ) : (
              tradeMoneyText(price, currency)
            )}
          </dd>
        </dl>

        <section className="space-y-2" aria-label="더 살 것">
          <h3 className="text-xs font-semibold text-text-primary">더 살 것</h3>
          <NumberUnitGroup w="sm">
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={l.id} className="space-y-1.5" data-avgcalc-line={i}>
                  <div className="flex items-center gap-2">
                    <span className="text-caption text-text-muted">{i + 1}번째</span>
                    {lines.length > 1 && <ListRemoveButton label="삭제" name={`${i + 1}번째 줄`} onClick={() => removeLine(l.id)} />}
                  </div>
                  <FormRow label="가격">
                    <NumberField kind="fill" thousands decimals={digits.price} max={TRADE_MAX.price} unit={unit} value={l.price} onValue={(v) => setLine(l.id, { price: v })} aria-label={`${i + 1}번째 가격`} data-avgcalc-price />
                  </FormRow>
                  <FormRow label="수량">
                    <NumberField kind="fill" thousands decimals={digits.qty} max={TRADE_MAX.qty} unit="주" value={l.qty} onValue={(v) => setLine(l.id, { qty: v })} aria-label={`${i + 1}번째 수량`} data-avgcalc-qty autoFocus={i === 0} />
                  </FormRow>
                </div>
              ))}
            </div>
          </NumberUnitGroup>
          <Button size="sm" icon={Plus} onClick={addLine} data-avgcalc-add>
            줄 추가
          </Button>
        </section>

        <div className="space-y-1 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs tabular-nums text-text-primary" data-avgcalc-result>
          {result == null ? (
            <span className="text-text-muted">가격과 수량을 넣으면 결과가 여기에 보입니다.</span>
          ) : (
            <>
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                <dt className="text-text-muted">새 평균 단가</dt>
                <dd className="font-semibold" data-avgcalc-new-avg>
                  {tradeMoneyText(result.newAvg, currency)}
                </dd>
                <dt className="text-text-muted">총 수량</dt>
                <dd data-avgcalc-new-qty>{tradeQtyText(result.newQty)}주</dd>
                <dt className="text-text-muted">더 드는 돈</dt>
                <dd data-avgcalc-cost>{costText(result.extraCost, currency)}</dd>
                <dt className="text-text-muted">수익률(지금 가격 기준)</dt>
                <dd data-avgcalc-return>
                  <ReturnText value={result.returnBefore} data="data-avgcalc-return-before" />
                  <span className="mx-1.5 text-text-muted">→</span>
                  <ReturnText value={result.returnAfter} data="data-avgcalc-return-after" />
                </dd>
              </dl>
              {skipped > 0 && (
                <p className="text-caption text-text-muted keep-all" data-avgcalc-skipped>
                  가격이나 수량이 빈 줄 {skipped}개는 빼고 계산했어요
                </p>
              )}
            </>
          )}
        </div>

        <section className="space-y-2" aria-label="목표 평균 단가">
          <NumberUnitGroup w="sm">
            <FormRow label="목표 평균 단가">
              <NumberField kind="fill" thousands decimals={digits.price} max={TRADE_MAX.price} unit={unit} value={target} onValue={setTarget} aria-label="목표 평균 단가" data-avgcalc-target />
            </FormRow>
          </NumberUnitGroup>
          {reverse && (
            <p className="text-xs tabular-nums text-text-primary keep-all" data-avgcalc-reverse={reverse.ok ? 'ok' : reverse.reason}>
              {reverse.ok
                ? `지금 가격 ${tradeMoneyText(price as number, currency)}에 ${tradeQtyText(reverse.qty)}주 더 사면 됩니다(${costText(reverse.cost, currency)} 필요)`
                : reverse.reason === 'price-too-high'
                  ? '지금 가격으로는 목표까지 낮출 수 없어요'
                  : reverse.reason === 'above-avg'
                    ? '목표 평균 단가는 지금 평균 단가보다 낮아야 해요'
                    : '지금 가격이 없어 계산할 수 없어요'}
            </p>
          )}
        </section>

        <p className="text-caption text-text-muted" data-avgcalc-note>
          계산만 해요 — 시트에 쓰지 않습니다
        </p>
      </div>
    </Dialog>
  );
}
