import { Badge, Panel } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { formatDateTime } from '../../utils/dateFormat';
import { EDITION_LABEL, isIntradayBar } from '../../utils/marketBrief';
import type { BriefAssetKey, MarketBrief, OutlookView } from '../../types/marketBrief';
import { dayLabel } from './briefText';
import RegimeCard from './RegimeCard';
import OutlookCard from './OutlookCard';
import ScheduleCard from './ScheduleCard';
import SectorsCard from './SectorsCard';
import ThemesCard from './ThemesCard';
import MarketDataCard from './MarketDataCard';
import SwingCard from './SwingCard';
import ActionCard from './ActionCard';
import Disclaimer from './Disclaimer';
import CollectStatus from './CollectStatus';

/** 화면에 보일 AI 없음 이유 — 서버 설정 이름(괄호 안 `GEMINI_ENABLED=false` 등)은 수집 상태 칸에만 */
const plainReason = (reason: string | null) =>
  (reason ?? '이유 모름').replace(/\s*\([A-Z_]+=[^)]*\)/g, '').replace(/^AI 꺼짐 — /, '');

/**
 * 브리핑 한 개 — 만든 시각 · 데이터 기준 줄 + 칸 ① ~ ⑧(Stockproject 메시지 순서 그대로) + 수집 상태.
 * 칸은 각자 부품(`*Card.tsx`)이고 여기서는 순서와 「AI 가 있을 때만」 만 정한다 — 새 칸은 이 목록에 한 줄로 붙인다.
 */
export default function BriefBody({ brief, outlook, onOpen }: { brief: MarketBrief; outlook?: OutlookView; onOpen: (symbol: string) => void }) {
  const ai = brief.brief;
  const basisKey: BriefAssetKey = brief.edition === 'morning' ? 'SP500' : 'KOSPI';
  const basis = brief.data.assets[basisKey]?.data_date;
  const collectedAt = Date.parse(brief.data.collectedAt ?? brief.createdAt);
  return (
    <div className="space-y-3">
      {/* 만든 시각 · 데이터 기준 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-text-muted" data-brief-meta>
        <Badge>{EDITION_LABEL[brief.edition]}</Badge>
        <span>{brief.trigger === 'auto' ? '자동으로 만듦' : '직접 만듦(시황 분석)'}</span>
        <span className="tabular-nums">만든 시각 {formatDateTime(brief.createdAt)}</span>
        <span className="tabular-nums">
          데이터 기준 {basis ? `${brief.edition === 'morning' ? '미국' : '국내'} ${dayLabel(basis)} ${isIntradayBar(basisKey, basis, collectedAt) ? '장중' : '종가'}` : '모름'}
        </span>
        {ai && <span>AI 참고 글 · 투자 조언 아님</span>}
      </div>

      {!ai && (
        <Panel pad="sm" className="text-xs text-warning" data-brief-ai-error>
          <WarnIcon />
          AI 분석이 없습니다: {plainReason(brief.aiError)}. 시장 데이터와 실적 일정만 보입니다.
        </Panel>
      )}

      <RegimeCard brief={brief} />
      <OutlookCard brief={brief} view={outlook} />
      <ScheduleCard brief={brief} onOpen={onOpen} />
      {ai && <SectorsCard ai={ai} onOpen={onOpen} />}
      {ai && <ThemesCard ai={ai} />}
      <MarketDataCard brief={brief} />
      {ai && <SwingCard ai={ai} />}
      {ai && <ActionCard ai={ai} onOpen={onOpen} />}
      <Disclaimer />

      <CollectStatus brief={brief} />
    </div>
  );
}
