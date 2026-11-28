import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import Dialog, { type DialogSize } from './Dialog';
import { ICON_SM } from './icon';
import ScrollRow from './ScrollRow';
import { TOUCH_LIST_ROW } from './tokens';
import { useLayoutMode, usePhoneLandscape } from '../../hooks/useLayoutMode';

/**
 * 왼쪽 메뉴 + 오른쪽 내용 창(v2.65.2) — 설정이 여러 묶음인 창. 틀은 공용 `Dialog` 그대로(제목 줄 · 닫기 · ESC · 초점 가두기).
 *
 * - 메뉴(`role="tablist"` · 세로): 고른 항목은 배경 강조 · 키보드 위/아래(좁은 화면 가로 줄에서는 왼쪽/오른쪽도) · Home/End.
 *   고른 항목만 Tab 으로 들어간다(나머지는 화살표로 — 탭 목록의 보통 동작).
 * - 오른쪽 위에 그 메뉴 이름 + 설명 한 줄, 아래 내용. **내용이 길면 오른쪽만 스크롤**된다.
 * - 창 높이는 고정 크기(`lg` · `xl` · `full`)라 메뉴를 바꿔도 흔들리지 않는다.
 * - 메뉴마다 `busy` 면 이름 옆 작은 회전 아이콘(저장 중).
 * - **모든 메뉴의 내용은 늘 그려 두고 고른 것만 보인다**(`hidden`) — 다른 메뉴를 보는 동안에도 저장 · 입력 중인 값이 사라지지 않는다.
 * - 좁은 화면(< 768px · `md` 밑)에서는 메뉴가 위쪽 가로 줄로 바뀐다(넘치면 가로 스크롤) — 폰(세로)은 그 줄을 `ScrollRow` 로 그려
 *   더 밀 수 있는 쪽 끝을 흐리게 한다(v2.83.0 · 테마 9-1 R7 — 잘린 메뉴 글이 끝에 걸려 보이지 않게). 손가락 화면 메뉴 칸 높이 44.
 * - 고른 메뉴는 쓰는 쪽이 들고 있다(`value` · `onChange` — 기억도 쓰는 쪽이). 화면마다 다른 글자를 넣지 않는다.
 */
export interface SideNavItem {
  id: string;
  label: string;
  /** 오른쪽 위 메뉴 이름 아래 설명 한 줄 */
  desc?: string;
  /** 저장 중 — 메뉴 이름 옆 회전 아이콘 · 창 전체를 막는다(공통 7-2 — 저장하는 동안 닫히지 않음) */
  busy?: boolean;
  /** 이 메뉴에 저장하지 않은 바꾼 것이 있음 — 하나라도 있으면 창을 닫을 때 묻는다(공통 3-3) */
  dirty?: boolean;
  content: ReactNode;
  /** 이 메뉴를 고른 동안 창 아래 단추 줄(`Dialog footer` — 폰은 판 아래에 붙음 · 테마 3-5). 없으면 단추 줄 없음 */
  footer?: ReactNode;
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
  /** 폰 세로 — 위쪽 가로 메뉴 줄을 끝 흐림 상자(`ScrollRow`)로. 폰 가로 · 패드 · 1280 이상은 지금 그대로 */
  const fadeRow = useLayoutMode() === 'phone' && !usePhoneLandscape();

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

  const tabs = (
        <div
          role="tablist"
          aria-label={navLabel}
          aria-orientation="vertical"
          className={fadeRow ? 'flex shrink-0 gap-1 p-2' : 'flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 p-2 md:w-44 md:flex-col md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0'}
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
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-xs transition-colors ${TOUCH_LIST_ROW} ${on ? 'bg-bg-tertiary font-semibold text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary'}`}
              >
                <span className="min-w-0 flex-1">{it.label}</span>
                <span className="inline-flex w-4 shrink-0 justify-center">
                  {it.busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}
                </span>
              </button>
            );
          })}
        </div>
  );

  return (
    <Dialog title={title} onClose={onClose} size={size} z={z} bodyClassName="p-0" busy={items.some((it) => it.busy)} dirty={items.some((it) => it.dirty)} footer={current.footer}>
      <div className="flex h-full min-h-0 flex-col md:flex-row">
        {fadeRow ? (
          <ScrollRow className="shrink-0 border-b border-border/40" innerClassName="flex">
            {tabs}
          </ScrollRow>
        ) : (
          tabs
        )}
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
