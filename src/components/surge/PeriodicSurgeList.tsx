import type { SurgeDetection, SurgeProgress } from '../../types/surge';
import { SkeletonList } from '../common/SkeletonLoader';
import SurgeCard from './SurgeCard';

/** 급등 임박으로 보는 기준 — 예상일까지 남은 일수 */
const IMMINENT_DAYS = 3;

/**
 * 주기적 급등 종목 목록.
 *
 * '임박' 과 '그 이후' 를 나눈 이유: 목록이 점수 순으로만 늘어서면 오늘 봐야 할
 * 종목과 2주 뒤에 봐도 되는 종목이 섞인다.
 */
export default function PeriodicSurgeList({
  results,
  detectedAt,
  progress,
  loading,
  error,
  watchlist,
  onDetect,
  onSelectSymbol,
  onWatch,
  onPaperBuy,
  onAnalyze,
}: {
  results: SurgeDetection[];
  detectedAt: string | null;
  progress: SurgeProgress | null;
  loading: boolean;
  error: string | null;
  watchlist: string[];
  onDetect: () => void;
  onSelectSymbol: (symbol: string) => void;
  onWatch: (symbol: string) => void;
  onPaperBuy: (symbol: string, price: number | null) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const running = progress?.running ?? false;
  const imminent = results.filter(
    (r) => r.daysUntilNext != null && r.daysUntilNext <= IMMINENT_DAYS,
  );
  const later = results.filter(
    (r) => r.daysUntilNext == null || r.daysUntilNext > IMMINENT_DAYS,
  );

  /* 카드는 최소 320px 를 유지하며 화면이 넓으면 여러 열로 늘어선다 */
  const gridClass = 'grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]';

  const card = (detection: SurgeDetection) => (
    <SurgeCard
      key={detection.id}
      detection={detection}
      watched={watchlist.includes(detection.symbol)}
      onSelectSymbol={onSelectSymbol}
      onWatch={onWatch}
      onPaperBuy={onPaperBuy}
      onAnalyze={onAnalyze}
    />
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[11px] text-text-secondary">
        <span>
          마지막 분석:{' '}
          <span className="text-text-primary">
            {detectedAt ? new Date(detectedAt).toLocaleString('ko-KR') : '없음'}
          </span>
        </span>
        {progress && progress.total > 0 && (
          <span>
            분석 종목: <span className="text-text-primary">{progress.total}개</span>
          </span>
        )}
        <span>
          발견: <span className="text-text-primary">{results.length}개</span>
        </span>

        <button
          type="button"
          onClick={onDetect}
          disabled={running}
          className="ml-auto rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {running ? '분석 중…' : '🔄 다시 분석'}
        </button>
      </header>

      {running && progress && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-[11px] text-accent">
          분석 중… {progress.done}/{progress.total}
          {progress.current && ` (${progress.current})`}
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-bg-tertiary">
            <div
              className="h-full bg-accent transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p className="mt-1 text-text-muted">
            yfinance 조회는 종목당 1초씩 간격을 둡니다. 캐시된 종목은 즉시 지나갑니다.
          </p>
        </div>
      )}

      {progress?.error && !running && (
        <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {progress.error}
        </p>
      )}

      {error && (
        <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
          {error}
        </p>
      )}

      {loading ? (
        <SkeletonList count={3} />
      ) : !results.length ? (
        <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
          {running
            ? '분석이 끝나면 여기에 표시됩니다.'
            : '아직 탐지된 주기적 급등 종목이 없습니다. [🔄 다시 분석] 을 눌러 보세요.'}
        </p>
      ) : (
        <>
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-text-secondary">
              급등 임박 ({IMMINENT_DAYS}일 이내) · {imminent.length}개
            </h3>
            {imminent.length ? (
              <div className={gridClass}>{imminent.map(card)}</div>
            ) : (
              <p className="text-[11px] text-text-muted">임박한 종목이 없습니다.</p>
            )}
          </section>

          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-text-secondary">
              급등 패턴 발견 ({IMMINENT_DAYS}일 이후) · {later.length}개
            </h3>
            {later.length ? (
              <div className={gridClass}>{later.map(card)}</div>
            ) : (
              <p className="text-[11px] text-text-muted">해당하는 종목이 없습니다.</p>
            )}
          </section>
        </>
      )}

      <p className="text-[11px] text-text-muted">
        ⚠️ 과거 급등이 반복됐다는 사실이 다음 급등을 보장하지 않습니다. 이 화면은 탐지·평가만
        하며 투자 조언이 아닙니다.
      </p>
    </div>
  );
}
