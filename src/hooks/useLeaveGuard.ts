import { useLayoutEffect, useRef } from 'react';
import { addLeaveGuard } from '../store/leaveGuard';

/**
 * 이 창 · 화면에 바꾼 것이 남았으면 떠나기 전에 묻게 한다(v2.72.2 · 공통 화면 부품 3-3 — 판단은 `store/leaveGuard` 한 곳).
 * - `dirty`: 처음 값과 지금 값이 다른가(되돌리면 다시 false). `busy`: 저장 중(막는 로딩) — 묻지도 떠나지도 않는다.
 * - `discard`: [저장하지 않고 닫기] 뒤 부른다 — 창이면 닫기, 화면이면 처음 값으로(화면이 사라지면 안 줘도 된다).
 * 창은 `ui/Dialog` 의 `dirty` 를 쓴다(창이 이 훅을 부른다) — 화면 코드가 직접 부르는 것은 창이 아닌 편집 화면뿐.
 */
export function useLeaveGuard(dirty: boolean, opts: { busy?: boolean; discard?: () => void; note?: string } = {}): void {
  const ref = useRef({ dirty, busy: opts.busy ?? false, discard: opts.discard, note: opts.note });
  ref.current = { dirty, busy: opts.busy ?? false, discard: opts.discard, note: opts.note };
  const on = dirty || (opts.busy ?? false);
  // 그리기 바로 뒤에 올린다 — 바꾸자마자 다른 메뉴를 눌러도 묻는다
  useLayoutEffect(() => {
    if (!on) return;
    return addLeaveGuard({
      dirty: () => ref.current.dirty,
      busy: () => ref.current.busy,
      discard: () => ref.current.discard?.(),
      note: () => ref.current.note,
    });
  }, [on]);
}
