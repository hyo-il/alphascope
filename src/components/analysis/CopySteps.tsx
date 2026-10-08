import Button from '../ui/Button';
import { useEffect, useRef, useState } from 'react';
import {
  copyBlobToClipboard,
  downloadBlob,
  type ImageCopyResult,
} from '../../services/analysis/chartCapture';
import { useCaptureStore } from '../../store/captureStore';
import { copyText } from '../../services/clipboard';
import CopyPreview from './CopyPreview';

interface Props {
  symbol: string;
  timeframe: string;
  prompt: string;
  /** 차트 이미지가 의미 없는 모드(포트폴리오·비교)에서는 이미지 단계를 숨긴다 */
  includeImage: boolean;
  /** 캡처해 둔 이미지가 없을 때 캡처 팝업을 연다 */
  onOpenCapture: () => void;
  /** 프롬프트 복사 버튼 글자 (차트 하단 탭은 「기본 프롬프트 복사」, v2.26.0) */
  promptLabel?: string;
  /** false 면 데이터가 아직 다 오지 않아 프롬프트 복사를 막는다 — 반쯤 채운 프롬프트가 복사되지 않게 */
  promptReady?: boolean;
  /** 캡처가 준비됐을 때 ① 버튼 글자 (AI 분석 화면은 「지금 보고 있는 차트 캡처」, v2.28.0) */
  captureLabel?: string;
  /** 화면 밖에서 미리 캡처하는 중 — ① 버튼을 잠시 막는다 (v2.28.0) */
  capturePending?: boolean;
  /**
   * 가로 3칸 (v2.33.0) — 차트 하단 탭이 좁은 세로 칸 하나에 쌓여 오른쪽이 비고 아래가 잘렸다.
   * 칸마다 번호 + 짧은 제목 · 버튼 · 상태 한 줄. 동작(복사·저장·열기)은 세로와 같다.
   */
  horizontal?: boolean;
  /** 맨 위 제목·안내 문장을 그리지 않는다 — 부모가 한 줄로 합쳐 보여 줄 때(차트 하단 탭) */
  hideIntro?: boolean;
  /**
   * ① 칸에 「복사될 차트」 미리보기 (v2.34.0, AI 분석 화면만 — 차트 하단 간단 모드는 차트가 바로 위에 보여 넣지 않는다).
   * 그림은 복사·저장과 **같은 Blob**(`captureStore`). [다시 캡처] 는 기존 자동 캡처(`onRecapture`)를 한 번 더 돌린다.
   */
  preview?: { symbol: string | null; error: string | null; onRecapture: () => void };
}

type StepState =
  | { kind: 'idle' }
  | { kind: 'done'; at: string; label?: string }
  | { kind: 'failed'; reason: string };

const TIP_KEY = 'alphascope.copyTipHidden';
const STATUS_RESET_MS = 3000;

/** HTTP 접속(보안 컨텍스트 아님)에서는 이미지 복사가 불가능하다 — 처음부터 저장으로 안내한다 */
const INSECURE_NOTE =
  'HTTP 접속에서는 이미지 복사가 안 됩니다. 저장한 파일을 Claude 대화창에 끌어다 넣어 주세요.';

const IMAGE_FAIL_REASON: Record<Exclude<ImageCopyResult, 'copied'>, string> = {
  insecure: INSECURE_NOTE,
  unsupported: '이 브라우저는 이미지 복사를 지원하지 않습니다',
  failed: '복사가 거부됐습니다 (창이 활성 상태인지 확인하세요)',
};

function now(): string {
  return new Date().toLocaleTimeString('ko-KR');
}

/** 단계 번호 배지 */
function StepBadge({ n }: { n: number }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated text-caption font-semibold text-text-primary">
      {n}
    </span>
  );
}

function StatusLabel({ state }: { state: StepState }) {
  if (state.kind === 'done') {
    return (
      <span className="text-caption text-bullish">
        {state.label ?? '복사 완료'} <span className="text-text-muted">({state.at})</span>
      </span>
    );
  }
  if (state.kind === 'failed') {
    return <span className="text-caption text-bearish">{state.reason}</span>;
  }
  return null;
}

/**
 * Claude 로 보내는 3단계 안내 — **① 차트 캡처 → ② 프롬프트 복사 → ③ Claude 열기** (v2.28.0, 예전에는 ① 이미지 · ② Claude · ③ 프롬프트).
 *
 * 이미지와 텍스트를 나눠 복사하는 이유: 브라우저 클립보드는 마지막에 쓴 항목만 남는 경우가 있어,
 * 순서대로 두 번 붙여넣는 편이 확실하다. ⚠️ 그래서 ① 을 복사했으면 ② 를 누르기 **전에** 붙여넣어야 한다 —
 * 단계 설명과 맨 위 한 줄이 "Claude 대화창을 열어 둔 채 차례로 복사·붙여넣기" 를 말한다(③ 은 대화창 열기 버튼).
 */
