import { useRef, useState } from 'react';
import { Badge, Button, Dialog, FormRow, NumberField, NumberUnitGroup, Select } from '../ui';
import SymbolSearch from '../common/SymbolSearch';
import { InlineSpinner } from '../common/LoadingOverlay';
import { TRADE_DIGITS, tradeAfter } from '../../utils/assetTrade';
import { tradeMoneyText, tradeQtyText } from './AssetTradeDialog';
import { ASSET_CLASSES, RATIO_TAB_NOTICE, UNASSIGNED_LABEL, US_CODE_PREFIXES, type AssetClass, type AssetCurrency, type AssetNewHoldingPlan, type AssetNewHoldingRequest, type AssetNewHoldingTarget, type AssetSection, type AssetUsPrefix } from '../../types/asset';
import type { StockSearchResult } from '../../types/toss';

/**
 * 새 종목 매수 창(v2.67.0) — 다른 증권사에서 산 새 종목을 적으면 시트에 줄을 넣고 「티커」 에 종목을 더한다(실제 주문 없음).
 * - 첫 화면: 계좌 · 종목 검색(종목 목록) · 수량 · 가격(국내 원 · 미국 달러) · 자산 분류. [다음] → 서버가 시트를 읽어 어디에 쓸지 돌려준다(시트를 바꾸지 않음).
 * - 종목 칸(v2.67.2): 버튼 없이 글자를 치면 목록이 뜨고 누르거나 Enter(맨 위)로 고른다(`SymbolSearch` `hideSubmit`). 칸은 모두 같은 왼쪽 끝 — 값 칸(`lg`)을 채운다.
 * - 확인 화면: 어느 줄에 쓰는지 · 코드(미국은 앞부분을 바꿀 수 있음) · 적립식 계좌면 합친 표 안내 · 새 줄이면 비율 탭 안내 → [저장] · [뒤로].
 * - 그 계좌에 이미 있는 종목이면 새 줄 없이 매수로 더한다(확인 화면에 알림). 검사는 서버 `recordNewHolding` 한 곳.
 * - 바깥 클릭으로 닫지 않는다(입력을 잃는다).
 */

const US_LISTINGS = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const CLASS_OPTIONS: { value: AssetClass | ''; label: string }[] = [{ value: '', label: UNASSIGNED_LABEL }, ...ASSET_CLASSES.map((c) => ({ value: c, label: c }))];
const SPOT_LABEL: Record<AssetNewHoldingPlan['ticker']['status'], string> = { blank: '빈 줄', insert: '새 줄', existing: '이미 있음' };

