import type { ReactNode } from 'react';
import { useLayoutMode } from '../../hooks/useLayoutMode';

/**
 * 화면 제목(`<h2>`) 하나 — **폰 모양에서는 글을 숨긴다**(v2.74.0 · 테마 5-1 — 위쪽 막대가 화면 이름을 보여 줘 두 번 나온다).
 * 숨긴 제목은 화면 읽기용으로 남긴다(`sr-only` — 제목 구조가 없어지지 않게). 패드 · 1280 이상은 받은 모양 그대로.
 * `PageHeader` 와, `PageHeader` 를 쓰지 않고 제목을 직접 그리는 화면(종목 지도 · 실시간 순위 · 증시 일정 · 기업 비교 · 계좌 설정 · 앱 기능 설정 · 업데이트 내역)이 함께 쓴다 — 조건은 여기 한 곳.
 */
export default function PageTitle({ className, children }: { className: string; children: ReactNode }) {
  const phone = useLayoutMode() === 'phone';
  return <h2 className={phone ? 'sr-only' : className}>{children}</h2>;
}

/** 폰 모양에서 제목을 숨기나 — 제목 줄의 다른 것(여백 · 오른쪽 단추)을 고를 때 */
export function usePageTitleHidden(): boolean {
  return useLayoutMode() === 'phone';
}
