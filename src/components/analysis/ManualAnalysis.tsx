import { useEffect, useMemo, useState } from 'react';
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
import { TIMEFRAME_ITEMS, type IndicatorSeries, type IndicatorToggles } from '../../types/chart';
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

  const openCapture = () => setCaptureContext(getChartSnapshot());

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
  const { data: peers } = usePeers(symbol, mode === 'multi' && Boolean(fundamentals));
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

  // 편집본까지 반영해 상위로 올린다 (히스토리 저장용).
  useEffect(() => {
    onPromptChange?.({ mode: `${mode}·${horizonLabel(horizon)}`, text: prompt });
  }, [mode, horizon, prompt, onPromptChange]);
  const loading = summariesLoading || flowLoading || (mode === 'multi' && fundamentalsLoading);

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

  /*
   * 차트 하단 탭의 간단 모드 — 버튼만. mode·horizon·edited 는 기본값에서 바뀌지 않으므로(선택 UI 를 그리지 않는다)
   * `prompt` 는 곧 이 종목의 기본 프롬프트(전문가 분석 · 기본 투자 기간)다.
   */
  if (compact) {
    return (
      <div className="max-w-md space-y-3 p-3">
        <p className="text-[12px] leading-relaxed text-text-secondary">
          이 종목의 기본 프롬프트(전문가 분석 · {horizonLabel(horizon)})를 Claude 에 보냅니다. ① 차트 이미지를 붙여넣고, ② 프롬프트를 이어서
          붙여넣은 뒤 전송하세요.
        </p>
        <CopySteps
          symbol={symbol}
          timeframe={promptTimeframe}
          prompt={prompt}
          includeImage
          onOpenCapture={openCapture}
          promptLabel="기본 프롬프트 복사"
          promptReady={!loading}
        />
        <p className="text-[12px] text-text-muted">
          프롬프트를 고치거나 다른 분석 방식을 쓰려면 →{' '}
          <button type="button" onClick={onOpenFull} className="text-accent hover:underline">
            투자 분석 &gt; AI 분석 열기
          </button>
        </p>
        {captureModal}
      </div>
    );
  }

  return (
    <div className="flex h-full justify-center gap-6 overflow-hidden p-6">
      <div className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto pr-1">
        <section className="space-y-3">
          <h3 className="text-xs font-medium text-text-secondary">분석 모드</h3>
          <ModeSelector
            mode={mode}
            onChange={setMode}
            portfolioAvailable={Boolean(portfolio?.holdings.length)}
          />

        {mode === 'multi' && (
          <label className="inline-flex w-fit items-center gap-2 px-1 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={crossReview}
              onChange={(e) => setCrossReview(e.target.checked)}
              className="accent-accent"
            />
            교차 검증 라운드 추가 (답변이 길어집니다)
          </label>
        )}

        <div className="space-y-1.5 px-1">
          <h4 className="text-[12px] text-text-secondary">투자 기간</h4>
          <div className="grid grid-cols-4 gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => setHorizon(h.id)}
                title={h.directive}
                className={`rounded-md border px-1 py-1.5 text-center transition-colors ${
                  horizon === h.id
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
              >
                <span className="block text-[12px] font-medium">{h.label}</span>
                <span className="block text-[12px] text-text-muted">{h.period}</span>
              </button>
            ))}
          </div>
        </div>

        </section>

        {includeImage && (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-text-secondary">차트 이미지</h3>
            {capture ? (
              <div className="space-y-2 rounded-md border border-border/60 p-2">
                <img
                  src={capture.url}
                  alt="캡처한 차트"
                  className="w-full rounded border border-border object-contain"
                />
                <p className="text-[12px] leading-relaxed text-text-muted">
                  {capture.symbol} ·{' '}
                  {TIMEFRAME_ITEMS.find((i) => i.value === capture.timeframe)?.label ??
                    capture.timeframe}{' '}
                  ·{' '}
                  {new Date(capture.capturedAt).toLocaleTimeString('ko-KR')}
                  {capture.symbol !== symbol && (
                    <span className="ml-1 text-warning">⚠️ 다른 종목의 캡처입니다</span>
                  )}
                  {capture.symbol === symbol && capture.timeframe !== timeframe && (
                    <span className="ml-1 text-accent">· 프롬프트도 이 봉으로 작성됩니다</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={openCapture}
                  className="w-full rounded-md border border-border px-2 py-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  ↩ 다시 캡처
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={openCapture}
                className="w-full rounded-md border border-dashed border-border px-2 py-3 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              >
                📷 차트 캡처하기
              </button>
            )}
          </section>
        )}

        <CopySteps
          symbol={symbol}
          timeframe={promptTimeframe}
          prompt={prompt}
          includeImage={includeImage}
          onOpenCapture={openCapture}
        />

        <section className="space-y-3">
          <h3 className="text-xs font-medium text-text-secondary">포함된 데이터</h3>
          <ul className="space-y-1 rounded-md border border-border/60 px-3 py-2.5 text-[12px] leading-relaxed text-text-muted">
            {includeImage && <li>· 차트 이미지 (Step 1로 복사)</li>}
            {mode === 'quick' && <li>· RSI · MACD · MA · 볼린저 · ATR · 스토캐스틱</li>}
            {flowBlock && <li>· 투자자 동향 (최근 확정 거래일 순매수, 국내 종목)</li>}
            {mode === 'multi' && (
              <>
                <li>· 지표 요약 + 최근 10봉 OHLCV</li>
                <li>· 재무·밸류에이션 {fundamentals ? '✓' : '(없음)'}</li>
                <li>· 동종업계 비교 {peers?.length ? '✓' : '(없음)'}</li>
                <li>· 보유 현황 {holding ? '✓ 보유 중' : '미보유'}</li>
              </>
            )}
            {mode === 'portfolio' && (
              <>
                <li>· 보유 {portfolio?.holdings.length ?? 0}종목 + 종목별 지표</li>
                <li>· 포트폴리오 손익 · 환율 {exchangeRate ? '✓' : '(없음)'}</li>
              </>
            )}
          </ul>
          <p className="text-[12px] leading-relaxed text-text-muted">
            API 키 없이 Claude 구독 대화에서 사용합니다. AI 의견은 투자 조언이 아닙니다.
          </p>
        </section>
      </div>

      <div className="flex min-w-0 max-w-[760px] flex-1 flex-col gap-3">
        <div className="flex items-center justify-between text-xs">
          <h3 className="text-xs font-medium text-text-secondary">
            생성된 프롬프트
            {loading && <span className="ml-1.5 font-normal text-text-muted">· 불러오는 중…</span>}
          </h3>
          <span className="flex items-center gap-2 text-text-muted">
            {prompt.length.toLocaleString('ko-KR')}자
            {edited !== null && (
              <>
                <span className="text-warning">편집됨</span>
                <button
                  type="button"
                  onClick={() => setEdited(null)}
                  className="rounded border border-border px-2 py-0.5 transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                >
                  초기화
                </button>
              </>
            )}
          </span>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setEdited(e.target.value)}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-bg-tertiary p-4 font-mono text-xs leading-relaxed text-text-secondary focus:border-accent focus:outline-none"
        />
      </div>

      {captureModal}
    </div>
  );
}
