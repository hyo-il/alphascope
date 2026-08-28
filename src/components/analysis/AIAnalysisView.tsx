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
        {tab === 'auto' && (
          <AutoAnalysisPanel
            symbol={symbol}
            onAnalyzed={() => setRefreshKey((key) => key + 1)}
          />
        )}
        {tab === 'trade' && <AutoTradePanel />}
        {tab === 'results' && (
          <AnalysisTimeline symbol={symbol} currentPrice={currentPrice} refreshKey={refreshKey} />
        )}
        {tab === 'accuracy' && <AIAccuracyDashboard />}
      </div>
    </div>
  );
}
