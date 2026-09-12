import { create } from 'zustand';
import type { Timeframe } from '../types/toss';
import { MAX_COMPARE_SYMBOLS } from '../types/compare';

/** 관심 목록 클릭 한 번의 결과 — 호출부가 안내 문구를 고른다 */
export type CompareToggleResult = 'added' | 'removed' | 'full';

interface AppState {
  /** 선택된 종목. null 이면 아직 고르지 않은 상태(종목 탐색 화면) */
  symbol: string | null;
  timeframe: Timeframe;
  /** 서버가 모의 데이터를 반환 중인지 (토스 API 키 미설정) */
  isMock: boolean;
  /**
   * 기업 비교 화면이 고른 종목.
   *
   * 컴포넌트 state 가 아니라 여기 있는 이유: 관심 목록 패널(`WatchPanel`)은 App 이
   * 비교 화면 **바깥**에 그리는데, 거기서 클릭·드래그로 비교 대상을 넣고 빼기 때문이다.
   * 비교 화면을 나가면 비운다 (`CompareView` 언마운트).
   */
  compareSymbols: string[];
  setSymbol: (symbol: string | null) => void;
  /** 종목 선택을 해제하고 탐색 화면으로 돌아간다 */
  clearSymbol: () => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setMock: (isMock: boolean) => void;
  /** 관심 목록 클릭 = 담기/빼기 토글. 가득 찼으면 'full' 을 돌려준다 */
  toggleCompareSymbol: (symbol: string) => CompareToggleResult;
  addCompareSymbol: (symbol: string) => CompareToggleResult;
  removeCompareSymbol: (symbol: string) => void;
  clearCompareSymbols: () => void;
}

const normalize = (symbol: string) => symbol.trim().toUpperCase();

export const useAppStore = create<AppState>((set, get) => ({
  symbol: null,
  timeframe: '1d',
  isMock: false,
  compareSymbols: [],
  setSymbol: (symbol) => set({ symbol: symbol ? normalize(symbol) : null }),
  clearSymbol: () => set({ symbol: null }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setMock: (isMock) => set({ isMock }),

  addCompareSymbol: (raw) => {
    const symbol = normalize(raw);
    if (!symbol) return 'full';
    const current = get().compareSymbols;
    if (current.includes(symbol)) return 'added';
    if (current.length >= MAX_COMPARE_SYMBOLS) return 'full';
    set({ compareSymbols: [...current, symbol] });
    return 'added';
  },

  toggleCompareSymbol: (raw) => {
    const symbol = normalize(raw);
    if (!symbol) return 'full';
    const current = get().compareSymbols;
    if (current.includes(symbol)) {
      set({ compareSymbols: current.filter((s) => s !== symbol) });
      return 'removed';
    }
    if (current.length >= MAX_COMPARE_SYMBOLS) return 'full';
    set({ compareSymbols: [...current, symbol] });
    return 'added';
  },

  removeCompareSymbol: (raw) =>
    set((state) => ({
      compareSymbols: state.compareSymbols.filter((s) => s !== normalize(raw)),
    })),

  clearCompareSymbols: () => set({ compareSymbols: [] }),
}));
