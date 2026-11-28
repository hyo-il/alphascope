import type { ReactNode } from 'react';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import InfoTip from './InfoTip';

/**
 * 긴 설명 · 화면 위아래 안내 문단을 폰 · 패드에서 「한 줄 + [?]」 로(v2.84.0 · 테마 9-1 R5) — **판단 한 곳**.
 * - 1280 이상은 `children`(지금 문단 그대로 — DOM 도 같음).
 * - 폰 · 패드는 `lead`(첫 문장) 한 줄 + [?](`ui/InfoTip`) — [?] 안은 `more`(나머지 문장 그대로 · 글을 지우지 않고 옮김).
 *   손가락 화면은 줄 높이 44(`touch:min-h-11`) — [?] 의 누르는 칸 44 가 위아래 단추와 겹치지 않게.
 * - ⚠️ 「지우지 않는다」 고정 문구(백테스트 5개 등)는 여기에 넣지 않는다 — 늘 화면 글자로(`InfoTip` 머리글과 같은 규칙).
 */
export default function ShortNote({
  lead,
  more,
  label = '설명 더 보기',
  className = '',
  children,
}: {
  lead: ReactNode;
  more: ReactNode;
  label?: string;
  /** 폰 · 패드 줄의 글 크기 · 색(1280 문단과 같은 것을 준다) */
  className?: string;
  /** 1280 이상 — 지금 문단 그대로 */
  children: ReactNode;
}) {
  if (useLayoutMode() === 'desk') return <>{children}</>;
  return (
    <p className={`flex items-center gap-1.5 touch:min-h-11 ${className}`.trim()} data-short-note>
      <span className="min-w-0">{lead}</span>
      <InfoTip label={label}>{more}</InfoTip>
    </p>
  );
}
