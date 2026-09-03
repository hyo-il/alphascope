import { useState } from 'react';
import { useSurgeDetection, useSurgeHistory, useSurgeQuickBuy } from '../../hooks/useSurge';
import PeriodicSurgeList from './PeriodicSurgeList';
import SurgeSearch from './SurgeSearch';
import SurgeSettings from './SurgeSettings';
import SymbolLabel from '../common/SymbolLabel';
import { formatPercent } from '../../utils/formatters';

type Tab = 'list' | 'search' | 'history' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '주기적 급등 종목' },
  { id: 'search', label: '종목 검색 평가' },
  { id: 'history', label: '탐지 이력' },
  { id: 'settings', label: '설정' },
];

/**
 * 🔥 급등 탐지.
 *
 * 두 가지를 한 메뉴에 둔다 — 자동으로 찾아 주는 목록과, 궁금한 종목을 직접 평가하는 검색.
 * ⚠️ 실제 매매는 하지 않는다. [모의 매수] 는 모의투자 계좌에만 주문을 넣는다.
 */
export default function SurgeDashboard({
  watchlist,
  onSelectSymbol,
  onWatch,
  onAnalyze,
}: {
  watchlist: string[];
  onSelectSymbol: (symbol: string) => void;
  onWatch: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('list');
  const detection = useSurgeDetection(watchlist);
  const paperBuy = useSurgeQuickBuy();

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`border-b-2 px-3 py-2 text-sm transition-colors ${
              tab === item.id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'list' && (
          <PeriodicSurgeList
            results={detection.results}
            detectedAt={detection.detectedAt}
            progress={detection.progress}
            loading={detection.loading}
            error={detection.error}
            watchlist={watchlist}
            onDetect={detection.detect}
            onSelectSymbol={onSelectSymbol}
            onWatch={onWatch}
            onPaperBuy={paperBuy}
            onAnalyze={onAnalyze}
          />
        )}
        {tab === 'search' && (
          <SurgeSearch
            watchlist={watchlist}
            onSelectSymbol={onSelectSymbol}
            onWatch={onWatch}
            onAnalyze={onAnalyze}
          />
        )}
        {tab === 'history' && <SurgeHistoryTable />}
        {tab === 'settings' && <SurgeSettings watchlistCount={watchlist.length} />}
      </div>
    </div>
  );
}

/**
 * 지난 탐지의 성과 — 탐지 후 30일 안에 실제로 급등했는지.
 *
 * 채점은 서버가 이 목록을 읽을 때 함께 갱신한다 (별도 스케줄러를 두지 않았다).
 * 7일이 지나야 볼 것이 생기므로 그전에는 '대기' 로만 보인다.
 */
function SurgeHistoryTable() {
  const { detections, loading } = useSurgeHistory(true);

  if (loading) return <p className="text-xs text-text-muted">이력을 불러오는 중…</p>;
  if (!detections.length) {
    return <p className="text-xs text-text-muted">아직 탐지 이력이 없습니다.</p>;
  }

  const judged = detections.filter((d) => d.actualSurged != null);
  const hits = judged.filter((d) => d.actualSurged).length;

  const changeOf = (from: number | null, to: number | null) =>
    from && to ? formatPercent(((to - from) / from) * 100) : '—';

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-secondary">
        채점 완료 {judged.length}건 중 실제 급등 {hits}건
        {judged.length ? ` (${Math.round((hits / judged.length) * 100)}%)` : ''} · 탐지 후 30일
        안에 같은 기준의 급등이 나왔는지로 판정합니다.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[11px]">
          <thead className="text-text-muted">
            <tr className="border-b border-border">
              <th className="py-1.5 pr-2">탐지일</th>
              <th className="pr-2">종목</th>
              <th className="pr-2">점수</th>
              <th className="pr-2">예상일</th>
              <th className="pr-2">7일</th>
              <th className="pr-2">14일</th>
              <th className="pr-2">30일</th>
              <th>실제 급등</th>
            </tr>
          </thead>
          <tbody>
            {detections.map((row) => (
              <tr key={row.id} className="border-b border-border/50">
                <td className="py-1.5 pr-2 text-text-secondary">{row.detectedAt.slice(0, 10)}</td>
                <td className="pr-2">
                  <SymbolLabel symbol={row.symbol} name={row.name} />
                </td>
                <td className="pr-2 tabular-nums">{row.surgeScore}</td>
                <td className="pr-2 text-text-secondary">{row.nextEstimatedDate ?? '—'}</td>
                <td className="pr-2 tabular-nums">
                  {changeOf(row.priceAtDetection, row.priceAfter7d)}
                </td>
                <td className="pr-2 tabular-nums">
                  {changeOf(row.priceAtDetection, row.priceAfter14d)}
                </td>
                <td className="pr-2 tabular-nums">
                  {changeOf(row.priceAtDetection, row.priceAfter30d)}
                </td>
                <td>
                  {row.actualSurged == null ? (
                    <span className="text-text-muted">대기</span>
                  ) : row.actualSurged ? (
                    <span className="text-bullish">
                      ✅ {row.actualSurgeDate} (+{row.actualSurgePercent?.toFixed(1)}%)
                    </span>
                  ) : (
                    <span className="text-text-secondary">❌ 없음</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
