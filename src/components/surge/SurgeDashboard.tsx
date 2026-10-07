import { RemoveAllButton } from '../ui';
import { Fragment } from 'react';
import { usePageTab } from '../../hooks/usePageTab';
import PageHeader from '../ui/PageHeader';
import type { PageTab } from '../../types/nav';
import { useSurgeDetection, useSurgeHistory } from '../../hooks/useSurge';
import { usePaperQuickBuy } from '../../hooks/usePaperQuickBuy';
import PeriodicSurgeList from './PeriodicSurgeList';
import SurgeSearch from './SurgeSearch';
import SurgeSettings from './SurgeSettings';
import StockName from '../common/StockName';
import CriteriaPanel from '../common/CriteriaPanel';
import NextSurgeDate from './NextSurgeDate';
import { SURGE_CRITERIA } from '../../data/criteria';
import { formatPercent } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import TrashIcon from '../common/TrashIcon';
import type { SurgeDetection } from '../../types/surge';

/** 탭 목록은 `types/nav.ts` 의 `PAGE_TABS` 한 곳 — 주소 `#/surge/{탭}` (v2.28.0) */
type Tab = PageTab<'surge'>;

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '주기적 급등 종목' },
  { id: 'search', label: '종목 검색 평가' },
  { id: 'history', label: '탐지 히스토리' },
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
  const [tab, setTab] = usePageTab('surge');
  const detection = useSurgeDetection(watchlist);
  const paperBuy = usePaperQuickBuy();

  return (
    <div className="flex h-full flex-col">
      {/*
        ⚠️ **검증 전 기능이라는 것을 화면이 먼저 말한다** (2026-09-25).
        실제로 써 보니 탐지된 종목이 이미 급등한 뒤였는데, 구조상 당연하다 — 종목 풀이
        상승률·거래량 상위 랭킹이고 판정은 일봉의 과거 급등 간격 평균이다.
        지우지 않고 격하해 두는 이유는, 검증 뒤 되돌리기 쉽게 하기 위해서다.
      */}
      <p className="shrink-0 border-b border-warning/40 bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-warning">
        <b>테스트 기능</b> — 이미 많이 오른 종목(상승률·거래량 상위)에서 출발하고, 하루 단위
        데이터로 판단합니다. 매매 근거로 쓰기 전에 성과 검증이 필요합니다.
        {/* 왜 발굴 팝업에서 사라졌는지 여기 남긴다 — "왜 없어졌지?" 를 막는다 (v2.15.0) */}
        <br />
        자동매매 후보에서는 제외됨(2026-09-29, 진단 근거 — 급등 다음 날 매수 시 −5% 먼저 62%).
      </p>

      <PageHeader tabs={TABS} value={tab} onChange={setTab} tabsLabel="급등 탐지" />

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'list' && (
          <div className="space-y-3">
            {/* 무슨 기준으로 급등이라 부르는지 — 결과 위에 둔다 */}
            <CriteriaPanel spec={SURGE_CRITERIA} />
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
          </div>
        )}
        {tab === 'search' && (
          <SurgeSearch
            watchlist={watchlist}
            onSelectSymbol={onSelectSymbol}
            onWatch={onWatch}
            onAnalyze={onAnalyze}
          />
        )}
        {tab === 'history' && (
          <SurgeHistoryTable running={detection.progress?.running ?? false} onDeleted={detection.reload} />
        )}
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
/** 삭제 확인창 공통 문구 — 무엇이 사라지고 무엇이 남는지 */
const DELETE_NOTE =
  '삭제하면 진단 리포트의 급등 예측 성적이 처음부터 다시 쌓입니다. 「주기적 급등 종목」 탭의 최근 결과도 함께 사라질 수 있습니다. AI 분석은 이 히스토리를 읽지 않으므로 영향이 없습니다.';

const roundLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
};

