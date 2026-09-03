import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import type { Candle, Timeframe } from '../../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../../types/chart';
import type { GeminiAnalysis } from '../../../types/gemini';
import ManualAnalysis from '../../analysis/ManualAnalysis';
import AnalysisTimeline from '../../analysis/AnalysisTimeline';
import { SIGNAL_CLASS, SIGNAL_LABEL, confidencePercent } from '../../analysis/signalStyle';
import { toast } from '../../../store/uiStore';

/**
 * 차트 하단의 AI 분석 탭.
 *
 * 사이드 메뉴의 AI 분석 화면과 달리 **지금 보고 있는 종목만** 다룬다 —
 * 자동 분석 설정(대상 종목·주기·자동매매)은 전체 화면 쪽에 그대로 두고,
 * 여기서는 "이 종목 지금 분석" 과 "이 종목 결과" 만 남긴다.
 */

type SubTab = 'manual' | 'auto' | 'results';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'manual', label: '수동 분석' },
  { id: 'auto', label: '자동 분석' },
  { id: 'results', label: '분석 결과' },
];

export default function ChartAiPanel({
  symbol,
  timeframe,
  candles,
  currentPrice,
  indicators,
  toggles,
  getChartSnapshot,
  onPromptChange,
  onOpenFullView,
}: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  toggles: IndicatorToggles;
  getChartSnapshot: ComponentProps<typeof ManualAnalysis>['getChartSnapshot'];
  onPromptChange?: ComponentProps<typeof ManualAnalysis>['onPromptChange'];
  onOpenFullView: () => void;
}) {
  const [tab, setTab] = useState<SubTab>('manual');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-2.5 py-1 text-[11px] transition-colors ${
              tab === item.id ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenFullView}
          className="ml-auto px-2 py-1 text-[11px] text-text-muted transition-colors hover:text-accent"
        >
          전체 화면으로 ↗
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'manual' && (
          <ManualAnalysis
            symbol={symbol}
            timeframe={timeframe}
            candles={candles}
            currentPrice={currentPrice}
            indicators={indicators}
            toggles={toggles}
            getChartSnapshot={getChartSnapshot}
            onPromptChange={onPromptChange}
          />
        )}

        {tab === 'auto' && (
          <SingleSymbolGemini
            symbol={symbol}
            onAnalyzed={() => {
              setRefreshKey((key) => key + 1);
              setTab('results');
            }}
          />
        )}

        {tab === 'results' && (
          <div className="p-2">
            {/* 이 종목만 — 차트에서 보고 있는 종목의 결과가 아니면 여기 있을 이유가 없다 */}
            <AnalysisTimeline
              symbol={symbol}
              currentPrice={currentPrice}
              refreshKey={refreshKey}
              lastRun={null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 이 종목만 Gemini 분석.
 *
 * 키가 없으면 서버가 503 + geminiDisabled 로 답한다 — 버튼을 띄우지 않고 이유를 적는다.
 */
function SingleSymbolGemini({
  symbol,
  onAnalyzed,
}: {
  symbol: string;
  onAnalyzed: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [model, setModel] = useState<string>('');
  const [latest, setLatest] = useState<GeminiAnalysis | null>(null);
  const [running, setRunning] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const response = await fetch(`/api/gemini/analyses?symbol=${symbol}&limit=1`);
      if (!response.ok) return;
      // 이 라우트는 배열을 그대로 돌려준다 (다른 라우트처럼 {analyses:[]} 가 아니다).
      const data = (await response.json()) as GeminiAnalysis[] | { analyses?: GeminiAnalysis[] };
      const rows = Array.isArray(data) ? data : (data.analyses ?? []);
      setLatest(rows[0] ?? null);
    } catch {
      // 최근 결과는 없어도 실행에는 지장이 없다.
    }
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/gemini/status')
      .then((r) => r.json())
      .then((data: { enabled?: boolean; model?: string }) => {
        if (cancelled) return;
        setEnabled(Boolean(data.enabled));
        setModel(data.model ?? '');
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    void loadLatest();
    return () => {
      cancelled = true;
    };
  }, [symbol, loadLatest]);

  const analyze = async () => {
    setRunning(true);
    try {
      const response = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '분석 실패');
      toast.success(`${symbol} 분석 완료 — ${data.signal}`, data.summary);
      await loadLatest();
      onAnalyzed();
    } catch (e) {
      toast.error(`${symbol} 분석 실패`, (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (enabled === null) return <p className="p-3 text-[11px] text-text-muted">확인 중…</p>;

  if (!enabled) {
    return (
      <p className="p-3 text-[11px] text-text-muted">
        Gemini 키가 없어 자동 분석을 쓸 수 없습니다. <code>.env</code> 에{' '}
        <code>GEMINI_API_KEY</code> 를 넣으면 이 버튼이 활성화됩니다. 수동 분석(Claude)은 키 없이
        그대로 씁니다.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-secondary">
          이 종목 Gemini 분석{model && <span className="ml-1 text-text-muted">({model})</span>}
        </span>
        <button
          type="button"
          onClick={analyze}
          disabled={running}
          className="rounded bg-accent px-2.5 py-1 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {running ? '분석 중… (약 8초)' : '▶ 지금 분석'}
        </button>
      </div>

      {latest ? (
        <p className="text-text-secondary">
          최근 결과:{' '}
          <span className={SIGNAL_CLASS[latest.signal]}>{SIGNAL_LABEL[latest.signal]}</span>{' '}
          {confidencePercent(latest.confidence)} ·{' '}
          <span className="text-text-muted">
            {new Date(latest.createdAt).toLocaleString('ko-KR')}
          </span>
          {latest.summary && <span className="ml-1 text-text-muted">"{latest.summary}"</span>}
        </p>
      ) : (
        <p className="text-text-muted">이 종목의 분석 기록이 아직 없습니다.</p>
      )}

      <p className="text-text-muted">
        4명의 에이전트 + 종합 의장이 2라운드로 토론합니다 (1종목 5회 호출). 대상 종목·주기·자동매매
        설정은 [전체 화면으로] 의 자동 분석 탭에 있습니다.
      </p>
    </div>
  );
}
