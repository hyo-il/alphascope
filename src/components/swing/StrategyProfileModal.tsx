import { ICON_SM } from '../ui/icon';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CUSTOM_PROFILES,
  PARAM_LIMITS,
  PROFILE_LABEL,
  cloneSwingParams,
  sameSwingParams,
  type CustomProfileId,
  type ProfileId,
  type ProfileState,
  type SwingParams,
} from '../../types/strategyProfile';
import { ProfileSaveError, type ProfileFieldError } from '../../hooks/useStrategyProfile';
import { toast } from '../../store/uiStore';
import {
  DIP_OPTIONS,
  FREQUENCY_OPTIONS,
  RISK_OPTIONS,
  applyEasy,
  detectEasy,
  type EasyChoice,
} from '../../utils/easyProfile';
import {
  GOAL_PERIOD_CHOICES,
  GOAL_TARGET_CHOICES,
  autoStop,
  goalPct,
  type SwingGoal,
} from '../../types/swingGoal';
import { TARGET_INPUT_LIMITS } from '../../types/targetAnalysis';

/**
 * 스윙 기준 편집 팝업 (v2.29.0 재구성)
 *
 * - **1층 「초보자 설정」** — 목표 수익률(3·5·10·15·20% + 직접)과 보유 기간(1·2·3달 = 21·42·63거래일)만.
 *   ⚠️ 이 값은 **추천 판정을 바꾸지 않는다** — 「목표 도달 가능성 분석」(Gemini)의 조건이다(`types/swingGoal.ts`). 저장은 `PUT /api/swing/goal`.
 * - **2층 「고급 설정」**(접힘) — (가) 가능성 분석 조건(목표·손절·기간 직접) · (나) 추천 판정 기준(아래 v2.17.0 의 쉬운 설정·숫자표를 그대로 옮겼다).
 * - 저장 버튼 하나가 바뀐 쪽만 저장한다(목표 / 판정 기준). 한쪽이 실패하면 어느 쪽인지 알린다.
 *
 * 아래는 (나) 판정 기준의 설명이다 — 판정 기준은 **공격·수비만** 고친다.
 *
 * **2층 구조** (v2.17.0): 초보자가 숫자표로는 고르지 못해서(사용자 신고),
 *   - 1층 「쉬운 설정」 — 질문 3개(자주 받기 · 얼마나 떨어졌을 때 · 한 번에 잃어도 되는 돈) × 버튼 3개.
 *     답은 `utils/easyProfile.ts` 가 숫자로 옮긴다. 고를 때마다 **과거 120일 결과 미리보기**를 표준과 나란히 보여 준다.
 *   - 2층 「고급 설정」(접힘) — 예전 숫자표 그대로 + 행마다 쉬운 설명 한 줄. 여기서 직접 고치면 1층은 "직접 설정" 이 된다.
 * 저장 구조·서버 검증은 그대로다 — 1층이 만든 값도 검증을 통과해야 저장된다.
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
  /** 초보자용 한 줄 설명 (v2.17.0) */
  easy: string;
  hint: string;
  step: number;
  get: (p: SwingParams) => number;
  set: (p: SwingParams, v: number) => SwingParams;
}

const g = PARAM_LIMITS;

