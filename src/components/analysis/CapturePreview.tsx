interface Props {
  url: string;
  width: number;
  height: number;
  symbol: string;
  timeframe: string;
  onRetake: () => void;
  onConfirm: () => void;
}

/**
 * 캡처 팝업 2단계 — 방금 캡처한 이미지를 확인한다 (수정 3).
 *
 * 예전에는 캡처 결과를 보지 못한 채 클립보드로 바로 보냈다. Claude 에 붙여넣고 나서야
 * 범위가 어긋난 걸 알게 되는 흐름이라, 보내기 전에 한 번 보여 준다.
 */
export default function CapturePreview({
  url,
  width,
  height,
  symbol,
  timeframe,
  onRetake,
  onConfirm,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-md border border-border bg-bg-primary p-3">
        <img
          src={url}
          alt={`${symbol} ${timeframe} 캡처 미리보기`}
          className="max-h-full max-w-full object-contain"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-text-muted">
          {symbol} · {timeframe} · {width}×{height}px
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetake}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            ↩ 다시 캡처
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
          >
            이 이미지로 분석 →
          </button>
        </div>
      </div>
    </div>
  );
}
