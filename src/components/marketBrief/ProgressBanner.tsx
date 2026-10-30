import { Panel } from '../ui';
import { InlineSpinner } from '../common/LoadingOverlay';
import { EDITION_LABEL } from '../../utils/marketBrief';
import type { BriefStage, MarketBriefStatus } from '../../types/marketBrief';

const STAGES: { id: BriefStage; label: string }[] = [
  { id: 'collect', label: '시장 데이터 받는 중' },
  { id: 'ai', label: 'AI 분석 중' },
  { id: 'save', label: '저장 중' },
];

/** 진행 단계 — 서버 진행 상태(자동 · 버튼)를 그대로 보인다 */
export default function ProgressBanner({ stage, edition, trigger }: { stage: BriefStage | null; edition: MarketBriefStatus['edition']; trigger: MarketBriefStatus['trigger'] }) {
  const at = STAGES.findIndex((s) => s.id === stage);
  return (
    <Panel pad="sm" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" role="status" aria-live="polite">
      <InlineSpinner />
      <span className="font-medium text-text-primary">
        {edition ? EDITION_LABEL[edition] : '시황'} 만드는 중{trigger === 'auto' ? '(자동)' : ''}
      </span>
      <ol className="flex flex-wrap items-center gap-x-2 text-caption">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i === at ? 'font-medium text-text-primary' : i < at ? 'text-text-secondary' : 'text-text-muted'}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
      <span className="text-caption text-text-muted">1~3분 걸립니다 · 다른 화면에 다녀와도 계속됩니다</span>
    </Panel>
  );
}
