import { Segmented } from '../ui';
import { useEffect, useRef, useState } from 'react';
import LiteCandleChart, { LITE_CHART_MAS } from '../chart/LiteCandleChart';
import { InlineSpinner } from '../common/LoadingOverlay';
import StockName from '../common/StockName';
import UsDateTag from '../common/UsDateTag';
import { isKrSymbol } from '../../utils/market';
import { barUnitOf, maLabel } from '../../types/chart';
import { useRealtimePrice } from '../../hooks/useRealtimePrice';
import type { Candle, Timeframe } from '../../types/toss';
import { CHART_PAGE_SIZE } from '../../utils/constants';
import type { LiveRankingRow } from '../../types/ranking';
import { changeColor, formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 실시간 순위 오른쪽 **고정** 미리보기 패널 — 행을 따라다니는 팝업이 아니다(덜 산만하다).
 *
 * - 차트는 `LiteCandleChart` **하나**다. 종목·봉이 바뀌면 데이터만 갈아 끼운다(행마다 새 차트를 만들지 않는다).
 * - (종목, 봉) 단위 **메모리 캐시** — 같은 행을 다시 올리면 즉시 그린다.
 * - 마우스로 빠르게 훑을 때는 **이전 요청을 취소**(AbortController)하고 마지막 것만 그린다.
 * - 봉은 5분·15분·일·주·월. 보이는 기간: 분봉 200봉(토스 1분봉은 3일치뿐 — 더 받아도 비어 있다) · 일봉 약 6개월(126봉) · 주봉 약 2년(104) · 월봉 약 5년(60).
 * - 실시간: 현재가 1초(`useRealtimePrice` — 메인 차트와 같은 훅 · 숨은 탭에서 쉼)로 마지막 봉 · 위쪽 가격을 고친다.
 *   분봉은 1분마다 그 (종목, 봉)을 다시 받아 새 봉을 붙인다(가리는 로딩 없음 — 자동 주기 갱신). 일·주·월은 다시 받지 않는다.
 */

export type PreviewTimeframe = Extract<Timeframe, '5m' | '15m' | '1d' | '1w' | '1M'>;

export const PREVIEW_TIMEFRAMES: { id: PreviewTimeframe; label: string; limit: number }[] = [
  { id: '5m', label: '5분', limit: CHART_PAGE_SIZE['5m'] },
  { id: '15m', label: '15분', limit: CHART_PAGE_SIZE['15m'] },
  { id: '1d', label: '일', limit: 126 },
  { id: '1w', label: '주', limit: 104 },
  { id: '1M', label: '월', limit: 60 },
];

export const isPreviewTimeframe = (tf: string): tf is PreviewTimeframe => PREVIEW_TIMEFRAMES.some((t) => t.id === tf);
const isMinuteTf = (tf: PreviewTimeframe) => tf === '5m' || tf === '15m';

/** 분봉 다시 받기 주기 */
const MINUTE_REFRESH_MS = 60_000;
/**
 * 일·주·월 캐시가 이만큼 오래됐으면 다시 올렸을 때 한 번 조용히 다시 받는다(즉시 그리기는 그대로).
 * 날짜가 바뀌거나 장이 열려 새 봉이 생겼는데 옛 마지막 봉에 현재가를 덮어쓰지 않게.
 */
const MEMO_STALE_MS = 10 * 60_000;

/** 모듈 전역 — 화면을 나갔다 와도 방금 본 종목은 즉시. `at` = 받은 시각 */
const memo = new Map<string, { candles: Candle[]; at: number }>();
function remember(key: string, candles: Candle[]) {
  memo.delete(key); // 새로 넣은 것을 맨 뒤로 — 넘치면 오래된 것부터 버린다
  memo.set(key, { candles, at: Date.now() });
  if (memo.size > 200) memo.delete(memo.keys().next().value!);
}
/** 다시 받은 최근 봉을 캐시 앞쪽(이어 받은 과거 봉)에 잇는다 — 겹치는 시각은 새 값 */
function mergeLatest(base: Candle[], latest: Candle[]): Candle[] {
  if (!latest.length) return base;
  const first = latest[0].timestamp;
  return [...base.filter((c) => c.timestamp < first), ...latest];
}

/**
 * 다음 실적 발표일 — `GET /api/earnings/next`(earnings_calendar 만 읽는다, yfinance 를 부르지 않는다).
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

function EarningsLine({ info, symbol }: { info: NextEarnings | null | undefined; symbol: string }) {
  if (info === undefined) return <p className="text-caption text-text-muted">실적일 확인 중…</p>;
  if (!info || !info.date || info.daysUntil == null) return <p className="text-caption text-text-muted/70">실적일 정보 없음</p>;
  const when = info.daysUntil === 0 ? '오늘' : `D−${info.daysUntil}`;
  const soon = info.daysUntil <= EARNINGS_WARN_DAYS;
  return (
    <p className={`text-caption ${soon ? 'font-medium text-warning' : 'text-text-secondary'}`}>
      {/* 날짜는 시장 날짜 문자열(YYYY-MM-DD) 그대로 — 앱 공통 표기 */}
      실적 발표 {info.date}
      {/* 미국 종목은 미국 날짜(D−N 도 미국 날짜로 센다 — 서버 /api/earnings/next) · 문장 안 모양 · 양쪽 공백 한 칸 */}
      {!isKrSymbol(symbol) && (
        <>
          {' '}
          <UsDateTag inline />
        </>
      )}{' '}
      (예정·{info.isEstimate ? '추정' : when})
      {info.isEstimate && <span className="ml-1 text-text-muted">{when}</span>}
    </p>
  );
}

