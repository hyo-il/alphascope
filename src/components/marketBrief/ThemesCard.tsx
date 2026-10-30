import { Badge } from '../ui';
import type { BriefAi } from '../../types/marketBrief';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean } from './briefText';
import MismatchTag from './MismatchTag';

const THEME_KIND: Record<string, { tone: 'bullish' | 'bearish' | 'neutral'; label: string }> = {
  '🟢': { tone: 'bullish', label: '상승 모멘텀' },
  '🔴': { tone: 'bearish', label: '하락 리스크' },
  '🟡': { tone: 'neutral', label: '중립 · 혼조' },
};

function ThemeBadge({ icon }: { icon: string }) {
  const kind = THEME_KIND[icon.trim()] ?? THEME_KIND['🟡'];
  return <Badge tone={kind.tone}>{kind.label}</Badge>;
}

/** ④ 핵심 테마 (AI 가 있을 때만) — AI 의 색 이모지는 배지로 바꾼다 */
export default function ThemesCard({ ai }: { ai: BriefAi }) {
  return (
    <BriefCard id="themes" title="핵심 테마" aside="1~3개월">
      <ul className="space-y-3">
        {ai.key_themes.map((t, i) => (
          <li key={i} className="space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <ThemeBadge icon={t.icon} />
              {t.category && <Badge>{clean(t.category)}</Badge>}
              <span className="font-semibold text-text-primary">{clean(t.title)}</span>
            </div>
            {t.duration && <LabeledLine label="지속">{clean(t.duration)}</LabeledLine>}
            {t.why_important && (
              <LabeledLine label="왜 중요">
                {clean(t.why_important)}
                <MismatchTag ai={ai} field={`key_themes.${i}.why_important`} />
              </LabeledLine>
            )}
            {t.swing_point && <LabeledLine label="스윙 관점">{clean(t.swing_point)}</LabeledLine>}
          </li>
        ))}
      </ul>
    </BriefCard>
  );
}
