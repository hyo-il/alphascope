export type TabId = 'manual' | 'ai' | 'company' | 'history' | 'holdings';

interface Tab {
  id: TabId;
  label: string;
  /** 아직 구현되지 않은 탭 (해당 Step 에서 열린다) */
  pendingStep?: number;
}

export const TABS: Tab[] = [
  { id: 'manual', label: '수동분석' },
  { id: 'ai', label: 'AI분석', pendingStep: 7 },
  { id: 'company', label: '기업정보', pendingStep: 6 },
  { id: 'history', label: '히스토리', pendingStep: 7 },
  { id: 'holdings', label: '보유주식', pendingStep: 6 },
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
            title={tab.pendingStep ? `Step ${tab.pendingStep}에서 구현 예정` : undefined}
            className={`border-b-2 px-4 py-2 text-sm transition-colors ${
              active === tab.id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {tab.label}
            {tab.pendingStep && <span className="ml-1 text-[10px] text-text-muted">준비중</span>}
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
