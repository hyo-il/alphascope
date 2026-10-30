import type { BriefAi } from '../../types/marketBrief';
import { BriefCard, BulletList, LabeledLine } from './BriefCard';
import { clean } from './briefText';

/** ⑥ 스윙 체크포인트 (AI 가 있을 때만) */
export default function SwingCard({ ai }: { ai: BriefAi }) {
  return (
    <BriefCard id="swing" title="스윙 체크포인트" info="스윙 = 며칠~몇 달 들고 가는 매매. 촉매 = 값을 크게 움직일 수 있는 일정(금리 결정 · 물가 지표 등). FOMC 날짜는 연준 공식 일정으로 AI 에게 줍니다.">
      <div className="space-y-2 text-xs">
        {ai.swing_check.phase && <LabeledLine label="국면">{clean(ai.swing_check.phase)}</LabeledLine>}
        <BulletList label="주목 촉매" items={ai.swing_check.catalysts} empty="1~2주 안 경제지표 · 정책 일정 없음" />
        <BulletList label="주요 리스크" items={ai.swing_check.risks} empty="없음" />
      </div>
    </BriefCard>
  );
}
