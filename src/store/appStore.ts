import { create } from 'zustand';
import type { Timeframe } from '../types/toss';
import { MAX_COMPARE_SYMBOLS } from '../types/compare';

/** 관심 목록 클릭 한 번의 결과 — 호출부가 안내 문구를 고른다 */
export type CompareToggleResult = 'added' | 'removed' | 'full';

/** 비교 화면은 항상 2×2 = 4칸이다 */
export const COMPARE_SLOT_COUNT = MAX_COMPARE_SYMBOLS;

const emptySlots = (): (string | null)[] => Array(COMPARE_SLOT_COUNT).fill(null);

interface AppState {
  /** 선택된 종목. null 이면 아직 고르지 않은 상태(종목 탐색 화면) */
  symbol: string | null;
  timeframe: Timeframe;
  /** 서버가 모의 데이터를 반환 중인지 (토스 API 키 미설정) */
  isMock: boolean;
  /**
   * 기업 비교 화면의 **4칸 슬롯**. 빈 칸은 null 이다.
   *
   * 길이를 4로 고정하는 이유: 화면이 항상 2×2 이고, 사용자가 "② 번 칸에 이 종목" 처럼
   * 자리를 직접 고르기 때문이다. 종목 목록만 들고 있으면 빈 칸의 위치를 표현할 수 없다.
   *
   * 컴포넌트 state 가 아니라 여기 있는 이유: 관심 목록 패널(`WatchPanel`)은 App 이
   * 비교 화면 **바깥**에 그리는데, 거기서 클릭·드래그로 비교 대상을 넣고 빼기 때문이다.
   * 비교 화면을 나가면 비운다 (`CompareView` 언마운트).
   */
  compareSlots: (string | null)[];
  setSymbol: (symbol: string | null) => void;
  /** 종목 선택을 해제하고 탐색 화면으로 돌아간다 */
  clearSymbol: () => void;
  setTimeframe: (timeframe: Timeframe) => void;
  setMock: (isMock: boolean) => void;
  /** 관심 목록 클릭 = 담기/빼기 토글. 가득 찼으면 'full' 을 돌려준다 */
  toggleCompareSymbol: (symbol: string) => CompareToggleResult;
  /** 빈 슬롯 중 **번호가 작은 곳**에 담는다 */
  addCompareSymbol: (symbol: string) => CompareToggleResult;
  /** 슬롯을 지정해 담는다 (드래그 드롭·슬롯 안 검색). 차 있으면 교체한다 */
  setCompareSlot: (index: number, symbol: string) => void;
  removeCompareSlot: (index: number) => void;
  clearCompareSymbols: () => void;
}

const normalize = (symbol: string) => symbol.trim().toUpperCase();

export const useAppStore = create<AppState>((set, get) => ({
  symbol: null,
  timeframe: '1d',
  isMock: false,
  compareSlots: emptySlots(),
  setSymbol: (symbol) => set({ symbol: symbol ? normalize(symbol) : null }),
  clearSymbol: () => set({ symbol: null }),
  setTimeframe: (timeframe) => set({ timeframe }),
  setMock: (isMock) => set({ isMock }),

  addCompareSymbol: (raw) => {
    const symbol = normalize(raw);
    if (!symbol) return 'full';
    const slots = get().compareSlots;
    if (slots.includes(symbol)) return 'added';

    const empty = slots.indexOf(null);
    if (empty === -1) return 'full';

    const next = [...slots];
    next[empty] = symbol;
    set({ compareSlots: next });
    return 'added';
  },

  toggleCompareSymbol: (raw) => {
    const symbol = normalize(raw);
    if (!symbol) return 'full';
    const slots = get().compareSlots;
    const at = slots.indexOf(symbol);

    if (at !== -1) {
      const next = [...slots];
      next[at] = null;
      set({ compareSlots: next });
      return 'removed';
    }
    return get().addCompareSymbol(symbol);
  },

  setCompareSlot: (index, raw) => {
    const symbol = normalize(raw);
    if (!symbol) return;
    const next = [...get().compareSlots];
    // 같은 종목이 두 칸에 들어가지 않게, 원래 있던 칸은 비운다.
    const previous = next.indexOf(symbol);
    if (previous !== -1) next[previous] = null;
    next[index] = symbol;
    set({ compareSlots: next });
  },

  removeCompareSlot: (index) =>
    set((state) => {
      const next = [...state.compareSlots];
      next[index] = null;
      return { compareSlots: next };
    }),

  clearCompareSymbols: () => set({ compareSlots: emptySlots() }),
}));
