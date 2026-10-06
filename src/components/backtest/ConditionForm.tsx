import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import RuleChoiceCards from '../common/RuleChoiceCards';
import { InlineSpinner } from '../common/LoadingOverlay';
import { Badge, Button, InfoTip, Panel, Segmented, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { toast } from '../../store/uiStore';
import { fetchAdvice } from '../../hooks/useBacktest';
import { draftInput, type BacktestDraft } from '../../hooks/useBacktestDraft';
import { backtestInputErrors, type BacktestField } from '../../utils/backtestInput';
import { ENGINE_MA_PERIODS, RULE_LIMITS, type EngineMaPeriod } from '../../types/autoTrading';
import { BACKTEST_YEARS, type BacktestAdvice } from '../../types/backtest';
import { RULE_CHOICES, matchChoice } from '../../types/ruleChoices';

/**
 * ② 조건 정하기 (v2.38.0) — 자동매매 규칙형이 **실제로 쓰는 것만**: 이동평균 교차(5·20·60·120 중) · RSI 기준 · 손절 · 트레일링 + 기간.
 * 쉬운 선택지 3장이 먼저, 숫자는 「자세히」 안. 범위 검사는 서버와 같은 `backtestInputErrors`.
 * 「AI에게 조건 물어보기」 의 제안은 **[이 값으로 채우기]를 눌러야** 칸에 들어간다(자동으로 넣지 않는다).
 */
const LABEL: Record<string, string> = {
  maShort: '단기 이동평균',
  maLong: '장기 이동평균',
  useMaCross: '이동평균 사용',
  rsiBuyBelow: 'RSI 살 때 기준',
  rsiSellAbove: 'RSI 팔 때 기준',
  useRsi: 'RSI 사용',
  hardStopLossPercent: '손절',
  trailingStopEnabled: '트레일링',
  trailingStopPercent: '트레일링 %',
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

function AdviceCard({ advice, draft, onFill, onClose }: { advice: BacktestAdvice; draft: BacktestDraft; onFill: () => void; onClose: () => void }) {
  const cur: Record<string, unknown> = { ...draft.rule, hardStopLossPercent: draft.hardStopLossPercent, trailingStopEnabled: draft.trailingStopEnabled, trailingStopPercent: draft.trailingStopPercent };
  const changes = Object.entries(advice.values).filter(([k, v]) => cur[k] !== v);
  const methodTitle = RULE_CHOICES.find((c) => c.id === advice.method)?.title;
  return (
    <Panel pad="sm" tone="tertiary" className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-text-primary">AI 제안</p>
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
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      {advice.cautions.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-warning">
          {advice.cautions.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <div className="space-y-0.5 text-[13px] text-text-muted">
        {advice.dropped.length > 0 && <p>AI 제안 중 범위 밖 값 {advice.dropped.length}개를 뺐습니다: {advice.dropped.join(', ')}</p>}
        <p>
          시험 기간이 시작되기 전 1년의 숫자만 보냈습니다 · {advice.summarized ? `종목이 많아 분야별 평균으로 줄여 보냈습니다(${advice.sent}종목)` : `${advice.sent}종목`}
        </p>
        {advice.excluded.length > 0 && <p>앞 1년 기록이 모자라 빼고 물은 종목: {advice.excluded.map((e) => e.symbol).join(', ')}</p>}
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

export default function ConditionForm({
  draft,
  patch,
  gemini,
}: {
  draft: BacktestDraft;
  patch: (p: Partial<BacktestDraft>) => void;
  gemini: { enabled: boolean; reason: string | null } | null;
}) {
  const active = matchChoice(draft.rule);
  const [open, setOpen] = useState(active == null);
  const [advice, setAdvice] = useState<BacktestAdvice | null>(null);
  const [asking, setAsking] = useState(false);
  const errors = backtestInputErrors(draftInput(draft));
  const err = (f: BacktestField) => errors[f];
  const r = draft.rule;
  const setRule = (p: Partial<typeof r>) => patch({ rule: { ...r, ...p } });

  const ask = async () => {
    setAsking(true);
    try {
      setAdvice(await fetchAdvice(draftInput(draft)));
    } catch (e) {
      toast.error('AI 제안을 받지 못했습니다', (e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const fill = () => {
    if (!advice) return;
    const { hardStopLossPercent, trailingStopEnabled, trailingStopPercent, ...rule } = advice.values;
    patch({
      rule: { ...r, ...rule },
      ...(hardStopLossPercent != null ? { hardStopLossPercent } : {}),
      ...(trailingStopEnabled != null ? { trailingStopEnabled } : {}),
      ...(trailingStopPercent != null ? { trailingStopPercent } : {}),
    });
    setOpen(true);
    setAdvice(null);
    toast.info('AI 제안을 칸에 채웠습니다', '아래 「자세히」 에서 확인하고 고칠 수 있습니다.');
  };

  const askDisabled = asking || !draft.symbols.length || !gemini?.enabled;
  const askWhy = !draft.symbols.length ? '종목을 먼저 고르세요' : gemini && !gemini.enabled ? (gemini.reason ?? 'Gemini 를 쓸 수 없습니다') : null;
  const maOptions = (ENGINE_MA_PERIODS as readonly EngineMaPeriod[]).map((p) => ({ value: p, label: `${p}일` }));

  return (
    <Panel pad="sm" className="space-y-3">
      <SectionTitle
        right={
          <span className="flex items-center gap-2">
            <Button size="sm" icon={asking ? undefined : Sparkles} onClick={() => void ask()} disabled={askDisabled}>
              {asking && <InlineSpinner />}
              {asking ? 'AI에게 묻는 중…' : 'AI에게 조건 물어보기'}
            </Button>
            <InfoTip label="AI에게 조건 물어보기 설명">
              누를 때마다 Gemini 를 1번 부릅니다. 무료 사용 한도를 자동매매와 함께 씁니다. 시험 기간이 시작되기 전 1년의 숫자만 보냅니다.
            </InfoTip>
          </span>
        }
      >
        ② 조건 정하기
      </SectionTitle>
      {askWhy && <p className="text-[13px] text-text-muted">AI에게 묻기: {askWhy}</p>}
      {advice && <AdviceCard advice={advice} draft={draft} onFill={fill} onClose={() => setAdvice(null)} />}

      <RuleChoiceCards rule={r} showWhy={false} onPick={(c) => setRule(c.rule)} />
      {!active && (
        <p className="text-[13px] text-text-secondary">
          <Badge>직접 설정</Badge> 세 가지와 다른 값입니다 — 아래 「자세히」 에서 고친 값으로 시험합니다.
        </p>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
      >
        {open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}
        자세히 — 숫자 직접 고치기
      </button>
      {open && (
        <div className="space-y-3 rounded-lg bg-bg-tertiary/40 p-3">
          <Field label="이동평균 사용" hint="짧은 평균이 긴 평균을 위로 넘으면 사고, 아래로 내려가면 판다." error={err('useAny')}>
            <label className="inline-flex w-fit items-center gap-1.5 text-xs">
              <input type="checkbox" checked={r.useMaCross} onChange={(e) => setRule({ useMaCross: e.target.checked })} /> 사용
            </label>
          </Field>
          <Field label="단기 · 장기" hint="엔진이 계산하는 5·20·60·120일 중에서 고릅니다(장기가 더 길어야 합니다)." error={err('maShort') ?? err('maLong')}>
            <Segmented label="단기 이동평균" size="sm" options={maOptions.filter((o) => o.value !== 120)} value={r.maShort as EngineMaPeriod} onChange={(v) => setRule({ maShort: v })} />
            <span className="text-text-muted">/</span>
            <Segmented label="장기 이동평균" size="sm" options={maOptions.filter((o) => o.value !== 5)} value={r.maLong as EngineMaPeriod} onChange={(v) => setRule({ maLong: v })} />
          </Field>
          <Field label="RSI 사용" hint="RSI 는 최근 14일 동안 얼마나 올랐는지·떨어졌는지를 0~100 으로 나타낸 값입니다.">
            <label className="inline-flex w-fit items-center gap-1.5 text-xs">
              <input type="checkbox" checked={r.useRsi} onChange={(e) => setRule({ useRsi: e.target.checked })} /> 사용
            </label>
          </Field>
          <Field
            label="RSI 살 때 기준"
            hint={`RSI 가 이 값 이하로 떨어졌다가 다시 오를 때 산다 (${RULE_LIMITS.rsiBuyBelow.min}~${RULE_LIMITS.rsiBuyBelow.max}).`}
            error={err('rsiBuyBelow')}
          >
            <NumberBox label="RSI 살 때 기준" value={r.rsiBuyBelow} disabled={!r.useRsi} onChange={(v) => setRule({ rsiBuyBelow: v })} />
          </Field>
          <Field
            label="RSI 팔 때 기준"
            hint={`RSI 가 이 값 이상이면 판다 (${RULE_LIMITS.rsiSellAbove.min}~${RULE_LIMITS.rsiSellAbove.max}).`}
            error={err('rsiSellAbove')}
          >
            <NumberBox label="RSI 팔 때 기준" value={r.rsiSellAbove} disabled={!r.useRsi} onChange={(v) => setRule({ rsiSellAbove: v })} />
          </Field>
          <Field
            label="손절 %"
            hint={`손절 ${Number.isFinite(draft.hardStopLossPercent) ? draft.hardStopLossPercent : '—'}% — 산 값보다 이만큼 내려가면 바로 판다 (${RULE_LIMITS.hardStopLossPercent.min}~${RULE_LIMITS.hardStopLossPercent.max}).`}
            error={err('hardStopLossPercent')}
          >
            <NumberBox label="손절 %" value={draft.hardStopLossPercent} onChange={(v) => patch({ hardStopLossPercent: v })} />
          </Field>
          <Field
            label="트레일링"
            hint={`산 뒤 가장 높았던 종가보다 이만큼 내려가면 판다 (${RULE_LIMITS.trailingStopPercent.min}~${RULE_LIMITS.trailingStopPercent.max}).`}
            error={err('trailingStopPercent')}
          >
            <label className="inline-flex w-fit items-center gap-1.5 text-xs">
              <input type="checkbox" checked={draft.trailingStopEnabled} onChange={(e) => patch({ trailingStopEnabled: e.target.checked })} /> 켜기
            </label>
            <NumberBox label="트레일링 %" value={draft.trailingStopPercent} disabled={!draft.trailingStopEnabled} onChange={(v) => patch({ trailingStopPercent: v })} />
          </Field>
        </div>
      )}
      {!open && Object.keys(errors).some((k) => k !== 'symbols') && (
        <p className="text-[13px] text-bearish">고칠 칸이 있습니다 — 「자세히」 를 펼쳐 보세요.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-text-primary">기간</span>
        <Segmented label="기간" options={BACKTEST_YEARS.map((y) => ({ value: y, label: `${y}년` }))} value={draft.years} onChange={(v) => patch({ years: v })} />
        <span className="text-[13px] text-text-muted">최근 {draft.years}년(1년씩 나눠 계산), 수수료 왕복 0.30%p 포함, 신호 다음 날 시가에 사고팝니다.</span>
      </div>
    </Panel>
  );
}
