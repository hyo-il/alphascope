import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Dialog, FormRow, ListRemoveButton, NumberField, NumberUnitGroup, Tabs, type TabItem } from '../ui';
import { Skeleton } from '../common/SkeletonLoader';
import { changeColor, formatSigned } from '../../utils/formatters';
import { TRADE_DIGITS, TRADE_MAX, roundTo } from '../../utils/assetTrade';
import { addBuys, buysToTarget, type AverageHolding } from '../../utils/assetAverage';
import { formatAssetPrice, formatAssetQty } from '../../utils/assetFormat';
import type { AssetHolding, AssetSection } from '../../types/asset';

/**
 * 평단 계산기(v2.68.0 · v2.68.1 이름 · 탭 · 차수 · v2.68.2 결과를 위로) — 가진 종목을 「얼마에 몇 주 더 사면 평균 단가가 얼마가 되나」 계산만 한다.
 * - **계산만**: 저장 · 시트 쓰기 · 기록 · 주문 · 서버 요청 없음. 입력은 이 창 안에만 있고 닫으면 사라진다(다시 열면 첫 줄 지금 가격만).
 * - 탭 「더 사면 평단은?」 | 「목표 평단까지」(공용 `Tabs`) — 처음은 늘 첫째 탭(기억하지 않음) · 탭을 바꿔도 두 탭 값은 창을 닫기 전까지 남는다.
 *   두 탭 내용을 같은 칸에 겹쳐 두고 고르지 않은 쪽은 숨긴다(`invisible` — 초점 · 클릭에서도 빠진다) — 창 높이 = 더 긴 탭(탭을 바꿔도 흔들리지 않음 · 길면 창 안 스크롤).
 * - 「더 살 것」 = 구매 단계 「1차 매수 · 2차 매수 · …」(최대 `MAX_STEPS` · 다 차면 [+ n차 매수] 숨김) · 지우기는 마지막 차수만(1차는 지우지 않음 — 번호가 섞이지 않게).
 * - 평균 식은 `src/utils/assetAverage.ts` 한 곳(매수 창 미리 보기 · 서버 `recordTrade` 와 같은 함수 — 여러 줄은 한 줄씩 차례로 더한다).
 * - 지금 가격 = 「자산 현황」 이 계산에 쓴 summary 의 가격(미국은 달러) — 새 가격 요청 없음. 받기 전에는 뼈대 · 못 받았으면 「지금 가격 없음」.
 *   첫 줄 가격 칸에 지금 가격을 미리 넣는다(가격이 늦게 오면 그 칸을 아직 건드리지 않았을 때만 넣는다).
 * - 두 탭 모두 「탭 → 결과 상자 → 입력」 순서(v2.68.2). 「더 사면 평단은?」 결과 상자는 창 안 스크롤 맨 위에 붙어(sticky) 5차까지 넣고 아래 칸을 써도 보인다. 결과가 없을 때도 결과 줄 자리를 잡아
 *   (보이지 않게 그리고 안내 글을 겹침) 값을 넣는 순간 아래 입력 칸이 밀리지 않는다.
 * - 숫자 표시는 `src/utils/assetFormat.ts` 한 곳(국내 원 정수 · 미국 $ 소수 2자리 · 수량 「30주」 · 「0.5주」) — 표 · 매수 창과 같다.
 *   「목표 평단까지」 필요 수량은 계산(6자리)은 그대로 · 보이는 것만 소수 2자리 **올림**. 미국은 원화 환산을 보이지 않는다.
 */

interface Line {
  id: number;
  price: string;
  qty: string;
}

/** 구매 단계 최대 차수 */
const MAX_STEPS = 5;

