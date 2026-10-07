import { RSI_HELP } from '../../data/indicatorHelp';
import { useState, type ReactNode } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import RuleChoiceCards from '../common/RuleChoiceCards';
import { InlineSpinner } from '../common/LoadingOverlay';
import { Badge, Button, DisclosureButton, InfoTip, Panel, Segmented, SectionTitle } from '../ui';
import { toast } from '../../store/uiStore';
import { fetchAdvice } from '../../hooks/useBacktest';
import { draftInput, type BacktestDraft } from '../../hooks/useBacktestDraft';
import { conditionErrors, type ConditionField } from '../../utils/backtestInput';
import { ruleConditionLine } from '../../utils/autoTradeExplain';
import { ENGINE_MA_PERIODS, RULE_LIMITS, type EngineMaPeriod } from '../../types/autoTrading';
import { BACKTEST_YEARS, MAX_CONDITIONS, fixMethodNames, methodName, type BacktestAdvice, type BacktestCondition, type ConditionLabel } from '../../types/backtest';
import { RULE_CHOICES, matchChoice } from '../../types/ruleChoices';

/**
 * ② 조건 정하기 (v2.38.0 → v2.39.0 조건 A·B·C) — 자동매매 규칙형이 **실제로 쓰는 것만**: 이동평균 교차(5·20·60·120 중) · RSI 기준 · 손절 · 트레일링 · 익절 + 기간.
 * - 조건은 최대 3개. [조건 추가] = **바로 앞 조건을 복사한** 새 카드(하나만 바꿔 비교하기 쉽게). 카드는 한 번에 하나만 펼친다(`Segmented` A·B·C).
 * - 기간은 모든 조건 공통(카드 밖). 범위 검사는 서버와 같은 `conditionErrors`.
 * - 「AI에게 조건 물어보기」 의 제안은 **[이 값으로 채우기]를 눌러야** 지금 고른 카드에 들어간다(자동으로 넣지 않는다).
 */
const LABEL: Record<string, string> = {
  maShort: '단기 이동평균',
  maLong: '장기 이동평균',
  useMaCross: '이동평균 사용',
  rsiBuyBelow: 'RSI 매수 기준',
  rsiSellAbove: 'RSI 매도 기준',
  useRsi: 'RSI 사용',
  hardStopLossPercent: '손절',
  trailingStopEnabled: '트레일링',
  trailingStopPercent: '트레일링 %',
  takeProfitEnabled: '익절',
  takeProfitPercent: '익절 %',
};
const show = (k: string, v: unknown) =>
  typeof v === 'boolean' ? (v ? '사용' : '안 씀') : k === 'maShort' || k === 'maLong' ? `${v}일` : k.endsWith('Percent') ? `${v}%` : String(v);

function Field({ label, hint, error, children }: { label: string; hint: string; error?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-28 shrink-0 text-xs text-text-primary">{label}</span>
        {children}
      </div>
      <p className="pl-[7.75rem] text-[13px] text-text-muted">{hint}</p>
      {error && <p className="pl-[7.75rem] text-[13px] text-bearish">{error}</p>}
    </div>
  );
}

