import { useState } from 'react';
import { NAV_GROUPS, type NavGroup, type NavGroupId, type NavPageId } from '../../types/nav';
import LogoMark from './LogoMark';

/**
 * 왼쪽 내비게이션 — **대메뉴 → 소메뉴 2단**이다.
 *
 * 평면 메뉴는 항목이 아홉 개까지 늘면서 아이콘만 보고 위치를 외워야 했다. 묶고 나니
 * 한 번에 보이는 것은 네 개고, 새 화면을 넣을 자리도 분명해진다.
 * 메뉴 목록 자체는 `types/nav.ts` 한 곳에 있다.
 *
 * 접으면 대메뉴 아이콘만 남고, 아이콘에 올리면 소메뉴가 옆으로 펼쳐진다(플라이아웃) —
 * 접힌 상태에서도 두 번 클릭으로 어디든 갈 수 있어야 한다.
 *
 * **로고는 홈 버튼이다** — 다른 웹사이트의 관례대로, 누르면 차트 화면 + 종목 미선택
 * (= 종목 탐색 홈)으로 돌아간다. 접힌 상태의 도형도 같은 역할을 한다.
 *
 * ⚠️ **설정은 맨 아래에 고정한다.** 차트·분석·계좌는 "지금 무엇을 보는가" 이고 설정은
 * "가끔 손대는 것" 이라 성격이 다르다. 위 목록에 섞어 두면 메뉴가 길어질수록 설정이
 * 스크롤 아래로 밀려 사라진다. `mt-auto` + 구분선으로 떼어 둔다.
 */
interface Props {
  page: NavPageId;
  group: NavGroupId;
  onSelectPage: (page: NavPageId) => void;
  onSelectGroup: (group: NavGroupId) => void;
  /** 로고 클릭 — 홈(차트 + 종목 미선택)으로 */
  onGoHome: () => void;
  /** 로그아웃 — 이 브라우저의 세션만 끊는다 (모든 기기는 설정 화면에서) */
  onLogout: () => void;
}

const MAIN_GROUPS = NAV_GROUPS.filter((g) => g.id !== 'settings');
const SETTINGS_GROUP = NAV_GROUPS.find((g) => g.id === 'settings');

export default function SideNav({
  page,
  group,
  onSelectPage,
  onSelectGroup,
  onGoHome,
  onLogout,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  /** 접힌 상태에서 아이콘에 올린 대메뉴 — 소메뉴를 옆에 띄운다 */
  const [hovered, setHovered] = useState<NavGroupId | null>(null);

  /** 접힌 상태의 대메뉴 한 칸 (아이콘 + 호버 플라이아웃) */
  const collapsedGroup = (item: NavGroup) => (
    <div
      key={item.id}
      className="relative"
      onMouseEnter={() => setHovered(item.id)}
      onMouseLeave={() => setHovered(null)}
    >
      <button
        type="button"
        onClick={() => onSelectGroup(item.id)}
        title={item.label}
        className={`flex w-full flex-col items-center gap-0.5 border-l-2 py-2.5 transition-colors ${
          group === item.id
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-transparent text-text-muted hover:bg-bg-tertiary/60 hover:text-text-secondary'
        }`}
      >
        <span className="text-lg leading-none">{item.icon}</span>
        <span className="text-[10px] leading-tight">{item.label}</span>
      </button>

      {hovered === item.id && (
        <div className="absolute left-full top-0 z-50 ml-px w-40 rounded-r-md border border-border bg-bg-secondary py-1 shadow-xl">
          {item.pages.map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => onSelectPage(sub.id)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                page === sub.id
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /** 펼친 상태의 대메뉴 한 칸 (아코디언) */
  const expandedGroup = (item: NavGroup) => {
    /*
     * 보고 있는 화면이 속한 대메뉴는 **항상 펼쳐 둔다.** 접을 수 있게 하면
     * 지금 어디에 있는지가 화면에서 사라진다.
     */
    const open = group === item.id;

    return (
      <div key={item.id}>
        <button
          type="button"
          onClick={() => onSelectGroup(item.id)}
          className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left text-xs transition-colors ${
            open
              ? 'border-accent bg-accent/10 font-medium text-accent'
              : 'border-transparent text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'
          }`}
        >
          <span className="text-base leading-none">{item.icon}</span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="text-[10px] text-text-muted">{open ? '▾' : '▸'}</span>
        </button>

        {open &&
          item.pages.map((sub) => (
            <button
              key={sub.id}
              type="button"
              onClick={() => onSelectPage(sub.id)}
              className={`block w-full py-1.5 pl-10 pr-2 text-left text-xs transition-colors ${
                page === sub.id
                  ? 'bg-accent/5 text-accent'
                  : 'text-text-muted hover:bg-bg-tertiary/60 hover:text-text-primary'
              }`}
            >
              {sub.label}
            </button>
          ))}
      </div>
    );
  };

  if (collapsed) {
    return (
      <nav className="flex w-[52px] shrink-0 flex-col border-r border-border bg-bg-secondary">
        {/*
          접힌 상태에서도 **도형 자체가 홈 버튼**이다. 메뉴를 펼치는 `›` 는 옆에 따로 둔다 —
          로고에 펼치기를 겹쳐 두면 홈으로 갈 방법이 없어진다.
        */}
        <div className="flex h-12 shrink-0 items-center border-b border-border pl-1.5 pr-0.5">
          <button
            type="button"
            onClick={onGoHome}
            title="홈으로"
            aria-label="홈으로"
            className="flex flex-1 items-center justify-center text-accent transition-opacity hover:opacity-80"
          >
            <LogoMark size={22} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            title="메뉴 펼치기"
            aria-label="메뉴 펼치기"
            className="px-0.5 text-xs text-text-muted transition-colors hover:text-text-primary"
          >
            ›
          </button>
        </div>

        {/*
          ⚠️ 여기에 `overflow-y-auto` 를 두면 안 된다. 한 축이 visible 이 아니면 다른 축도
          잘리므로(CSS 규격), `left-full` 로 띄우는 플라이아웃이 z-index 와 무관하게 잘린다.
          대메뉴는 넷뿐이라 스크롤이 필요 없다 — 메뉴가 더 늘어 스크롤이 필요해지면
          플라이아웃을 `position: fixed` 로 바꿔야 한다.
        */}
        <div className="flex-1">{MAIN_GROUPS.map(collapsedGroup)}</div>

        {/* 설정은 스크롤과 무관하게 늘 맨 아래에 보인다 */}
        {SETTINGS_GROUP && (
          <div className="mt-auto border-t border-border">
            {collapsedGroup(SETTINGS_GROUP)}
            <button
              type="button"
              onClick={onLogout}
              title="로그아웃"
              aria-label="로그아웃"
              className="flex h-10 w-full items-center justify-center text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
            >
              ⎋
            </button>
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav className="flex w-[156px] shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <button
          type="button"
          onClick={onGoHome}
          title="홈으로"
          aria-label="홈으로"
          className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-accent transition-opacity hover:opacity-80"
        >
          <LogoMark size={18} />
          <span className="truncate">AlphaScope</span>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="메뉴 접기"
          className="text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          ‹
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">{MAIN_GROUPS.map(expandedGroup)}</div>

      {SETTINGS_GROUP && (
        <div className="mt-auto border-t border-border py-1">
          {expandedGroup(SETTINGS_GROUP)}
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
          >
            <span className="text-base leading-none">⎋</span>
            <span>로그아웃</span>
          </button>
        </div>
      )}
    </nav>
  );
}