const FIELDS: FieldSpec[] = [
  {
    path: 'grades.strong',
    easy: "이 점수 이상이면 '강력 추천' 이 됩니다",
    label: 'STRONG 컷',
    hint: `${g.grade.min}~${g.grade.max} 정수 · BUY 보다 커야 합니다`,
    step: 1,
    get: (p) => p.grades.strong,
    set: (p, v) => ({ ...p, grades: { ...p.grades, strong: v } }),
  },
  {
    path: 'grades.buy',
    easy: "이 점수 이상이면 '추천' 이 됩니다",
    label: 'BUY 컷 (추천 기준)',
    hint: '이 점수 이상만 추천합니다',
    step: 1,
    get: (p) => p.grades.buy,
    set: (p, v) => ({ ...p, grades: { ...p.grades, buy: v } }),
  },
  {
    path: 'grades.watch',
    easy: "이 점수 이상이면 '관심'(아직 살 때는 아님) 입니다",
    label: 'WATCH 컷',
    hint: `${g.grade.min}~${g.grade.max} 정수`,
    step: 1,
    get: (p) => p.grades.watch,
    set: (p, v) => ({ ...p, grades: { ...p.grades, watch: v } }),
  },
  {
    path: 'grades.hold',
    easy: "이 점수 아래는 '피하기' 입니다",
    label: 'HOLD 컷',
    hint: '이 아래는 AVOID 입니다',
    step: 1,
    get: (p) => p.grades.hold,
    set: (p, v) => ({ ...p, grades: { ...p.grades, hold: v } }),
  },
  {
    path: 'rrDemoteBelow',
    easy: "벌 수 있는 돈 ÷ 잃을 수 있는 돈이 이보다 작으면 추천에서 내립니다",
    label: '손익비 강등 기준',
    // 1.0 하한은 성향이 아니라 원칙이다 (Step 10).
    hint: `이 값 미만이면 STRONG·BUY → WATCH · ${g.rrDemoteBelow.min} 아래로는 내릴 수 없습니다`,
    step: 0.1,
    get: (p) => p.rrDemoteBelow,
    set: (p, v) => ({ ...p, rrDemoteBelow: v }),
  },
  {
    path: 'rsiBand.low',
    easy: "RSI 눌림 구간: 최근 얼마나 내려왔는지를 0~100 으로 잰 값. 낮을수록 많이 떨어진 것",
    label: 'RSI 눌림 구간 (아래)',
    hint: `${g.rsi.min}~${g.rsi.max}`,
    step: 1,
    get: (p) => p.rsiBand.low,
    set: (p, v) => ({ ...p, rsiBand: { ...p.rsiBand, low: v } }),
  },
  {
    path: 'rsiBand.high',
    easy: "이 구간 안에 있을 때 '적당히 쉬어 가는 중' 으로 보고 점수를 줍니다",
    label: 'RSI 눌림 구간 (위)',
    hint: '아래값보다 커야 합니다',
    step: 1,
    get: (p) => p.rsiBand.high,
    set: (p, v) => ({ ...p, rsiBand: { ...p.rsiBand, high: v } }),
  },
  {
    path: 'risk.lowVol',
    easy: "리스크 %: 손절에 걸렸을 때 전체 자산에서 잃는 비율 (덜 움직이는 종목)",
    label: '리스크 % (저변동 ATR<2%)',
    hint: `${g.risk.min}~${g.risk.max}% · 앱의 안전 범위입니다`,
    step: 0.1,
    get: (p) => p.risk.lowVol,
    set: (p, v) => ({ ...p, risk: { ...p.risk, lowVol: v } }),
  },
  {
    path: 'risk.midVol',
    easy: "리스크 %: 손절에 걸렸을 때 전체 자산에서 잃는 비율 (보통 종목)",
    label: '리스크 % (중변동 2~4%)',
    hint: '저변동 이하 · 고변동 이상',
    step: 0.1,
    get: (p) => p.risk.midVol,
    set: (p, v) => ({ ...p, risk: { ...p.risk, midVol: v } }),
  },
  {
    path: 'risk.highVol',
    easy: "리스크 %: 손절에 걸렸을 때 전체 자산에서 잃는 비율 (많이 움직이는 종목)",
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
  goal,
  onSaveGoal,
  activeId,
  onSwitchProfile,
  onClose,
}: {
  state: ProfileState;
  onSave: (custom: Record<CustomProfileId, SwingParams>) => Promise<unknown>;
  /** 초보자 목표 설정 (v2.29.0) */
  goal: SwingGoal;
  onSaveGoal: (goal: SwingGoal) => Promise<SwingGoal>;
  /** 지금 쓰는 판정 기준 — 창 맨 위 세그먼트 (v2.33.0, 예전에는 스윙 화면 도구줄에 있었다) */
  activeId: ProfileId;
  /** 기준 바꾸기 — 스윙 화면의 `switchProfile` 그대로(저장 경로 동일) */
  onSwitchProfile: (id: ProfileId) => Promise<void>;
  onClose: () => void;
}) {
  const [goalDraft, setGoalDraft] = useState<SwingGoal>(goal);
  const [goalError, setGoalError] = useState<string | null>(null);
  /** 1층 목표 「직접 입력」 칸을 연 상태 */
  const [customTarget, setCustomTarget] = useState(() => !GOAL_TARGET_CHOICES.some((c) => c === goal.targetPct));
  /** 고급 설정을 펼쳤는가 — 판정 기준 미리보기(과거 120일 재현)는 펼쳤을 때만 계산한다 */
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const goalChanged =
    goalDraft.targetPct !== goal.targetPct ||
    goalDraft.days !== goal.days ||
    goalDraft.stopAuto !== goal.stopAuto ||
    (!goalDraft.stopAuto && goalDraft.stopPct !== goal.stopPct);
  const shownStop = goalDraft.stopAuto ? autoStop(goalDraft.targetPct) : goalDraft.stopPct;
  const setGoal = (patch: Partial<SwingGoal>) => {
    setGoalDraft((prev) => ({ ...prev, ...patch }));
    setGoalError(null);
  };

  const [draft, setDraft] = useState<Record<CustomProfileId, SwingParams>>(() => ({
    aggressive: cloneSwingParams(state.custom.aggressive),
    defensive: cloneSwingParams(state.custom.defensive),
  }));
  const [errors, setErrors] = useState<ProfileFieldError[]>([]);
  const [saving, setSaving] = useState(false);
  /** 1층에서 지금 고치는 프로파일 */
  const [editing, setEditing] = useState<CustomProfileId>('aggressive');
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const previewSeq = useRef(0);

  const easy = detectEasy(draft[editing]);

  const choose = (patch: Partial<EasyChoice>) => {
    const base: EasyChoice = easy ?? { frequency: 'normal', dip: 'normal', risk: 1 };
    setDraft((prev) => ({ ...prev, [editing]: applyEasy({ ...base, ...patch }, prev[editing]) }));
    setErrors((prev) => prev.filter((e) => !e.field.startsWith(`${editing}.`)));
  };

  // 고칠 때마다 과거 결과 미리보기 — 연타를 모아 한 번만 보낸다(서버는 설정별 하루 캐시)
  const editingParams = JSON.stringify(draft[editing]);
  useEffect(() => {
    if (!advancedOpen) return;
    const mine = ++previewSeq.current;
    setPreview((p) => ({ status: 'loading', last: p.status === 'done' ? p.result : p.status === 'loading' ? p.last : undefined }));
    const timer = setTimeout(() => {
      fetch('/api/swing/profile-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: JSON.parse(editingParams) }),
      })
        .then(async (r) => {
          const payload = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
          return payload as PreviewResult;
        })
        .then((result) => mine === previewSeq.current && setPreview({ status: 'done', result }))
        .catch((e: Error) => mine === previewSeq.current && setPreview({ status: 'error', message: e.message }));
    }, 400);
    return () => clearTimeout(timer);
  }, [editingParams, advancedOpen]);

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

  const profileChanged = CUSTOM_PROFILES.some((id) => !sameSwingParams(draft[id], state.custom[id]));

  /** 바뀐 쪽만 저장한다 — 목표(PUT /api/swing/goal) · 판정 기준(PUT /api/strategy-profile). 실패하면 어느 쪽인지 알린다 */
  const submit = async () => {
    if (!goalChanged && !profileChanged) {
      onClose();
      return;
    }
    setSaving(true);
    let ok = true;
    if (goalChanged) {
      try {
        await onSaveGoal(goalDraft);
      } catch (e) {
        ok = false;
        setGoalError((e as Error).message);
        toast.error('목표 설정을 저장하지 못했습니다', (e as Error).message);
      }
    }
    if (profileChanged) {
      try {
        await onSave(draft);
      } catch (e) {
        ok = false;
        if (e instanceof ProfileSaveError) {
          setErrors(e.fields);
          setAdvancedOpen(true);
          toast.error('판정 기준을 저장하지 못했습니다', e.fields[0]?.message ?? e.message);
        } else {
          toast.error('판정 기준을 저장하지 못했습니다', (e as Error).message);
        }
      }
    }
    setSaving(false);
    if (ok) {
      toast.success(
        goalChanged && profileChanged ? '목표 설정과 판정 기준을 저장했습니다' : goalChanged ? '목표 설정을 저장했습니다' : '판정 기준을 저장했습니다',
      );
      onClose();
    }
  };

  const [tLo, tHi] = TARGET_INPUT_LIMITS.targetPct;
  const [sLo, sHi] = TARGET_INPUT_LIMITS.stopPct;
  const [dLo, dHi] = TARGET_INPUT_LIMITS.days;
  const targetIsChoice = !customTarget && GOAL_TARGET_CHOICES.some((c) => c === goalDraft.targetPct);
  const periodIsChoice = GOAL_PERIOD_CHOICES.some((c) => c.days === goalDraft.days);
  const chip = (active: boolean) =>
    `rounded-md border px-3 py-1 text-xs transition-colors ${
      active ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-border text-text-secondary hover:border-accent/50'
    }`;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(640px,85vh)] w-[min(700px,80vw)] flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">판단 기준 편집</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
          {/* ── 판정 기준 고르기 (v2.33.0 — 도구줄에서 옮겼다). 바꾸면 곧바로 저장된다(예전 세그먼트와 같은 경로) ── */}
          <section className="mb-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-text-muted">판정 기준</span>
              {(['standard', 'aggressive', 'defensive'] as ProfileId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void onSwitchProfile(id)}
                  aria-pressed={activeId === id}
                  className={`rounded-md border px-2.5 py-1 text-[13px] transition-colors ${
                    activeId === id
                      ? 'border-accent bg-accent/10 font-medium text-accent'
                      : 'border-border text-text-secondary hover:border-accent/50'
                  }`}
                >
                  {PROFILE_LABEL[id]}
                </button>
              ))}
              <span className="text-[13px] text-text-muted">바꾸면 바로 적용됩니다 — 추천은 [다시 분석] 해야 새 기준으로 나옵니다</span>
            </div>
            {activeId !== 'standard' && sameSwingParams(state.custom[activeId as CustomProfileId], state.standard) && (
              <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-1.5 text-[13px] text-text-muted">
                {PROFILE_LABEL[activeId]} 기준은 아직 표준과 같은 값입니다 — 아래 「고급 설정 &gt; 추천 판정 기준」 에서 조정하세요.
                (공격·수비 값은 사용자 설정이며 근거가 검증되지 않았습니다.)
              </p>
            )}
          </section>

          {/* ── 1층: 초보자 설정 (v2.29.0) — 가능성 분석의 조건. 판정은 바꾸지 않는다 ── */}
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-text-primary">초보자 설정</h3>
            <div>
              <p className="mb-1 text-[13px] text-text-primary">목표 수익률</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {GOAL_TARGET_CHOICES.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setCustomTarget(false);
                      setGoal({ targetPct: v });
                    }}
                    className={chip(targetIsChoice && goalDraft.targetPct === v)}
                  >
                    {v}%
                  </button>
                ))}
                <button type="button" onClick={() => setCustomTarget(true)} className={chip(!targetIsChoice)}>
                  직접 입력
                </button>
                {!targetIsChoice && (
                  <span className="inline-flex items-center gap-1 text-xs">
                    +
                    <input
                      type="number"
                      step={0.5}
                      min={tLo}
                      max={tHi}
                      value={goalDraft.targetPct}
                      onChange={(e) => setGoal({ targetPct: Number(e.target.value) })}
                      aria-label="목표 수익률 직접 입력(%)"
                      className="w-16 rounded border border-border px-1.5 py-0.5 tabular-nums"
                    />
                    % <span className="text-text-muted">({tLo}~{tHi})</span>
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1 text-[13px] text-text-primary">보유 기간</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {GOAL_PERIOD_CHOICES.map((p) => (
                  <button key={p.days} type="button" onClick={() => setGoal({ days: p.days })} className={chip(goalDraft.days === p.days)}>
                    {p.label}
                  </button>
                ))}
                {!periodIsChoice && (
                  <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] text-text-secondary">
                    직접 설정 · {goalDraft.days}거래일
                  </span>
                )}
              </div>
            </div>
            <p className="text-[13px] text-text-secondary">
              손절 −{goalPct(shownStop)} ({goalDraft.stopAuto ? '목표의 절반' : '직접 설정'}) · {goalDraft.days}거래일 — 고급 설정에서 바꿀 수 있습니다
            </p>
            {goalError && <p className="text-[13px] text-bearish">{goalError}</p>}
            {/* ⚠️ 고정 안내 두 줄 — 지우지 않는다(목표가 추천을 바꾼다고 오해하지 않게) */}
            <div className="space-y-0.5 rounded-md bg-bg-tertiary/40 px-3 py-2 text-[13px] leading-relaxed text-text-muted">
              <p>목표 수익률은 추천 판정을 바꾸지 않습니다. 「목표 도달 가능성 분석」을 할 때의 조건입니다.</p>
              <p>가능성은 Gemini 의 추정이며 아직 채점이 쌓이지 않았습니다. 투자 조언이 아닙니다.</p>
            </div>
          </section>

          {/* ── 2층: 고급 설정 ── */}
          <details
            className="mt-4 rounded-lg border border-border px-3 py-2"
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="text-xs font-medium text-text-secondary">고급 설정 — 분석 조건 · 추천 판정 기준</summary>

            {/* (가) 가능성 분석 조건 */}
            <section className="mt-3 space-y-2">
              <h4 className="text-xs font-medium text-text-primary">(가) 가능성 분석 조건</h4>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <label className="inline-flex w-fit items-center gap-1">
                  목표 +
                  <input
                    type="number"
                    step={0.5}
                    min={tLo}
                    max={tHi}
                    value={goalDraft.targetPct}
                    onChange={(e) => {
                      setCustomTarget(true);
                      setGoal({ targetPct: Number(e.target.value) });
                    }}
                    className="w-16 rounded border border-border px-1.5 py-0.5 tabular-nums"
                  />
                  %
                </label>
                <label className="inline-flex w-fit items-center gap-1">
                  손절 −
                  <input
                    type="number"
                    step={0.5}
                    min={sLo}
                    max={sHi}
                    value={shownStop}
                    disabled={goalDraft.stopAuto}
                    onChange={(e) => setGoal({ stopPct: Number(e.target.value) })}
                    className="w-16 rounded border border-border px-1.5 py-0.5 tabular-nums disabled:opacity-50"
                  />
                  %
                </label>
                <label className="inline-flex w-fit items-center gap-1.5 text-text-secondary">
                  <input
                    type="checkbox"
                    checked={goalDraft.stopAuto}
                    onChange={(e) => setGoal({ stopAuto: e.target.checked, stopPct: e.target.checked ? goalDraft.stopPct : shownStop })}
                  />
                  목표의 절반으로 자동
                </label>
                <label className="inline-flex w-fit items-center gap-1">
                  기간
                  <input
                    type="number"
                    step={1}
                    min={dLo}
                    max={dHi}
                    value={goalDraft.days}
                    onChange={(e) => setGoal({ days: Number(e.target.value) })}
                    className="w-16 rounded border border-border px-1.5 py-0.5 tabular-nums"
                  />
                  거래일 <span className="text-text-muted">({dLo}~{dHi})</span>
                </label>
              </div>
              <p className="text-[13px] text-text-muted">
                손절 = 목표의 절반은 앱의 출발값입니다(근거 검증 전). 기간이 길수록 채점까지 오래 걸립니다(63거래일 ≈ 3달).
              </p>
            </section>

            {/* (나) 추천 판정 기준 — v2.17.0 의 쉬운 설정·숫자표를 그대로 옮겼다 */}
            <section className="mt-4 space-y-3 border-t border-border pt-3">
              <h4 className="text-xs font-medium text-text-primary">(나) 추천 판정 기준</h4>
            {/* ⚠️ 이 문구는 지우지 말 것 — 근거 없는 숫자를 권장값처럼 읽게 두지 않기 위한 것이다 */}
            <p className="rounded-md bg-warning/10 px-3 py-2 text-[13px] leading-relaxed text-warning">
              공격·수비 값은 <b>사용자 설정이며 근거가 검증되지 않았습니다.</b> 분석 성적표에서
              프로파일별 성과를 비교해 조정하세요. 기준을 낮추면 추천이 늘어날 뿐, 더 잘 맞는다는
              뜻은 아닙니다. (모의투자 전용입니다.)
            </p>


          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-medium text-text-primary">쉬운 설정</h4>
              <div className="flex gap-1">
                {CUSTOM_PROFILES.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setEditing(id)}
                    className={`rounded border px-2.5 py-0.5 text-[13px] transition-colors ${
                      editing === id ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
                    }`}
                  >
                    {PROFILE_LABEL[id]}
                  </button>
                ))}
              </div>
              {!easy && (
                <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] text-text-secondary">
                  직접 설정 — 아래 고급 설정에서 고친 값입니다
                </span>
              )}
              <span className="ml-auto text-[13px] text-text-muted">표준은 바꿀 수 없습니다</span>
            </div>

            <EasyQuestion
              title="추천을 얼마나 자주 받고 싶나요?"
              options={FREQUENCY_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
              value={easy?.frequency}
              onPick={(v) => choose({ frequency: v })}
            />
            <EasyQuestion
              title="얼마나 떨어졌을 때 사고 싶나요?"
              options={DIP_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
              value={easy?.dip}
              onPick={(v) => choose({ dip: v })}
            />
            <EasyQuestion
              title="한 번 거래에서 잃어도 되는 돈은 전체의 몇 %?"
              options={RISK_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
              value={easy?.risk}
              onPick={(v) => choose({ risk: v })}
            />

            <PreviewBox state={preview} />
          </section>
          <details className="rounded-lg border border-border px-3 py-2">
            <summary className="text-xs font-medium text-text-secondary">숫자표 — 숫자를 직접 고칩니다</summary>
          <table className="mt-2 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-border text-[13px] text-text-muted">
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
                    <p className="text-[13px] leading-relaxed text-text-secondary">{spec.easy}</p>
                    <p className="text-[13px] leading-relaxed text-text-muted">{spec.hint}</p>
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
                        {err && <p className="mt-0.5 text-[13px] text-bearish">{err.message}</p>}
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
                className="rounded border border-border px-2 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {PROFILE_LABEL[id]}를 표준값으로 되돌리기
              </button>
            ))}
          </div>
          </details>
            </section>
          </details>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 text-[13px] text-text-muted">
            저장해도 이미 나온 추천은 바뀌지 않습니다 — 다시 분석해야 새 기준으로 채점됩니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 whitespace-nowrap ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="shrink-0 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 1층 부품 ─────────────────────────────────────────────────────────────────

