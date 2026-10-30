import { TriangleAlert } from 'lucide-react';
import { ICON_SM, InfoTip } from '../ui';
import type { BriefAi } from '../../types/marketBrief';

/** 용어 — 오늘 시황 AI 문장의 방향이 같은 브리핑의 시장 숫자와 반대(서버 검사 `directionCheck.ts`) */
const MISMATCH_LABEL = '숫자와 다름';

/**
 * 「숫자와 다름」 — 그 글(field)에 서버가 찾은 어긋남이 있으면 문장 끝에 작은 표시 + 툴팁(글: 방어 · 숫자: 코스피 −5.53%).
 * 문장은 AI 글 그대로 둔다(서버가 고치지 않는다). 키보드로도 열린다(`InfoTip` trigger).
 */
export default function MismatchTag({ ai, field }: { ai: BriefAi; field: string }) {
  const items = (ai.mismatches ?? []).filter((m) => m.field === field);
  if (!items.length) return null;
  return (
    <span className="ml-1 inline-flex align-baseline" data-brief-mismatch={field}>
      <InfoTip
        label={MISMATCH_LABEL}
        trigger={
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-caption text-warning">
            <TriangleAlert {...ICON_SM} />
            {MISMATCH_LABEL}
          </span>
        }
      >
        {items.map((m, i) => (
          <span key={i} className="block tabular-nums">
            글: {m.said} · 숫자: {m.actual}
          </span>
        ))}
        <span className="mt-1 block">AI 글의 방향이 같은 브리핑의 시장 데이터와 반대입니다 — 「시장 데이터」 칸의 숫자를 기준으로 보세요.</span>
      </InfoTip>
    </span>
  );
}