export default function AssetNewBuyDialog({
  sections,
  writeEnabled,
  onPlan,
  onSend,
  onSaved,
  onClose,
}: {
  sections: AssetSection[];
  /** 이 서버에서 시트 쓰기가 켜져 있나 — 아직 모르면 null */
  writeEnabled: boolean | null;
  /** 어디에 쓸지 — 실패면 이유 글자 */
  onPlan: (target: AssetNewHoldingTarget) => Promise<AssetNewHoldingPlan | string>;
  /** 저장 — 실패 이유 또는 null */
  onSend: (req: AssetNewHoldingRequest) => Promise<string | null>;
  onSaved: () => void;
  onClose: () => void;
}) {
  const accounts = sections.filter((s) => !s.combined && s.key);
  const [section, setSection] = useState(accounts[0]?.key ?? '');
  const [stock, setStock] = useState<StockSearchResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [assetClass, setAssetClass] = useState<AssetClass | ''>('');
  const [plan, setPlan] = useState<AssetNewHoldingPlan | null>(null);
  const [prefix, setPrefix] = useState<AssetUsPrefix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookId = useRef(0);

  const currency: AssetCurrency = stock && US_LISTINGS.has(stock.market) ? 'USD' : 'KRW';
  const digits = TRADE_DIGITS[currency];
  const qtyN = Number(qty);
  const priceN = Number(price);
  const filled = stock != null && section !== '' && qty !== '' && price !== '' && qtyN > 0 && priceN > 0;

  /** 검색에서 고른 코드 → 종목 목록의 이름 · 시장 */
  const choose = async (symbol: string) => {
    const id = ++lookId.current;
    setLooking(true);
    setLookError(null);
    try {
      const res = await fetch(`/api/stocks/info?symbol=${encodeURIComponent(symbol)}`);
      const body = (await res.json().catch(() => ({}))) as { stock?: StockSearchResult | null };
      if (id !== lookId.current) return;
      if (!res.ok) throw new Error('응답 실패');
      if (!body.stock) {
        setStock(null);
        setLookError('종목 목록에 없는 코드입니다 — 검색 결과에서 골라 주세요.');
      } else {
        const wasUs = stock != null && US_LISTINGS.has(stock.market);
        if (wasUs !== US_LISTINGS.has(body.stock.market)) setPrice(''); // 원 ↔ 달러가 바뀌면 가격을 비운다
        setStock(body.stock);
      }
    } catch {
      if (id === lookId.current) setLookError('종목을 찾지 못했습니다(서버 응답 없음).');
    } finally {
      if (id === lookId.current) setLooking(false);
    }
  };

  const toConfirm = async () => {
    if (!filled || !stock || writeEnabled !== true) return;
    setBusy(true);
    setError(null);
    const got = await onPlan({ section, symbol: stock.symbol, exchange: null });
    setBusy(false);
    if (typeof got === 'string') setError(got);
    else {
      setPlan(got);
      setPrefix(got.prefix);
    }
  };

  const save = async () => {
    if (!plan || !stock) return;
    setBusy(true);
    setError(null);
    const message = await onSend({ section, symbol: stock.symbol, exchange: plan.market === 'US' ? prefix : null, qty: qtyN, price: priceN, assetClass });
    setBusy(false);
    if (message) setError(message);
    else onSaved();
  };

  const shownCode = plan ? (plan.prefixEditable && prefix ? `${prefix}:${plan.symbol}` : plan.code) : '';
  const afterBuy = plan?.existing && plan.existing.quantity != null && plan.existing.avgPrice != null ? tradeAfter({ side: 'buy', currency: plan.currency, beforeQty: plan.existing.quantity, beforeAvg: plan.existing.avgPrice, qty: qtyN, price: priceN }) : null;

  return (
    <Dialog
      title="새 종목 매수"
      titleAside="다른 증권사에서 산 종목을 시트에 적습니다"
      onClose={() => !busy && onClose()}
      closeOnBackdrop={false}
      size="md"
      footer={
        plan ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => { setPlan(null); setError(null); }} data-newbuy-back>
              뒤로
            </Button>
            <Button variant="buy" busy={busy} onClick={() => void save()} data-newbuy-save>
              저장
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={busy} onClick={onClose} data-newbuy-cancel>
              취소
            </Button>
            <Button variant="primary" busy={busy} disabled={!filled || writeEnabled !== true || looking} onClick={() => void toConfirm()} data-newbuy-next>
              다음
            </Button>
          </>
        )
      }
    >
      {plan ? (
        <div className="space-y-3" data-newbuy-confirm>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
            <dt className="text-text-muted">종목</dt>
            <dd className="min-w-0 truncate text-text-primary" title={plan.name}>
              {plan.name}
              <span className="ml-2 text-caption text-text-muted">{plan.symbol}</span>
            </dd>
            <dt className="text-text-muted">계좌</dt>
            <dd className="min-w-0 truncate text-text-primary">{plan.section}</dd>
            <dt className="text-text-muted">수량</dt>
            <dd className="text-text-primary tabular-nums">{tradeQtyText(qtyN)}주</dd>
            <dt className="text-text-muted">가격</dt>
            <dd className="text-text-primary tabular-nums">{tradeMoneyText(priceN, plan.currency)}</dd>
            {!plan.existing && (
              <>
                <dt className="text-text-muted">자산 분류</dt>
                <dd className="text-text-primary">{plan.ticker.status === 'existing' ? '「티커」 줄의 분류 그대로' : assetClass || UNASSIGNED_LABEL}</dd>
              </>
            )}
          </dl>

          {plan.existing ? (
            <div className="space-y-0.5 rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs text-text-primary" data-newbuy-existing>
              <div>이미 가진 종목 — 매수로 더합니다</div>
              {afterBuy && <div className="tabular-nums" data-newbuy-after>{`사고 나면 ${tradeQtyText(afterBuy.afterQty)}주 · 평균 ${tradeMoneyText(afterBuy.afterAvg, plan.currency)}`}</div>}
            </div>
          ) : (
            <p className="rounded-lg bg-bg-tertiary/40 px-3 py-2 text-xs text-text-primary keep-all" data-newbuy-where>
              「{plan.section}」 맨 아래에 줄을 넣고, 「티커」 「{plan.ticker.group}」 묶음 {plan.ticker.row}행({SPOT_LABEL[plan.ticker.status]})에 씁니다 · 코드 <span className="tabular-nums">{shownCode}</span>
            </p>
          )}

          {plan.prefixEditable && (
            <FormRow label="미국 코드 앞부분" labelW="sm">
              <Select className="w-full" aria-label="미국 코드 앞부분" value={prefix ?? ''} onChange={(e) => setPrefix(e.target.value as AssetUsPrefix)} data-newbuy-prefix>
                {US_CODE_PREFIXES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </FormRow>
          )}
          {!plan.existing && (
            <div className="space-y-0.5">
              {plan.notice && (
                <p className="text-caption text-text-muted keep-all" data-newbuy-notice>
                  {plan.notice}
                </p>
              )}
              <p className="text-caption text-text-muted keep-all" data-newbuy-ratio-notice>
                {RATIO_TAB_NOTICE}
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-newbuy-error>
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-newbuy-form>
          <FormRow label="계좌" labelW="sm" valueW="lg">
            <Select className="w-full" aria-label="계좌" value={section} onChange={(e) => setSection(e.target.value)} data-newbuy-section>
              {accounts.map((s) => (
                <option key={s.key} value={s.key as string}>
                  {s.key}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="종목" labelW="sm" valueW="lg" error={lookError ?? undefined}>
            <div className="w-full" data-newbuy-search>
              <SymbolSearch symbol="" onSubmit={(s) => void choose(s)} placeholder="종목 이름이나 티커를 입력하세요" hideSubmit compact dropUp={false} clearOnSubmit autoFocus />
            </div>
          </FormRow>
          <div className="flex min-h-5 items-center gap-2 text-xs" data-newbuy-chosen>
            {looking ? (
              <>
                <InlineSpinner />
                <span className="text-text-muted">찾는 중…</span>
              </>
            ) : stock ? (
              <>
                <span className="min-w-0 truncate text-text-primary" title={stock.name}>
                  {stock.name}
                </span>
                <span className="text-caption text-text-muted">{stock.symbol}</span>
                <Badge>{US_LISTINGS.has(stock.market) ? '미국' : '국내'}</Badge>
              </>
            ) : (
              <span className="text-text-muted">검색에서 종목을 고르면 여기에 보입니다.</span>
            )}
          </div>

          <NumberUnitGroup w="sm">
            <div className="space-y-3">
              <FormRow label="수량" labelW="sm" valueW="lg">
                <NumberField kind="fill" thousands decimals={digits.qty} unit="주" value={qty} onValue={setQty} aria-label="수량" data-newbuy-qty />
              </FormRow>
              <FormRow label="가격" labelW="sm" valueW="lg">
                <NumberField kind="fill" thousands decimals={digits.price} unit={currency === 'KRW' ? '원' : '$'} value={price} onValue={setPrice} aria-label="가격" data-newbuy-price />
              </FormRow>
            </div>
          </NumberUnitGroup>
          <FormRow label="자산 분류" labelW="sm" valueW="lg">
            <Select className="w-full" aria-label="자산 분류" value={assetClass} onChange={(e) => setAssetClass(e.target.value as AssetClass | '')} data-newbuy-class>
              {CLASS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormRow>

          {writeEnabled === false && (
            <p className="text-caption text-text-muted keep-all" data-newbuy-write-off>
              이 서버에서는 시트 쓰기가 꺼져 있습니다.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-newbuy-error>
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
