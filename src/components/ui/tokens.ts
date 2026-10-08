/**
 * 디자인 기준표의 크기 값 — 한 곳 (v2.42.0). 글자 크기·색은 `index.css` 의 `@theme`, **높이·폭**은 여기다.
 * 버튼·묶음 버튼·입력칸·드롭박스가 같은 높이를 쓴다: 기본 `md` 32px · 좁은 곳(표 안 등) `sm` 28px.
 * ⚠️ Tailwind 는 소스의 글자 그대로를 찾아 클래스를 만든다 — 값을 문자열을 조합해 만들지 말고 아래처럼 통째로 적는다.
 */
export const CONTROL_H = { md: 'h-8', sm: 'h-7' } as const;
export type ControlSize = keyof typeof CONTROL_H;

/** 묶음 버튼(Segmented) 안 칸 높이 — 바깥 틀 p-0.5(2px) 안에서 위 높이에 맞춘다 */
export const SEGMENT_H = { md: 'h-7', sm: 'h-6' } as const;

/**
 * 폼 줄(`FormRow`)의 이름 칸·값 칸 폭 — **같은 묶음은 같은 폭**이라 입력칸의 왼쪽·오른쪽 끝이 맞는다(사용자: "끝부분이 맞아떨어져야 깔끔").
 * 묶음마다 하나를 고른다(그 묶음에서 가장 긴 값이 들어가는 폭).
 */
export const FORM_LABEL_W = { sm: 'w-32', md: 'w-44', lg: 'w-56' } as const;
export const FORM_VALUE_W = { sm: 'w-28', md: 'w-40', lg: 'w-56' } as const;

/** 목록 줄 — 높이 약 36px + 줄 사이 4px (사용자: "아이템 사이 약간의 간격이 있어야 구분") */
export const LIST_ROW = 'min-h-9';
export const LIST_GAP = 'space-y-1';
