import { create } from 'zustand';
import type { Timeframe } from '../types/toss';

interface AppState {
  symbol: string;
  timeframe: Timeframe;
  /** 서버가 모의 데이터를 반환 중인지 (토스 API 키 미설정) */
  isMock: boolean;
  setSymbol: (symbol: string) => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setMock: (isMock: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  symbol: 'AAPL',
  timeframe: '1d',
  isMock: false,
  setSymbol: (symbol) => set({ symbol: symbol.trim().toUpperCase() }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setMock: (isMock) => set({ isMock }),
}));
