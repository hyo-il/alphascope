import type { ReactNode } from 'react';

export type AISource = 'claude' | 'gemini';

/**
 * 분석 결과가 어느 AI 에서 나왔는지 표시한다.
 *
 * 두 AI 의 결과가 한 타임라인에 섞이므로, 출처가 없으면
 * 사용자가 "내가 붙여넣은 것" 과 "앱이 자동으로 만든 것" 을 구분할 수 없다.
 */
const STYLE: Record<AISource, { label: string; icon: string; className: string }> = {
  claude: {
    label: 'Claude',
    icon: '🟣',
    className: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  },
  gemini: {
    label: 'Gemini',
    icon: '🔵',
    className: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
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
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${style.className}`}
    >
      <span aria-hidden>{style.icon}</span>
      {style.label}
      {suffix ? <span className="text-text-muted">· {suffix}</span> : null}
    </span>
  );
}
