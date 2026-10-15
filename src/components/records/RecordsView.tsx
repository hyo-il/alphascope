import { useState } from 'react';
import { PANEL_PAD } from '../ui/tokens';
import PageHeader from '../ui/PageHeader';
import { Segmented, Select } from '../ui';
import { usePageTab } from '../../hooks/usePageTab';
import type { PageTab } from '../../types/nav';
import { useAppStore } from '../../store/appStore';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { useAiCheckHistory } from '../../hooks/useAiCheckHistory';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { TargetHistorySection } from '../swing/TargetAnalysisParts';
import AiCheckHistoryPanel from '../paper-trading/AiCheckHistoryPanel';
import AIStatusBoard from '../analysis/AIStatusBoard';
import ScheduledSymbols from '../analysis/ScheduledSymbols';
import AnalysisTimeline from '../analysis/AnalysisTimeline';
import AIAccuracyDashboard from '../analysis/AIAccuracyDashboard';
import DiagnoseView from '../diagnose/DiagnoseView';

/**
 * 「퀀트 > 검증 기록」 (v2.47.0 — 퀀트 다시 만들기 5단계, 사용자 결정 A-4~A-8).
 *
 * 앱이 남긴 판단·분석이 그 뒤 어땠는지 보는 화면을 한 곳에 모았다. 탭 순서는 `types/nav.ts` 의 `PAGE_TABS.records` 한 곳:
 * - 목표 수익 가능성 — 예전 「매수 판단 > 히스토리」 ③(`TargetHistorySection` 그대로). 실행·결과 카드는 매수 판단 표에 남는다
 * - AI 검증 — 계좌 화면과 **같은 부품·같은 채점**(`AiCheckHistoryPanel` · `server/aiCheck/history.ts`). 처음은 모든 계좌, 계좌를 고를 수 있다
 * - AI 분석 — 예전 「투자 분석 > AI 분석」 의 히스토리 · 성적표 (상태 판 · 지정 종목 · 기록 · 성적표)
 * - 진단 리포트 — 예전 「실험실 > 진단 리포트」 그대로
 */
type RecordsTab = PageTab<'records'>;

const TABS: { id: RecordsTab; label: string }[] = [
  { id: 'target', label: '목표 수익 가능성' },
  { id: 'aicheck', label: 'AI 검증' },
  { id: 'analysis', label: 'AI 분석' },
  { id: 'diagnose', label: '진단 리포트' },
];

export default function RecordsView({ currentPrice }: { currentPrice: number | null }) {
  const [tab, setTab] = usePageTab('records');

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="검증 기록" tabs={TABS} value={tab} onChange={setTab} tabsLabel="검증 기록" />
      <div className={`min-h-0 flex-1 overflow-auto ${PANEL_PAD}`}>
        {tab === 'target' && <TargetTab />}
        {tab === 'aicheck' && <AiCheckTab />}
        {tab === 'analysis' && <AnalysisTab currentPrice={currentPrice} />}
        {tab === 'diagnose' && <DiagnoseView />}
      </div>
    </div>
  );
}

/** 목표 수익 가능성 기록·성적 — 탭을 열 때만 받는다(예전 매수 판단 화면은 열 때마다 받았다) */
function TargetTab() {
  const target = useTargetAnalysis();
  return (
    <TargetHistorySection records={target.records} stats={target.stats} progress={target.progress} error={target.error} remove={target.remove} />
  );
}

/** AI 검증 — 모든 계좌(기본) 또는 계좌 하나. 고른 계좌는 기억하지 않는다 */
function AiCheckTab() {
  const { accounts } = usePaperAccounts();
  const [scope, setScope] = useState<'all' | number>('all');
  const history = useAiCheckHistory(scope);
  const nameOf = (id: number) => accounts.find((a) => a.id === id)?.name ?? `계좌 ${id}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={scope === 'all' ? 'all' : String(scope)}
          onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          aria-label="계좌"
        >
          <option value="all">모든 계좌</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <span className="text-caption text-text-muted">
          {scope === 'all' ? '같은 날·같은 종목의 검증을 여러 계좌가 썼으면 한 줄로 묶습니다(AI에게 한 번 물었습니다).' : '이 계좌가 쓴 검증만 봅니다.'}
        </span>
      </div>
      <AiCheckHistoryPanel
        data={history.data}
        loading={history.loading}
        error={history.error}
        onMore={history.more}
        accountName={nameOf}
        emptyText={
          scope === 'all'
            ? '아직 AI 검증 기록이 없습니다. 계좌 자동매매 설정에서 「AI 검증」 을 켜면, 규칙이 「사도 됨」 을 낸 날 사기 직전에 AI에게 묻고 여기에 남깁니다.'
            : '이 계좌의 AI 검증 기록이 없습니다.'
        }
      />
    </div>
  );
}

/**
 * AI 분석 — 히스토리 / 성적표를 묶음 버튼으로 나눈다(쌓지 않는다). 성적표는 표가 길어 히스토리 아래에 쌓으면 한참 내려야 보이고,
 * 두 내용이 서로를 보면서 쓰는 화면이 아니라서다. 묶음 버튼은 주소에 넣지 않는다(탭 안의 보기 — 패널 규칙과 같다).
 */
function AnalysisTab({ currentPrice }: { currentPrice: number | null }) {
  const symbol = useAppStore((s) => s.symbol);
  const [view, setView] = useState<'history' | 'accuracy'>('history');
  return (
    <div className="space-y-3">
      <Segmented
        label="AI 분석 보기"
        value={view}
        onChange={setView}
        options={[
          { value: 'history', label: '히스토리' },
          { value: 'accuracy', label: '성적표' },
        ]}
      />
      {view === 'history' ? (
        <div className="space-y-3">
          <AIStatusBoard scheduled={<ScheduledSymbols />} />
          <AnalysisTimeline symbol={symbol} currentPrice={currentPrice} />
        </div>
      ) : (
        <AIAccuracyDashboard />
      )}
    </div>
  );
}
