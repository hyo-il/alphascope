export type ViewId =
  | 'chart'
  | 'analysis'
  | 'company'
  | 'portfolio'
  | 'paper'
  | 'settings';

interface NavItem {
  id: ViewId;
  icon: string;
  label: string;
}

const ITEMS: NavItem[] = [
  { id: 'chart', icon: '🏠', label: '홈' },
  { id: 'analysis', icon: '🧠', label: 'AI 분석' },
  { id: 'company', icon: '🏢', label: '기업정보' },
  { id: 'portfolio', icon: '💼', label: '포트폴리오' },
  { id: 'paper', icon: '💰', label: '모의투자' },
];

const SETTINGS: NavItem = { id: 'settings', icon: '⚙️', label: '설정' };

interface Props {
  view: ViewId;
  onChange: (view: ViewId) => void;
}

/** 왼쪽 아이콘 내비게이션 — 클릭하면 메인 영역 전체가 바뀐다. */
export default function SideNav({ view, onChange }: Props) {
  const button = (item: NavItem) => {
    const active = view === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onChange(item.id)}
        title={item.label}
        className={`flex w-full flex-col items-center gap-0.5 border-l-2 py-2.5 transition-colors ${
          active
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-transparent text-text-muted hover:bg-bg-tertiary/60 hover:text-text-secondary'
        }`}
      >
        <span className="text-lg leading-none">{item.icon}</span>
        <span className="text-[10px] leading-tight">{item.label}</span>
      </button>
    );
  };

  return (
    <nav className="flex w-[60px] shrink-0 flex-col border-r border-border bg-bg-secondary">
      <div className="flex h-12 items-center justify-center border-b border-border text-sm font-bold text-accent">
        AS
      </div>

      <div className="flex flex-1 flex-col">{ITEMS.map(button)}</div>

      <div className="border-t border-border">{button(SETTINGS)}</div>
    </nav>
  );
}
