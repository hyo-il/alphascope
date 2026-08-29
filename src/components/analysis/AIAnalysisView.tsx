import { useState, type ReactNode } from 'react';
import AutoAnalysisPanel from './AutoAnalysisPanel';
import AutoTradePanel from './AutoTradePanel';
import AnalysisTimeline from './AnalysisTimeline';
import AIAccuracyDashboard from './AIAccuracyDashboard';

/**
 * AI 분석 하나의 메뉴 아래에 수동(Claude)과 자동(Gemini)을 모은다.
 *
 * 두 방식은 입력(차트·지표·재무)도 출력(매매 신호)도 같고 호출 방법만 다르다.
 * 메뉴를 둘로 나누면 "어느 쪽으로 들어가야 하지" 를 매번 고민하게 된다.
 */
export type AITab = 'manual' | 'auto' | 'trade' | 'results' | 'accuracy';

/**
 * 분석을 한 바퀴 돌린 결과 — 실행한 화면이 상위에 알린다.
 *
 * 전체 종목을 돌렸는데 결과 탭이 '현재 종목만' 으로 걸러져 있으면 방금 분석한
 * 다른 종목이 하나도 보이지 않는다. 실제로 "분석 결과가 안 나온다" 는 신고가
 * 이것이었다 — 그래서 실행 범위를 함께 넘겨 필터를 맞춰 준다.
 */
export interface AnalysisRunResult {
  /** 'all' 이면 여러 종목 — 결과 탭의 종목 필터를 푼다 */
  scope: 'all' | 'single';
  /** 실행을 시작한 시각 — 이 뒤에 생긴 결과에 NEW 를 붙인다 */
  since: number;
}

/**
 * 자동 '분석' 과 자동 '매매' 를 나눈 이유:
 * 한 화면에 쌓으면 돈이 움직이는 스위치가 스크롤 아래로 밀려 보이지 않는다.
 * 매매 탭은 열자마자 ON/OFF 가 최상단에 있다.
 */
const TABS: { id: AITab; label: string }[] = [
  { id: 'manual', label: '수동 분석' },
  { id: 'auto', label: '자동 분석' },
  { id: 'trade', label: '자동 매매' },
  { id: 'results', label: '분석 결과' },
  { id: 'accuracy', label: '분석 성적표' },
];

export default function AIAnalysisView({
  symbol,
  currentPrice,
  /** 수동 분석(Claude) 화면 — App 이 이미 만들어 넘긴다 */
  manual,
}: {
  symbol: string | null;
  currentPrice: number | null;
  manual: ReactNode;
}) {
  const [tab, setTab] = useState<AITab>('manual');
  // 자동 분석을 돌린 직후 '분석 결과' 가 최신을 보여 주도록 강제 갱신 키를 넘긴다.
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRun, setLastRun] = useState<AnalysisRunResult | null>(null);

  /** 분석이 끝나면 결과 탭으로 데려간다 — 실행한 자리에 남으면 아무 일도 없어 보인다. */
  const handleAnalyzed = (result: AnalysisRunResult) => {
    setLastRun(result);
    setRefreshKey((key) => key + 1);
    setTab('results');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-1">
        {TABS.map((item) => (
          <button
            key={item.id}
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
        {tab === 'manual' && manual}
        {tab === 'auto' && <AutoAnalysisPanel symbol={symbol} onAnalyzed={handleAnalyzed} />}
        {tab === 'trade' && <AutoTradePanel onAnalyzed={handleAnalyzed} />}
        {tab === 'results' && (
          <AnalysisTimeline
            symbol={symbol}
            currentPrice={currentPrice}
            refreshKey={refreshKey}
            lastRun={lastRun}
          />
        )}
        {tab === 'accuracy' && <AIAccuracyDashboard />}
      </div>
    </div>
  );
}