function SurgeHistoryTable({ running, onDeleted }: { running: boolean; onDeleted: () => void }) {
  const { detections, loading, remove } = useSurgeHistory(true);

  const confirmDelete = (detectedAt?: string, count?: number) => {
    modal.confirm({
      title: detectedAt ? '탐지 회차 삭제' : '탐지 히스토리 모두 삭제',
      message: detectedAt
        ? `${roundLabel(detectedAt)} 회차(${count}종목)를 삭제합니다. 되돌릴 수 없습니다. ${DELETE_NOTE}`
        : `탐지 히스토리 ${detections.length}건을 모두 삭제합니다. 되돌릴 수 없습니다. ${DELETE_NOTE} 설정과 캐시는 남습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        try {
          const deleted = await remove(detectedAt);
          toast.success(`${deleted}건 삭제 완료`);
          // 「주기적 급등 종목」 탭도 같은 표의 최신 회차를 읽는다 — 함께 다시 읽는다
          onDeleted();
        } catch (e) {
          toast.error('삭제 실패', (e as Error).message);
        }
      },
    });
  };

  if (loading && !detections.length) return <p className="text-xs text-text-muted">히스토리를 불러오는 중…</p>;
  if (!detections.length) {
    return <p className="text-xs text-text-muted">아직 탐지 히스토리가 없습니다.</p>;
  }

  // 회차(detected_at)별로 묶는다 — 서버가 최신 회차부터 준다
  const rounds: { at: string; rows: SurgeDetection[] }[] = [];
  for (const row of detections) {
    const last = rounds.at(-1);
    if (last && last.at === row.detectedAt) last.rows.push(row);
    else rounds.push({ at: row.detectedAt, rows: [row] });
  }

  const judged = detections.filter((d) => d.actualSurged != null);
  const hits = judged.filter((d) => d.actualSurged).length;

  const changeOf = (from: number | null, to: number | null) =>
    from && to ? formatPercent(((to - from) / from) * 100) : '—';

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <p className="text-[13px] text-text-secondary">
          채점 완료 {judged.length}건 중 실제 급등 {hits}건
          {judged.length ? ` (${Math.round((hits / judged.length) * 100)}%)` : ''} · 탐지 후 30일
          안에 같은 기준의 급등이 나왔는지로 판정합니다.
        </p>
        {/* 탐지 중에는 감춘다(예전: 꺼진 버튼 + "탐지가 끝난 뒤에 지울 수 있습니다") */}
        {!running && <RemoveAllButton onClick={() => confirmDelete()} className="ml-auto" />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="whitespace-nowrap text-text-muted">
            <tr className="border-b border-border/50">
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
            {rounds.map((round) => (
              <Fragment key={round.at}>
                <tr className="border-b border-border/50 bg-bg-tertiary/40">
                  <td colSpan={8} className="py-1 pr-1">
                    <div className="flex items-center gap-2 text-text-secondary">
                      <span>
                        탐지 회차 {roundLabel(round.at)} · {round.rows.length}종목
                      </span>
                      <button
                        type="button"
                        onClick={() => confirmDelete(round.at, round.rows.length)}
                        disabled={running}
                        aria-label={`${roundLabel(round.at)} 회차 삭제`}
                        title="이 회차 삭제"
                        className="ml-auto rounded p-1 transition-colors hover:bg-bg-tertiary hover:text-bearish disabled:opacity-40"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
                {round.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-text-secondary">{row.detectedAt.slice(0, 10)}</td>
                    <td className="pr-2">
                      <StockName symbol={row.symbol} name={row.name} />
                    </td>
                    <td className="pr-2 tabular-nums">{row.surgeScore}</td>
                    <td className="pr-2 text-text-secondary">
                      <NextSurgeDate
                        date={row.nextEstimatedDate}
                        daysUntil={row.daysUntilNext}
                        overdueDays={row.overdueDays}
                        atDetection
                      />
                    </td>
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
                          급등 {row.actualSurgeDate} (+{row.actualSurgePercent?.toFixed(1)}%)
                        </span>
                      ) : (
                        <span className="text-text-secondary">없음</span>
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
