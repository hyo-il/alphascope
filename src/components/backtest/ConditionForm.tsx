import { Plus } from 'lucide-react';
import { Button, Panel, Segmented, SectionTitle, ShortNote } from '../ui';
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
            // 폰: 줄 1 = 방법 이름 · [방법 N 삭제](오른쪽) · 줄 2 = 규칙 고르기 전체 너비(고르기 칸이 좁아 [조건 보기] · 안내가 꺾였다) ·
            // 손가락 화면 줄 사이 16(누르는 칸 44 가 위아래로 겹치지 않게)
            <div key={c.label} className="flex flex-wrap items-start gap-x-3 gap-y-1 touch:gap-y-4">
              <span className="w-14 shrink-0 pt-1 text-xs font-medium text-text-primary">{methodName(c.label)}</span>
              <div className="min-w-0 flex-1 phone:order-last phone:basis-full">
                <RuleSelect rules={rules} value={c.ruleId} onChange={(id) => setMethodRule(c.label, id)} label={`${methodName(c.label)} 매매 규칙`} />
              </div>
              {many && (
                <Button size="sm" variant="ghost" onClick={() => removeMethod(c.label)} className="phone:ml-auto">
                  {methodName(c.label)} 삭제
                </Button>
              )}
            </div>
          ))}
        </div>
        {draft.conditions.length < MAX_CONDITIONS && rules != null && rules.length > 0 && (
          // 손가락 화면 — 바로 위 「매매 규칙으로 가기」 글자 단추와 누르는 칸 44 가 겹치지 않게 위 12 더(점검 165)
          <Button size="sm" icon={Plus} onClick={addMethod} className="touch:mt-3">
            비교할 방법 추가
          </Button>
        )}
        {many && (
          // 폰 · 패드는 첫 문장 + [?](R5 · 같은 글)
          <ShortNote className="text-caption text-text-muted" label="비교하는 법" lead="한 번에 하나씩 바꾸고 전후를 비교하세요." more="여러 개를 함께 바꾸면 무엇 때문에 달라졌는지 알 수 없습니다.">
            <p className="text-caption text-text-muted">한 번에 하나씩 바꾸고 전후를 비교하세요 — 여러 개를 함께 바꾸면 무엇 때문에 달라졌는지 알 수 없습니다.</p>
          </ShortNote>
        )}
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
