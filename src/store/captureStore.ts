import { create } from 'zustand';

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
  timeframe: string;
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
