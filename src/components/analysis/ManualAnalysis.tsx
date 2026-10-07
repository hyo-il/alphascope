import DisclosureButton from '../ui/DisclosureButton';
import { useEffect, useMemo, useState } from 'react';
import { modal } from '../../store/uiStore';
import type { Candle, Timeframe } from '../../types/toss';
import type { AnalysisMode } from '../../types/analysis';
import { buildMultiAgentPrompt } from '../../services/analysis/multiAgentPrompt';
import { buildPortfolioPrompt, buildQuickPrompt } from '../../services/analysis/modePrompts';
import { useExchangeRate, useFundamentals, usePeers, usePortfolio } from '../../hooks/useCompany';
import { useSymbolSummaries } from '../../hooks/useSymbolSummaries';
import { useInvestorFlow } from '../../hooks/useInvestorFlow';
import { investorFlowBlock } from '../../utils/investorFlow';
import CopySteps from './CopySteps';
import ModeSelector from './ModeSelector';
import ChartCaptureModal from './ChartCaptureModal';
import type { DrawingSnapshot } from '../chart/CandleChart';
import type { IndicatorSeries, IndicatorToggles } from '../../types/chart';
import { useCaptureStore } from '../../store/captureStore';
import {
  DEFAULT_HORIZON,
  HORIZONS,
  horizonLabel,
  type InvestmentHorizon,
} from '../../services/analysis/horizons';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  indicators: IndicatorSeries | null;
  /** 캡처 팝업의 '포함 항목' 기본값 — 메인 차트에서 켜져 있는 것과 같게 시작한다 */
  toggles: IndicatorToggles;
  /** 캡처 팝업 차트를 메인 차트와 같은 구간·같은 드로잉으로 열기 위한 스냅샷 */
  getChartSnapshot: () => {
    range: { from: number; to: number } | null;
    drawings: DrawingSnapshot[];
  };
  /** 히스토리 탭이 '방금 쓴 프롬프트'를 함께 저장할 수 있도록 알려 준다 */
  onPromptChange?: (value: { mode: string; text: string }) => void;
  /**
   * 차트 하단 탭용 간단 모드 (v2.26.0) — 프롬프트 내용·모드·투자 기간을 그리지 않고 복사 단계만 보인다.
   * 프롬프트는 같은 조립 함수로 만든 **기본값**(전문가 분석 · DEFAULT_HORIZON, 편집 없음) — 두 벌로 두면 갈라진다.
   */
  compact?: boolean;
  /** 간단 모드의 「투자 분석 > AI 분석 열기」 */
  onOpenFull?: () => void;
}

/**
 * AI 분석 준비.
 *
 * 앱은 "Claude 에게 보낼 최적의 입력"을 만드는 데까지만 관여하고, 추론은 구독 대화에서 한다.
 * 덕분에 API 키도, 호출 비용도 필요 없다.
 */
