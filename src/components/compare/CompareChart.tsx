import type { Timeframe } from '../../types/toss';
import LiteCandleChart, { LITE_CHART_MAS } from '../chart/LiteCandleChart';
import { barUnitOf, maLabel } from '../../types/chart';
import { InlineSpinner } from '../common/LoadingOverlay';
import { COMPARE_TIMEFRAMES } from '../../types/compare';
import type { Candle } from '../../types/toss';
import { changeColor, formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 비교 화면의 한 칸 — 머리줄(이름·가격·타임프레임·빼기) + `LiteCandleChart`.
 *
 * 메인 `CandleChart.tsx` 를 쓰지 않는다 — 드로잉 매니저·지표 패널·실시간 폴링·캡처가
 * 전부 붙어 있어서, 네 개를 동시에 띄우면 그 무게가 그대로 네 배가 된다.
 * 화면을 나가면 언마운트한다.
 */

interface Props {
  symbol: string;
  name?: string | null;
  candles: Candle[];
  loading: boolean;
  error: string | null;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  onRemove: () => void;
  /** 표기 통화 — 국내 종목을 $ 로 적지 않는다 */
  currency: 'KRW' | 'USD';
  /** 몇 번 칸인지 (①②③④) — 드래그로 자리를 고르는 화면이라 번호가 보여야 한다 */
  slotLabel?: string;
}

export default function CompareChart({
  symbol,
  name,
  candles,
  loading,
  error,
  timeframe,
  onTimeframeChange,
  onRemove,
  currency,
  slotLabel,
}: Props) {
  const last = candles.at(-1);
  const previous = candles.at(-2);
  const changeRate =
    last && previous?.close ? ((last.close - previous.close) / previous.close) * 100 : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col rounded-md border border-border bg-bg-secondary">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
        {slotLabel && <span className="shrink-0 text-xs text-text-muted">{slotLabel}</span>}
        {/*
          이름이 먼저, 티커가 괄호로 뒤에 — 티커만 단독으로 적지 않는다.
          ⚠️ 줄일 때는 **이름만** 말줄임한다 — 티커(코드)는 자르지 않는다(v2.33.0, 1280 에서 「(00593…」 처럼 잘렸다).
        */}
        <span className="flex min-w-0 items-baseline gap-1 text-sm font-semibold">
          {name ? (
            <>
              <span className="truncate" title={name}>{name}</span>
              <span className="shrink-0">({symbol})</span>
            </>
          ) : (
            <span className="shrink-0">{symbol}</span>
          )}
        </span>

        {last && (
          <span className="shrink-0 text-xs tabular-nums">{formatPrice(last.close, currency)}</span>
        )}
        {changeRate != null && (
          <span className={`shrink-0 text-[14px] tabular-nums ${changeColor(changeRate)}`}>
            {formatPercent(changeRate)}
          </span>
        )}

        <select
          value={timeframe}
          onChange={(e) => onTimeframeChange(e.target.value as Timeframe)}
          className="ml-auto shrink-0 rounded border border-border px-1 py-0.5 text-[14px]"
        >
          {COMPARE_TIMEFRAMES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRemove}
          title="비교에서 빼기"
          className="shrink-0 text-xs leading-none text-text-muted transition-colors hover:text-bearish"
        >
          ✕
        </button>
      </div>

      {/* MA 범례 — 색만 봐도 어느 선인지 알 수 있게 (메인 차트와 같은 색) */}
      <div className="flex shrink-0 gap-2 px-2 pt-1 text-[14px]">
        {LITE_CHART_MAS.map((ma) => (
          <span key={ma.key} style={{ color: ma.color }}>
            {maLabel(ma, barUnitOf(candles))}
          </span>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <LiteCandleChart candles={candles} currency={currency} />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/70 text-xs text-text-secondary">
            <InlineSpinner /> <span className="ml-1.5">{symbol} 불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[14px] text-bearish">
            {error}
          </div>
        )}
        {!loading && !error && !candles.length && (
          <div className="absolute inset-0 flex items-center justify-center text-[14px] text-text-muted">
            캔들 데이터가 없습니다
          </div>
        )}
      </div>
    </div>
  );
}
