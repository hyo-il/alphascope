import { useMemo, useState } from 'react';
import type { Candle, Timeframe } from '../../types/toss';
import {
  copyChartWithText,
  downloadChartImage,
  type CopyResult,
} from '../../services/analysis/chartCapture';
import { buildAnalysisText } from '../../services/analysis/summaryText';
import { buildMultiAgentPrompt } from '../../services/analysis/multiAgentPrompt';
import { useFundamentals, usePeers, usePortfolio } from '../../hooks/useCompany';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  getChartElement: () => HTMLElement | null;
}

type Mode = 'simple' | 'multiAgent';

const COPY_MESSAGE: Record<CopyResult, string> = {
  'image+text': '✅ 차트 이미지와 프롬프트를 복사했습니다. Claude 대화에 붙여넣으세요.',
  'text-only-unsupported':
    '⚠️ 이 브라우저는 클립보드 이미지 복사를 지원하지 않습니다. 프롬프트만 복사했습니다 — 이미지는 "이미지 저장"으로 받아 첨부하세요.',
  'text-only-failed':
    '⚠️ 이미지 복사가 거부됐습니다 (창이 활성 상태인지 확인하세요). 프롬프트는 복사했습니다 — 이미지는 "이미지 저장"으로 받아 첨부하세요.',
  failed: '❌ 클립보드 복사에 실패했습니다. 아래 내용을 직접 선택해 복사하세요.',
};

/**
 * AI 분석 준비 (방식 B).
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
}: Props) {
  const [mode, setMode] = useState<Mode>('multiAgent');
  const [crossReview, setCrossReview] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 멀티 에이전트 프롬프트에는 재무·보유 데이터도 넣는다 (둘 다 캐시된 값을 재사용).
  const needsExtras = mode === 'multiAgent';
  const { data: fundamentals, loading: fundamentalsLoading } = useFundamentals(symbol, needsExtras);
  const { data: peers } = usePeers(symbol, needsExtras && Boolean(fundamentals));
  const { data: portfolio } = usePortfolio(needsExtras);

  const holding = portfolio?.holdings.find((h) => h.symbol === symbol) ?? null;

  const text = useMemo(() => {
    if (mode === 'simple') {
      return buildAnalysisText(symbol, timeframe, candles, currentPrice);
    }
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
  }, [mode, symbol, timeframe, candles, currentPrice, fundamentals, peers, holding, crossReview]);

  const handleCopyAll = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    setStatus(null);
    try {
      setStatus(COPY_MESSAGE[await copyChartWithText(element, text)]);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('✅ 프롬프트를 복사했습니다.');
    } catch {
      setStatus('❌ 텍스트 복사에 실패했습니다.');
    }
  };

  const handleSaveImage = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    try {
      await downloadChartImage(element, `${symbol}_${timeframe}_${Date.now()}.png`);
      setStatus('✅ 차트 이미지를 저장했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const modeButton = (value: Mode, label: string, hint: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      title={hint}
      className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
        mode === value
          ? 'bg-accent text-white'
          : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full gap-4 overflow-hidden p-4">
      <div className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto">
        <div className="flex gap-1">
          {modeButton('multiAgent', '멀티 전문가', '5명의 전문가 역할 + 종합 판단')}
          {modeButton('simple', '간단 요약', '지표 요약만 복사')}
        </div>

        {mode === 'multiAgent' && (
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

        <button
          type="button"
          onClick={() => void handleCopyAll()}
          disabled={busy || !candles.length}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? '처리 중…' : '① 차트 + 프롬프트 복사'}
        </button>

        <a
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-2 text-center text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          ② Claude 대화 열기 ↗
        </a>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleCopyText()}
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            텍스트만 복사
          </button>
          <button
            type="button"
            onClick={() => void handleSaveImage()}
            disabled={busy}
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
          >
            이미지 저장
          </button>
        </div>

        {status && (
          <p className="rounded-md bg-bg-tertiary px-3 py-2 text-xs leading-relaxed text-text-secondary">
            {status}
          </p>
        )}

        <div className="mt-1 rounded-md border border-border/60 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          <p className="font-medium text-text-secondary">포함된 데이터</p>
          <ul className="mt-1 space-y-0.5">
            <li>· 차트 이미지 + 최근 10봉 OHLCV</li>
            <li>· RSI · MACD · 이동평균 · 거래량</li>
            {mode === 'multiAgent' && (
              <>
                <li>
                  · 재무·밸류에이션{' '}
                  {fundamentalsLoading ? '(불러오는 중…)' : fundamentals ? '✓' : '(없음)'}
                </li>
                <li>· 동종업계 비교 {peers?.length ? '✓' : '(없음)'}</li>
                <li>· 보유 현황 {holding ? '✓ 보유 중' : '미보유'}</li>
              </>
            )}
          </ul>
          <p className="mt-2">
            API 키 없이 Claude 구독 대화에서 그대로 사용합니다. AI 의견은 투자 조언이 아닙니다.
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <p className="mb-1.5 text-xs text-text-muted">
          복사될 내용 미리보기 · {text.length.toLocaleString('ko-KR')}자
        </p>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-primary p-3 font-mono text-xs leading-relaxed text-text-secondary">
          {text}
        </pre>
      </div>
    </div>
  );
}
