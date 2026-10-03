/**
 * 아이콘 공통 크기·선 굵기 (v2.36.0 디자인 규칙 1).
 *
 * 앱의 아이콘은 `lucide-react` 하나다. 모양을 맞추려고 크기·선 굵기를 여기 한 곳에 둔다 —
 * `<Settings {...ICON} />` 처럼 펼쳐 쓴다. 작은 자리(표 안·배지 옆)는 `ICON_SM`.
 * 색은 따로 주지 않는다 — `currentColor` 라 둘러싼 글자색(회색 계열)을 따른다.
 */
export const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;
export const ICON_SM = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;
export const ICON_LG = { size: 18, strokeWidth: 1.75, 'aria-hidden': true } as const;
