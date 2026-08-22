import { create } from 'zustand';

/**
 * 앱 공통 팝업 상태.
 *
 * 브라우저 기본 alert/confirm 은 앱 밖 시스템 창이라 다크 테마와 겉돌고,
 * 자동화·임베딩 환경에서는 아예 막히기도 한다. 상태만 여기 두고
 * 실제 렌더는 앱 루트의 `<ModalHost />` · `<ToastHost />` 가 한 번만 맡는다.
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  /** 보조 설명 (선택) */
  detail?: string;
}

/** 확인창 본문에 항목별로 늘어놓을 값 — 금액·수수료를 문장에 묻지 않기 위한 것 */
export interface ModalRow {
  label: string;
  value: string;
  tone?: 'default' | 'bullish' | 'bearish' | 'muted';
}

export interface ModalRequest {
  title: string;
  message?: string;
  rows?: ModalRow[];
  confirmText?: string;
  cancelText?: string;
  /** 되돌릴 수 없는 동작이면 확인 버튼을 위험 색으로 */
  danger?: boolean;
  /** 알림 전용 — 취소 버튼을 감춘다 */
  alertOnly?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface UiState {
  modal: ModalRequest | null;
  toasts: ToastItem[];
  openModal: (request: ModalRequest) => void;
  closeModal: () => void;
  pushToast: (toast: Omit<ToastItem, 'id'>) => number;
  dismissToast: (id: number) => void;
}

let nextToastId = 1;

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  toasts: [],
  openModal: (request) => set({ modal: request }),
  closeModal: () => set({ modal: null }),
  pushToast: (toast) => {
    const id = nextToastId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** 어디서든 확인창을 띄운다 (컴포넌트 밖에서도 호출 가능하도록 스토어를 직접 쓴다) */
export const modal = {
  confirm: (request: ModalRequest) => useUiStore.getState().openModal(request),
  alert: (request: Omit<ModalRequest, 'alertOnly'>) =>
    useUiStore.getState().openModal({ ...request, alertOnly: true }),
};

export const toast = {
  show: (type: ToastType, message: string, detail?: string) =>
    useUiStore.getState().pushToast({ type, message, detail }),
  success: (message: string, detail?: string) =>
    useUiStore.getState().pushToast({ type: 'success', message, detail }),
  error: (message: string, detail?: string) =>
    useUiStore.getState().pushToast({ type: 'error', message, detail }),
  warning: (message: string, detail?: string) =>
    useUiStore.getState().pushToast({ type: 'warning', message, detail }),
  info: (message: string, detail?: string) =>
    useUiStore.getState().pushToast({ type: 'info', message, detail }),
};

/** 훅 형태를 선호하는 호출부용 — 내용은 위와 같다 */
export const useModal = () => modal;
export const useToast = () => toast;