export default function CopySteps({
  symbol,
  timeframe,
  prompt,
  includeImage,
  onOpenCapture,
  promptLabel = '프롬프트 복사',
  promptReady = true,
  captureLabel = '차트 이미지 복사',
  capturePending = false,
  horizontal = false,
  hideIntro = false,
  preview,
}: Props) {
  const capture = useCaptureStore((s) => s.capture);
  // HTTPS 를 붙이면 코드 수정 없이 원래 복사 방식으로 돌아온다 (호스트·IP 로 판단하지 않는다)
  const secure = window.isSecureContext;
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

  /**
   * 미리 캡처해 둔 Blob 을 그대로 복사한다.
   * 클릭 시점에 html2canvas 를 돌리지 않으므로 사용자 제스처가 살아 있고, 복사가 거부되지 않는다.
   */
  const handleImage = async () => {
    if (!capture) return;
    setBusy(true);
    try {
      const result = await copyBlobToClipboard(capture.blob);
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
    if ((await copyText(prompt)) === 'copied') {
      setTextStep({ kind: 'done', at: now() });
      autoReset(setTextStep);
    } else {
      setTextStep({ kind: 'failed', reason: '복사 실패 — 미리보기에서 직접 선택해 복사하세요' });
    }
  };

  /** 복사가 막혔을 때의 폴백 — 파일로 내려받아 Claude 대화창에 끌어다 놓는다. */
  const handleDownload = () => {
    if (!capture) return;
    downloadBlob(capture.blob, `${symbol}_${timeframe}_${Date.now()}.png`);
    setImageStep({ kind: 'done', at: now(), label: '저장 완료' });
  };

  const hideTip = () => {
    localStorage.setItem(TIP_KEY, '1');
    setTipHidden(true);
  };

  /** 가로 칸의 짧은 제목 — 세로 배치의 긴 설명은 칸 위 툴팁으로 남긴다 */
  const SHORT_TITLE: Record<number, string> = includeImage
    ? { 1: '차트 이미지', 2: '프롬프트', 3: 'Claude 열기' }
    : { 1: '프롬프트', 2: 'Claude 열기' };

  const stepCard = (n: number, description: string, children: React.ReactNode) =>
    horizontal ? (
      <li className="flex min-w-0 flex-col gap-1.5 rounded-md bg-bg-tertiary/50 p-2.5" title={description}>
        <div className="flex items-center gap-2">
          <StepBadge n={n} />
          <p className="text-caption font-medium text-text-secondary">{SHORT_TITLE[n]}</p>
        </div>
        {children}
      </li>
    ) : (
      <li className="rounded-md bg-bg-tertiary/50 p-3">
        <div className="mb-2 flex items-start gap-2">
          <StepBadge n={n} />
          <p className="text-caption leading-relaxed text-text-secondary">{description}</p>
        </div>
        {children}
      </li>
    );

  // 가로 배치에서는 화살표 대신 칸 순서(번호)가 흐름을 말한다
  const arrow = horizontal ? null : (
    <li aria-hidden className="py-0.5 text-center text-xs text-text-muted">
      ↓
    </li>
  );

  return (
    <section className={horizontal ? 'space-y-2' : 'space-y-3'}>
      {!hideIntro && <h3 className="text-xs font-medium text-text-secondary">Claude에 보내기</h3>}

      {includeImage && !hideIntro && (
        <p className="text-caption leading-relaxed text-text-muted">
          Claude 대화창을 열어 둔 채 ① → ② 를 차례로 <b className="text-text-secondary">복사하고 바로 붙여넣으세요</b>
          (클립보드에는 마지막에 복사한 것 하나만 남습니다).
        </p>
      )}
      <ol className={horizontal ? `grid gap-2 ${includeImage ? 'grid-cols-3' : 'grid-cols-2'}` : 'space-y-1'}>
        {includeImage && (
          <>
            {stepCard(
              1,
              capture
                ? secure
                  ? '차트 이미지를 복사해 Claude 입력창에 붙여넣으세요(Ctrl+V 또는 Cmd+V).'
                  : '차트 이미지를 PNG 파일로 저장해 Claude 대화창에 끌어다 넣으세요.'
                : capturePending
                  ? '지금 보고 있는 차트를 캡처하고 있습니다…'
                  : '먼저 차트를 캡처하세요.',
              preview ? (
                <div className="space-y-1.5">
                  <CopyPreview
                    capture={capture}
                    symbol={preview.symbol}
                    pending={capturePending}
                    error={preview.error}
                    onRecapture={preview.onRecapture}
                  />
                  {(capture || (!capturePending && !preview.error)) && (
                    capture && !secure ? (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={handleDownload}
                          className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70"
                        >
                          PNG로 저장해서 첨부하기
                        </button>
                        <StatusLabel state={imageStep} />
                        <p className="text-caption leading-relaxed text-text-muted">
                          {horizontal ? '이미지 복사가 안 됩니다(HTTP) — PNG 로 저장해 끌어 넣기' : INSECURE_NOTE}
                        </p>
                      </div>
                    ) : capture ? (
                      <div className="space-y-1.5">
                        <button
                          type="button"
                          onClick={() => void handleImage()}
                          disabled={busy}
                          className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70 disabled:opacity-40"
                        >
                          {captureLabel}
                        </button>
                        <StatusLabel state={imageStep} />
                        {imageStep.kind === 'failed' && (
                          <>
                            <Button variant="secondary" size="sm"
                              onClick={handleDownload}
                              className="w-full">
                              PNG로 저장해서 첨부하기
                            </Button>
                            <p className="text-caption leading-relaxed text-text-muted">
                              저장한 파일을 Claude 대화창에 드래그해 넣으세요.
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={onOpenCapture}
                        disabled={capturePending}
                        className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70 disabled:opacity-50"
                      >
                        {capturePending ? '캡처 준비 중…' : '차트 캡처하기'}
                      </button>
                    )
                  )}
                  {capture && (
                    <Button variant="ghost" size="sm"
                      onClick={preview.onRecapture}
                      disabled={capturePending}>
                      다시 캡처
                    </Button>
                  )}
                </div>
              ) : (
              capture && !secure ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70"
                  >
                    PNG로 저장해서 첨부하기
                  </button>
                  <StatusLabel state={imageStep} />
                  <p className="text-caption leading-relaxed text-text-muted">
                    {horizontal ? '이미지 복사가 안 됩니다(HTTP) — PNG 로 저장해 끌어 넣기' : INSECURE_NOTE}
                  </p>
                </div>
              ) : capture ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => void handleImage()}
                    disabled={busy}
                    className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70 disabled:opacity-40"
                  >
                    {captureLabel}
                  </button>
                  <StatusLabel state={imageStep} />
                  {imageStep.kind === 'failed' && (
                    <>
                      <Button variant="secondary" size="sm"
                        onClick={handleDownload}
                        className="w-full">
                        PNG로 저장해서 첨부하기
                      </Button>
                      <p className="text-caption leading-relaxed text-text-muted">
                        저장한 파일을 Claude 대화창에 드래그해 넣으세요.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onOpenCapture}
                  disabled={capturePending}
                  className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70 disabled:opacity-50"
                >
                  {capturePending ? '캡처 준비 중…' : '차트 캡처하기'}
                </button>
              )
              ),
            )}
            {arrow}
          </>
        )}

        {stepCard(
          includeImage ? 2 : 1,
          includeImage
            ? '분석 프롬프트를 복사해 같은 입력창에 이어서 붙여넣고 전송하세요.'
            : '분석 프롬프트를 복사해 Claude 대화에 붙여넣고 전송하세요.',
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => void handleText()}
              disabled={!promptReady}
              className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70 disabled:opacity-50"
            >
              {promptReady ? `${promptLabel}` : '데이터 불러오는 중…'}
            </button>
            <StatusLabel state={textStep} />
          </div>,
        )}
        {arrow}
        {stepCard(
          includeImage ? 3 : 2,
          'Claude 대화창이 열려 있지 않으면 여기서 엽니다(새 탭).',
          <button
            type="button"
            onClick={() => window.open('https://claude.ai/new', '_blank', 'noopener')}
            className="w-full rounded-md bg-bg-elevated px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-elevated/70"
          >
            Claude 대화 열기
          </button>,
        )}
      </ol>

      {!tipHidden && includeImage && !hideIntro && (
        <div className="rounded-lg bg-bg-tertiary/50 px-3 py-2 text-caption leading-relaxed text-text-muted">
          이미지와 프롬프트를 <b className="text-text-secondary">같은 대화</b>에 함께 보내면
          차트 패턴과 수치를 모두 분석합니다.
          <Button variant="ghost" size="md"
            onClick={hideTip}
            className="ml-1">
            다시 보지 않기
          </Button>
        </div>
      )}
    </section>
  );
}
