import { useEffect, useRef, useState } from 'react';
import LiteCandleChart, { LITE_CHART_MAS } from '../chart/LiteCandleChart';
import { InlineSpinner } from '../common/LoadingOverlay';
import StockName from '../common/StockName';
import { maLabel } from '../../types/chart';
import type { Candle, Timeframe } from '../../types/toss';
import type { LiveRankingRow } from '../../types/ranking';
import { changeColor, formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 실시간 순위 오른쪽 **고정** 미리보기 패널 (v2.20.0) — 행을 따라다니는 팝업이 아니다(덜 산만하다).
 *
 * - 차트는 `LiteCandleChart` **하나**다. 종목·봉이 바뀌면 데이터만 갈아 끼운다(행마다 새 차트를 만들지 않는다).
 * - (종목, 봉) 단위 **메모리 캐시** — 같은 행을 다시 올리면 즉시 그린다.
 * - 마우스로 빠르게 훑을 때는 **이전 요청을 취소**(AbortController)하고 마지막 것만 그린다.
 * - 봉은 일·주·월. 보이는 기간: 일봉 약 6개월(126봉) · 주봉 약 2년(104) · 월봉 약 5년(60).
 */

export type PreviewTimeframe = Extract<Timeframe, '1d' | '1w' | '1M'>;

export const PREVIEW_TIMEFRAMES: { id: PreviewTimeframe; label: string; limit: number }[] = [
  { id: '1d', label: '일', limit: 126 },
  { id: '1w', label: '주', limit: 104 },
  { id: '1M', label: '월', limit: 60 },
];

/** 모듈 전역 — 화면을 나갔다 와도 방금 본 종목은 즉시 */
const memo = new Map<string, Candle[]>();

export default function RankingPreview({
  row,
  timeframe,
  onTimeframeChange,
  onOpen,
}: {
  row: LiveRankingRow | null;
  timeframe: PreviewTimeframe;
  onTimeframeChange: (tf: PreviewTimeframe) => void;
  onOpen: (symbol: string) => void;
}) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const symbol = row?.symbol ?? null;

  useEffect(() => {
    controller.current?.abort(); // 훑고 지나간 행의 요청은 버린다
    if (!symbol) return;
    const key = `${symbol}|${timeframe}`;
    const hit = memo.get(key);
    if (hit) {
      setCandles(hit);
      setLoading(false);
      setError(null);
      return;
    }
    const ac = new AbortController();
    controller.current = ac;
    setLoading(true);
    setError(null);
    const limit = PREVIEW_TIMEFRAMES.find((t) => t.id === timeframe)!.limit;
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`, { signal: ac.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error ?? `요청 실패 (${r.status})`);
        const list: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        memo.set(key, list);
        if (memo.size > 200) memo.delete(memo.keys().next().value!);
        setCandles(list);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ac.abort();
  }, [symbol, timeframe]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-border bg-bg-secondary" aria-label="종목 미리보기">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        {row ? (
          <div className="min-w-0 flex-1">
            <StockName symbol={row.symbol} name={row.name ?? undefined} className="text-sm font-semibold text-text-primary" />
            <p className="text-[12px] tabular-nums">
              <span className="text-text-primary">{row.price != null ? formatPrice(row.price, row.currency) : '—'}</span>{' '}
              {row.changeRate != null && <span className={changeColor(row.changeRate)}>{formatPercent(row.changeRate)}</span>}
            </p>
          </div>
        ) : (
          <p className="flex-1 text-[12px] text-text-muted">목록의 종목에 마우스를 올리면 여기 차트가 보입니다.</p>
        )}
        <div className="flex shrink-0 gap-1" role="group" aria-label="봉">
          {PREVIEW_TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTimeframeChange(t.id)}
              aria-pressed={timeframe === t.id}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                timeframe === t.id ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      <div className="flex shrink-0 gap-2 px-3 pt-1 text-[10px]">
        {LITE_CHART_MAS.map((ma) => (
          <span key={ma.key} style={{ color: ma.color }}>
            {maLabel(ma, timeframe === '1w' ? 'week' : timeframe === '1M' ? 'month' : 'day')}
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* 차트는 종목이 없어도 마운트해 둔다 — 인스턴스 하나를 계속 쓴다 */}
        <LiteCandleChart candles={row ? candles : []} barSpacing={4} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/60 text-xs text-text-secondary">
            <InlineSpinner /> <span className="ml-1.5">불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-bearish">{error}</div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between border-t border-border px-3 py-2">
        <span className="text-[10px] text-text-muted">
          {PREVIEW_TIMEFRAMES.find((t) => t.id === timeframe)!.label}봉 · 캔들 + 거래량 + 이동평균(5·20·60)
        </span>
        <button
          type="button"
          disabled={!row}
          onClick={() => row && onOpen(row.symbol)}
          className="rounded bg-accent px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          차트로 열기
        </button>
      </footer>
    </section>
  );
}
