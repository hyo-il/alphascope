import { modal } from './uiStore';

/**
 * 저장하지 않고 나갈 때 묻기 — 한 곳(v2.72.2 · 공통 화면 부품 3-3).
 *
 * - 바꾼 것이 남은 창(`ui/Dialog` `dirty`) · 편집 화면(`useLeaveGuard`)이 여기에 「막을 것」 으로 올라온다.
 * - 화면을 떠나는 길(메뉴 · 화면 안 탭 · 홈 · 뒤로 가기 — `appStore` 의 화면 바꾸기와 `useHashRoute`)은 모두 `guardLeave` 를 거친다.
 *   - 바꾼 것이 없으면 바로 간다 · 있으면 공용 확인 창(아래 문구) · 저장 중(막는 로딩)이면 묻지도 가지도 않는다.
 *   - [저장하지 않고 닫기] 면 바꾼 것을 버리고(창은 닫힘) 간다.
 * - 브라우저 탭 · 창 닫기(`beforeunload`)는 묻지 않는다(공통 3-3 — 브라우저 기본 창이라 글을 바꿀 수 없다).
 */
export const DISCARD_ASK = {
  title: '저장하지 않고 닫을까요?',
  message: '바꾼 내용이 사라져요',
  confirmText: '저장하지 않고 닫기',
} as const;

interface Guard {
  dirty: () => boolean;
  busy: () => boolean;
  /** 버리기 — 창은 닫기 · 화면은 처음 값으로 */
  discard: () => void;
}

const guards = new Set<Guard>();
/** [저장하지 않고 닫기] 뒤 이어지는 이동 한 번은 다시 묻지 않는다(버린 상태가 화면에 반영되기 전) */
let passing = false;
let allowance = false;

export function addLeaveGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

/** 떠나도 되나 — `busy` 면 막는 로딩 중(묻지도 가지도 않음) · `dirty` 면 물어야 함 */
export function leaveState(): 'free' | 'dirty' | 'busy' {
  if (passing) return 'free';
  let dirty = false;
  for (const g of guards) {
    if (g.busy()) return 'busy';
    if (g.dirty()) dirty = true;
  }
  return dirty ? 'dirty' : 'free';
}

/** 공용 확인 창 — [취소](기본 초점 · Esc) → [저장하지 않고 닫기] */
export function askDiscard(onDiscard: () => void): void {
  modal.confirm({ ...DISCARD_ASK, danger: true, focusCancel: true, onConfirm: onDiscard });
}

function discardAll(): void {
  for (const g of [...guards]) if (g.dirty()) g.discard();
}

/** 버리고 `go` — 그 사이의 이동은 묻지 않는다 */
function passWith(go: () => void): void {
  discardAll();
  runPassing(go);
}

/** 화면을 떠나는 길 한 곳 — 바꾼 것이 없으면 바로 `go` */
export function guardLeave(go: () => void): void {
  const state = leaveState();
  if (state === 'free') return go();
  if (state === 'busy') return;
  askDiscard(() => passWith(go));
}

/**
 * 주소(뒤로 · 앞으로 가기)에서 온 이동 — 주소는 이미 바뀌었으므로 막으면 `restore` 로 되돌리고,
 * [저장하지 않고 닫기] 면 버린 뒤 `retry`(같은 이동을 다시 — `history.back()` 등) 한 번은 묻지 않는다.
 * 돌려주는 값: 지금 이 이동을 이어 가도 되나.
 */
export function guardAddressLeave(restore: () => void, retry: () => void): boolean {
  if (allowance) {
    allowance = false;
    return true;
  }
  const state = leaveState();
  if (state === 'free') return true;
  restore();
  if (state === 'dirty') {
    askDiscard(() => {
      discardAll();
      allowance = true;
      retry();
    });
  }
  return false;
}

/** 주소에서 온 이동을 이어 갈 때 — 안의 화면 바꾸기가 다시 묻지 않게 */
export function runPassing(go: () => void): void {
  passing = true;
  try {
    go();
  } finally {
    passing = false;
  }
}
