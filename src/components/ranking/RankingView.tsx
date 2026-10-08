import { InfoTip, Segmented, Button } from '../ui';
import StarIcon from '../ui/StarIcon';
import { useCallback, useEffect, useRef, useState } from 'react';
import StockName from '../common/StockName';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useAppStore } from '../../store/appStore';
import {
  LIVE_RANKING_KINDS,
  type LiveRankingKind,
  type LiveRankingMarket,
  type LiveRankingResponse,
  type LiveRankingRow,
} from '../../types/ranking';
import { changeColor, formatCompact, formatCompactMoney, formatPercent, formatPrice } from '../../utils/formatters';
import RankingPreview, { type PreviewTimeframe } from './RankingPreview';

/**
 * 📶 실시간 순위 (v2.20.0) — 토스 거래대금·거래량·상승률·하락률 상위 100(`/api/rankings/live`, 서버 30초 캐시).
 *
 * - 화면이 보일 때만 30초마다 다시 받는다(숨은 탭 정지, 돌아오면 즉시 한 번).
 * - 행에 마우스를 **150ms** 올리면 오른쪽 고정 패널에 미리보기. 마우스가 목록을 떠나도 마지막 종목을 둔다(깜빡임 방지).
 *   키보드 ↑↓ 로 옮겨도 바뀌고, Enter·행 클릭·[차트로 열기]는 **미리보기에서 고른 봉 그대로** 메인 차트를 연다.
 * - ⚠️ 보기 전용이다. 순위는 매수 신호가 아니다 — 급등 다음 날 추격은 이 앱의 진단에서 불리했다(하단 고정 문구).
 */

const REFRESH_MS = 30_000;
const HOVER_MS = 150;
const FIRST_PAGE = 50;

const isPreviewTf = (tf: string): tf is PreviewTimeframe => tf === '1d' || tf === '1w' || tf === '1M';

