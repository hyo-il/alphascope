import { useCallback } from 'react';
import AISourceBadge from './AISourceBadge';
import AsyncBoundary from '../common/AsyncBoundary';
import { Skeleton, SkeletonCards } from '../common/SkeletonLoader';
import { useLoading } from '../../hooks/useLoading';

interface Stats {
  total: number;
  scored: number;
  pending: number;
  accuracy: number | null;
  bySignal: Record<string, { scored: number; correct: number; accuracy: number | null }>;
}

interface Report {
  horizonDays: number;
  flatBandPercent: number;
  claude: Stats;
  gemini: Stats;
  agents: { role: string; label: string; scored: number; correct: number; accuracy: number | null }[];
  paired: {
    pairs: { symbol: string; date: string; agreed: boolean }[];
    agreementRate: number | null;
    claudeAccuracy: number | null;
    geminiAccuracy: number | null;
  };
}

const percent = (value: number | null) => (value == null ? '—' : `${value.toFixed(1)}%`);

function accuracyClass(value: number | null): string {
  if (value == null) return 'text-text-muted';
  if (value >= 60) return 'text-bullish';
  if (value >= 45) return 'text-text-primary';
  return 'text-bearish';
}

/**
 * 이 건수를 넘겨야 적중률을 숫자로 보여 준다.
 *
 * 3건짜리 적중률(33% / 67%)은 다음 한 건에 따라 크게 흔들려서, 보여 주면
 * 오히려 판단을 그르친다. 표본이 쌓이기 전에는 "얼마나 남았는지" 만 알려 준다.
 */
const MIN_SCORED_FOR_STATS = 20;

/** 무엇을 재는 화면인지 — 숫자만 있고 정의가 없으면 그 숫자를 믿을 수 없다. */
function Explainer({ horizonDays, flatBand }: { horizonDays: number; flatBand: number }) {
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm">
      <p className="mb-2 font-medium text-text-primary">📊 AI 분석이 실제로 맞았는지 추적합니다</p>
      <ul className="space-y-1 text-xs leading-relaxed text-text-secondary">
        <li>
          분석 당시 <b className="text-bullish">매수</b> 신호를 줬는데 실제로 가격이 올랐으면
          '적중', 내렸으면 '빗나감' 으로 기록됩니다.
        </li>
        <li>
          <b className="text-bearish">매도</b> 는 반대로, <b>중립</b> 은 ±{flatBand}% 안에
          머물렀으면 적중입니다.
        </li>
        <li>
          기준 시점은 분석일로부터 <b className="text-text-primary">{horizonDays} 거래일 뒤 종가</b>
          입니다 (스윙 트레이딩 보유 기간에 맞췄습니다). 아직 {horizonDays} 거래일이 지나지 않은
          분석은 '대기' 로 남습니다.
        </li>
        <li>
          충분히 쌓이면 어느 AI 가 더 정확한지, 어떤 신호가 더 믿을 만한지 판단할 수 있습니다.
        </li>
      </ul>
    </div>
  );
}

export default function AIAccuracyDashboard() {
  const fetchReport = useCallback(async (): Promise<Report> => {
    const response = await fetch('/api/ai/accuracy');
    if (!response.ok) throw new Error('정확도를 불러오지 못했습니다.');
    return response.json();
  }, []);

  const { data: report, isLoading, error, reload } = useLoading<Report>(fetchReport);

  return (
    <AsyncBoundary
      isLoading={isLoading || !report}
      error={error}
      onRetry={() => void reload()}
      skeleton={
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-lg" />
          <SkeletonCards count={2} className="grid-cols-1 sm:grid-cols-2" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      }
    >
      {report && <AccuracyReport report={report} />}
    </AsyncBoundary>
  );
}

