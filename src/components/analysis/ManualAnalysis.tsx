import { useEffect, useMemo, useState } from 'react';
import type { Candle, Timeframe } from '../../types/toss';
import type { AnalysisMode } from '../../types/analysis';
import { buildMultiAgentPrompt } from '../../services/analysis/multiAgentPrompt';
import {
  buildComparePrompt,
  buildPortfolioPrompt,
  buildQuickPrompt,
} from '../../services/analysis/modePrompts';
import { useExchangeRate, useFundamentals, usePeers, usePortfolio } from '../../hooks/useCompany';
import { useSymbolSummaries } from '../../hooks/useSymbolSummaries';
import CompareSymbols from './CompareSymbols';
import CopySteps from './CopySteps';
import ModeSelector from './ModeSelector';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  getChartElement: () => HTMLElement | null;
  /** 히스토리 탭이 '방금 쓴 프롬프트'를 함께 저장할 수 있도록 알려 준다 */
  onPromptChange?: (value: { mode: string; text: string }) => void;
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
  getChartElement,
  onPromptChange,
}: Props) {
  const [mode, setMode] = useState<AnalysisMode>('multi');
  const [crossReview, setCrossReview] = useState(false);
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  /** 사용자가 직접 고친 프롬프트. null 이면 자동 생성본을 그대로 쓴다. */
  const [edited, setEdited] = useState<string | null>(null);

  // 모드별로 필요한 데이터만 부른다.
  const { data: fundamentals, loading: fundamentalsLoading } = useFundamentals(
    symbol,
    mode === 'multi',
  );
  const { data: peers } = usePeers(symbol, mode === 'multi' && Boolean(fundamentals));
  const { data: portfolio } = usePortfolio(true);
  const { data: exchangeRate } = useExchangeRate(mode === 'portfolio');

  const holding = portfolio?.holdings.find((h) => h.symbol === symbol) ?? null;

  // 빠른 분석·포트폴리오·비교는 종목 요약(지표 + 재무)이 필요하다.
  const summaryTargets = useMemo(() => {
    if (mode === 'quick') return [symbol];
    if (mode === 'portfolio') return portfolio?.holdings.map((h) => h.symbol) ?? [];
    if (mode === 'compare') return [symbol, ...compareSymbols];
    return [];
  }, [mode, symbol, portfolio, compareSymbols]);

  const { summaries, loading: summariesLoading } = useSymbolSummaries(summaryTargets);

  const generated = useMemo(() => {
    switch (mode) {
      case 'quick':
        return buildQuickPrompt(summaries.find((s) => s.symbol === symbol) ?? null, timeframe, symbol);
      case 'portfolio':
        return buildPortfolioPrompt(portfolio, summaries, exchangeRate);
      case 'compare':
        return buildComparePrompt(summaries);
      case 'multi':
      default:
        return buildMultiAgentPrompt({
          symbol,
          timeframe,
          candles,
          currentPrice,
          fundamentals,
          peers,
          holding,
          crossReview,
        });
    }
  }, [
    mode,
    symbol,
    timeframe,
    candles,
    currentPrice,
    fundamentals,
    peers,
    holding,
    crossReview,
    summaries,
    portfolio,
    exchangeRate,
  ]);

  // 모드나 종목이 바뀌면 편집 내용을 버린다 (다른 종목의 편집본이 남으면 혼란스럽다).
  useEffect(() => {
    setEdited(null);
  }, [mode, symbol]);

  const prompt = edited ?? generated;

  // 편집본까지 반영해 상위로 올린다 (히스토리 저장용).
  useEffect(() => {
    onPromptChange?.({ mode, text: prompt });
  }, [mode, prompt, onPromptChange]);
  const loading = summariesLoading || (mode === 'multi' && fundamentalsLoading);

  // 포트폴리오·비교는 여러 종목이라 현재 차트 이미지가 프롬프트와 맞지 않는다.
  const includeImage = mode === 'quick' || mode === 'multi';

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
          <label className="flex items-center gap-2 px-1 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={crossReview}
              onChange={(e) => setCrossReview(e.target.checked)}
              className="accent-accent"
            />
            교차 검증 라운드 추가 (답변이 길어집니다)
          </label>
        )}

        {mode === 'compare' && (
          <CompareSymbols
            baseSymbol={symbol}
            symbols={compareSymbols}
            onChange={setCompareSymbols}
          />
        )}
        </section>

        <CopySteps
          symbol={symbol}
          timeframe={timeframe}
          prompt={prompt}
          getChartElement={getChartElement}
          includeImage={includeImage}
        />

        <section className="space-y-3">
          <h3 className="text-xs font-medium text-text-secondary">포함된 데이터</h3>
          <ul className="space-y-1 rounded-md border border-border/60 px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
            {includeImage && <li>· 차트 이미지 (Step 1로 복사)</li>}
            {mode === 'quick' && <li>· RSI · MACD · MA · 볼린저 · ATR · 스토캐스틱</li>}
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
            {mode === 'compare' && <li>· 종목 {summaryTargets.length}개 지표 + 밸류에이션</li>}
          </ul>
          <p className="text-[11px] leading-relaxed text-text-muted">
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
          className="min-h-0 flex-1 resize-none rounded-md border border-border bg-bg-primary p-4 font-mono text-xs leading-relaxed text-text-secondary focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}