function NumberBox({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  return (
    <input
      type="number"
      aria-label={label}
      value={Number.isFinite(value) ? value : ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
      className="h-8 w-20 rounded-md border border-border bg-bg-tertiary px-2 text-xs tabular-nums disabled:opacity-40"
    />
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="inline-flex w-fit items-center gap-1.5 text-xs">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  );
}

function AdviceCard({
  advice,
  target,
  onFill,
  onClose,
}: {
  advice: BacktestAdvice;
  target: BacktestCondition;
  onFill: () => void;
  onClose: () => void;
}) {
  const cur: Record<string, unknown> = {
    ...target.rule,
    hardStopLossPercent: target.hardStopLossPercent,
    trailingStopEnabled: target.trailingStopEnabled,
    trailingStopPercent: target.trailingStopPercent,
    takeProfitEnabled: target.takeProfitEnabled,
    takeProfitPercent: target.takeProfitPercent,
  };
  const changes = Object.entries(advice.values).filter(([k, v]) => cur[k] !== v);
  const methodTitle = RULE_CHOICES.find((c) => c.id === advice.method)?.title;
  return (
    <Panel pad="sm" tone="tertiary" className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-text-primary">AI 제안 — {methodName(target.label)}</p>
        {methodTitle && <Badge>{methodTitle}</Badge>}
        <span className="ml-auto text-[13px] text-text-muted">{advice.model}</span>
      </div>
      {changes.length ? (
        <ul className="space-y-0.5 text-[13px] text-text-secondary">
          {changes.map(([k, v]) => (
            <li key={k}>
              {LABEL[k] ?? k}: {show(k, cur[k])} → <b className="text-text-primary">{show(k, v)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-text-secondary">지금 조건과 같은 값을 제안했습니다.</p>
      )}
      {advice.reasons.length > 0 && (
        <div className="text-[13px]">
          <p className="text-text-muted">이유</p>
          <ul className="list-disc space-y-0.5 pl-5 text-text-secondary">
            {advice.reasons.map((r, i) => (
              <li key={i}>{fixMethodNames(r)}</li>
            ))}
          </ul>
        </div>
      )}
      {advice.cautions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-warning">
          {advice.cautions.map((r, i) => (
            <li key={i}>{fixMethodNames(r)}</li>
          ))}
        </ul>
      )}
      <div className="space-y-0.5 text-[13px] text-text-muted">
        {advice.dropped.length > 0 && <p>AI 제안 중 범위 밖 값 {advice.dropped.length}개를 제외했습니다: {advice.dropped.join(', ')}</p>}
        <p>
          시험 기간이 시작되기 전 1년의 숫자만 보냈습니다 · {advice.summarized ? `종목이 많아 분야별 평균으로 줄여 보냈습니다(${advice.sent}종목)` : `${advice.sent}종목`}
        </p>
        {advice.excluded.length > 0 && <p>앞 1년 데이터가 모자라 제외하고 물은 종목: {advice.excluded.map((e) => e.symbol).join(', ')}</p>}
        {/* 고정 문구 — 지우지 않는다 */}
        <p>AI 제안은 검증된 값이 아닙니다. 시험해 보고 판단하세요.</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={onFill} disabled={!changes.length}>
          이 값으로 채우기
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    </Panel>
  );
}

/** 조건 카드 하나 — 쉬운 선택지 + 「자세히」 숫자 */
function ConditionCard({
  c,
  onChange,
  onRemove,
}: {
  c: BacktestCondition;
  onChange: (p: Partial<BacktestCondition>) => void;
  onRemove?: () => void;
}) {
  const active = matchChoice(c.rule);
  const [open, setOpen] = useState(active == null);
  const errors = conditionErrors(c);
  const err = (f: ConditionField) => errors[f];
  const r = c.rule;
  const setRule = (p: Partial<typeof r>) => onChange({ rule: { ...r, ...p } });
  const maOptions = (ENGINE_MA_PERIODS as readonly EngineMaPeriod[]).map((p) => ({ value: p, label: `${p}일` }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 text-[13px] text-text-secondary">
          <b className="font-semibold text-text-primary">{methodName(c.label)}</b> · {ruleConditionLine(c)}
        </p>
        {onRemove && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
            {methodName(c.label)} 삭제
          </Button>
        )}
      </div>
      <RuleChoiceCards rule={r} showWhy={false} onPick={(ch) => setRule(ch.rule)} />
      {!active && (
        <p className="text-[13px] text-text-secondary">
          <Badge>직접 설정</Badge> 세 가지와 다른 값입니다 — 아래 「고급 설정」 에서 고친 값으로 시험합니다.
        </p>
      )}

      <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="고급 설정" controls={`bt-detail-${c.label}`} />
      {open && (
        <div id={`bt-detail-${c.label}`} className="space-y-3 rounded-lg bg-bg-tertiary/40 p-3">
          <Field label="이동평균 사용" hint="짧은 평균이 긴 평균을 위로 넘으면 매수, 아래로 내려가면 매도." error={err('useAny')}>
            <Check checked={r.useMaCross} onChange={(v) => setRule({ useMaCross: v })}>
              사용
            </Check>
          </Field>
          <Field label="단기 · 장기" hint="엔진이 계산하는 5·20·60·120일 중에서 고릅니다(장기가 더 길어야 합니다)." error={err('maShort') ?? err('maLong')}>
            <Segmented label="단기 이동평균" size="sm" options={maOptions.filter((o) => o.value !== 120)} value={r.maShort as EngineMaPeriod} onChange={(v) => setRule({ maShort: v })} />
            <span className="text-text-muted">/</span>
            <Segmented label="장기 이동평균" size="sm" options={maOptions.filter((o) => o.value !== 5)} value={r.maLong as EngineMaPeriod} onChange={(v) => setRule({ maLong: v })} />
          </Field>
          <Field label="RSI 사용" hint={RSI_HELP}>
            <Check checked={r.useRsi} onChange={(v) => setRule({ useRsi: v })}>
              사용
            </Check>
          </Field>
          <Field
            label="RSI 매수 기준"
            hint={`RSI 가 이 값 이하로 떨어졌다가 다시 오를 때 매수 (${RULE_LIMITS.rsiBuyBelow.min}~${RULE_LIMITS.rsiBuyBelow.max}).`}
            error={err('rsiBuyBelow')}
          >
            <NumberBox label="RSI 매수 기준" value={r.rsiBuyBelow} disabled={!r.useRsi} onChange={(v) => setRule({ rsiBuyBelow: v })} />
          </Field>
          <Field
            label="RSI 매도 기준"
            hint={`RSI 가 이 값 이상이면 매도 (${RULE_LIMITS.rsiSellAbove.min}~${RULE_LIMITS.rsiSellAbove.max}).`}
            error={err('rsiSellAbove')}
          >
            <NumberBox label="RSI 매도 기준" value={r.rsiSellAbove} disabled={!r.useRsi} onChange={(v) => setRule({ rsiSellAbove: v })} />
          </Field>
          <Field
            label="손절 %"
            hint={`손절 ${Number.isFinite(c.hardStopLossPercent) ? c.hardStopLossPercent : '—'}% — 매수가보다 이만큼 내려가면 바로 매도 (${RULE_LIMITS.hardStopLossPercent.min}~${RULE_LIMITS.hardStopLossPercent.max}).`}
            error={err('hardStopLossPercent')}
          >
            <NumberBox label="손절 %" value={c.hardStopLossPercent} onChange={(v) => onChange({ hardStopLossPercent: v })} />
          </Field>
          <Field
            label="익절"
            hint={`매수가보다 이만큼 오르면 모두 매도 (${RULE_LIMITS.takeProfitPercent.min}~${RULE_LIMITS.takeProfitPercent.max}). 끄면 오르는 동안 계속 들고 간다. 같은 날 손절과 둘 다 닿으면 손절로 센다.`}
            error={err('takeProfitPercent')}
          >
            <Check checked={c.takeProfitEnabled} onChange={(v) => onChange({ takeProfitEnabled: v })}>
              켜기
            </Check>
            <NumberBox label="익절 %" value={c.takeProfitPercent} disabled={!c.takeProfitEnabled} onChange={(v) => onChange({ takeProfitPercent: v })} />
          </Field>
          <Field
            label="트레일링"
            hint={`매수한 뒤 최고가(종가 기준)보다 이만큼 내려가면 매도 (${RULE_LIMITS.trailingStopPercent.min}~${RULE_LIMITS.trailingStopPercent.max}).`}
            error={err('trailingStopPercent')}
          >
            <Check checked={c.trailingStopEnabled} onChange={(v) => onChange({ trailingStopEnabled: v })}>
              켜기
            </Check>
            <NumberBox label="트레일링 %" value={c.trailingStopPercent} disabled={!c.trailingStopEnabled} onChange={(v) => onChange({ trailingStopPercent: v })} />
          </Field>
        </div>
      )}
      {!open && Object.keys(errors).length > 0 && <p className="text-[13px] text-bearish">고칠 칸이 있습니다 — 「고급 설정」 을 펼쳐 보세요.</p>}
    </div>
  );
}

export default function ConditionForm({
  draft,
  patch,
  patchCondition,
  addCondition,
  removeCondition,
  gemini,
}: {
  draft: BacktestDraft;
  patch: (p: Partial<BacktestDraft>) => void;
  patchCondition: (label: ConditionLabel, p: Partial<BacktestCondition>) => void;
  addCondition: () => void;
  removeCondition: (label: ConditionLabel) => void;
  gemini: { enabled: boolean; reason: string | null } | null;
}) {
  const [advice, setAdvice] = useState<{ label: ConditionLabel; data: BacktestAdvice } | null>(null);
  const [asking, setAsking] = useState(false);
  const many = draft.conditions.length > 1;
  const current = draft.conditions.find((c) => c.label === draft.active) ?? draft.conditions[0];
  const adviceTarget = advice ? draft.conditions.find((c) => c.label === advice.label) : undefined;

  const ask = async () => {
    setAsking(true);
    try {
      setAdvice({ label: current.label, data: await fetchAdvice(draftInput(draft), current.label) });
    } catch (e) {
      toast.error('AI 제안을 받지 못했습니다', (e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const fill = () => {
    if (!advice || !adviceTarget) return;
    const { hardStopLossPercent, trailingStopEnabled, trailingStopPercent, takeProfitEnabled, takeProfitPercent, ...rule } = advice.data.values;
    patchCondition(adviceTarget.label, {
      rule: { ...adviceTarget.rule, ...rule },
      ...(hardStopLossPercent != null ? { hardStopLossPercent } : {}),
      ...(trailingStopEnabled != null ? { trailingStopEnabled } : {}),
      ...(trailingStopPercent != null ? { trailingStopPercent } : {}),
      ...(takeProfitEnabled != null ? { takeProfitEnabled } : {}),
      ...(takeProfitPercent != null ? { takeProfitPercent } : {}),
    });
    patch({ active: adviceTarget.label });
    setAdvice(null);
    toast.info(`${methodName(adviceTarget.label)} 에 채웠습니다`, '「고급 설정」 에서 확인하고 고칠 수 있습니다.');
  };

  const askDisabled = asking || !draft.symbols.length || !gemini?.enabled;
  const askWhy = !draft.symbols.length ? '종목을 먼저 고르세요' : gemini && !gemini.enabled ? (gemini.reason ?? 'Gemini 를 쓸 수 없습니다') : null;
  const full = draft.conditions.length >= MAX_CONDITIONS;

  return (
    <Panel pad="sm" className="space-y-3">
      <SectionTitle
        right={
          <span className="flex items-center gap-2">
            <Button size="sm" icon={asking ? undefined : Sparkles} onClick={() => void ask()} disabled={askDisabled}>
              {asking && <InlineSpinner />}
              {asking ? 'AI에게 묻는 중…' : many ? `AI에게 ${methodName(current.label)} 조건 물어보기` : 'AI에게 조건 물어보기'}
            </Button>
            <InfoTip label="AI에게 조건 물어보기 설명">
              누를 때마다 Gemini 를 1번 부릅니다. 무료 사용 한도를 자동매매와 함께 씁니다. 시험 기간이 시작되기 전 1년의 숫자만 보냅니다.
              제안은 지금 고른 조건 카드에 채웁니다.
            </InfoTip>
          </span>
        }
      >
        ② 조건 정하기
      </SectionTitle>
      {askWhy && <p className="text-[13px] text-text-muted">AI에게 묻기: {askWhy}</p>}
      {advice && adviceTarget && <AdviceCard advice={advice.data} target={adviceTarget} onFill={fill} onClose={() => setAdvice(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        {many && (
          <Segmented
            label="고칠 방법"
            options={draft.conditions.map((c) => ({ value: c.label, label: methodName(c.label) }))}
            value={current.label}
            onChange={(v) => patch({ active: v })}
          />
        )}
        <Button size="sm" icon={Plus} onClick={addCondition} disabled={full} title={full ? `방법은 ${MAX_CONDITIONS}개까지입니다` : '바로 앞 방법을 복사해 새 방법을 만듭니다'}>
          비교할 방법 추가
        </Button>
        <span className="min-w-0 text-[13px] text-text-muted">
          {full ? `방법은 ${MAX_CONDITIONS}개까지 비교합니다.` : '같은 종목으로 방법을 최대 3개까지 나란히 비교합니다. 추가하면 앞 방법을 복사합니다.'}
        </span>
      </div>

      {/* key = label — 카드를 바꾸면 「자세히」 펼침 상태도 그 카드 것으로 새로 시작한다 */}
      <ConditionCard
        key={current.label}
        c={current}
        onChange={(p) => patchCondition(current.label, p)}
        onRemove={many ? () => removeCondition(current.label) : undefined}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-text-primary">기간</span>
        <Segmented label="기간" options={BACKTEST_YEARS.map((y) => ({ value: y, label: `${y}년` }))} value={draft.years} onChange={(v) => patch({ years: v })} />
        <span className="min-w-0 text-[13px] text-text-muted">
          모든 방법에 같은 기간 · 최근 {draft.years}년(1년씩 나눠 계산), 수수료 왕복 0.30%p 포함, 신호 다음 날 시가에 매수·매도합니다.
        </span>
      </div>
    </Panel>
  );
}
