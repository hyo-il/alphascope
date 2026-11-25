import { Menu, Search, Star } from 'lucide-react';
import IconButton from '../ui/IconButton';

/**
 * 폰 위쪽 막대(v2.73.0 · 테마 3-1) — 폰 모양에서 왼쪽 메뉴 · 종목 머리줄 대신.
 * 높이 52 + 위 안전 여백 · 바탕 bg-secondary · 화면 위에 붙음.
 * [메뉴](서랍) · 화면 이름(차트면 + 종목 코드) · [종목 찾기] · [관심 목록](옆 판).
 */
export default function MobileTopBar({
  title,
  code,
  onMenu,
  onSearch,
  onWatch,
}: {
  title: string;
  /** 차트 화면의 종목 코드 */
  code?: string | null;
  onMenu: () => void;
  onSearch: () => void;
  onWatch: () => void;
}) {
  return (
    <header data-testid="top-bar" className="sticky top-0 z-20 shrink-0 bg-bg-secondary pt-[env(safe-area-inset-top)]">
      <div className="flex h-[52px] items-center gap-1 px-1">
        <IconButton icon={Menu} label="메뉴" onClick={onMenu} />
        <h1 className="flex min-w-0 flex-1 items-baseline gap-1.5 px-1">
          <span className="min-w-0 truncate text-sm font-semibold text-text-primary" data-tip-clip={title}>
            {title}
          </span>
          {code && <span className="shrink-0 text-caption text-text-secondary">{code}</span>}
        </h1>
        <IconButton icon={Search} label="종목 찾기" onClick={onSearch} />
        <IconButton icon={Star} label="관심 목록" onClick={onWatch} />
      </div>
    </header>
  );
}
