import { useEffect, useMemo, useState } from 'react';
import { buildComparePrompt } from '../../services/analysis/modePrompts';
import {
  DEFAULT_HORIZON,
  HORIZONS,
  type InvestmentHorizon,
} from '../../services/analysis/horizons';
import type { SymbolSummary } from '../../types/analysis';
import { toast } from '../../store/uiStore';

/**
 * AI 비교 평가 — 붙여넣기용 프롬프트를 만든다.
 *
 * 앱은 여기까지만 하고 추론은 Claude 구독 대화에서 한다 (비용 $0, Step 7 과 같은 방식).
 * **차트 이미지는 넣지 않는다** — 비교 차트는 캡처 대상이 아니고, 네 장을 붙이면
 * 프롬프트가 무거워지는 데 비해 표로 이미 들어간 수치보다 나은 게 없다.
 */
interface Props {
  summaries: SymbolSummary[];
  loading: boolean;
}

export default function CompareAIPrompt({ summaries, loading }: Props) {
  const [horizon, setHorizon] = useState<InvestmentHorizon>(DEFAULT_HORIZON);
  const [edited, setEdited] = useState<string | null>(null);

  const generated = useMemo(
    () => `${buildComparePrompt(summaries, horizon)}

5. 위 종목들을 표로 정리하고 투자 매력도 순위를 매겨 주세요 (근거 포함)`,
    [summaries, horizon],
  );

  // 비교 종목이나 기간이 바뀌면 편집본을 버린다 — 다른 조합의 문장이 남으면 혼란스럽다.
  useEffect(() => {
    setEdited(null);
  }, [summaries, horizon]);

  const prompt = edited ?? generated;
  const ready = summaries.filter((s) => s.price != null).length >= 2;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('프롬프트를 복사했습니다', 'Claude 대화에 붙여넣으세요');
    } catch (e) {
      toast.error('복사하지 못했습니다', (e as Error).message);
    }
  };

  return (
    <section className="rounded-md border border-border bg-bg-secondary p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium text-text-secondary">AI 비교 평가</h3>

        <div className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHorizon(h.id)}
              title={h.period}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                horizon === h.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-[11px] text-text-muted">
          {loading ? '요약 불러오는 중…' : `${prompt.length.toLocaleString('ko-KR')}자`}
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setEdited(e.target.value)}
        spellCheck={false}
        rows={12}
        className="w-full resize-y rounded border border-border bg-bg-tertiary p-2 font-mono text-[11px] leading-relaxed text-text-primary focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copy}
          disabled={!ready}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          📋 클립보드 복사
        </button>
        <a
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          Claude 열기 ↗
        </a>
        <button
          type="button"
          onClick={() => setEdited(null)}
          disabled={edited == null}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-40"
        >
          프롬프트 초기화
        </button>

        <span className="text-[11px] text-warning">⚠️ 이 분석은 투자 조언이 아닙니다.</span>
      </div>
    </section>
  );
}
