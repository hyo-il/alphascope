import type { ReactNode } from 'react';
import { GEMINI_TRIGGER_LABEL } from '../../types/gemini';

export { GEMINI_TRIGGER_LABEL };

export type AISource = 'claude' | 'gemini';

/**
 * 분석 결과가 어느 AI 에서 나왔는지 표시한다.
 *
 * 두 AI 의 결과가 한 타임라인에 섞이므로, 출처가 없으면
 * 사용자가 "내가 붙여넣은 것" 과 "앱이 자동으로 만든 것" 을 구분할 수 없다.
 */
const STYLE: Record<AISource, { label: string; className: string }> = {
  claude: {
    label: 'Claude',
    // 기본 팔레트 대신 앱 토큰. 파랑은 주요 실행 버튼·링크에만(디자인 규칙 2): Claude = 회색 글자, Gemini = 흰 글자(둘 다 회색 바탕)
    className: 'border-transparent bg-bg-tertiary text-text-secondary',
  },
  gemini: {
    label: 'Gemini',
    className: 'border-transparent bg-bg-tertiary text-text-primary',
  },
};


export default function AISourceBadge({
  source,
  suffix,
}: {
  source: AISource;
  /** '수동' · '자동' 같은 꼬리표 */
  suffix?: ReactNode;
}) {
  const style = STYLE[source];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-caption font-medium ${style.className}`}
    >
      {style.label}
      {suffix ? <span className="text-text-muted">· {suffix}</span> : null}
    </span>
  );
}
