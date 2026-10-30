import type { BriefAi } from '../../types/marketBrief';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean } from './briefText';

/** ③ 현재 주도 섹터 (AI 가 있을 때만) */
export default function SectorsCard({ ai }: { ai: BriefAi }) {
  return (
    <BriefCard
      id="sectors"
      title="현재 주도 섹터"
      info="기준 A = 3개월 넘게 이어질 상승 근거, 기준 B = 방향과 상관없이 시장 관심이 몰린 섹터입니다. 별 = AI 가 본 관심의 크기(오를 가능성이나 매수 추천의 세기가 아닙니다). 숏 관점 = 값이 내릴 것으로 보는 쪽(이 앱은 공매도를 하지 않습니다) · 관망 = 사지 않고 지켜봄."
    >
      <ul className="space-y-3">
        {ai.leading_sectors.map((s, i) => (
          <li key={i} className="space-y-1 text-xs">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-text-primary">{s.name}</span>
              <span className="text-caption text-text-secondary" aria-label={`별 ${(s.stars.match(/★/g) ?? []).length}개`}>
                {s.stars}
              </span>
            </div>
            {s.reason && <p className="break-keep text-text-secondary">{clean(s.reason)}</p>}
            {s.stocks_kr && <LabeledLine label="국내">{clean(s.stocks_kr)}</LabeledLine>}
            {s.stocks_us && <LabeledLine label="미국">{clean(s.stocks_us)}</LabeledLine>}
          </li>
        ))}
      </ul>
    </BriefCard>
  );
}
