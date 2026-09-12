import { useState } from 'react';
import { NAV_GROUPS, type NavGroupId, type NavPageId } from '../../types/nav';

/**
 * 왼쪽 내비게이션 — **대메뉴 → 소메뉴 2단**이다.
 *
 * 평면 메뉴는 항목이 여덟 개를 넘기면서 아이콘만 보고 위치를 외워야 했다. 묶고 나니
 * 한 번에 보이는 것은 네 개고, 새 화면을 넣을 자리도 분명해진다.
 * 메뉴 목록 자체는 `types/nav.ts` 한 곳에 있다.
 *
 * 접으면 대메뉴 아이콘만 남고, 아이콘에 올리면 소메뉴가 옆으로 펼쳐진다(플라이아웃) —
 * 접힌 상태에서도 두 번 클릭으로 어디든 갈 수 있어야 한다.
 */
interface Props {
  page: NavPageId;
  group: NavGroupId;
  onSelectPage: (page: NavPageId) => void;
  onSelectGroup: (group: NavGroupId) => void;
}

export default function SideNav({ page, group, onSelectPage, onSelectGroup }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  /** 접힌 상태에서 아이콘에 올린 대메뉴 — 소메뉴를 옆에 띄운다 */
  const [hovered, setHovered] = useState<NavGroupId | null>(null);

  if (collapsed) {
    return (
      <nav className="flex w-[52px] shrink-0 flex-col border-r border-border bg-bg-secondary">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="메뉴 펼치기"
          className="flex h-12 items-center justify-center border-b border-border text-sm font-bold text-accent"
        >
          AS
        </button>

        <div className="flex flex-1 flex-col">
          {NAV_GROUPS.map((item) => (
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
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="flex w-[156px] shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-sm font-bold text-accent">AlphaScope</span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="메뉴 접기"
          className="text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          ‹
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {NAV_GROUPS.map((item) => {
          /*
           * 보고 있는 화면이 속한 대메뉴는 **항상 펼쳐 둔다.** 접을 수 있게 하면
           * 지금 어디에 있는지가 화면에서 사라진다.
           */
          const expanded = group === item.id;

          return (
            <div key={item.id}>
              <button
                type="button"
                onClick={() => onSelectGroup(item.id)}
                className={`flex w-full items-center gap-2 border-l-2 px-2.5 py-2 text-left text-xs transition-colors ${
                  expanded
                    ? 'border-accent bg-accent/10 font-medium text-accent'
                    : 'border-transparent text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'
                }`}
              >
                <span className="text-base leading-none">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <span className="text-[10px] text-text-muted">{expanded ? '▾' : '▸'}</span>
              </button>

              {expanded &&
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
        })}
      </div>
    </nav>
  );
}
