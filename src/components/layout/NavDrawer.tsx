import { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import type { NavGroup, NavGroupId, NavPageId } from '../../types/nav';
import { LOGOUT_ICON, NAV_ICON } from './navIcons';
import { MAIN_GROUPS, SETTINGS_GROUP } from './SideNav';
import { ICON_SM, ICON_XL } from '../ui/icon';
import IconButton from '../ui/IconButton';
import Sheet from '../ui/Sheet';

/**
 * 폰 메뉴 서랍(v2.73.0 · 테마 3-2) — 위쪽 막대 [메뉴] 로 왼쪽에서 나온다.
 *
 * - 메뉴 목록 · 나눔은 `SideNav` 와 **같은 데이터**(`types/nav.ts` → `MAIN_GROUPS` · `SETTINGS_GROUP`) · **같은 이동 함수**(`setPage` · `setGroup` · `onLogout`).
 * - 대메뉴 줄 44 · 소메뉴가 있으면 누르면 그 자리에서 펼침(이동하지 않음) · 지금 화면의 대메뉴는 처음부터 펼침.
 *   소메뉴가 없는 대메뉴(홈 · 증시 일정)는 누르면 그 화면으로(`setGroup` — 홈은 고른 홈 화면).
 * - 소메뉴(또는 바로 가는 대메뉴)를 고르면 서랍이 닫힌다. 지금 화면 줄 `aria-current="page"`.
 * - 아래: [설정](대메뉴와 같은 줄) · [로그아웃].
 */
export default function NavDrawer({
  open,
  onClose,
  page,
  group,
  onSelectPage,
  onSelectGroup,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  page: NavPageId;
  group: NavGroupId;
  onSelectPage: (page: NavPageId) => void;
  onSelectGroup: (group: NavGroupId) => void;
  onLogout: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="left"
      label="메뉴"
      testId="nav-drawer"
      // 폭 300 · 화면이 340 보다 좁으면 화면 − 40
      widthClass="w-[min(300px,calc(100vw-40px))]"
      header={
        <div className="flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-2">
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">AlphaScope</span>
          <IconButton icon={X} label="닫기" onClick={onClose} data-sheet-close />
        </div>
      }
      footer={
        <div data-list className="space-y-1 border-t border-border px-2 py-1">
          {SETTINGS_GROUP && <DrawerGroup key={`s-${group}`} item={SETTINGS_GROUP} page={page} group={group} onSelectPage={onSelectPage} onSelectGroup={onSelectGroup} onClose={onClose} />}
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-text-secondary"
          >
            <LOGOUT_ICON {...ICON_XL} />
            로그아웃
          </button>
        </div>
      }
    >
      {/* 열 때마다 지금 화면의 대메뉴부터 펼친다(key) */}
      <div data-list className="space-y-1 px-2 py-1">
        {MAIN_GROUPS.map((item) => (
          <DrawerGroup key={`${item.id}-${group}`} item={item} page={page} group={group} onSelectPage={onSelectPage} onSelectGroup={onSelectGroup} onClose={onClose} />
        ))}
      </div>
    </Sheet>
  );
}

function DrawerGroup({
  item,
  page,
  group,
  onSelectPage,
  onSelectGroup,
  onClose,
}: {
  item: NavGroup;
  page: NavPageId;
  group: NavGroupId;
  onSelectPage: (page: NavPageId) => void;
  onSelectGroup: (group: NavGroupId) => void;
  onClose: () => void;
}) {
  /** 소메뉴 줄 없이 대메뉴가 곧 그 화면(`SideNav` 와 같은 판단) */
  const single = item.pages.length <= 1 && !item.showSinglePage;
  const [open, setOpen] = useState(group === item.id);
  const Icon = NAV_ICON[item.icon];
  const current = group === item.id;
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => {
          if (!single) return setOpen((v) => !v);
          onSelectGroup(item.id);
          onClose();
        }}
        aria-expanded={single ? undefined : open}
        aria-current={single && current ? 'page' : undefined}
        className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm ${
          single && current ? 'bg-bg-elevated font-semibold text-text-primary' : 'text-text-primary'
        }`}
      >
        <Icon {...ICON_XL} />
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span className="min-w-0 truncate">{item.label}</span>
          {item.badge && <span className="shrink-0 rounded bg-warning/15 px-0.5 py-px text-caption text-warning">{item.badge}</span>}
        </span>
        {!single && <span className="text-text-secondary">{open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}</span>}
      </button>
      {open &&
        !single &&
        item.pages.map((sub) => (
          <button
            key={sub.id}
            type="button"
            aria-current={page === sub.id ? 'page' : undefined}
            onClick={() => {
              onSelectPage(sub.id);
              onClose();
            }}
            className={`flex h-11 w-full items-center rounded-lg pl-12 pr-3 text-left text-xs ${
              page === sub.id ? 'bg-bg-elevated font-semibold text-text-primary' : 'text-text-secondary'
            }`}
          >
            {sub.label}
          </button>
        ))}
    </div>
  );
}
