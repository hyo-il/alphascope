import { useEffect, useMemo, useState } from 'react';
import {
  CUSTOM_PROFILES,
  PARAM_LIMITS,
  PROFILE_LABEL,
  cloneSwingParams,
  sameSwingParams,
  type CustomProfileId,
  type ProfileState,
  type SwingParams,
} from '../../types/strategyProfile';
import { ProfileSaveError, type ProfileFieldError } from '../../hooks/useStrategyProfile';
import { toast } from '../../store/uiStore';

/**
 * 판정 기준 편집 팝업 — **공격·수비만** 고친다.
 *
 * ⚠️ 표준 열은 읽기 전용이다. 표준은 코드 상수라 화면에서 바꿀 수 없고, 옆에 두는 이유는
 * "얼마나 바꿨는지" 를 눈으로 비교하기 위해서다.
 *
 * ⚠️ 여기 숫자에는 **권장값이 없다.** 공격·수비의 초기값은 표준과 같고, 무엇이 더 나은지는
 * 분석 성적표로만 확인된다 — 화면에 "권장"·"검증된 값" 으로 적지 말 것.
 */

type FieldPath =
  | 'grades.strong'
  | 'grades.buy'
  | 'grades.watch'
  | 'grades.hold'
  | 'rrDemoteBelow'
  | 'rsiBand.low'
  | 'rsiBand.high'
  | 'risk.lowVol'
  | 'risk.midVol'
  | 'risk.highVol';

interface FieldSpec {
  path: FieldPath;
  label: string;
  hint: string;
  step: number;
  get: (p: SwingParams) => number;
  set: (p: SwingParams, v: number) => SwingParams;
}

const g = PARAM_LIMITS;

const FIELDS: FieldSpec[] = [
  {
    path: 'grades.strong',
    label: 'STRONG 컷',
    hint: `${g.grade.min}~${g.grade.max} 정수 · BUY 보다 커야 합니다`,
    step: 1,
    get: (p) => p.grades.strong,
    set: (p, v) => ({ ...p, grades: { ...p.grades, strong: v } }),
  },
  {
    path: 'grades.buy',
    label: 'BUY 컷 (추천 기준)',
    hint: '이 점수 이상만 추천합니다',
    step: 1,
    get: (p) => p.grades.buy,
    set: (p, v) => ({ ...p, grades: { ...p.grades, buy: v } }),
  },
  {
    path: 'grades.watch',
    label: 'WATCH 컷',
    hint: `${g.grade.min}~${g.grade.max} 정수`,
    step: 1,
    get: (p) => p.grades.watch,
    set: (p, v) => ({ ...p, grades: { ...p.grades, watch: v } }),
  },
  {
    path: 'grades.hold',
    label: 'HOLD 컷',
    hint: '이 아래는 AVOID 입니다',
    step: 1,
    get: (p) => p.grades.hold,
    set: (p, v) => ({ ...p, grades: { ...p.grades, hold: v } }),
  },
  {
    path: 'rrDemoteBelow',
    label: '손익비 강등 기준',
    // 1.0 하한은 성향이 아니라 원칙이다 (Step 10).
    hint: `이 값 미만이면 STRONG·BUY → WATCH · ${g.rrDemoteBelow.min} 아래로는 내릴 수 없습니다`,
    step: 0.1,
    get: (p) => p.rrDemoteBelow,
    set: (p, v) => ({ ...p, rrDemoteBelow: v }),
  },
  {
    path: 'rsiBand.low',
    label: 'RSI 눌림 구간 (아래)',
    hint: `${g.rsi.min}~${g.rsi.max}`,
    step: 1,
    get: (p) => p.rsiBand.low,
    set: (p, v) => ({ ...p, rsiBand: { ...p.rsiBand, low: v } }),
  },
  {
    path: 'rsiBand.high',
    label: 'RSI 눌림 구간 (위)',
    hint: '아래값보다 커야 합니다',
    step: 1,
    get: (p) => p.rsiBand.high,
    set: (p, v) => ({ ...p, rsiBand: { ...p.rsiBand, high: v } }),
  },
  {
    path: 'risk.lowVol',
    label: '리스크 % (저변동 ATR<2%)',
    hint: `${g.risk.min}~${g.risk.max}% · 앱의 안전 범위입니다`,
    step: 0.1,
    get: (p) => p.risk.lowVol,
    set: (p, v) => ({ ...p, risk: { ...p.risk, lowVol: v } }),
  },
  {
    path: 'risk.midVol',
    label: '리스크 % (중변동 2~4%)',
    hint: '저변동 이하 · 고변동 이상',
    step: 0.1,
    get: (p) => p.risk.midVol,
    set: (p, v) => ({ ...p, risk: { ...p.risk, midVol: v } }),
  },
  {
    path: 'risk.highVol',
    label: '리스크 % (고변동 ATR>4%)',
    hint: '변동성이 클수록 작게 잡습니다',
    step: 0.1,
    get: (p) => p.risk.highVol,
    set: (p, v) => ({ ...p, risk: { ...p.risk, highVol: v } }),
  },
];