type CalcTab = 'more' | 'target';
const TABS: TabItem<CalcTab>[] = [
  { id: 'more', label: '더 사면 평단은?' },
  { id: 'target', label: '목표 평단까지' },
];

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

  const [tab, setTab] = useState<CalcTab>('more');
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
  const addLine = () => setLines((ls) => (ls.length < MAX_STEPS ? [...ls, { id: nextId.current++, price: '', qty: '' }] : ls));
  /** 마지막 차수만 지운다(1차는 남김) */
  const removeLast = () => setLines((ls) => (ls.length > 1 ? ls.slice(0, -1) : ls));

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
      title="평단 계산기"
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
            {formatAssetQty(base.qty)}
          </dd>
          <dt className="text-text-muted">지금 평균 단가</dt>
          <dd className="text-text-primary tabular-nums" data-avgcalc-now-avg>
            {formatAssetPrice(base.avg, currency)}
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
              formatAssetPrice(price, currency)
            )}
          </dd>
        </dl>

        <Tabs items={TABS} value={tab} onChange={setTab} size="sm" label="평단 계산기 탭" />

        {/* 두 탭을 같은 칸에 겹친다 — 창 높이 = 더 긴 탭(탭을 바꿔도 같음) */}
        <div className="grid">
          <div className={`col-start-1 row-start-1 space-y-4 ${tab === 'more' ? '' : 'invisible'}`} role="tabpanel" aria-label="더 사면 평단은?" data-avgcalc-panel="more">
            {/* 결과 — 위. 창 안을 스크롤해도 맨 위에 붙어 있다(창 바탕으로 아래 칸을 가림 · 크롬은 붙는 위치를 몸통 여백 안쪽으로 재서 -16px) ·
                결과가 없어도 네 줄 자리를 잡는다(보이지 않는 「—」 줄 + 안내 글 겹침) */}
            <div className="sticky -top-4 z-10 -mt-2 mb-2 bg-bg-secondary pt-2 pb-2" data-avgcalc-result-pin>
            <div className="relative space-y-1 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs tabular-nums text-text-primary" data-avgcalc-result>
              <dl className={`grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 ${result == null ? 'invisible' : ''}`} aria-hidden={result == null}>
                <dt className="text-text-muted">새 평균 단가</dt>
                <dd className="font-semibold" {...(result ? { 'data-avgcalc-new-avg': '' } : {})}>
                  {result ? formatAssetPrice(result.newAvg, currency) : '—'}
                </dd>
                <dt className="text-text-muted">총 수량</dt>
                <dd {...(result ? { 'data-avgcalc-new-qty': '' } : {})}>{result ? formatAssetQty(result.newQty) : '—'}</dd>
                <dt className="text-text-muted">더 드는 돈</dt>
                <dd {...(result ? { 'data-avgcalc-cost': '' } : {})}>{result ? formatAssetPrice(result.extraCost, currency) : '—'}</dd>
                <dt className="text-text-muted">수익률(지금 가격 기준)</dt>
                <dd data-avgcalc-return>
                  {result ? (
                    <>
                      <ReturnText value={result.returnBefore} data="data-avgcalc-return-before" />
                      <span className="mx-1.5 text-text-muted">→</span>
                      <ReturnText value={result.returnAfter} data="data-avgcalc-return-after" />
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </dl>
              {result == null && <span className="absolute inset-x-3 top-2 text-text-muted">가격과 수량을 넣으면 결과가 여기에 보입니다.</span>}
              {result != null && skipped > 0 && (
                <p className="text-caption text-text-muted keep-all" data-avgcalc-skipped>
                  가격이나 수량이 빈 차수 {skipped}개는 빼고 계산했어요
                </p>
              )}
            </div>
            </div>

            <section className="space-y-2" aria-label="더 살 것">
              <h3 className="text-xs font-semibold text-text-primary">더 살 것</h3>
              <NumberUnitGroup w="sm">
                <div className="space-y-3">
                  {lines.map((l, i) => {
                    const step = `${i + 1}차 매수`;
                    return (
                      <div key={l.id} className="space-y-1.5" data-avgcalc-line={i}>
                        <div className="flex items-center gap-2">
                          <span className="text-caption text-text-muted" data-avgcalc-step>{step}</span>
                          {i > 0 && i === lines.length - 1 && <ListRemoveButton label="삭제" name={step} onClick={removeLast} />}
                        </div>
                        <FormRow label="가격">
                          <NumberField kind="fill" thousands decimals={digits.price} max={TRADE_MAX.price} unit={unit} value={l.price} onValue={(v) => setLine(l.id, { price: v })} aria-label={`${step} 가격`} data-avgcalc-price />
                        </FormRow>
                        <FormRow label="수량">
                          <NumberField kind="fill" thousands decimals={digits.qty} max={TRADE_MAX.qty} unit="주" value={l.qty} onValue={(v) => setLine(l.id, { qty: v })} aria-label={`${step} 수량`} data-avgcalc-qty autoFocus={i === 0} />
                        </FormRow>
                      </div>
                    );
                  })}
                </div>
              </NumberUnitGroup>
              {lines.length < MAX_STEPS && (
                <Button size="sm" icon={Plus} onClick={addLine} data-avgcalc-add>
                  {lines.length + 1}차 매수
                </Button>
              )}
            </section>
          </div>

          <div className={`col-start-1 row-start-1 space-y-4 ${tab === 'target' ? '' : 'invisible'}`} role="tabpanel" aria-label="목표 평단까지" data-avgcalc-panel="target">
            {/* 결과 — 위(필요 수량 · 돈 · 안 됨 안내). 두 줄 자리를 잡아 글이 바뀌어도 아래 칸이 덜 움직인다 */}
            <div className="min-h-12 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs tabular-nums text-text-primary keep-all" data-avgcalc-target-result>
              {reverse == null ? (
                <span className="text-text-muted">목표 평균 단가를 넣으면 결과가 여기에 보입니다.</span>
              ) : (
                <p data-avgcalc-reverse={reverse.ok ? 'ok' : reverse.reason}>
                  {reverse.ok
                    ? `지금 가격 ${formatAssetPrice(price as number, currency)}에 ${formatAssetQty(reverse.qty, { ceil: true })} 더 사면 됩니다(${formatAssetPrice(reverse.cost, currency)} 필요)`
                    : reverse.reason === 'price-too-high'
                      ? '지금 가격으로는 목표까지 낮출 수 없어요'
                      : reverse.reason === 'above-avg'
                        ? '목표 평균 단가는 지금 평균 단가보다 낮아야 해요'
                        : '지금 가격이 없어 계산할 수 없어요'}
                </p>
              )}
            </div>
            <section className="space-y-2" aria-label="목표 평균 단가">
              <NumberUnitGroup w="sm">
                <FormRow label="목표 평균 단가">
                  <NumberField kind="fill" thousands decimals={digits.price} max={TRADE_MAX.price} unit={unit} value={target} onValue={setTarget} aria-label="목표 평균 단가" data-avgcalc-target />
                </FormRow>
              </NumberUnitGroup>
            </section>
          </div>
        </div>

        <p className="text-caption text-text-muted" data-avgcalc-note>
          계산만 해요 — 시트에 쓰지 않습니다
        </p>
      </div>
    </Dialog>
  );
}