interface PreviewStats {
  count: number;
  avg10d: number | null;
  sample: number;
  /** 10일 안에 계획 손절가에 먼저 닿은 비율(%) — 같은 날 목표·손절 동시는 손절 */
  stopFirstRate: number | null;
}
interface PreviewResult extends PreviewStats {
  baseline: PreviewStats;
  symbols: number;
  days: number;
}
type PreviewState =
  | { status: 'idle' }
  | { status: 'loading'; last?: PreviewResult }
  | { status: 'done'; result: PreviewResult }
  | { status: 'error'; message: string };

function EasyQuestion<T extends string | number>({
  title,
  options,
  value,
  onPick,
}: {
  title: string;
  options: { id: T; label: string; hint: string }[];
  value: T | undefined;
  onPick: (value: T) => void;
}) {
  const picked = options.find((o) => o.id === value);
  return (
    <div>
      <p className="mb-1 text-[13px] text-text-primary">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={String(o.id)}
            type="button"
            onClick={() => onPick(o.id)}
            className={`rounded-md border px-3 py-1 text-xs transition-colors ${
              value === o.id ? 'border-accent bg-accent/10 font-semibold text-accent' : 'border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {picked && <p className="mt-1 text-[13px] text-text-muted">{picked.hint}</p>}
    </div>
  );
}

const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const rate = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);

/**
 * 결과 미리보기 — 진단의 120일 재현을 그 설정으로 다시 돌린 값.
 * ⚠️ 고정 문구 "과거 결과이며 앞으로를 보장하지 않습니다" 는 지우지 않는다. 표본 10 미만이면 "표본 적음 — 참고만".
 */
function PreviewBox({ state }: { state: PreviewState }) {
  const result = state.status === 'done' ? state.result : state.status === 'loading' ? state.last : undefined;
  return (
    <div className="rounded-lg border border-border bg-bg-tertiary/30 px-3 py-2 text-[13px]">
      <p className="mb-1 flex items-center gap-2 font-medium text-text-primary">
        이 설정이었다면
        {state.status === 'loading' && (
          <span className="inline-flex items-center gap-1 font-normal text-text-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden />
            과거 120일로 계산 중… (처음은 수십 초)
          </span>
        )}
      </p>
      {state.status === 'error' && <p className="text-bearish">{state.message}</p>}
      {result && (
        <div className={state.status === 'loading' ? 'opacity-50' : ''}>
          <p className="text-text-secondary">
            지난 {result.days}일 동안 관심 종목 {result.symbols}개에서 추천 <b className="text-text-primary">{result.count}번</b>
            {' · '}10일 평균{' '}
            <b className={(result.avg10d ?? 0) >= 0 ? 'text-bullish' : 'text-bearish'}>{pct(result.avg10d)}</b>
            {' · '}계획 손절 먼저 도달 <b className="text-text-primary">{rate(result.stopFirstRate)}</b>
            {result.sample < 10 && <span className="ml-1 rounded bg-bg-tertiary px-1 text-[13px] text-text-secondary">표본 적음 — 참고만</span>}
          </p>
          <p className="text-text-muted">
            표준 설정은 추천 {result.baseline.count}번 · 10일 평균 {pct(result.baseline.avg10d)} · 계획 손절 먼저 도달{' '}
            {rate(result.baseline.stopFirstRate)}
            {result.baseline.sample < 10 && ' (표본 적음)'}
          </p>
        </div>
      )}
      <p className="mt-1 text-[13px] text-text-muted">과거 결과이며 앞으로를 보장하지 않습니다.</p>
      <p className="text-[13px] text-text-muted">
        같은 기간 한 번의 결과입니다. 여러 설정을 바꿔 보며 가장 좋은 숫자를 고르면 우연에 속기 쉽습니다.
      </p>
    </div>
  );
}
