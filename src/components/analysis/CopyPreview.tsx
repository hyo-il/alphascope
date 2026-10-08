import Dialog from '../ui/Dialog';
import { useEffect, useState } from 'react';
import type { ChartCapture } from '../../store/captureStore';
import { TIMEFRAME_LABEL } from '../../types/toss';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 「복사될 차트」 미리보기 (v2.34.0) — AI 분석 화면(전체 모드)의 ① 칸.
 *
 * 그 화면에는 차트가 보이지 않아 "어떤 그림이 복사되는지" 알 수 없었다. 그래서 **복사·저장에 쓰는 바로 그 Blob**(자동 캡처가
 * `captureStore` 에 넣어 둔 것)을 작게 보이고, 누르면 크게 본다. 새로 캡처하는 경로는 만들지 않는다 — [다시 캡처] 는 기존 자동 캡처를 한 번 더 돌린다.
 * ⚠️ 이 컴포넌트가 만든 objectURL 은 그림이 바뀌거나 화면을 떠날 때 `revokeObjectURL` 한다.
 */
export default function CopyPreview({
  capture,
  symbol,
  pending,
  error,
  onRecapture,
}: {
  capture: ChartCapture | null;
  /** 지금 보고 있는 종목 — 없으면 미리보기 대신 안내 */
  symbol: string | null;
  pending: boolean;
  error: string | null;
  onRecapture: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const nameOf = useStockNames(capture ? [capture.symbol] : []);
  const blob = capture?.blob ?? null;

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  const box = 'flex aspect-[16/10] w-full items-center justify-center rounded border border-border bg-bg-primary text-center text-caption text-text-muted';

  if (!symbol) return <div className={box}>차트에서 종목을 먼저 고르세요</div>;
  if (pending) return <div className={box}>캡처 준비 중…</div>;
  if (error) {
    return (
      <div className={`${box} flex-col gap-1 px-2`}>
        <span className="text-danger">캡처하지 못했습니다 — {error}</span>
        <button type="button" onClick={onRecapture} className="text-accent hover:underline">
          다시 캡처
        </button>
      </div>
    );
  }
  if (!capture || !url) return null;

  const at = new Date(capture.capturedAt);
  const time = [at.getHours(), at.getMinutes(), at.getSeconds()].map((v) => String(v).padStart(2, '0')).join(':');
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="크게 보기"
        className="block w-full overflow-hidden rounded border border-border transition-colors hover:border-accent"
      >
        <img src={url} alt="복사될 차트" className="block h-auto w-full" />
      </button>
      <p className="text-caption text-text-muted">
        {nameOf(capture.symbol) ?? ''} {capture.symbol} · {TIMEFRAME_LABEL[capture.timeframe]} · 캡처 {time}
      </p>
      {/* 큰 미리보기 — 공용 창 틀(v2.41.0). ESC·바깥 클릭·닫기 X 로 닫는다 */}
      {open && (
        <Dialog
          title="복사될 차트"
          titleAside={`${nameOf(capture.symbol) ?? ''} ${capture.symbol} · ${TIMEFRAME_LABEL[capture.timeframe]} · 캡처 ${time}`}
          onClose={() => setOpen(false)}
          size="full"
          z={96}
          bodyClassName="flex items-center justify-center p-4"
        >
          <img src={url} alt="복사될 차트 (크게)" className="max-h-full max-w-full rounded" />
        </Dialog>
      )}
    </>
  );
}
