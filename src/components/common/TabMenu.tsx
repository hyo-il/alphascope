export type TabId = 'analysis' | 'company' | 'history' | 'holdings';

interface Tab {
  id: TabId;
  label: string;
}

export const TABS: Tab[] = [
  { id: 'analysis', label: 'AI 분석' },
  { id: 'company', label: '기업정보' },
  { id: 'history', label: '히스토리' },
  { id: 'holdings', label: '보유주식' },
];

interface Props {
  active: TabId;
  onChange: (tab: TabId) => void;
  /** 패널 접기/펼치기 */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function TabMenu({ active, onChange, collapsed, onToggleCollapse }: Props) {
  return (
    <div className="flex items-center justify-between border-y border-border bg-bg-secondary px-3">
      <div className="flex">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`border-b-2 px-4 py-2 text-sm transition-colors ${
              active === tab.id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleCollapse}
        className="px-2 py-1 text-xs text-text-muted transition-colors hover:text-text-primary"
      >
        {collapsed ? '▲ 펼치기' : '▼ 접기'}
      </button>
    </div>
  );
}
