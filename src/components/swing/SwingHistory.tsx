import { useState } from 'react';
import { useSwingHistory } from '../../hooks/useSwing';
import StockName from '../common/StockName';
import { formatPercent } from '../../utils/formatters';
import { PROFILE_LABEL, type ProfileId } from '../../types/strategyProfile';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { TargetHistorySection } from './TargetAnalysisParts';

/** 이 아래로는 승률을 숫자 하나로 믿기 어렵다 — 화면에 '표본 적음' 을 붙인다 */
const SMALL_SAMPLE = 10;

type Filter = 'all' | ProfileId;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'standard', label: PROFILE_LABEL.standard },
  { id: 'aggressive', label: PROFILE_LABEL.aggressive },
  { id: 'defensive', label: PROFILE_LABEL.defensive },
];

const RESULT_LABEL: Record<string, { text: string; className: string }> = {
  target1: { text: '1차 목표 도달', className: 'text-bullish' },
  target2: { text: '2차 목표 도달', className: 'text-bullish' },
  stop_loss: { text: '손절', className: 'text-bearish' },
  open: { text: '진행 중', className: 'text-text-secondary' },
  not_triggered: { text: '미체결', className: 'text-text-muted' },
  pending: { text: '대기', className: 'text-text-muted' },
};

/**
 * 추천 이력 + 성과.
 *
 * 시스템 자체를 검증하는 화면이다. 승률은 **체결된 추천만** 분모로 센다 —
 * 눌림·돌파 대기는 조건이 오지 않으면 체결 자체가 없었으므로, 실패로 세면
 * 정확도가 실제보다 나빠 보인다.
 */
function RecommendationHistory() {
  const { records: all, loading } = useSwingHistory(true);
  const [filter, setFilter] = useState<Filter>('all');

  if (loading) return <p className="text-xs text-text-muted">이력을 불러오는 중…</p>;
  if (!all.length) {
    return (
      <p className="text-xs text-text-muted">
        아직 추천 이력이 없습니다. [🔄 다시 분석] 으로 관심 종목을 분석하면 BUY 이상만
        기록됩니다.
      </p>
    );
  }

  /*
    ⚠️ 성과는 **필터를 따라** 계산한다. 기준이 다른 추천을 한 승률로 합치면
    어느 기준이 나은지 알 수 없다 — 프로파일을 만든 이유가 사라진다.
  */
  const records = filter === 'all' ? all : all.filter((r) => r.profile === filter);
  const countOf = (id: ProfileId) => all.filter((r) => r.profile === id).length;

  const triggered = records.filter(
    (r) => r.actualResult !== 'not_triggered' && r.actualResult !== 'pending',
  );
  const closed = triggered.filter((r) => r.actualResult !== 'open');
  const wins = closed.filter((r) => r.actualResult.startsWith('target')).length;
  const returns = triggered.map((r) => r.actualReturn).filter((v): v is number => v != null);
  const avgReturn = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[13px] text-text-muted">판정 기준</span>
        {FILTERS.map((f) => {
          const count = f.id === 'all' ? all.length : countOf(f.id);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-md border px-2 py-0.5 text-[13px] transition-colors ${
                filter === f.id
                  ? 'border-accent bg-accent/10 font-medium text-accent'
                  : 'border-border text-text-secondary hover:border-accent/50'
              }`}
            >
              {f.label} {count}
            </button>
          );
        })}
      </div>

      {!records.length ? (
        <p className="text-xs text-text-muted">이 기준으로 기록된 추천이 없습니다.</p>
      ) : (
      <>
      <p className="text-[13px] text-text-secondary">
        기록된 추천 {records.length}건 · 체결 {triggered.length}건 · 결판 {closed.length}건 중 목표
        도달 {wins}건
        {closed.length ? ` (${Math.round((wins / closed.length) * 100)}%)` : ''} · 평균 수익률{' '}
        {avgReturn == null ? '—' : formatPercent(avgReturn)}
        {closed.length > 0 && closed.length < SMALL_SAMPLE && (
          <span className="ml-1 rounded bg-warning/15 px-1.5 py-0.5 text-[13px] text-warning">
            표본 적음 ({closed.length}건)
          </span>
        )}
        <br />
        계획대로 1차에서 절반, 2차에서 나머지를 정리했다고 가정해 계산합니다. 눌림·돌파 대기 추천은
        조건이 오지 않으면 <span className="text-text-primary">미체결</span> 로 두고 승률 계산에서
        뺍니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="text-text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2">추천일</th>
              <th className="pr-2">종목</th>
              <th className="pr-2">기준</th>
              <th className="pr-2">점수</th>
              <th className="pr-2">매수</th>
              <th className="pr-2">1차</th>
              <th className="pr-2">2차</th>
              <th className="pr-2">손절</th>
              <th className="pr-2">7일</th>
              <th className="pr-2">30일</th>
              <th className="pr-2">결과</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => {
              const result = RESULT_LABEL[row.actualResult] ?? RESULT_LABEL.pending;
              const change = (to: number | null) =>
                to && row.priceAtAnalysis
                  ? formatPercent(((to - row.priceAtAnalysis) / row.priceAtAnalysis) * 100)
                  : '—';
              return (
                <tr key={row.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 text-text-secondary">{row.analyzedAt.slice(0, 10)}</td>
                  <td className="pr-2">
                    <StockName symbol={row.symbol} name={row.name} />
                  </td>
                  <td className="pr-2">
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] text-text-secondary">
                      {PROFILE_LABEL[row.profile]}
                    </span>
                  </td>
                  <td className="pr-2 tabular-nums">{row.score}</td>
                  <td className="pr-2 tabular-nums">{row.entryPrice?.toFixed(2) ?? '—'}</td>
                  <td className="pr-2 tabular-nums">{row.target1Price?.toFixed(2) ?? '—'}</td>
                  <td className="pr-2 tabular-nums">{row.target2Price?.toFixed(2) ?? '—'}</td>
                  <td className="pr-2 tabular-nums">{row.stopLossPrice?.toFixed(2) ?? '—'}</td>
                  <td className="pr-2 tabular-nums">{change(row.priceAfter7d)}</td>
                  <td className="pr-2 tabular-nums">{change(row.priceAfter30d)}</td>
                  <td className={`pr-2 ${result.className}`}>{result.text}</td>
                  <td className="tabular-nums">
                    {row.actualReturn == null ? '—' : formatPercent(row.actualReturn)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>
      )}
    </div>
  );
}

/**
 * 「추천 이력」 탭 — 스윙 추천 이력 + 맨 아래 「목표 도달 가능성 기록」(v2.29.0, 예전 「목표 도달 분석」 탭의 기록·필터·삭제·성적 그대로).
 * 옛 조건(+5/−3/10일 등) 기록도 지우지 않고 여기 그대로 보이고 채점된다.
 */
export default function SwingHistory() {
  return (
    <div className="space-y-4">
      <RecommendationHistory />
      <TargetRecords />
    </div>
  );
}

function TargetRecords() {
  const target = useTargetAnalysis();
  const count = target.records?.length;
  return (
    <details className="rounded-lg border border-border bg-bg-secondary/40 px-3 py-2">
      <summary className="text-xs font-semibold text-text-secondary">
        목표 도달 가능성 기록{count != null ? ` (${count}건)` : ''}
      </summary>
      <div className="mt-2">
        <TargetHistorySection
          records={target.records}
          stats={target.stats}
          progress={target.progress}
          error={target.error}
          remove={target.remove}
        />
      </div>
    </details>
  );
}
