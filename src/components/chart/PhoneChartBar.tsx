import { RotateCcw } from 'lucide-react';
import { Button, Chip, ScrollRow } from '../ui';
import { PHONE_CHIP_GAP, PHONE_CHIP_ROW_H, PHONE_PRICE_ROW_H } from '../ui/tokens';
import { TIMEFRAME_ITEMS, type IndicatorToggles } from '../../types/chart';
import type { Price, Timeframe } from '../../types/toss';
import { changeColor, formatPrice } from '../../utils/formatters';
import { priceChangeText } from './priceChange';
import IndicatorDropdown from './IndicatorDropdown';

/**
 * 폰 차트 화면의 가격 줄 · 주기 칩 줄(v2.82.0 · 테마 5-2) — 폰에서만 그린다(1280 이상 · 패드는 `ChartToolbar` · 종목 머리 줄 그대로).
 * - 가격 줄 56: 현재가 18 · 600 / 등락 13 — 큰 화면 종목 머리 줄과 **같은 값 · 같은 함수**(`formatPrice` · `priceChangeText`).
 * - 칩 줄 44: 주기 칩(1분 ~ 월 · 칩 32 · 넘치면 가로 밀기 + 끝 흐림) · [지표 ▾] · [초기화](확대 · 위치를 처음으로 — 그린 선은 남음).
 *   그리기 도구는 폰에서 그리지 않는다(사용자 결정 2026-11-27 — 이미 그린 선은 차트에 그대로 보임).
 * - 폰 가로(높이 < 500): 칩 줄을 가격 줄 오른쪽에 넣는다(`landscape`).
 */
export function PhonePriceRow({
  price,
  livePrice,
  currency,
  children,
}: {
  price: number | null;
  livePrice: Price | null;
  currency: 'KRW' | 'USD';
  /** 폰 가로 — 가격 줄 오른쪽에 넣을 칩 줄 */
  children?: React.ReactNode;
}) {
  return (
    <div data-testid="phone-price-row" className={`flex ${PHONE_PRICE_ROW_H} shrink-0 items-center gap-3 border-b border-border/60`}>
      <div className="flex shrink-0 items-baseline gap-2">
        <span data-testid="phone-price" className="whitespace-nowrap text-base font-semibold tabular-nums">
          {formatPrice(price, currency)}
        </span>
        {livePrice && (
          <span
            data-testid="phone-change"
            data-tone={livePrice.change < 0 ? 'down' : undefined}
            className={`whitespace-nowrap text-caption tabular-nums ${changeColor(livePrice.change)}`}
          >
            {priceChangeText(livePrice, currency)}
          </span>
        )}
      </div>
      {children && <div className="flex min-w-0 flex-1 justify-end">{children}</div>}
    </div>
  );
}

export function PhoneChipRow({
  timeframe,
  onTimeframeChange,
  toggles,
  onTogglesChange,
  indicatorsLoading,
  onResetView,
  inline = false,
}: {
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  toggles: IndicatorToggles;
  onTogglesChange: (toggles: IndicatorToggles) => void;
  indicatorsLoading: boolean;
  onResetView: () => void;
  /** 폰 가로 — 가격 줄 안(아래 선 · 높이는 가격 줄이 맡음) */
  inline?: boolean;
}) {
  return (
    <div
      data-testid="phone-chip-row"
      className={`flex ${PHONE_CHIP_ROW_H} min-w-0 shrink-0 items-center gap-3 ${inline ? 'w-full' : 'border-b border-border/60'}`}
    >
      {/* 주기 칩 · [지표 ▾] · [초기화] 한 줄 — 넘치면 줄째 가로로 밀고 끝 흐림(R7). 지표 목록은 화면 기준으로 뜬다(미는 상자에 잘리지 않게) */}
      <ScrollRow className="h-full min-w-0 flex-1" innerClassName={`flex h-full items-center ${PHONE_CHIP_GAP}`} testId="phone-timeframes">
        <div role="group" aria-label="봉 단위" className={`flex shrink-0 items-center ${PHONE_CHIP_GAP}`}>
          {TIMEFRAME_ITEMS.map((tf) => (
            <Chip key={tf.value} size="lg" selected={tf.value === timeframe} onClick={() => tf.value !== timeframe && onTimeframeChange(tf.value)}>
              {tf.short}
            </Chip>
          ))}
        </div>
        <div className="shrink-0">
          <IndicatorDropdown toggles={toggles} onChange={onTogglesChange} loading={indicatorsLoading} floating />
        </div>
        {/* 확대 · 위치를 처음으로(그린 선은 남음) — 칩과 같은 32(같은 줄 높이) */}
        <Button variant="ghost" icon={RotateCcw} aria-label="초기화" data-tip="초기화" onClick={onResetView} className="shrink-0" />
      </ScrollRow>
    </div>
  );
}