/** 실제 내용 — 로딩·오류 처리는 위의 AsyncBoundary 가 맡는다 */
function AccuracyReport({ report }: { report: Report }) {
  const scored = report.claude.scored + report.gemini.scored;
  const total = report.claude.total + report.gemini.total;
  const pending = report.claude.pending + report.gemini.pending;

  // 표본이 모자라면 통계 대신 "얼마나 남았는지" 를 보여 준다.
  if (scored < MIN_SCORED_FOR_STATS) {
    const progress = Math.min(100, (scored / MIN_SCORED_FOR_STATS) * 100);
    return (
      <div className="space-y-4">
        <Explainer horizonDays={report.horizonDays} flatBand={report.flatBandPercent} />

        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <p className="mb-1 text-sm font-medium text-warning">⚠️ 아직 판단할 만큼 쌓이지 않았습니다</p>
          <p className="text-xs leading-relaxed text-text-secondary">
            적중률은 최소 {MIN_SCORED_FOR_STATS}건이 채점된 뒤부터 보여 줍니다. 표본이 적으면
            한두 건에 수치가 크게 흔들려 오히려 판단을 그르칩니다.
          </p>

          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span>채점 완료</span>
              <span className="tabular-nums">
                {scored}건 / {MIN_SCORED_FOR_STATS}건
              </span>
            </div>
            <div className="h-1.5 rounded bg-bg-tertiary">
              <div className="h-full rounded bg-warning" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <p className="mt-2 text-[11px] text-text-muted">
            전체 분석 {total}건 · 채점 대기 {pending}건
            {pending > 0 && ` (${report.horizonDays} 거래일이 지나면 자동으로 채점됩니다)`}
          </p>
        </div>
      </div>
    );
  }

  const signals = [...new Set([
    ...Object.keys(report.gemini.bySignal),
    ...Object.keys(report.claude.bySignal),
  ])];

  return (
    <div className="space-y-4">
      <Explainer horizonDays={report.horizonDays} flatBand={report.flatBandPercent} />

      {/* 전체 */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(['claude', 'gemini'] as const).map((source) => {
          const stats = report[source];
          return (
            <div key={source} className="rounded-lg border border-border bg-bg-secondary p-4">
              <div className="mb-2 flex items-center gap-2">
                <AISourceBadge source={source} />
                <span className="ml-auto text-xs text-text-muted">
                  {stats.total}건 (채점 {stats.scored} · 대기 {stats.pending})
                </span>
              </div>
              <p className={`text-2xl font-semibold ${accuracyClass(stats.accuracy)}`}>
                {percent(stats.accuracy)}
              </p>
            </div>
          );
        })}
      </div>

      <p className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
        ⚠️ 위 두 수치를 직접 비교하지 마세요. Claude 는 사용자가 고른 종목만 분석하므로 선택 편향이
        있고 표본 수도 다릅니다. 공정한 비교는 아래 '같은 조건 비교'를 보세요.
      </p>

      {/* 신호별 */}
      {signals.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-bg-secondary">
          <table className="w-full text-sm">
            <thead className="text-xs text-text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2 text-left font-normal">신호</th>
                <th className="px-3 py-2 text-right font-normal">Claude 🟣</th>
                <th className="px-3 py-2 text-right font-normal">Gemini 🔵</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((signal) => {
                const c = report.claude.bySignal[signal];
                const g = report.gemini.bySignal[signal];
                return (
                  <tr key={signal} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 text-text-primary">{signal}</td>
                    <td className={`px-3 py-2 text-right ${accuracyClass(c?.accuracy ?? null)}`}>
                      {c ? `${percent(c.accuracy)} (${c.scored}건)` : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${accuracyClass(g?.accuracy ?? null)}`}>
                      {g ? `${percent(g.accuracy)} (${g.scored}건)` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 같은 조건 비교 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <h3 className="mb-2 text-sm font-medium text-text-primary">
          같은 조건 비교 (같은 종목·같은 날 둘 다 분석한 건)
        </h3>
        {report.paired.pairs.length === 0 ? (
          <p className="text-xs text-text-muted">
            아직 짝지을 기록이 없습니다. 같은 날 같은 종목을 Claude 와 Gemini 로 모두 분석하면 여기에
            쌓입니다.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-xs text-text-muted">짝 수</p>
                <p className="text-text-primary">{report.paired.pairs.length}쌍</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">방향 일치율</p>
                <p className="text-text-primary">{percent(report.paired.agreementRate)}</p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Claude 적중</p>
                <p className={accuracyClass(report.paired.claudeAccuracy)}>
                  {percent(report.paired.claudeAccuracy)}
                </p>
              </div>
              <div>
                <p className="text-xs text-text-muted">Gemini 적중</p>
                <p className={accuracyClass(report.paired.geminiAccuracy)}>
                  {percent(report.paired.geminiAccuracy)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {report.paired.pairs.slice(0, 30).map((pair, index) => (
                <span
                  key={index}
                  className={`rounded px-2 py-0.5 text-xs ${pair.agreed ? 'bg-bullish/15 text-bullish' : 'bg-warning/15 text-warning'}`}
                >
                  {pair.symbol} {pair.date.slice(5)}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 에이전트별 */}
      <div className="rounded-lg border border-border bg-bg-secondary p-4">
        <h3 className="mb-2 text-sm font-medium text-text-primary">
          Gemini 에이전트별 적중률
        </h3>
        {report.agents.length === 0 ? (
          <p className="text-xs text-text-muted">채점 가능한 분석이 아직 없습니다.</p>
        ) : (
          <div className="space-y-1.5">
            {report.agents
              .slice()
              .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))
              .map((agent) => (
                <div key={agent.role} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-text-secondary">{agent.label}</span>
                  <div className="h-1.5 flex-1 rounded bg-bg-tertiary">
                    <div
                      className="h-full rounded bg-accent"
                      style={{ width: `${Math.min(100, agent.accuracy ?? 0)}%` }}
                    />
                  </div>
                  <span className={`w-24 text-right text-xs ${accuracyClass(agent.accuracy)}`}>
                    {percent(agent.accuracy)} ({agent.scored}건)
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
