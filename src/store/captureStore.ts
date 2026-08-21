import { create } from 'zustand';
import type { Candle, Timeframe } from '../types/toss';

/**
 * 캡처해 둔 차트 이미지.
 *
 * 미리 Blob 으로 들고 있는 것이 핵심이다. 버튼을 누른 뒤에 html2canvas 를 돌리면
 * 렌더가 끝날 때쯤엔 사용자 제스처가 만료돼 `clipboard.write()` 가 거부된다
 * (NotAllowedError). 이미 만들어 둔 Blob 은 클릭 즉시 쓸 수 있어 거부되지 않는다.
 */
export interface ChartCapture {
  blob: Blob;
  /** `URL.createObjectURL(blob)` — 썸네일·프리뷰에서 쓴다 */
  url: string;
  width: number;
  height: number;
  symbol: string;
  /** 팝업에서 고른 타임프레임 — 메인 차트와 다를 수 있다 */
  timeframe: Timeframe;
  /**
   * 이 이미지를 그린 캔들.
   *
   * 프롬프트의 OHLCV·지표가 이미지와 같은 봉을 가리켜야 한다. 일봉 차트를 보다가
   * 팝업에서 5분봉으로 캡처했는데 프롬프트에 일봉 수치가 실리면, Claude 는
   * 서로 다른 두 시간대를 하나로 읽는다.
   */
  candles: Candle[];
  capturedAt: number;
}

interface CaptureState {
  capture: ChartCapture | null;
  setCapture: (capture: ChartCapture) => void;
  clearCapture: () => void;
}

export const useCaptureStore = create<CaptureState>((set, get) => ({
  capture: null,
  setCapture: (capture) => {
    // 이전 objectURL 을 놓아 주지 않으면 캡처를 반복할수록 메모리에 쌓인다.
    const previous = get().capture;
    if (previous) URL.revokeObjectURL(previous.url);
    set({ capture });
  },
  clearCapture: () => {
    const previous = get().capture;
    if (previous) URL.revokeObjectURL(previous.url);
    set({ capture: null });
  },
}));
