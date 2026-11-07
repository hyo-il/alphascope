import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import Dialog, { type DialogSize } from './Dialog';
import { ICON_SM } from './icon';

/**
 * 왼쪽 메뉴 + 오른쪽 내용 창(v2.65.2) — 설정이 여러 묶음인 창. 틀은 공용 `Dialog` 그대로(제목 줄 · 닫기 · ESC · 초점 가두기).
 *
 * - 메뉴(`role="tablist"` · 세로): 고른 항목은 배경 강조 · 키보드 위/아래(좁은 화면 가로 줄에서는 왼쪽/오른쪽도) · Home/End.
 *   고른 항목만 Tab 으로 들어간다(나머지는 화살표로 — 탭 목록의 보통 동작).
 * - 오른쪽 위에 그 메뉴 이름 + 설명 한 줄, 아래 내용. **내용이 길면 오른쪽만 스크롤**된다.
 * - 창 높이는 고정 크기(`lg` · `xl` · `full`)라 메뉴를 바꿔도 흔들리지 않는다.
 * - 메뉴마다 `busy` 면 이름 옆 작은 회전 아이콘(저장 중).
 * - **모든 메뉴의 내용은 늘 그려 두고 고른 것만 보인다**(`hidden`) — 다른 메뉴를 보는 동안에도 저장 · 입력 중인 값이 사라지지 않는다.
 * - 좁은 화면(< 768px · `md` 밑)에서는 메뉴가 위쪽 가로 줄로 바뀐다(넘치면 가로 스크롤).
 * - 고른 메뉴는 쓰는 쪽이 들고 있다(`value` · `onChange` — 기억도 쓰는 쪽이). 화면마다 다른 글자를 넣지 않는다.
 */
export interface SideNavItem {
  id: string;
  label: string;
  /** 오른쪽 위 메뉴 이름 아래 설명 한 줄 */
  desc?: string;
  /** 저장 중 — 메뉴 이름 옆 회전 아이콘 */
  busy?: boolean;
  content: ReactNode;
}

export default function SideNavDialog({
  title,
  items,
  value,
  onChange,
  onClose,
  size = 'xl',
  z,
  navLabel,
}: {
  title: ReactNode;
  items: SideNavItem[];
  /** 고른 메뉴 id */
  value: string;
  onChange: (id: string) => void;
  onClose: () => void;
  size?: Extract<DialogSize, 'lg' | 'xl' | 'full'>;
  z?: number;
  /** 메뉴 목록 이름(화면 읽기 프로그램) */
  navLabel: string;
}) {
  const base = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = items.find((it) => it.id === value) ?? items[0];
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;

  const move = (to: number) => {
    const n = items.length;
    const i = ((to % n) + n) % n;
    onChange(items[i].id);
    tabRefs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowRight') move(i + 1);
    else if (key === 'ArrowUp' || key === 'ArrowLeft') move(i - 1);
    else if (key === 'Home') move(0);
    else if (key === 'End') move(items.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <Dialog title={title} onClose={onClose} size={size} z={z} bodyClassName="p-0">
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        <div
          role="tablist"
          aria-label={navLabel}
          aria-orientation="vertical"
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 p-2 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0"
          data-side-nav
        >
          {items.map((it, i) => {
            const on = it.id === current.id;
            return (
              <button
                key={it.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={tabId(it.id)}
                aria-selected={on}
                aria-controls={panelId(it.id)}
                tabIndex={on ? 0 : -1}
                onClick={() => onChange(it.id)}
                onKeyDown={(e) => onKey(e, i)}
                data-side-nav-item={it.id}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-xs transition-colors ${on ? 'bg-bg-tertiary font-semibold text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'}`}
              >
                <span className="min-w-0 flex-1">{it.label}</span>
                <span className="inline-flex w-4 shrink-0 justify-center">
                  {it.busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-side-nav-content>
          {items.map((it) => (
            <section key={it.id} role="tabpanel" id={panelId(it.id)} aria-labelledby={tabId(it.id)} hidden={it.id !== current.id} className="space-y-4 p-4">
              <header className="space-y-1">
                <h3 className="text-sm font-semibold text-text-primary">{it.label}</h3>
                {it.desc && <p className="text-caption text-text-muted keep-all">{it.desc}</p>}
              </header>
              {it.content}
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