export default function RankingView({ onOpen }: { onOpen: (symbol: string, timeframe: PreviewTimeframe) => void }) {
  const [market, setMarket] = useState<LiveRankingMarket>('us');
  const [kind, setKind] = useState<LiveRankingKind>('amount');
  const [data, setData] = useState<LiveRankingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<LiveRankingRow | null>(null);
  const [active, setActive] = useState(-1);
  const chartTf = useAppStore((s) => s.timeframe);
  const [previewTf, setPreviewTf] = useState<PreviewTimeframe>(() => (isPreviewTf(chartTf) ? chartTf : '1d'));
  const { watchlist, add } = useWatchlist();
  const sequence = useRef(0);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    try {
      const r = await fetch(`/api/rankings/live?market=${market}&kind=${kind}`);
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      if (mine === sequence.current) {
        setData(payload as LiveRankingResponse);
        setError(null);
      }
    } catch (e) {
      if (mine === sequence.current) setError((e as Error).message);
    }
  }, [market, kind]);

  // 처음 + 30초마다 — 숨은 탭에서는 쉬고, 다시 보이면 곧바로 한 번
  useEffect(() => {
    setData(null);
    setActive(-1);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const rows = data ? (showAll ? data.rows : data.rows.slice(0, FIRST_PAGE)) : [];
  const open = (symbol: string) => onOpen(symbol, previewTf);

  const hover = (row: LiveRankingRow, index: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setPreview(row);
      setActive(index);
    }, HOVER_MS);
  };
  // 목록을 떠나도 미리보기는 그대로 — 대기 중인 타이머만 끊는다
  const leave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(rows.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      setPreview(rows[next]);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && active >= 0 && rows[active]) {
      open(rows[active].symbol);
    }
  };

  const valueLabel = kind === 'volume' ? '거래량' : '거래대금';

  return (
    <div className="flex h-full flex-col p-3">
      {/* 제목 줄 / 고르기 줄을 나눈다 (v2.41.0 디자인 규칙 7) */}
      <h2 className="shrink-0 pb-2 text-base font-semibold text-text-primary">실시간 순위</h2>
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <Segmented
          label="시장"
          size="sm"
          value={market}
          onChange={setMarket}
          options={[
            { value: 'us', label: '미국' },
            { value: 'kr', label: '국내' },
          ]}
        />
        <Segmented label="순위 종류" size="sm" value={kind} onChange={setKind} options={LIVE_RANKING_KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        {data && (
          <span className="flex items-center gap-1 text-caption text-text-muted">
            {data.rankedAt
              ? `${new Date(data.rankedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
              : '기준 시각 없음'}
            {/* 긴 설명은 정보 아이콘으로 (v2.36.0 디자인 규칙 6) */}
            <InfoTip>
              {data.duration === 'realtime' ? '실시간 순위입니다.' : '오늘 등락 기준입니다(토스가 실시간 상승·하락률을 주지 않습니다).'} 30초마다 새로고침합니다(화면을 볼 때만).
              {data.rankedAt && ` 기준 시각 ${new Date(data.rankedAt).toLocaleTimeString('ko-KR')}.`}
            </InfoTip>
          </span>
        )}
      </header>

      {error && <p className="mb-2 rounded-lg bg-danger/10 px-3 py-1.5 text-caption text-danger">{error}</p>}

      <div className="flex min-h-0 flex-1 gap-2">
        {/* 목록 ≈ 55% */}
        <div
          ref={listRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseLeave={leave}
          className="min-h-0 min-w-0 basis-[60%] overflow-y-auto rounded-xl bg-bg-secondary outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label="순위 목록 — ↑↓ 로 옮기고 Enter 로 차트 열기"
        >
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[1] bg-bg-secondary text-caption text-text-muted">
              <tr className="border-b border-border/50">
                <th className="w-9 py-2.5 pl-2 text-right font-normal">순위</th>
                <th className="w-7" />
                <th className="px-2 text-left font-normal">종목</th>
                {/* 숫자 열은 폭을 정해 둔다 — 자동 배분이면 남는 폭이 숫자 열로 가고 종목명이 0 에 가깝게 줄었다 (v2.25.0) */}
                <th className="w-[104px] px-2 text-right font-normal">현재가</th>
                <th className="w-[84px] px-2 text-right font-normal">등락률</th>
                <th className="w-[92px] pr-3 text-right font-normal">{valueLabel}</th>
              </tr>
            </thead>
            <tbody>
              {!data && !error && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-caption text-text-muted">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {data && !data.rows.length && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-caption text-text-muted">
                    {data.mock ? '모의 데이터 모드에서는 순위가 없습니다.' : '순위가 비어 있습니다.'}
                  </td>
                </tr>
              )}
              {rows.map((row, index) => {
                const watched = watchlist.includes(row.symbol);
                return (
                  <tr
                    key={row.symbol}
                    data-index={index}
                    onMouseEnter={() => hover(row, index)}
                    onClick={() => open(row.symbol)}
                    className={`cursor-pointer border-b border-border/30 transition-colors hover:bg-bg-tertiary/60 ${
                      active === index ? 'bg-bg-tertiary' : ''
                    }`}
                  >
                    <td className="py-2.5 pl-2 text-right tabular-nums text-text-muted">{row.rank}</td>
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!watched) add(row.symbol);
                        }}
                        disabled={watched}
                        title={watched ? '관심 종목' : '관심 목록에 추가'}
                        aria-label={watched ? `${row.symbol} 관심 종목` : `${row.symbol} 관심 목록에 추가`}
                        className="inline-flex align-middle disabled:cursor-default"
                      >
                        <StarIcon on={watched} size="sm" />
                      </button>
                    </td>
                    <td className="max-w-0 overflow-hidden whitespace-nowrap px-2">
                      {/* v2.25.0 — 글씨가 커져 이름이 말줄임 없이 잘렸다. flex 상자로 폭을 묶어야 이름 쪽 truncate(…)가 먹는다 */}
                      <div className="flex min-w-0">
                        <StockName symbol={row.symbol} name={row.name ?? undefined} size="sm" className="text-text-primary" />
                      </div>
                    </td>
                    <td className="px-2 text-right tabular-nums text-text-primary">
                      {row.price != null ? formatPrice(row.price, row.currency) : '—'}
                    </td>
                    <td className={`px-2 text-right tabular-nums ${row.changeRate != null ? changeColor(row.changeRate) : ''}`}>
                      {formatPercent(row.changeRate)}
                    </td>
                    <td className="pr-3 text-right tabular-nums text-text-secondary">
                      {kind === 'volume' ? formatCompact(row.tradingVolume) : formatCompactMoney(row.tradingAmount, row.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data && data.rows.length > FIRST_PAGE && (
            <Button variant="secondary" size="sm"
              onClick={() => setShowAll((v) => !v)}
              className="w-full">
              {showAll ? '50위까지만 보기' : `더 보기 (+${data.rows.length - FIRST_PAGE})`}
            </Button>
          )}
        </div>

        {/* 미리보기 ≈ 45% */}
        <div className="flex min-h-0 min-w-0 basis-[40%]">
          <div className="flex min-h-0 w-full flex-col">
            <RankingPreview row={preview} timeframe={previewTf} onTimeframeChange={setPreviewTf} />
          </div>
        </div>
      </div>

      {/* ⚠️ 고정 문구 — 지우지 않는다(CLAUDE.md). 조작법만 정보 아이콘으로 (v2.36.0) */}
      <p className="mt-2 flex shrink-0 items-center gap-1 text-caption text-text-secondary">
        순위는 둘러보기용입니다. 급등 다음 날 추격 매수는 이 앱의 과거 진단에서 불리했습니다.
        <InfoTip label="조작법">행을 누르거나 Enter 를 누르면 미리보기에서 고른 봉으로 차트를 엽니다. ↑↓ 로 행을 옮깁니다. 미리보기 차트를 왼쪽 끝까지 끌면 옛날 봉을 이어 받습니다.</InfoTip>
      </p>
    </div>
  );
}