export default function RankingPreview({
  row,
  timeframe,
  onTimeframeChange,
  pending = false,
}: {
  row: LiveRankingRow | null;
  /** 순위를 받는 중(처음·종류·시장을 바꿀 때) — 안내 대신 로딩 표시 */
  pending?: boolean;
  timeframe: PreviewTimeframe;
  onTimeframeChange: (tf: PreviewTimeframe) => void;
}) {
  /** 그리는 봉과 그 (종목|봉) — 현재가는 같은 종목 봉에만 덮는다(새 종목을 받는 동안 옛 봉에 새 종목 가격을 쓰지 않게) */
  const [shown, setShown] = useState<{ key: string; candles: Candle[] }>({ key: '', candles: [] });
  const candles = shown.candles;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** 과거 봉 이어 받기 — 메인 차트와 같은 API(before=)·같은 페이지 크기. 더 없으면 그 (종목, 봉)은 멈춘다 */
  const olderCtl = useRef<AbortController | null>(null);
  const olderBusy = useRef(false);
  const ended = useRef(new Set<string>());
  const [loadingOlder, setLoadingOlder] = useState(false);
  const symbol = row?.symbol ?? null;
  const live = useRealtimePrice(symbol);
  /** 다시 받기(분봉 1분 · 오래된 캐시) — 종목·봉이 바뀌면 취소 */
  const refreshCtl = useRef<AbortController | null>(null);
  const keyRef = useRef('');
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

  /** 최근 봉을 조용히 다시 받아 캐시 · 화면에 잇는다 — 가리는 로딩 없음 · 실패는 다음 주기에 다시 */
  const refresh = (sym: string, tf: PreviewTimeframe, forKey: string) => {
    refreshCtl.current?.abort();
    const ac = new AbortController();
    refreshCtl.current = ac;
    const limit = PREVIEW_TIMEFRAMES.find((t) => t.id === tf)!.limit;
    fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&timeframe=${tf}&limit=${limit}`, { signal: ac.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) return;
        const latest: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        if (!latest.length) return;
        const merged = mergeLatest(memo.get(forKey)?.candles ?? [], latest);
        remember(forKey, merged);
        if (keyRef.current === forKey) setShown({ key: forKey, candles: merged });
      })
      .catch(() => {
        /* 취소·실패 — 다음 주기에 다시 받는다 */
      });
  };

  useEffect(() => {
    controller.current?.abort(); // 훑고 지나간 행의 요청은 버린다
    olderCtl.current?.abort(); // 과거 받기도 — 종목·봉이 바뀌면 취소
    refreshCtl.current?.abort();
    olderBusy.current = false;
    setLoadingOlder(false);
    keyRef.current = symbol ? `${symbol}|${timeframe}` : '';
    if (!symbol) return;
    const key = `${symbol}|${timeframe}`;
    const hit = memo.get(key);
    if (hit) {
      setShown({ key, candles: hit.candles });
      setLoading(false);
      setError(null);
      // 즉시 그린 뒤 — 분봉은 늘, 일·주·월은 오래된 캐시만 조용히 다시 받는다
      if (isMinuteTf(timeframe) || Date.now() - hit.at > MEMO_STALE_MS) refresh(symbol, timeframe, key);
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
        remember(key, list);
        setShown({ key, candles: list });
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => ac.abort();
    // refresh 는 ref 만 쓰는 함수라 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  // 분봉 — 1분마다 다시 받아 새 봉을 붙인다. 숨은 탭에서는 쉬고, 화면을 나가거나 종목·봉을 바꾸면 타이머 · 요청을 끊는다
  useEffect(() => {
    if (!symbol || !isMinuteTf(timeframe)) return;
    const key = `${symbol}|${timeframe}`;
    const timer = setInterval(() => {
      if (!document.hidden) refresh(symbol, timeframe, key);
    }, MINUTE_REFRESH_MS);
    return () => {
      clearInterval(timer);
      refreshCtl.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  const key = symbol ? `${symbol}|${timeframe}` : '';
  const loadOlder = () => {
    if (!symbol || loading || olderBusy.current || ended.current.has(key)) return;
    const oldest = candles[0]?.timestamp;
    if (!oldest) return;
    const ac = new AbortController();
    olderCtl.current = ac;
    olderBusy.current = true;
    setLoadingOlder(true);
    const forKey = key;
    fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${CHART_PAGE_SIZE[timeframe]}&before=${oldest}`, { signal: ac.signal })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || data.error) throw new Error(data.error ?? `요청 실패 (${r.status})`);
        const older: Candle[] = Array.isArray(data.candles) ? data.candles : [];
        const base = memo.get(forKey)?.candles ?? candles;
        const have = new Set(base.map((c) => c.timestamp));
        const fresh = older.filter((c) => !have.has(c.timestamp));
        if (!fresh.length) {
          ended.current.add(forKey);
          return;
        }
        const merged = [...fresh, ...base];
        remember(forKey, merged);
        if (keyRef.current === forKey) setShown({ key: forKey, candles: merged });
      })
      .catch(() => {
        /* 취소·실패 — 다음에 다시 끌면 다시 받는다 */
      })
      .finally(() => {
        if (olderCtl.current === ac) {
          olderBusy.current = false;
          setLoadingOlder(false);
        }
      });
  };

  // 위쪽 가격 · 등락률 — 현재가를 받으면 그것, 받기 전에는 순위 줄 값. 전일 종가를 몰라 변동이 0 으로 오면 등락률은 순위 줄 값(App 헤더와 같은 기준)
  const price = live?.close ?? row?.price ?? null;
  const changeRate = live && Number.isFinite(live.changeRate) && live.change !== 0 ? live.changeRate : (row?.changeRate ?? null);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl bg-bg-secondary" aria-label="종목 미리보기">
      <header className="flex shrink-0 items-center gap-2 px-3 py-2.5">
        {row ? (
          <div className="min-w-0 flex-1">
            <StockName symbol={row.symbol} name={row.name ?? undefined} className="text-sm font-semibold text-text-primary" />
            <p className="text-xs tabular-nums">
              <span className="text-text-primary">{price != null ? formatPrice(price, row.currency) : '—'}</span>{' '}
              {changeRate != null && <span className={changeColor(changeRate)}>{formatPercent(changeRate)}</span>}
            </p>
            <EarningsLine info={earnings} symbol={row.symbol} />
          </div>
        ) : (
          <p className="flex flex-1 items-center gap-1.5 text-xs text-text-muted">
            {pending ? (
              <>
                <InlineSpinner /> 순위를 불러오는 중…
              </>
            ) : (
              '목록의 종목에 마우스를 올리면 여기 차트가 보입니다.'
            )}
          </p>
        )}
        <Segmented label="봉" size="sm" value={timeframe} onChange={onTimeframeChange} options={PREVIEW_TIMEFRAMES.map((t) => ({ value: t.id, label: t.label }))} />
      </header>
      {/* 범례 — 위아래 같은 간격(차트에 붙지 않게). 이름은 그리는 봉 간격으로(분봉 = 5봉선) — 메인 차트 · 기업 비교와 같은 함수 */}
      <div className="flex shrink-0 gap-2 px-3 py-1 text-caption">
        {LITE_CHART_MAS.map((ma) => (
          <span key={ma.key} style={{ color: ma.color }}>
            {maLabel(ma, barUnitOf(candles))}
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        {/* 차트는 종목이 없어도 마운트해 둔다 — 인스턴스 하나를 계속 쓴다 */}
        <LiteCandleChart
          candles={row ? candles : []}
          barSpacing={4}
          currency={row?.currency}
          datasetKey={key}
          onReachStart={loadOlder}
          livePrice={shown.key === key ? live?.close : null}
        />
        {loadingOlder && (
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded bg-bg-elevated/90 px-2 py-0.5 text-caption text-text-secondary">
            <InlineSpinner /> 과거 봉 불러오는 중…
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-secondary/60 text-xs text-text-secondary">
            <InlineSpinner /> <span className="ml-1.5">불러오는 중…</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-caption text-danger">{error}</div>
        )}
      </div>
      <footer className="flex shrink-0 items-center px-3 py-2.5">
        <span className="min-w-0 text-caption text-text-muted">
          {PREVIEW_TIMEFRAMES.find((t) => t.id === timeframe)!.label}봉 · 캔들 + 거래량 + 이동평균(5·20·60) · 왼쪽으로 끌면 과거 봉
        </span>
      </footer>
    </section>
  );
}
