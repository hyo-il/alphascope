import { Segmented } from '../ui';
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

/**
 * 다음 실적 발표일 (v2.21.0) — `GET /api/earnings/next`(earnings_calendar 만 읽는다, yfinance 를 부르지 않는다).
 * (종목) 단위 메모리 캐시 — 같은 종목을 다시 올리면 요청하지 않는다. 날짜는 하루 1회 갱신이라 화면에 있는 동안은 충분하다.
 */
interface NextEarnings {
  date: string | null;
  isEstimate: boolean | null;
  daysUntil: number | null;
}
const earningsMemo = new Map<string, NextEarnings>();
/** 스윙 "실적 14일 이내" 경고와 같은 기준 */
const EARNINGS_WARN_DAYS = 14;

function EarningsLine({ info }: { info: NextEarnings | null | undefined }) {
  if (info === undefined) return <p className="text-[13px] text-text-muted">실적일 확인 중…</p>;
  if (!info || !info.date || info.daysUntil == null) return <p className="text-[13px] text-text-muted/70">실적일 정보 없음</p>;
  const [, m, d] = info.date.split('-').map(Number);
  const when = info.daysUntil === 0 ? '오늘' : `D−${info.daysUntil}`;
  const soon = info.daysUntil <= EARNINGS_WARN_DAYS;
  return (
    <p className={`text-[13px] ${soon ? 'font-medium text-warning' : 'text-text-secondary'}`}>
      실적 발표 {m}/{d} (예정·{info.isEstimate ? '추정' : when})
      {info.isEstimate && <span className="ml-1 text-text-muted">{when}</span>}
    </p>
  );
}

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
  const [earnings, setEarnings] = useState<NextEarnings | null | undefined>(undefined);

  useEffect(() => {
    if (!symbol) return;
    const hit = earningsMemo.get(symbol);
    if (hit) {
      setEarnings(hit);
      return;
    }
    setEarnings(undefined);
    // 차트 요청과 달리 **취소하지 않는다** — DB 한 줄이라 가볍고, 끝까지 받아 두면 빠르게 훑고 지나간 종목도 캐시에 남는다.
    // 대신 그 사이 다른 종목으로 옮겼으면 화면에는 쓰지 않는다.
    let current = true;
    fetch(`/api/earnings/next?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NextEarnings | null) => {
        const info = data ?? { date: null, isEstimate: null, daysUntil: null };
        earningsMemo.set(symbol, info);
        if (current) setEarnings(info);
      })
      .catch(() => {
        if (current) setEarnings(null);
      });
    return () => {
      current = false;
    };
  }, [symbol]);

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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl bg-bg-secondary" aria-label="종목 미리보기">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        {row ? (
          <div className="min-w-0 flex-1">
            <StockName symbol={row.symbol} name={row.name ?? undefined} className="text-sm font-semibold text-text-primary" />
            <p className="text-[14px] tabular-nums">
              <span className="text-text-primary">{row.price != null ? formatPrice(row.price, row.currency) : '—'}</span>{' '}
              {row.changeRate != null && <span className={changeColor(row.changeRate)}>{formatPercent(row.changeRate)}</span>}
            </p>
            <EarningsLine info={earnings} />
          </div>
        ) : (
          <p className="flex-1 text-[14px] text-text-muted">목록의 종목에 마우스를 올리면 여기 차트가 보입니다.</p>
        )}
        <Segmented label="봉" size="sm" value={timeframe} onChange={onTimeframeChange} options={PREVIEW_TIMEFRAMES.map((t) => ({ value: t.id, label: t.label }))} />
      </header>
      <div className="flex shrink-0 gap-2 px-3 pt-1 text-[13px]">
        {LITE_CHART_MAS.map((ma) => (
          <span key={ma.key} style={{ color: ma.color }}>
            {maLabel(ma, timeframe === '1w' ? 'week' : timeframe === '1M' ? 'month' : 'day')}
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* 차트는 종목이 없어도 마운트해 둔다 — 인스턴스 하나를 계속 쓴다 */}
        <LiteCandleChart candles={row ? candles : []} barSpacing={4} currency={row?.currency} />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/60 text-xs text-text-secondary">
            <InlineSpinner /> <span className="ml-1.5">불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[13px] text-bearish">{error}</div>
        )}
      </div>
      <footer className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <span className="min-w-0 text-[13px] text-text-muted">
          {PREVIEW_TIMEFRAMES.find((t) => t.id === timeframe)!.label}봉 · 캔들 + 거래량 + 이동평균(5·20·60)
        </span>
        <button
          type="button"
          disabled={!row}
          onClick={() => row && onOpen(row.symbol)}
          className="shrink-0 whitespace-nowrap rounded-md bg-accent px-3 py-1 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          차트로 열기
        </button>
      </footer>
    </section>
  );
}
