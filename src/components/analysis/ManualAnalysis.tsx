import { useMemo, useState } from 'react';
import type { Candle, Timeframe } from '../../types/toss';
import {
  copyChartWithText,
  downloadChartImage,
  type CopyResult,
} from '../../services/analysis/chartCapture';
import { buildAnalysisText } from '../../services/analysis/summaryText';

interface Props {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  /** 캡처 대상 차트 DOM */
  getChartElement: () => HTMLElement | null;
}

const COPY_MESSAGE: Record<CopyResult, string> = {
  'image+text': '✅ 차트 이미지와 요약 텍스트를 복사했습니다. Claude 대화에 붙여넣으세요.',
  'text-only-unsupported':
    '⚠️ 이 브라우저는 클립보드 이미지 복사를 지원하지 않습니다. 요약 텍스트만 복사했습니다 — 이미지는 "이미지 저장"으로 받아 첨부하세요.',
  'text-only-failed':
    '⚠️ 이미지 복사가 거부됐습니다 (창이 활성 상태인지 확인하세요). 요약 텍스트는 복사했습니다 — 이미지는 "이미지 저장"으로 받아 첨부하세요.',
  failed: '❌ 클립보드 복사에 실패했습니다. 아래 텍스트를 직접 선택해 복사하세요.',
};

/**
 * 방식 B — 수동 분석.
 * 차트를 캡처하고 지표 요약을 붙여, claude.ai 대화창에 그대로 붙여넣는 흐름이다.
 * API 키 없이 쓸 수 있어 Step 7(앱 내 자동 분석) 전까지의 주력 사용 방식이다.
 */
export default function ManualAnalysis({
  symbol,
  timeframe,
  candles,
  currentPrice,
  getChartElement,
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const text = useMemo(
    () => buildAnalysisText(symbol, timeframe, candles, currentPrice),
    [symbol, timeframe, candles, currentPrice],
  );

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
      setStatus('✅ 요약 텍스트를 복사했습니다.');
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

  return (
    <div className="flex h-full gap-4 overflow-y-auto p-4">
      <div className="flex w-72 shrink-0 flex-col gap-2">
        <button
          type="button"
          onClick={() => void handleCopyAll()}
          disabled={busy || !candles.length}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {busy ? '처리 중…' : '① 차트 캡처 + 데이터 복사'}
        </button>

        <a
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-2 text-center text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          ② Claude 대화 열기 ↗
        </a>

        <div className="mt-1 flex gap-2">
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

        <div className="mt-auto pt-3 text-xs leading-relaxed text-text-muted">
          <p className="font-medium text-text-secondary">사용 방법</p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5">
            <li>차트를 원하는 구간·타임프레임으로 맞춥니다</li>
            <li>①을 눌러 이미지와 요약을 복사합니다</li>
            <li>②로 Claude를 열고 대화창에 붙여넣습니다</li>
          </ol>
          <p className="mt-2">⚠️ AI 의견은 투자 조언이 아닙니다.</p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-xs text-text-muted">복사될 내용 미리보기</p>
        <pre className="h-[calc(100%-1.5rem)] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg-primary p-3 font-mono text-xs leading-relaxed text-text-secondary">
          {text}
        </pre>
      </div>
    </div>
  );
}
