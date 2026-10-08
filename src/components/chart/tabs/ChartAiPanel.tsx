import Button from '../../ui/Button';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import type { Candle, Timeframe } from '../../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../../types/chart';
import type { GeminiAnalysis } from '../../../types/gemini';
import ManualAnalysis from '../../analysis/ManualAnalysis';
import { useAppStore } from '../../../store/appStore';
import { SIGNAL_CLASS, SIGNAL_LABEL, confidencePercent } from '../../analysis/signalStyle';
import { toast } from '../../../store/uiStore';

/**
 * 차트 하단의 AI 분석 탭.
 *
 * 사이드 메뉴의 AI 분석 화면과 달리 **지금 보고 있는 종목만** 다룬다 —
 * 자동 분석 설정(대상 종목·주기·자동매매)은 전체 화면 쪽에 그대로 두고,
 * 여기서는 "이 종목 지금 분석" 과 "이 종목 결과" 만 남긴다.
 */

type SubTab = 'manual' | 'auto';

/*
  v2.26.0 — 하위 탭은 둘(사용자 결정 C-1). 'auto' 는 **이 종목을 지금 한 번 분석하는 버튼**이다 —
  저장 출처(trigger)는 그대로 'manual'(「바로 분석」 배지)이고, 채점·필터가 그 값을 쓰므로 바꾸지 않는다.
  탭 안에 "버튼을 누르면 …" 설명을 둬서 계좌 자동매매와 헷갈리지 않게 한다.
  기록은 차트 탭에서 보여 주지 않는다(C-2) — [이전 기록 보기] 가 「투자 분석 > AI 분석」 의 기록 탭(#/analysis/records)을 연다.
*/
const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'manual', label: '수동 분석' },
  { id: 'auto', label: '자동 분석' },
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
}: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  toggles: IndicatorToggles;
  getChartSnapshot: ComponentProps<typeof ManualAnalysis>['getChartSnapshot'];
  onPromptChange?: ComponentProps<typeof ManualAnalysis>['onPromptChange'];
}) {
  const [tab, setTab] = useState<SubTab>('manual');
  const setPage = useAppStore((s) => s.setPage);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`px-2.5 py-1 text-caption transition-colors ${
              tab === item.id ? 'font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
        {/* 예전 「전체 화면으로」 자리 — 기록은 AI 분석 화면의 기록 탭에서 이 종목만 걸러 연다(주소 #/analysis/records) */}
        <button
          type="button"
          onClick={() => setPage('analysis', 'results')}
          className="ml-auto px-2 py-1 text-caption text-text-muted transition-colors hover:text-accent"
        >
          AI 분석 히스토리로 이동
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
            compact
            onOpenFull={() => setPage('analysis', 'manual')}
          />
        )}

        {tab === 'auto' && <SingleSymbolGemini symbol={symbol} />}
      </div>
    </div>
  );
}

/**
 * 이 종목만 Gemini 분석.
 *
 * 키가 없으면 서버가 503 + geminiDisabled 로 답한다 — 버튼을 띄우지 않고 이유를 적는다.
 */
function SingleSymbolGemini({ symbol }: { symbol: string }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  /** 꺼진 이유 — 키 없음과 서버 스위치(GEMINI_ENABLED=false)는 대처가 다르다 */
  const [offReason, setOffReason] = useState<string | null>(null);
  const [model, setModel] = useState<string>('');
  const [latest, setLatest] = useState<GeminiAnalysis | null>(null);
  /** 최근 결과를 받았는지 (v2.38.0 로딩 점검) — 받기 전에 "기록이 아직 없습니다" 를 띄우지 않는다 */
  const [latestLoaded, setLatestLoaded] = useState(false);
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
    } finally {
      setLatestLoaded(true);
    }
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setLatest(null);
    setLatestLoaded(false);
    void fetch('/api/gemini/status')
      .then((r) => r.json())
      .then((data: { enabled?: boolean; model?: string; reason?: string | null }) => {
        if (cancelled) return;
        setEnabled(Boolean(data.enabled));
        setOffReason(data.reason ?? null);
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
    } catch (e) {
      toast.error(`${symbol} 분석 실패`, (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (enabled === null) return <p className="p-3 text-caption text-text-muted">확인 중…</p>;

  if (!enabled && offReason?.includes('GEMINI_ENABLED')) {
    return <p className="p-3 text-caption text-text-muted">{offReason}. 수동 분석(Claude)은 그대로 씁니다.</p>;
  }

  if (!enabled) {
    return (
      <p className="p-3 text-caption text-text-muted">
        Gemini 키가 없어 Gemini 분석을 쓸 수 없습니다. <code>.env</code> 에{' '}
        <code>GEMINI_API_KEY</code> 를 넣으면 이 버튼이 활성화됩니다. 수동 분석(Claude)은 키 없이
        그대로 씁니다.
      </p>
    );
  }

  return (
    <div className="space-y-2 p-3 text-caption">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-secondary">
          이 종목 Gemini 분석{model && <span className="ml-1 text-text-muted">({model})</span>}
        </span>
        {/* 계좌 자동매매와 헷갈리지 않게 — 이 탭은 버튼을 눌렀을 때만 돈다 (v2.26.0) */}
        <span className="text-text-muted">버튼을 누르면 Gemini 가 지금 이 종목을 분석합니다(약 5회 호출)</span>
        <Button variant="primary" size="sm"
          onClick={analyze}
          disabled={running}>
          {running ? '분석 중… (약 8초)' : '지금 분석'}
        </Button>
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
      ) : !latestLoaded ? (
        <p className="text-text-muted">최근 결과를 불러오는 중…</p>
      ) : (
        <p className="text-text-muted">이 종목의 분석 히스토리가 아직 없습니다.</p>
      )}

      <p className="text-text-muted">
        4명의 에이전트 + 종합 의장이 2라운드로 토론합니다 (1종목 5회 호출). 이 버튼은 지금 이 종목만 한 번 분석합니다.
      </p>
      <p className="text-text-muted">
        계좌 자동 분석과 지정 종목 분석은 「투자 분석 &gt; AI 분석 &gt; AI 분석 히스토리」에서 봅니다.
      </p>
    </div>
  );
}