export default function StrategyProfileModal({
  state,
  onSave,
  onClose,
}: {
  state: ProfileState;
  onSave: (custom: Record<CustomProfileId, SwingParams>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Record<CustomProfileId, SwingParams>>(() => ({
    aggressive: cloneSwingParams(state.custom.aggressive),
    defensive: cloneSwingParams(state.custom.defensive),
  }));
  const [errors, setErrors] = useState<ProfileFieldError[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const errorOf = useMemo(
    () => (id: CustomProfileId, path: FieldPath) =>
      errors.find((e) => e.field === `${id}.${path}` || e.field === `${id}.${path.split('.')[0]}`),
    [errors],
  );

  const edit = (id: CustomProfileId, spec: FieldSpec, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setDraft((prev) => ({ ...prev, [id]: spec.set(prev[id], value) }));
  };

  const resetTo = (id: CustomProfileId) => {
    setDraft((prev) => ({ ...prev, [id]: cloneSwingParams(state.standard) }));
    setErrors((prev) => prev.filter((e) => !e.field.startsWith(`${id}.`)));
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('판정 기준을 저장했습니다');
      onClose();
    } catch (e) {
      if (e instanceof ProfileSaveError) {
        setErrors(e.fields);
        toast.error('저장하지 못했습니다', e.fields[0]?.message ?? e.message);
      } else {
        toast.error('저장하지 못했습니다', (e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(640px,85vh)] w-[min(700px,80vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">📐 스윙 판정 기준 편집</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* ⚠️ 이 문구는 지우지 말 것 — 근거 없는 숫자를 권장값처럼 읽게 두지 않기 위한 것이다 */}
        <p className="shrink-0 border-b border-border bg-warning/10 px-4 py-2 text-[11px] leading-relaxed text-warning">
          공격·수비 값은 <b>사용자 설정이며 근거가 검증되지 않았습니다.</b> 분석 성적표에서
          프로파일별 성과를 비교해 조정하세요. 기준을 낮추면 추천이 늘어날 뿐, 더 잘 맞는다는
          뜻은 아닙니다. (모의투자 전용입니다.)
        </p>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[11px] text-text-muted">
                <th className="py-2 pr-2 font-normal">항목</th>
                <th className="w-20 py-2 pr-2 font-normal">표준</th>
                {CUSTOM_PROFILES.map((id) => (
                  <th key={id} className="w-28 py-2 pr-2 font-normal text-text-secondary">
                    {PROFILE_LABEL[id]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((spec) => (
                <tr key={spec.path} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-2">
                    <p className="text-xs text-text-primary">{spec.label}</p>
                    <p className="text-[10px] leading-relaxed text-text-muted">{spec.hint}</p>
                  </td>
                  <td className="py-2 pr-2 text-xs tabular-nums text-text-muted">
                    {spec.get(state.standard)}
                  </td>
                  {CUSTOM_PROFILES.map((id) => {
                    const value = spec.get(draft[id]);
                    const changed = value !== spec.get(state.standard);
                    const err = errorOf(id, spec.path);
                    return (
                      <td key={id} className="py-2 pr-2">
                        <input
                          type="number"
                          step={spec.step}
                          value={value}
                          onChange={(e) => edit(id, spec, e.target.value)}
                          aria-label={`${PROFILE_LABEL[id]} ${spec.label}`}
                          className={`w-20 rounded border px-2 py-1 text-xs tabular-nums ${
                            err
                              ? 'border-bearish text-bearish'
                              : changed
                                ? 'border-accent text-accent'
                                : 'border-border'
                          }`}
                        />
                        {err && <p className="mt-0.5 text-[10px] text-bearish">{err.message}</p>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap gap-2">
            {CUSTOM_PROFILES.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => resetTo(id)}
                disabled={sameSwingParams(draft[id], state.standard)}
                className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {PROFILE_LABEL[id]}를 표준값으로 되돌리기
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-[11px] text-text-muted">
            저장해도 이미 나온 추천은 바뀌지 않습니다 — 다시 분석해야 새 기준으로 채점됩니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
