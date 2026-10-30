import { Button, Panel } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { EDITION_LABEL } from '../../utils/marketBrief';
import type { MarketBriefStatus } from '../../types/marketBrief';

/** 불러오기 실패 줄 — 본문이 있으면 본문 위에 */
export function LoadError({ error, hasDay }: { error: string; hasDay: boolean }) {
  return (
    <Panel pad="sm" className={`text-xs text-danger ${hasDay ? 'mb-3' : ''}`}>
      <WarnIcon />
      불러오지 못했습니다: {error}
    </Panel>
  );
}

/** 빈 오늘 — 자동이 꺼짐 · 자동 시간대(아직) · 오늘 자동을 시도했는데 못 만듦 · 시간대 밖(13시 뒤 · 주말)을 나눠 말한다 */
function emptyText(status: MarketBriefStatus | null): string {
  if (!status) return '아직 오늘 시황이 없습니다.';
  if (status.autoDisabledReason) return '아직 오늘 시황이 없습니다 — 이 서버는 자동 만들기가 꺼져 있습니다.';
  if (status.autoWindowNow && !status.autoTriedToday) return '아직 오늘 시황이 없습니다 — 평일 아침 7시 무렵 자동으로 만들어집니다.';
  if (status.autoTriedToday && !status.autoDoneToday) return '오늘 자동 시황을 만들지 못했습니다(서버가 다시 켜지는 등).';
  return '아직 오늘 시황이 없습니다 — 오늘 자동 오전판은 없습니다(평일 아침에 13시 전까지만 만듭니다).';
}

/** 그날 만든 시황이 없음 — 오늘이고 버튼이 남았으면 「시황 분석」 */
export function EmptyDay({ isToday, status, onRun }: { isToday: boolean; status: MarketBriefStatus | null; onRun: () => void }) {
  const canRun = !!status && !status.running && status.buttonUsed < status.buttonLimit;
  return (
    <Panel className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
      <span>{isToday ? emptyText(status) : '이 날 만든 시황이 없습니다.'}</span>
      {isToday && canRun && status && (
        <>
          <Button size="sm" onClick={onRun}>
            시황 분석
          </Button>
          <span className="text-caption text-text-muted">지금 누르면 {EDITION_LABEL[status.nowEdition]}을 만듭니다</span>
        </>
      )}
    </Panel>
  );
}
