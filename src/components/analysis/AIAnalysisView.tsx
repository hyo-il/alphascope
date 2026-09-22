import { useState, type ReactNode } from 'react';
import AnalysisTimeline from './AnalysisTimeline';
import AIAccuracyDashboard from './AIAccuracyDashboard';

/**
 * AI 분석 하나의 메뉴 아래에 수동(Claude)과 자동(Gemini)을 모은다.
 *
 * 두 방식은 입력(차트·지표·재무)도 출력(매매 신호)도 같고 호출 방법만 다르다.
 * 메뉴를 둘로 나누면 "어느 쪽으로 들어가야 하지" 를 매번 고민하게 된다.
 */
export type AITab = 'manual' | 'results' | 'accuracy';

/**
 * ⚠️ **자동 분석·자동 매매 탭은 없앴다** (v2.4.0, Step 12 3단계).
 * 자동매매는 **계좌마다** 걸린다 — 진입점은 「계좌 관리 > 자동매매」 하나다.
 * 전역 설정 하나로 돌던 시절의 잔재를 여기 남겨 두면, 계좌 화면과 값이 달라 보여
 * 어느 쪽이 진짜인지 알 수 없었다.
 *
 * 이 화면에 남는 것은 **사람이 직접 하는 일**이다 — Claude 에 붙여넣을 프롬프트를 만들고,
 * 쌓인 분석 결과와 적중률을 본다.
 */
const TABS: { id: AITab; label: string }[] = [
  { id: 'manual', label: '수동 분석' },
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
        {tab === 'manual' && manual}
        {tab === 'results' && <AnalysisTimeline symbol={symbol} currentPrice={currentPrice} />}
        {tab === 'accuracy' && <AIAccuracyDashboard />}
      </div>
    </div>
  );
}
