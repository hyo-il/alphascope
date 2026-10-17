import { Plus } from 'lucide-react';
import { Button, Panel, Segmented, SectionTitle } from '../ui';
import RuleSelect from '../rules/RuleSelect';
import type { BacktestDraft } from '../../hooks/useBacktestDraft';
import type { TradingRule } from '../../types/tradingRule';
import { BACKTEST_YEARS, MAX_CONDITIONS, methodName, type ConditionLabel } from '../../types/backtest';

/**
 * ② 방법 · ③ 기간 (퀀트 다시 만들기 2단계). 방법 하나 = 「매매 규칙」 하나(최대 3개 비교).
 * 규칙의 숫자는 여기서 고치지 않는다 — [조건 보기] 는 보기 전용이고, 고치기는 「퀀트 > 매매 규칙」 에서만.
 * 규칙이 하나도 없으면 막힌 이유와 가는 길을 같은 자리에 보인다(`RuleSelect`) — [시험 실행] 은 입력 검사가 막는다.
 */
export default function ConditionForm({
  draft,
  rules,
  patch,
  setMethodRule,
  addMethod,
  removeMethod,
}: {
  draft: BacktestDraft;
  rules: TradingRule[] | null;
  patch: (p: Partial<BacktestDraft>) => void;
  setMethodRule: (label: ConditionLabel, ruleId: number | null) => void;
  addMethod: () => void;
  removeMethod: (label: ConditionLabel) => void;
}) {
  const many = draft.conditions.length > 1;
  return (
    <Panel pad="sm" className="space-y-4">
      <div className="space-y-3">
        <SectionTitle aside={`방법마다 매매 규칙 하나 · 최대 ${MAX_CONDITIONS}개 비교`}>② 방법</SectionTitle>
        <div className="space-y-3">
          {draft.conditions.map((c) => (
            <div key={c.label} className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <span className="w-14 shrink-0 pt-1.5 text-xs font-medium text-text-primary">{methodName(c.label)}</span>
              <div className="min-w-0 flex-1">
                <RuleSelect rules={rules} value={c.ruleId} onChange={(id) => setMethodRule(c.label, id)} label={`${methodName(c.label)} 매매 규칙`} />
              </div>
              {many && (
                <Button size="md" variant="danger-text" onClick={() => removeMethod(c.label)}>
                  {methodName(c.label)} 삭제
                </Button>
              )}
            </div>
          ))}
        </div>
        {draft.conditions.length < MAX_CONDITIONS && rules != null && rules.length > 0 && (
          <Button size="sm" icon={Plus} onClick={addMethod}>
            비교할 방법 추가
          </Button>
        )}
        {many && <p className="text-caption text-text-muted">한 번에 하나씩 바꾸고 전후를 비교하세요 — 여러 개를 함께 바꾸면 무엇 때문에 달라졌는지 알 수 없습니다.</p>}
      </div>

      <div className="space-y-2">
        <SectionTitle>③ 기간</SectionTitle>
        <Segmented
          label="기간"
          size="md"
          value={String(draft.years)}
          onChange={(v) => patch({ years: Number(v) as BacktestDraft['years'] })}
          options={BACKTEST_YEARS.map((y) => ({ value: String(y), label: `${y}년` }))}
        />
      </div>
    </Panel>
  );
}
