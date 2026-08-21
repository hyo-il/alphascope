import { useEffect, useRef, useState } from 'react';
import CaptureChart, { type CaptureChartHandle } from '../chart/CaptureChart';
import CapturePreview from './CapturePreview';
import type { DrawingSnapshot } from '../chart/CandleChart';
import { captureElementToBlob } from '../../services/analysis/chartCapture';
import { useCaptureStore } from '../../store/captureStore';
import {
  OVERLAY_ITEMS,
  PANEL_ITEMS,
  type IndicatorSeries,
  type IndicatorToggles,
  type OverlayIndicator,
  type PanelIndicator,
} from '../../types/chart';
import type { Candle } from '../../types/toss';

interface Props {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  indicators: IndicatorSeries | null;
  /** 기본값 — 메인 차트에서 지금 켜져 있는 항목과 같게 시작한다 */
  toggles: IndicatorToggles;
  drawings: DrawingSnapshot[];
  initialRange: { from: number; to: number } | null;
  onClose: () => void;
}

/** 다음 페인트까지 기다린다 — 캡처가 그리기보다 앞서지 않게 한다. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

interface Shot {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

/**
 * 차트 캡처 팝업 (수정 3).
 *
 * 1단계에서 범위와 포함 항목을 맞추고, 2단계에서 결과를 확인한 뒤 분석으로 넘긴다.
 * 캡처는 여기서 미리 끝내 두므로, AI 분석 탭의 복사 버튼은 Blob 만 쓰면 된다.
 */
export default function ChartCaptureModal({
  symbol,
  timeframe,
  candles,
  indicators,
  toggles: initialToggles,
  drawings,
  initialRange,
  onClose,
}: Props) {
  const chartRef = useRef<CaptureChartHandle>(null);
  const [toggles, setToggles] = useState<IndicatorToggles>(initialToggles);
  const [includeDrawings, setIncludeDrawings] = useState(drawings.length > 0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * 차트가 한 번 그려지기 전에는 캡처를 막는다.
   * 칠해지지 않은 캔버스를 담으면 빈 PNG 가 나오는데, 프리뷰를 보기 전까지 알 수 없다.
   */
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 다시 캡처했을 때 조정해 둔 범위를 잃지 않도록 들고 있는다 */
  const [range, setRange] = useState(initialRange);
  const setCapture = useCaptureStore((s) => s.setCapture);

  // 프리뷰용 objectURL 은 모달이 닫히거나 다시 캡처할 때 놓아 준다.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const flip = (group: 'overlays' | 'panels', key: string) =>
    setToggles((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: !prev[group][key as OverlayIndicator & PanelIndicator] },
    }));

  const handleCapture = async () => {
    const element = chartRef.current?.getElement();
    if (!element) return;

    setBusy(true);
    setError(null);
    // 조정해 둔 범위를 기억해 둔다 — '다시 캡처' 로 돌아왔을 때 그 자리에서 이어 간다.
    setRange(chartRef.current?.getVisibleRange() ?? range);

    try {
      // 방금 바꾼 체크박스·범위가 캔버스에 반영될 때까지 두 프레임 기다린다.
      await nextFrame();
      await nextFrame();

      const { blob, width, height } = await captureElementToBlob(element);
      setShot({ blob, url: URL.createObjectURL(blob), width, height });
    } catch (e) {
      setError(e instanceof Error ? e.message : '캡처에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = () => {
    if (!shot) return;
    // 스토어가 자체 objectURL 을 들고 있어야 프리뷰 URL 해제와 얽히지 않는다.
    setCapture({
      blob: shot.blob,
      url: URL.createObjectURL(shot.blob),
      width: shot.width,
      height: shot.height,
      symbol,
      timeframe,
      capturedAt: Date.now(),
    });
    onClose();
  };

  const checkbox = (checked: boolean, label: string, onChange: () => void) => (
    <label key={label} className="flex items-center gap-1.5 text-[11px] text-text-secondary">
      <input type="checkbox" checked={checked} onChange={onChange} className="accent-accent" />
      {label}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[78vh] w-[88vw] max-w-[1200px] flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-4">
        <div className="flex shrink-0 items-center justify-between">
          <h2 className="text-sm font-medium text-text-primary">
            {shot ? '캡처 확인' : '차트 캡처'}
            <span className="ml-2 text-[11px] font-normal text-text-muted">
              {shot
                ? '이 이미지를 Claude 에 보냅니다'
                : '범위를 맞추고 포함할 항목을 고른 뒤 캡처하세요'}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted transition-colors hover:text-text-primary"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/*
          1단계 차트는 언마운트하지 않는다. 프리뷰에서 '다시 캡처'로 돌아왔을 때
          차트를 새로 만들면 맞춰 둔 범위와 조작감이 초기화되기 때문이다.
        */}
        <div className={shot ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-3'}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md bg-bg-tertiary/50 px-3 py-2">
            {OVERLAY_ITEMS.map((item) =>
              checkbox(toggles.overlays[item.key], item.label, () => flip('overlays', item.key)),
            )}
            <span className="text-border">|</span>
            {PANEL_ITEMS.map((item) =>
              checkbox(toggles.panels[item.key], item.label, () => flip('panels', item.key)),
            )}
            {drawings.length > 0 && (
              <>
                <span className="text-border">|</span>
                {checkbox(includeDrawings, `드로잉 ${drawings.length}개`, () =>
                  setIncludeDrawings((v) => !v),
                )}
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            <CaptureChart
              ref={chartRef}
              onReady={() => setReady(true)}
              candles={candles}
              indicators={indicators}
              toggles={toggles}
              drawings={includeDrawings ? drawings : []}
              initialRange={range}
            />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3">
            <p className="text-[11px] text-text-muted">
              휠: 확대/축소 · 드래그: 좌우 이동 · Esc: 닫기
              {error && <span className="ml-2 text-bearish">❌ {error}</span>}
            </p>
            <button
              type="button"
              onClick={() => void handleCapture()}
              disabled={busy || !ready || !candles.length}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? '캡처 중…' : ready ? '📸 캡처' : '차트 준비 중…'}
            </button>
          </div>
        </div>

        {shot && (
          <CapturePreview
            url={shot.url}
            width={shot.width}
            height={shot.height}
            symbol={symbol}
            timeframe={timeframe}
            onRetake={() => setShot(null)}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  );
}
