import { useState } from 'react';
import { Button, Dialog, NumberField, Segmented } from '../ui';
import { toast } from '../../store/uiStore';
import { GOAL_PERIOD_CHOICES, GOAL_TARGET_CHOICES, autoStop, goalPct, type SwingGoal } from '../../types/swingGoal';
import { TARGET_INPUT_LIMITS } from '../../types/targetAnalysis';

/**
 * 「목표 수익 가능성」 조건(목표 수익률 · 보유 기간 · 손절) — v2.45.0 에 「판단 기준 편집」 창을 없애면서 그 창의 목표 설정만 남겼다.
 * 저장은 그대로 `PUT /api/swing/goal`(`useSwingGoal`). ⚠️ 매수 판단을 바꾸지 않는다 — 가능성 분석의 조건일 뿐이다(고정 안내 두 줄).
 */
export default function GoalDialog({ goal, onSave, onClose }: { goal: SwingGoal; onSave: (g: SwingGoal) => Promise<SwingGoal>; onClose: () => void }) {
  const [draft, setDraft] = useState<SwingGoal>(goal);
  const [custom, setCustom] = useState(() => !GOAL_TARGET_CHOICES.some((c) => c === goal.targetPct));
  const [saving, setSaving] = useState(false);
  const [tLo, tHi] = TARGET_INPUT_LIMITS.targetPct;
  const [sLo, sHi] = TARGET_INPUT_LIMITS.stopPct;
  const set = (p: Partial<SwingGoal>) => setDraft((d) => ({ ...d, ...p }));
  const shownStop = draft.stopAuto ? autoStop(draft.targetPct) : draft.stopPct;
  const targetIsChoice = !custom && GOAL_TARGET_CHOICES.some((c) => c === draft.targetPct);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ ...draft, stopPct: shownStop });
      toast.success('목표 조건을 저장했습니다');
      onClose();
    } catch (e) {
      toast.error('목표 조건을 저장하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="목표 수익 가능성 — 조건"
      onClose={onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button busy={saving} variant="primary" onClick={() => void save()} disabled={saving}>
            {saving ? '저장하는 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1 text-caption text-text-primary">목표 수익률</p>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="목표 수익률"
              size="sm"
              value={targetIsChoice ? String(draft.targetPct) : 'custom'}
              onChange={(v) => {
                if (v === 'custom') return setCustom(true);
                setCustom(false);
                set({ targetPct: Number(v) });
              }}
              options={[...GOAL_TARGET_CHOICES.map((v) => ({ value: String(v), label: `${v}%` })), { value: 'custom', label: '직접 입력' }]}
            />
            {!targetIsChoice && (
              <span className="inline-flex items-center gap-1 text-xs">
                +
                <NumberField step={0.5} min={tLo} max={tHi} value={draft.targetPct} onChange={(e) => set({ targetPct: Number(e.target.value) })} aria-label="목표 수익률 직접 입력(%)" unit="%" />
                <span className="text-text-muted">({tLo}~{tHi})</span>
              </span>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 text-caption text-text-primary">보유 기간</p>
          <Segmented label="보유 기간" size="sm" value={draft.days} onChange={(days) => set({ days })} options={GOAL_PERIOD_CHOICES.map((p) => ({ value: p.days, label: p.label }))} />
        </div>
        <div>
          <p className="mb-1 text-caption text-text-primary">손절</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="inline-flex w-fit items-center gap-1.5 text-text-secondary">
              <input type="checkbox" checked={draft.stopAuto} onChange={(e) => set({ stopAuto: e.target.checked, stopPct: shownStop })} />
              목표의 절반으로 자동
            </label>
            <span className="inline-flex items-center gap-1">
              −
              <NumberField step={0.5} min={sLo} max={sHi} unit="%" value={shownStop} disabled={draft.stopAuto} onChange={(e) => set({ stopPct: Number(e.target.value) })} aria-label="손절(%)" />
            </span>
          </div>
        </div>
        <p className="text-caption text-text-secondary">
          지금 조건: 목표 +{goalPct(draft.targetPct)} · {draft.days}거래일 · 손절 −{goalPct(shownStop)}
        </p>
        {/* ⚠️ 고정 안내 두 줄 — 지우지 않는다(목표가 판단을 바꾼다고 오해하지 않게) */}
        <div className="space-y-0.5 rounded-md bg-bg-tertiary/40 px-3 py-2 text-caption leading-relaxed text-text-muted">
          <p>목표 수익률은 매수 판단을 바꾸지 않습니다. 「목표 수익 가능성」 분석의 조건입니다.</p>
          <p>가능성은 Gemini 의 추정이며 아직 채점이 쌓이지 않았습니다. 투자 조언이 아닙니다.</p>
        </div>
      </div>
    </Dialog>
  );
}
