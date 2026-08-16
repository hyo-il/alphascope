import { useState } from 'react';
import {
  copyChartImage,
  downloadChartImage,
  type ImageCopyResult,
} from '../../services/analysis/chartCapture';

interface Props {
  symbol: string;
  timeframe: string;
  prompt: string;
  getChartElement: () => HTMLElement | null;
  /** 차트 이미지가 의미 없는 모드(포트폴리오·비교)에서는 이미지 단계를 숨긴다 */
  includeImage: boolean;
}

interface StepState {
  done: boolean;
  message: string;
}

const IMAGE_MESSAGE: Record<ImageCopyResult, string> = {
  copied: '복사됨',
  unsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다 — 아래에서 저장하세요',
  failed: '복사가 거부됐습니다 (창이 활성 상태인지 확인) — 아래에서 저장하세요',
};

function time(): string {
  return new Date().toLocaleTimeString('ko-KR');
}

/**
 * 2단계 복사 흐름.
 *
 * 이미지와 텍스트를 각각 복사하게 나눈 이유: 브라우저 클립보드는 마지막에 쓴 항목만
 * 남기므로, 한 번에 담아도 붙여넣는 쪽이 하나만 가져가는 경우가 있다.
 * 순서대로 두 번 붙여넣는 편이 확실하다.
 */
export default function CopySteps({
  symbol,
  timeframe,
  prompt,
  getChartElement,
  includeImage,
}: Props) {
  const [imageStep, setImageStep] = useState<StepState>({ done: false, message: '대기중' });
  const [textStep, setTextStep] = useState<StepState>({ done: false, message: '대기중' });
  const [busy, setBusy] = useState(false);

  const handleImage = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    try {
      const result = await copyChartImage(element);
      setImageStep({
        done: result === 'copied',
        message: `${IMAGE_MESSAGE[result]}${result === 'copied' ? ` (${time()})` : ''}`,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleText = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setTextStep({ done: true, message: `복사됨 (${time()})` });
    } catch {
      setTextStep({ done: false, message: '복사 실패 — 미리보기에서 직접 선택해 복사하세요' });
    }
  };

  const handleSaveImage = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    try {
      await downloadChartImage(element, `${symbol}_${timeframe}_${Date.now()}.png`);
      setImageStep({ done: true, message: `이미지 파일로 저장됨 (${time()})` });
    } finally {
      setBusy(false);
    }
  };

  const step = (state: StepState) => (
    <span className={state.done ? 'text-bullish' : 'text-text-muted'}>
      {state.done ? '✅' : '⬜'} {state.message}
    </span>
  );

  return (
    <div className="rounded-md border border-border bg-bg-tertiary/40 p-3">
      <p className="mb-2 text-xs font-medium text-text-secondary">Claude에 보내기</p>

      <ol className="space-y-2 text-[11px]">
        {includeImage && (
          <li>
            <button
              type="button"
              onClick={() => void handleImage()}
              disabled={busy}
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
            >
              📸 Step 1 — 차트 이미지 복사
            </button>
            <p className="mt-1 pl-1 text-text-muted">
              Claude 대화에 붙여넣기 (⌘V) · {step(imageStep)}
            </p>
          </li>
        )}

        <li>
          <button
            type="button"
            onClick={() => void handleText()}
            className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            📋 Step {includeImage ? '2' : '1'} — 프롬프트 복사
          </button>
          <p className="mt-1 pl-1 text-text-muted">
            같은 대화에 붙여넣기 (⌘V) · {step(textStep)}
          </p>
        </li>
      </ol>

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener')}
          className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          🔗 Claude 열기
        </button>
        {includeImage && (
          <button
            type="button"
            onClick={() => void handleSaveImage()}
            disabled={busy}
            className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
          >
            이미지 저장
          </button>
        )}
      </div>
    </div>
  );
}
