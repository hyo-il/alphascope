import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';

/**
 * 빨간 표시가 보이는 때(v2.71.2 · 사용자 결정 2026-11-17) — 앱의 모든 입력 칸이 이 한 곳을 따른다.
 * - 빨간 테두리 · 빨간 글 = **칸이 틀렸을 때만**, 그리고 그 칸을 **한 번 건드리고 떠난 뒤**(blur) 또는 그 폼의 **[저장] 을 누른 뒤**.
 *   처음 열었을 때 · 아직 손대지 않은 칸은 빨갛지 않다. 무엇이 틀린 값인지 · [저장] 을 막는지는 화면이 정한다(여기는 보이는 때만).
 * - 「저장 시도」 = 폼 묶음(`Dialog` 판 · `FormScope`) 안에서 `data-form-submit` 버튼(`Button submit`)을 누름(꺼진 버튼도 — 크롬은 꺼진 버튼에도 pointerdown 을 보낸다)
 *   또는 폼 제출(Enter). 묶음이 겹치면 가장 가까운 묶음만.
 * - 「건드림」 = `FormRow` 하나(또는 `FieldTouch` 묶음) 안의 칸을 떠남. 묶음 밖 칸은 칸마다.
 * - 서버가 거절한 오류(저장 실패 · 찾기 실패 등)는 「입력 칸 틀림」 이 아니라 「저장 결과」 — `rejected` 로 넘기면 바로 보인다.
 */

const SubmitTried = createContext(false);
type Touch = { touched: boolean; touch: () => void };
const TouchCtx = createContext<Touch | null>(null);

/** 폼 묶음의 「저장 시도」 상태와 그 묶음 틀에 붙일 속성 — `Dialog` 판과 `FormScope` 가 쓴다 */
export function useFormScope() {
  const [tried, setTried] = useState(false);
  const mark = useCallback((e: SyntheticEvent) => {
    const t = e.target as Element | null;
    if (!(t instanceof Element) || t.closest('[data-form-scope]') !== e.currentTarget) return;
    if (e.type === 'submit' || t.closest('[data-form-submit]')) setTried(true);
  }, []);
  const props = { 'data-form-scope': '', onPointerDownCapture: mark, onClickCapture: mark, onSubmitCapture: mark } as const;
  return { tried, props };
}

/** 폼 묶음 하나 — 판(`Dialog`) 밖의 폼(설정 창 안 한 구역 등)을 따로 묶을 때. 자리를 차지하지 않는다(display: contents) */
export function FormScope({ children }: { children: ReactNode }) {
  const { tried, props } = useFormScope();
  return (
    <div className="contents" {...props}>
      <SubmitTried.Provider value={tried}>{children}</SubmitTried.Provider>
    </div>
  );
}
/** `Dialog` 가 판 안을 감쌀 때 */
export function SubmitTriedProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <SubmitTried.Provider value={value}>{children}</SubmitTried.Provider>;
}

/** 칸 여럿이 오류 글 하나를 함께 쓸 때(규칙 창의 RSI 범위 등) — 안의 어느 칸이든 떠나면 묶음 전체가 「건드림」 */
export function FieldTouch({ children }: { children: ReactNode }) {
  const [touched, setTouched] = useState(false);
  const touch = useCallback(() => setTouched(true), []);
  const value = useMemo(() => ({ touched, touch }), [touched, touch]);
  return <TouchCtx.Provider value={value}>{children}</TouchCtx.Provider>;
}

/** 지금 묶음에서 틀림을 보여도 되나(건드렸거나 저장을 눌렀나) */
export function useRevealed(): boolean {
  const tried = useContext(SubmitTried);
  const group = useContext(TouchCtx);
  return tried || (group?.touched ?? false);
}

/**
 * 입력 칸(`Input` · `NumberField`)이 쓴다 — 빨간 테두리를 보일지와 칸을 떠날 때 부를 함수.
 * `invalid` 는 그대로 「틀림」(보이는 때만 늦춘다) · `rejected` 는 서버 거절(바로 보임).
 */
export function useFieldInvalid(invalid: boolean, rejected: boolean) {
  const tried = useContext(SubmitTried);
  const group = useContext(TouchCtx);
  const [own, setOwn] = useState(false);
  const touched = group ? group.touched : own;
  const groupTouch = group?.touch;
  const touch = useCallback(() => (groupTouch ? groupTouch() : setOwn(true)), [groupTouch]);
  return { show: rejected || (invalid && (touched || tried)), touch };
}

/** 칸 아래 빨간 오류 글 — 보이는 때는 위 규칙(건드림 · 저장 시도). 글이 없으면 그리지 않는다 */
export function FieldError({ children, className = '' }: { children: ReactNode; className?: string }) {
  const revealed = useRevealed();
  if (children == null || children === false || children === '' || !revealed) return null;
  return (
    <span className={`text-caption text-danger ${className}`} data-field-error>
      {children}
    </span>
  );
}
