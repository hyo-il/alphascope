import { create } from 'zustand';
import type { Timeframe } from '../types/toss';

interface AppState {
  /** 선택된 종목. null 이면 아직 고르지 않은 상태(종목 탐색 화면) */
  symbol: string | null;
  timeframe: Timeframe;
  /** 서버가 모의 데이터를 반환 중인지 (토스 API 키 미설정) */
  isMock: boolean;
  setSymbol: (symbol: string | null) => void;
  /** 종목 선택을 해제하고 탐색 화면으로 돌아간다 */
  clearSymbol: () => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setMock: (isMock: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  symbol: null,
  timeframe: '1d',
  isMock: false,
  setSymbol: (symbol) => set({ symbol: symbol ? symbol.trim().toUpperCase() : null }),
  clearSymbol: () => set({ symbol: null }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setMock: (isMock) => set({ isMock }),
}));
