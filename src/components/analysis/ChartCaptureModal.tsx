import { useEffect, useMemo, useRef, useState } from 'react';
import CaptureChart, { type CaptureChartHandle } from '../chart/CaptureChart';
import CapturePreview from './CapturePreview';
import type { DrawingSnapshot } from '../chart/CandleChart';
import { captureElementToBlob } from '../../services/analysis/chartCapture';
import { useCaptureStore } from '../../store/captureStore';
import {
  OVERLAY_ITEMS,
  PANEL_ITEMS,
  TIMEFRAME_ITEMS,
  type IndicatorSeries,
  type IndicatorToggles,
  type OverlayIndicator,
  type PanelIndicator,
} from '../../types/chart';
import type { Candle, Timeframe } from '../../types/toss';
import { useCandleData } from '../../hooks/useCandleData';
import { useIndicators } from '../../hooks/useIndicators';

interface Props {
  symbol: string;
  /** 메인 차트의 타임프레임 — 팝업의 시작값이자, 캔들을 그대로 물려받을 기준 */
  timeframe: Timeframe;
  /** 메인 차트가 이미 들고 있는 캔들 (같은 타임프레임일 때 재사용) */
  candles: Candle[];
  indicators: IndicatorSeries | null;
  /** 기본값 — 메인 차트에서 지금 켜져 있는 항목과 같게 시작한다 */
  toggles: IndicatorToggles;
  drawings: DrawingSnapshot[];
  initialRange: { from: number; to: number } | null;
  onClose: () => void;
}

/** 매 렌더 새 배열이 만들어지지 않도록 고정해 둔다 */
const EMPTY_DRAWINGS: DrawingSnapshot[] = [];

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
  /** 팝업 안에서만 바꾸는 타임프레임 — 메인 차트는 건드리지 않는다 */
  const [tf, setTf] = useState<Timeframe>(timeframe);
  const [includeDrawings, setIncludeDrawings] = useState(drawings.length > 0);
  const [shot, setShot] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
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

  /*
   * 메인 차트와 같은 타임프레임이면 이미 받아 둔 캔들·지표를 그대로 쓴다.
   * 다를 때만 서버에서 새로 받는다 (5·15·30분봉 집계는 /api/candles 가 맡는다).
   */
  const isMainTf = tf === timeframe;
  // 거래량은 캔들만으로 그리므로 지표 엔진 호출 대상에서 제외한다 (App 과 같은 규칙).
  const needsEngine =
    Object.values(toggles.overlays).some(Boolean) ||
    (Object.entries(toggles.panels) as [string, boolean][]).some(
      ([key, on]) => on && key !== 'volume',
    );

  const altCandles = useCandleData(symbol, tf, !isMainTf);
  const altIndicators = useIndicators(symbol, tf, !isMainTf && needsEngine);

  const activeCandles = isMainTf ? candles : altCandles.candles;
  const activeIndicators = isMainTf ? indicators : altIndicators.indicators;
  const dataLoading = !isMainTf && (altCandles.loading || altIndicators.loading);
  const dataError = isMainTf ? null : altCandles.error;

  /*
   * 다른 타임프레임에서는 드로잉을 옮기지 않는다 — 앵커가 그은 시각에 묶여 있어
   * 엉뚱한 자리에 그려진다. 배열을 매 렌더 새로 만들면 드로잉 effect 가 계속 돈다.
   */
  const activeDrawings = useMemo(
    () => (includeDrawings && isMainTf ? drawings : EMPTY_DRAWINGS),
    [includeDrawings, isMainTf, drawings],
  );

  const changeTimeframe = (next: Timeframe) => {
    if (next === tf) return;
    setTf(next);
    // 봉이 바뀌면 이전 범위는 의미가 없다 — 새 데이터에 맞춰 다시 잡는다.
    setRange(null);
  };

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
      timeframe: tf,
      candles: activeCandles,
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
          <div className="flex items-center gap-1">
            {TIMEFRAME_ITEMS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => changeTimeframe(item.value)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  tf === item.value
                    ? 'bg-accent/15 font-medium text-accent'
                    : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                }`}
              >
                {item.label}
              </button>
            ))}
            {dataLoading && <span className="ml-2 text-[11px] text-accent">불러오는 중…</span>}
            {dataError && <span className="ml-2 text-[11px] text-bearish">❌ {dataError}</span>}
          </div>

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
                {isMainTf ? (
                  checkbox(includeDrawings, `드로잉 ${drawings.length}개`, () =>
                    setIncludeDrawings((v) => !v),
                  )
                ) : (
                  /*
                   * 드로잉 앵커는 그은 시각에 묶여 있다. 다른 타임프레임으로 옮기면
                   * 추세선이 화면 밖 시각을 가리켜 엉뚱한 자리에 그려진다.
                   * (특히 1분봉은 3일치뿐이라 일봉에 그은 선이 아예 범위 밖이다.)
                   */
                  <span className="text-[11px] text-text-muted">
                    드로잉은 {TIMEFRAME_ITEMS.find((i) => i.value === timeframe)?.label}에서만
                    포함됩니다
                  </span>
                )}
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            {/*
              타임프레임이 바뀌면 차트를 새로 만든다. 봉 수가 달라져 이전 논리 범위를
              그대로 쓸 수 없고, 남은 시리즈를 일일이 정리하는 것보다 확실하다.
            */}
            <CaptureChart
              key={tf}
              ref={chartRef}
              candles={activeCandles}
              indicators={activeIndicators}
              toggles={toggles}
              drawings={activeDrawings}
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
              disabled={busy || dataLoading || !activeCandles.length}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? '캡처 중…' : dataLoading ? '불러오는 중…' : '📸 캡처'}
            </button>
          </div>
        </div>

        {shot && (
          <CapturePreview
            url={shot.url}
            width={shot.width}
            height={shot.height}
            symbol={symbol}
            timeframe={tf}
            onRetake={() => setShot(null)}
            onConfirm={handleConfirm}
          />
        )}
      </div>
    </div>
  );
}
