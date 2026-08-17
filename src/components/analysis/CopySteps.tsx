import { useEffect, useRef, useState } from 'react';
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

type StepState = { kind: 'idle' } | { kind: 'done'; at: string } | { kind: 'failed'; reason: string };

const TIP_KEY = 'alphascope.copyTipHidden';
const STATUS_RESET_MS = 3000;

const IMAGE_FAIL_REASON: Record<Exclude<ImageCopyResult, 'copied'>, string> = {
  unsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다',
  failed: '복사가 거부됐습니다 (창이 활성 상태인지 확인하세요)',
};

function now(): string {
  return new Date().toLocaleTimeString('ko-KR');
}

/** 단계 번호 배지 */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">
      {n}
    </span>
  );
}

function StatusLabel({ state }: { state: StepState }) {
  if (state.kind === 'done') {
    return (
      <span className="text-[11px] text-bullish">
        ✅ 복사 완료 <span className="text-text-muted">({state.at})</span>
      </span>
    );
  }
  if (state.kind === 'failed') {
    return <span className="text-[11px] text-bearish">❌ {state.reason}</span>;
  }
  return null;
}

/**
 * Claude 로 보내는 3단계 안내.
 *
 * 이미지와 텍스트를 나눠 복사하는 이유: 브라우저 클립보드는 마지막에 쓴 항목만 남는 경우가 있어,
 * 순서대로 두 번 붙여넣는 편이 확실하다.
 */
export default function CopySteps({
  symbol,
  timeframe,
  prompt,
  getChartElement,
  includeImage,
}: Props) {
  const [imageStep, setImageStep] = useState<StepState>({ kind: 'idle' });
  const [textStep, setTextStep] = useState<StepState>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const [tipHidden, setTipHidden] = useState(() => localStorage.getItem(TIP_KEY) === '1');
  const timers = useRef<number[]>([]);

  // 상태 표시는 잠시 뒤 지운다. 남겨 두면 언제 복사한 건지 헷갈린다.
  useEffect(() => {
    const ids = timers.current;
    return () => ids.forEach((id) => clearTimeout(id));
  }, []);

  const autoReset = (setter: (state: StepState) => void) => {
    const id = window.setTimeout(() => setter({ kind: 'idle' }), STATUS_RESET_MS);
    timers.current.push(id);
  };

  const handleImage = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    try {
      const result = await copyChartImage(element);
      if (result === 'copied') {
        setImageStep({ kind: 'done', at: now() });
        autoReset(setImageStep);
      } else {
        setImageStep({ kind: 'failed', reason: IMAGE_FAIL_REASON[result] });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleText = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setTextStep({ kind: 'done', at: now() });
      autoReset(setTextStep);
    } catch {
      setTextStep({ kind: 'failed', reason: '복사 실패 — 미리보기에서 직접 선택해 복사하세요' });
    }
  };

  const handleDownload = async () => {
    const element = getChartElement();
    if (!element) return;
    setBusy(true);
    try {
      await downloadChartImage(element, `${symbol}_${timeframe}_${Date.now()}.png`);
      setImageStep({ kind: 'done', at: `${now()} · 파일 저장` });
    } finally {
      setBusy(false);
    }
  };

  const hideTip = () => {
    localStorage.setItem(TIP_KEY, '1');
    setTipHidden(true);
  };

  const stepCard = (n: number, description: string, children: React.ReactNode) => (
    <li className="rounded-md bg-bg-tertiary/50 p-3">
      <div className="mb-2 flex items-start gap-2">
        <StepBadge n={n} />
        <p className="text-[11px] leading-relaxed text-text-secondary">{description}</p>
      </div>
      {children}
    </li>
  );

  const arrow = (
    <li aria-hidden className="py-0.5 text-center text-xs text-text-muted">
      ↓
    </li>
  );

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium text-text-secondary">📤 Claude에 보내기</h3>

      <ol className="space-y-1">
        {includeImage && (
          <>
            {stepCard(
              1,
              '아래 버튼을 누르면 현재 차트가 이미지로 클립보드에 복사됩니다.',
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => void handleImage()}
                  disabled={busy}
                  className="w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
                >
                  📸 차트 이미지 복사
                </button>
                <StatusLabel state={imageStep} />
                {imageStep.kind === 'failed' && (
                  <button
                    type="button"
                    onClick={() => void handleDownload()}
                    disabled={busy}
                    className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                  >
                    💾 PNG로 저장해서 첨부하기
                  </button>
                )}
              </div>,
            )}
            {arrow}
            {stepCard(
              2,
              'Claude 대화창을 열고 입력창에 붙여넣기(⌘V)로 차트 이미지를 넣으세요.',
              <button
                type="button"
                onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener')}
                className="w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary transition-colors hover:bg-bg-tertiary"
              >
                🔗 Claude 열기
              </button>,
            )}
            {arrow}
          </>
        )}

        {stepCard(
          includeImage ? 3 : 1,
          includeImage
            ? '아래 버튼으로 분석 프롬프트를 복사한 뒤, 같은 대화에 이어서 붙여넣고 전송하세요.'
            : '아래 버튼으로 분석 프롬프트를 복사한 뒤, Claude 대화에 붙여넣고 전송하세요.',
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => void handleText()}
              className="w-full rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              📋 프롬프트 복사
            </button>
            <StatusLabel state={textStep} />
            {!includeImage && (
              <button
                type="button"
                onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener')}
                className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
              >
                🔗 Claude 열기
              </button>
            )}
          </div>,
        )}
      </ol>

      {!tipHidden && includeImage && (
        <div className="rounded-md border border-border/60 px-3 py-2 text-[11px] leading-relaxed text-text-muted">
          💡 이미지와 프롬프트를 <b className="text-text-secondary">같은 대화</b>에 함께 보내면
          차트 패턴과 수치를 모두 분석합니다.
          <button
            type="button"
            onClick={hideTip}
            className="ml-1 underline transition-colors hover:text-text-primary"
          >
            다시 보지 않기
          </button>
        </div>
      )}
    </section>
  );
}