export default function ManualAnalysis({
  symbol,
  timeframe,
  candles,
  currentPrice,
  indicators,
  toggles,
  getChartSnapshot,
  onPromptChange,
  compact = false,
  onOpenFull,
}: Props) {
  const [mode, setMode] = useState<AnalysisMode>('multi');
  const [crossReview, setCrossReview] = useState(false);
  /** 투자 기간 — 프롬프트의 판단 시간축을 정한다 */
  const [horizon, setHorizon] = useState<InvestmentHorizon>(DEFAULT_HORIZON);
  /** 사용자가 직접 고친 프롬프트. null 이면 자동 생성본을 그대로 쓴다. */
  const [edited, setEdited] = useState<string | null>(null);
  /** 캡처 팝업을 열 때 메인 차트에서 떠 온 스냅샷 (열려 있는 동안 고정) */
  const [captureContext, setCaptureContext] = useState<ReturnType<typeof getChartSnapshot> | null>(
    null,
  );
  const capture = useCaptureStore((s) => s.capture);
  const clearCapture = useCaptureStore((s) => s.clearCapture);
  /** 「프롬프트 수정」 펼침 (v2.28.0) — 기억하지 않는다(기본 접힘) */
  const [editorOpen, setEditorOpen] = useState(false);
  /**
   * 「지금 보고 있는 차트 캡처」 를 위해 화면 밖에서 찍는 중인 스냅샷 (v2.28.0, 전체 모드만).
   * 화면을 열 때·종목/봉이 바뀔 때 메인 차트 그대로 미리 찍어 둔다 — ① 버튼은 그 Blob 만 복사한다.
   */
  const [autoContext, setAutoContext] = useState<ReturnType<typeof getChartSnapshot> | null>(null);

  /** 자동 캡처 실패 이유 — 전체 모드의 ① 미리보기 자리에 보인다 (v2.34.0) */
  const [autoError, setAutoError] = useState<string | null>(null);

  const openCapture = () => setCaptureContext(getChartSnapshot());
  const startAutoCapture = () => {
    clearCapture(); // 다른 종목·예전 구간의 캡처가 ① 로 복사되지 않게
    setAutoError(null);
    setAutoContext(getChartSnapshot());
  };

  // 전체 모드·차트 하단 간단 모드 모두(v2.29.0 — 간단 모드에도 같은 코드로). 간단 모드는 차트 화면에서 그 탭을 열 때만 마운트된다
  // (ChartBottomTabs 의 `active`) — 다른 화면에서는 돌지 않는다.
  useEffect(() => {
    startAutoCapture();
    // 종목·봉이 바뀔 때만 — 함수는 매 렌더 새로 만들어진다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe]);

  /*
   * 캡처 이미지가 있으면 프롬프트도 그 이미지와 같은 봉을 가리켜야 한다.
   * 팝업에서 타임프레임을 바꿔 캡처할 수 있어서, 메인 차트가 일봉이어도
   * 이미지가 5분봉이면 프롬프트의 타임프레임·OHLCV 도 5분봉이 된다.
   * (다른 종목의 캡처가 남아 있으면 쓰지 않는다.)
   */
  const captureMatches = Boolean(capture && capture.symbol === symbol);
  const promptTimeframe = captureMatches ? capture!.timeframe : timeframe;
  const promptCandles = captureMatches && capture!.candles.length ? capture!.candles : candles;

  // 모드별로 필요한 데이터만 부른다.
  const { data: fundamentals, loading: fundamentalsLoading } = useFundamentals(
    symbol,
    mode === 'multi',
  );
  const peersState = usePeers(symbol, mode === 'multi' && Boolean(fundamentals));
  const peers = peersState.data;
  const { data: portfolio } = usePortfolio(true);
  const { data: exchangeRate } = useExchangeRate(mode === 'portfolio');

  const holding = portfolio?.holdings.find((h) => h.symbol === symbol) ?? null;

  // 빠른 분석·포트폴리오는 종목 요약(지표 + 재무)이 필요하다.
  // (비교 분석 모드는 v2.22.0 에 「차트 > 기업 비교」 로 모았다)
  const summaryTargets = useMemo(() => {
    if (mode === 'quick') return [symbol];
    if (mode === 'portfolio') return portfolio?.holdings.map((h) => h.symbol) ?? [];
    return [];
  }, [mode, symbol, portfolio]);

  const { summaries, loading: summariesLoading } = useSymbolSummaries(summaryTargets);

  // 투자자 동향 — 국내 종목의 간단·전문가 분석에만 넣는다(v2.23.0). 미국 종목은 요청도 하지 않는다.
  const { flow, loading: flowLoading } = useInvestorFlow(symbol, mode === 'quick' || mode === 'multi');
  const flowBlock = investorFlowBlock(flow);

  const generated = useMemo(() => {
    switch (mode) {
      case 'quick':
        return buildQuickPrompt(
          summaries.find((s) => s.symbol === symbol) ?? null,
          timeframe,
          symbol,
          horizon,
          flowBlock,
        );
      case 'portfolio':
        return buildPortfolioPrompt(portfolio, summaries, exchangeRate, horizon);
      case 'multi':
      default:
        return buildMultiAgentPrompt({
          symbol,
          timeframe: promptTimeframe,
          candles: promptCandles,
          currentPrice,
          fundamentals,
          peers,
          holding,
          crossReview,
          horizon,
          investorFlow: flowBlock,
        });
    }
  }, [
    mode,
    symbol,
    timeframe,
    promptTimeframe,
    promptCandles,
    candles,
    currentPrice,
    fundamentals,
    peers,
    holding,
    crossReview,
    summaries,
    portfolio,
    exchangeRate,
    horizon,
    flowBlock,
  ]);

  // 모드나 종목이 바뀌면 편집 내용을 버린다 (다른 종목의 편집본이 남으면 혼란스럽다).
  useEffect(() => {
    setEdited(null);
  }, [mode, symbol, horizon]);

  const prompt = edited ?? generated;

  /*
   * 프롬프트 초기화 — 직접 고친 내용이 있을 때만 확인 창 (v2.34.1). 고친 것이 없거나 자동 생성본과 같으면 바로 되돌린다.
   */
  const resetPrompt = () => {
    if (edited === null || edited === generated) {
      setEdited(null);
      return;
    }
    modal.confirm({
      title: '프롬프트 초기화',
      message: '고친 프롬프트를 버리고 자동 생성본으로 초기화합니다. 되돌릴 수 없습니다.',
      confirmText: '초기화',
      danger: true,
      onConfirm: () => setEdited(null),
    });
  };

  // 편집본까지 반영해 상위로 올린다 (히스토리 저장용).
  useEffect(() => {
    onPromptChange?.({ mode: `${mode}·${horizonLabel(horizon)}`, text: prompt });
  }, [mode, horizon, prompt, onPromptChange]);
  /*
   * 동종업계도 기다린다 (v2.29.0) — 예전에는 빠져 있어 ② 를 일찍 누르면 동종업계 비교가 빠진 프롬프트가 복사됐다.
   * 요청을 실제로 보낼 때(전문가 분석 + 재무를 받았을 때)만, 응답(성공·실패·빈 목록)이 올 때까지. 실패·빈 응답은 막지 않는다("(없음)").
   */
  const peersWaiting = mode === 'multi' && Boolean(fundamentals) && !peersState.settled;
  const loading = summariesLoading || flowLoading || (mode === 'multi' && fundamentalsLoading) || peersWaiting;

  // 포트폴리오는 여러 종목이라 현재 차트 이미지가 프롬프트와 맞지 않는다.
  const includeImage = mode === 'quick' || mode === 'multi';

  const captureModal = captureContext && (
    <ChartCaptureModal
      symbol={symbol}
      timeframe={timeframe}
      candles={candles}
      indicators={indicators}
      toggles={toggles}
      drawings={captureContext.drawings}
      initialRange={captureContext.range}
      onClose={() => setCaptureContext(null)}
    />
  );

  const autoCaptureModal = autoContext && (
    <ChartCaptureModal
      auto
      symbol={symbol}
      timeframe={timeframe}
      candles={candles}
      indicators={indicators}
      toggles={toggles}
      drawings={autoContext.drawings}
      initialRange={autoContext.range}
      onClose={() => setAutoContext(null)}
      onAutoError={setAutoError}
    />
  );

  /*
   * 차트 하단 탭의 간단 모드 — 버튼만. mode·horizon·edited 는 기본값에서 바뀌지 않으므로(선택 UI 를 그리지 않는다)
   * `prompt` 는 곧 이 종목의 기본 프롬프트(전문가 분석 · 기본 투자 기간)다.
   */
  if (compact) {
    return (
      /*
        가로 배치 (v2.33.0) — 예전에는 좁은 세로 칸 하나(max-w-md)에 쌓여 오른쪽이 비고 아래가 잘렸다.
        위 한 줄(설명 + 오른쪽 끝 AI 분석 열기) → ① ② ③ 가로 3칸. 탭 기본 높이에서 스크롤 없이 다 보인다.
      */
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-text-secondary">
            이 종목의 기본 프롬프트(전문가 분석 · {horizonLabel(horizon)})를 Claude 에 보냅니다 — Claude 대화창을 열어 둔 채 ① 이미지 →
            ② 프롬프트를 차례로 <b className="text-text-primary">복사하고 바로 붙여넣은 뒤</b> 전송하세요(클립보드에는 마지막 것 하나만 남습니다).
          </p>
          <p className="shrink-0 text-[13px] text-text-muted">
            고치려면 →{' '}
            <button type="button" onClick={onOpenFull} className="text-accent hover:underline">
              투자 분석 &gt; AI 분석 열기
            </button>
          </p>
        </div>
        <CopySteps
          symbol={symbol}
          timeframe={promptTimeframe}
          prompt={prompt}
          includeImage
          onOpenCapture={startAutoCapture}
          captureLabel="지금 보고 있는 차트 캡처"
          capturePending={Boolean(autoContext)}
          promptLabel="기본 프롬프트 복사"
          promptReady={!loading}
          horizontal
          hideIntro
        />
        {/* 간단 모드에는 「상세 캡처」 를 두지 않는다(상세는 AI 분석 화면에서) */}
        {autoCaptureModal}
      </div>
    );
  }


  /*
   * 전체 모드 (v2.28.0 간소화) — 분석 방식 한 줄 + ① 캡처 ② 프롬프트 복사 ③ Claude 열기 + [상세 캡처…] [프롬프트 수정 ▾].
   * 프롬프트 글은 「프롬프트 수정」 을 펼칠 때만 보인다(투자 기간·교차 검증·편집창·글자 수·초기화도 그 안).
   * 프롬프트를 만드는 함수·내용은 바꾸지 않았다 — 위 `generated` 그대로.
   */
  /*
   * ⚠️ 바깥 틀은 아래 기록 영역(`AnalysisHistory` — p-4, 화면 폭)과 **같다** (v2.34.0) — 예전에는 위만 가운데로 모인 좁은 폭(max-w-3xl)이라
   * 위·아래 좌우 끝이 맞지 않았다. ①②③ 은 이 폭에서 3등분된다. 스크롤은 바깥(AI 분석 화면)이 맡는다.
   */
  return (
    <div className="px-4 pt-4">
      <div className="flex flex-col gap-4">
        <section className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-medium text-text-secondary">분석 방식</h3>
          <ModeSelector mode={mode} onChange={setMode} portfolioAvailable={Boolean(portfolio?.holdings.length)} />
        </section>

        <CopySteps
          symbol={symbol}
          timeframe={promptTimeframe}
          prompt={prompt}
          includeImage={includeImage}
          onOpenCapture={startAutoCapture}
          captureLabel="지금 보고 있는 차트 캡처"
          capturePending={Boolean(autoContext)}
          promptLabel={edited !== null ? '수정한 프롬프트 복사' : '기본 프롬프트 복사'}
          promptReady={!loading}
          horizontal
          // 전체 모드에는 차트가 보이지 않는다 — ① 칸에 복사될 그림을 미리 보인다 (v2.34.0). 간단 모드(차트 바로 아래)에는 두지 않는다
          preview={{ symbol, error: autoError, onRecapture: startAutoCapture }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {includeImage && (
            <button
              type="button"
              onClick={openCapture}
              title="범위·지표·봉 단위를 골라 캡처합니다"
              className="rounded-md bg-bg-tertiary px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
            >
              상세 캡처…
            </button>
          )}
          <DisclosureButton open={editorOpen} onToggle={() => setEditorOpen((v) => !v)} label="프롬프트 수정 보기" controls="manual-prompt-editor" />
          {edited !== null && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[13px] text-warning">수정됨</span>}
          {capture && capture.symbol === symbol && (
            <span className="ml-auto text-[13px] text-text-muted">
              캡처 {new Date(capture.capturedAt).toLocaleTimeString('ko-KR')}
              {capture.timeframe !== timeframe && <span className="text-text-secondary"> · 프롬프트도 캡처한 봉으로</span>}
            </span>
          )}
        </div>

        {editorOpen && (
          <section id="manual-prompt-editor" className="space-y-3 rounded-lg bg-bg-tertiary/40 p-3">
            <div className="space-y-1.5">
              <h4 className="text-[13px] text-text-secondary">투자 기간</h4>
              <div className="grid grid-cols-4 gap-1">
                {HORIZONS.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setHorizon(h.id)}
                    title={h.directive}
                    className={`rounded-md border px-1 py-1.5 text-center transition-colors ${
                      horizon === h.id
                        ? 'border-transparent bg-bg-elevated font-medium text-text-primary'
                        : 'border-transparent bg-bg-tertiary text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    <span className="block text-[13px] font-medium">{h.label}</span>
                    <span className="block text-[13px] text-text-muted">{h.period}</span>
                  </button>
                ))}
              </div>
            </div>

            {mode === 'multi' && (
              <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={crossReview}
                  onChange={(e) => setCrossReview(e.target.checked)}
                  className="accent-accent"
                />
                교차 검증 라운드 추가 (답변이 길어집니다)
              </label>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="text-text-secondary">
                프롬프트
                {loading && <span className="ml-1.5 text-text-muted">· 불러오는 중…</span>}
              </span>
              <span className="flex items-center gap-2 text-text-muted">
                {prompt.length.toLocaleString('ko-KR')}자
                {edited !== null && (
                  <button
                    type="button"
                    onClick={resetPrompt}
                    className="rounded bg-bg-tertiary px-2 py-0.5 transition-colors hover:bg-bg-elevated hover:text-text-primary"
                  >
                    초기화
                  </button>
                )}
              </span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setEdited(e.target.value)}
              spellCheck={false}
              className="h-[45vh] w-full resize-y rounded-md border border-border bg-bg-tertiary p-3 font-mono text-xs leading-relaxed text-text-secondary focus:border-accent focus:outline-none"
            />
            <ul className="space-y-0.5 text-[13px] leading-relaxed text-text-muted">
              {includeImage && <li>· 차트 이미지 (① 로 복사)</li>}
              {mode === 'quick' && <li>· RSI · MACD · MA · 볼린저 · ATR · 스토캐스틱</li>}
              {flowBlock && <li>· 투자자 동향 (최근 확정 거래일 순매수, 국내 종목)</li>}
              {mode === 'multi' && (
                <>
                  <li>· 지표 요약 + 최근 10봉 OHLCV</li>
                  <li>· 재무·밸류에이션 {fundamentals ? '포함' : '(없음)'}</li>
                  <li>· 동종업계 비교 {peers?.length ? '포함' : '(없음)'}</li>
                  <li>· 보유 현황 {holding ? '보유 중' : '미보유'}</li>
                </>
              )}
              {mode === 'portfolio' && (
                <>
                  <li>· 보유 {portfolio?.holdings.length ?? 0}종목 + 종목별 지표</li>
                  <li>· 포트폴리오 손익 · 환율 {exchangeRate ? '포함' : '(없음)'}</li>
                </>
              )}
            </ul>
          </section>
        )}

        <p className="text-[13px] leading-relaxed text-text-muted">
          API 키 없이 Claude 구독 대화에서 사용합니다. AI 의견은 투자 조언이 아닙니다.
        </p>
      </div>

      {captureModal}
      {autoCaptureModal}
    </div>
  );
}
