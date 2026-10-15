import { formatDateTime } from '../../../utils/dateFormat';
import { PANEL_PAD, PANEL_X, Tabs } from '../../ui';
import Button from '../../ui/Button';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import type { Candle, Timeframe } from '../../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../../types/chart';
import type { GeminiAnalysis } from '../../../types/gemini';
import ManualAnalysis from '../../analysis/ManualAnalysis';
import AnalysisHistory from '../../analysis/AnalysisHistory';
import { useAppStore } from '../../../store/appStore';
import { SIGNAL_CLASS, SIGNAL_LABEL, confidencePercent } from '../../analysis/signalStyle';
import { toast } from '../../../store/uiStore';

/**
 * 차트 하단의 AI 분석 탭 — **지금 보고 있는 종목만** 다룬다.
 *
 * v2.47.0 (퀀트 5단계, A-2): 사이드 메뉴의 「AI 분석」 화면을 없애고 이 탭 하나로 모았다.
 * - 수동 분석은 간단 모드(①②③ 버튼)가 기본이고, [분석 방식·프롬프트 수정 보기] 를 누르면 **같은 자리에서** 예전 AI 분석 화면의
 *   전체 모드(분석 방식 3종 · 상세 캡처 · 프롬프트 수정 · Claude 답변 저장 `AnalysisHistory`)로 바뀐다 — 기능을 잃지 않게.
 * - 기록·성적표·지정 종목은 「퀀트 > 검증 기록 > AI 분석」(#/records/analysis).
 */

type SubTab = 'manual' | 'auto';

/*
  v2.26.0 — 하위 탭은 둘(사용자 결정 C-1). 'auto' 는 **이 종목을 지금 한 번 분석하는 버튼**이다 —
  저장 출처(trigger)는 그대로 'manual'(「바로 분석」 배지)이고, 채점·필터가 그 값을 쓰므로 바꾸지 않는다.
  탭 안에 "버튼을 누르면 …" 설명을 둬서 계좌 자동매매와 헷갈리지 않게 한다.
  기록은 차트 탭에서 보여 주지 않는다(C-2) — [AI 분석 히스토리로 이동] 이 「퀀트 > 검증 기록 > AI 분석」(#/records/analysis)을 연다(v2.47.0).
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
}: {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  toggles: IndicatorToggles;
  getChartSnapshot: ComponentProps<typeof ManualAnalysis>['getChartSnapshot'];
}) {
  const [tab, setTab] = useState<SubTab>('manual');
  const setPage = useAppStore((s) => s.setPage);
  /** 수동 분석 전체 모드인지 (v2.47.0) — 펼침은 기억하지 않는다 */
  const [full, setFull] = useState(false);
  /** 전체 모드에서 Claude 답변을 저장할 때 함께 남길 '방금 쓴 프롬프트' (예전 App 이 들고 있던 값) */
  const [lastPrompt, setLastPrompt] = useState({ mode: 'multi', text: '' });

  return (
    <div className="flex h-full flex-col">
      {/* 소탭 줄 — ui/Tabs(sm) · 왼쪽 끝은 위 탭 줄·아래 내용과 같은 선(PANEL_X, v2.42.2 — 예전 직접 만든 버튼 px-2.5) */}
      <div className={`flex shrink-0 items-center border-b border-border/60 ${PANEL_X}`}>
        <Tabs label="AI 분석 하위 탭" line={false} size="sm" items={SUB_TABS} value={tab} onChange={setTab} />
        {/* 기록은 「검증 기록」 의 AI 분석 탭(주소 #/records/analysis, v2.47.0) */}
        <button
          type="button"
          onClick={() => setPage('records', 'analysis')}
          className="ml-auto py-1 text-caption text-text-muted transition-colors hover:text-accent"
        >
          AI 분석 히스토리로 이동
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'manual' && full && (
          <div className={`space-y-4 ${PANEL_PAD}`}>
            <div className="flex items-center gap-2">
              <span className="text-caption text-text-muted">분석 방식을 고르고 프롬프트를 고쳐 Claude 에 보냅니다. 받은 답변은 아래에 저장합니다.</span>
              <Button size="sm" variant="secondary" className="ml-auto shrink-0" onClick={() => setFull(false)}>
                간단히 보기
              </Button>
            </div>
            <ManualAnalysis
              symbol={symbol}
              timeframe={timeframe}
              candles={candles}
              currentPrice={currentPrice}
              indicators={indicators}
              toggles={toggles}
              getChartSnapshot={getChartSnapshot}
              onPromptChange={setLastPrompt}
            />
            <AnalysisHistory symbol={symbol} timeframe={timeframe} currentPrice={currentPrice} mode={lastPrompt.mode} prompt={lastPrompt.text} />
          </div>
        )}
        {tab === 'manual' && !full && (
          <ManualAnalysis
            symbol={symbol}
            timeframe={timeframe}
            candles={candles}
            currentPrice={currentPrice}
            indicators={indicators}
            toggles={toggles}
            getChartSnapshot={getChartSnapshot}
            compact
            onOpenFull={() => setFull(true)}
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

  if (enabled === null) return <p className={`${PANEL_PAD} text-caption text-text-muted`}>확인 중…</p>;

  if (!enabled && offReason?.includes('GEMINI_ENABLED')) {
    return <p className={`${PANEL_PAD} text-caption text-text-muted`}>{offReason}. 수동 분석(Claude)은 그대로 씁니다.</p>;
  }

  if (!enabled) {
    return (
      <p className={`${PANEL_PAD} text-caption text-text-muted`}>
        Gemini 키가 없어 Gemini 분석을 쓸 수 없습니다. <code>.env</code> 에{' '}
        <code>GEMINI_API_KEY</code> 를 넣으면 이 버튼이 활성화됩니다. 수동 분석(Claude)은 키 없이
        그대로 씁니다.
      </p>
    );
  }

  return (
    <div className={`space-y-2 ${PANEL_PAD} text-caption`}>
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
            {formatDateTime(latest.createdAt)}
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
        지정 종목 분석과 지난 분석은 「퀀트 &gt; 검증 기록 &gt; AI 분석」에서 봅니다.
      </p>
    </div>
  );
}
