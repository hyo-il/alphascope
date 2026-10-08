import Button from '../ui/Button';
import { ICON_SM } from '../ui/icon';
import { ExternalLink } from 'lucide-react';
import WarnIcon from '../ui/WarnIcon';
import { useEffect, useMemo, useState } from 'react';
import { buildComparePrompt } from '../../services/analysis/modePrompts';
import {
  DEFAULT_HORIZON,
  HORIZONS,
  type InvestmentHorizon,
} from '../../services/analysis/horizons';
import type { SymbolSummary } from '../../types/analysis';
import { modal, toast } from '../../store/uiStore';
import { copyText } from '../../services/clipboard';

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

  /*
   * 프롬프트 초기화 — 직접 고친 내용이 있을 때만 확인 창 (v2.34.1). 고친 것이 없거나 자동 생성본과 같으면 바로 되돌린다.
   */
  const resetPrompt = () => {
    if (edited === null || edited === generated) {
      setEdited(null);
      return;
    }
    modal.confirm({
      title: '프롬프트 초기화',
      message: '고친 프롬프트를 버리고 자동 생성본으로 초기화합니다. 되돌릴 수 없습니다.',
      confirmText: '초기화',
      danger: true,
      onConfirm: () => setEdited(null),
    });
  };
  const ready = summaries.filter((s) => s.price != null).length >= 2;

  const copy = async () => {
    if ((await copyText(prompt)) === 'copied') {
      toast.success('프롬프트를 복사했습니다', 'Claude 대화에 붙여넣으세요');
    } else {
      toast.error('복사하지 못했습니다', '프롬프트 칸에서 직접 선택해 복사하세요');
    }
  };

  return (
    <section className="rounded-xl bg-bg-secondary p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium text-text-secondary">AI 비교 평가</h3>

        <div className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => setHorizon(h.id)}
              title={h.period}
              className={`rounded border px-2 py-0.5 text-caption transition-colors ${
                horizon === h.id
                  ? 'border-transparent bg-bg-elevated font-medium text-text-primary'
                  : 'border-transparent bg-bg-tertiary text-text-secondary hover:text-text-primary'
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-caption text-text-muted">
          {loading ? '요약 불러오는 중…' : `${prompt.length.toLocaleString('ko-KR')}자`}
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setEdited(e.target.value)}
        spellCheck={false}
        rows={12}
        className="w-full resize-y rounded border border-border bg-bg-tertiary p-2 font-mono text-caption leading-relaxed text-text-primary focus:border-accent focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="md"
          onClick={copy}
          disabled={!ready}>
          클립보드 복사
        </Button>
        <a
          href="https://claude.ai/new"
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          Claude 열기 <ExternalLink {...ICON_SM} />
        </a>
        <Button variant="secondary" size="md"
          onClick={resetPrompt}
          disabled={edited == null}>
          프롬프트 초기화
        </Button>

        <span className="text-caption text-warning"><WarnIcon />이 분석은 투자 조언이 아닙니다.</span>
      </div>
    </section>
  );
}
