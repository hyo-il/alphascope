import { useSwingHistory } from '../../hooks/useSwing';
import StockName from '../common/StockName';
import { formatPercent } from '../../utils/formatters';

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
export default function SwingHistory() {
  const { records, loading } = useSwingHistory(true);

  if (loading) return <p className="text-xs text-text-muted">이력을 불러오는 중…</p>;
  if (!records.length) {
    return (
      <p className="text-xs text-text-muted">
        아직 추천 이력이 없습니다. [🔄 다시 분석] 으로 관심 종목을 분석하면 추천(65점 이상)만
        기록됩니다.
      </p>
    );
  }

  const triggered = records.filter(
    (r) => r.actualResult !== 'not_triggered' && r.actualResult !== 'pending',
  );
  const closed = triggered.filter((r) => r.actualResult !== 'open');
  const wins = closed.filter((r) => r.actualResult.startsWith('target')).length;
  const returns = triggered.map((r) => r.actualReturn).filter((v): v is number => v != null);
  const avgReturn = returns.length ? returns.reduce((s, v) => s + v, 0) / returns.length : null;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-secondary">
        기록된 추천 {records.length}건 · 체결 {triggered.length}건 · 결판 {closed.length}건 중 목표
        도달 {wins}건
        {closed.length ? ` (${Math.round((wins / closed.length) * 100)}%)` : ''} · 평균 수익률{' '}
        {avgReturn == null ? '—' : formatPercent(avgReturn)}
        <br />
        계획대로 1차에서 절반, 2차에서 나머지를 정리했다고 가정해 계산합니다. 눌림·돌파 대기 추천은
        조건이 오지 않으면 <span className="text-text-primary">미체결</span> 로 두고 승률 계산에서
        뺍니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[11px]">
          <thead className="text-text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2">추천일</th>
              <th className="pr-2">종목</th>
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
    </div>
  );
}
