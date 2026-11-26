import type { ReactNode } from 'react';
import { TOUCH_HIT } from './tokens';

/**
 * 글자 단추(v2.76.0 · 디자인 규칙 「버튼 부품을 쓰지 않는 것 — 링크 글자」) — 문장 안의 파란 글자 「○○로 가기」.
 * 손가락 화면 누르는 칸 44 는 이 부품이 맡는다(`TOUCH_HIT` — 보이는 모양 · 줄 흐름 그대로).
 */
export default function LinkButton({ onClick, children, className = '' }: { onClick: () => void; children: ReactNode; /** 자리 · 굵기만(예: 굵은 제목 줄 안의 `font-normal`) — 색 · 밑줄은 부품이 맡음 */ className?: string }) {
  return (
    <button type="button" className={`text-accent hover:underline ${TOUCH_HIT} ${className}`.trim()} onClick={onClick}>
      {children}
    </button>
  );
}
