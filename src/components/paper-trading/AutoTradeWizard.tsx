import { ICON_SM } from '../ui/icon';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AccountStrategy, StrategyMode } from '../../types/autoTrading';
import type { AccountOverviewItem, StrategyOverviewItem } from '../../hooks/usePaperOverview';
import CreateAccountForm, { type CreateAccountInput } from './CreateAccountForm';
import ModePicker from './ModePicker';
import RuleChoices, { matchChoice, RULE_CHOICES } from './RuleChoices';
import TargetSymbolsEditor from './TargetSymbolsEditor';
import AutoTradeSettings from './AutoTradeSettings';
import { toast } from '../../store/uiStore';

/**
 * 자동매매 **처음 켜기** 4단계 안내 (v2.32.0) — 계좌 → 방식 → 종목 → 확인.
 *
 * ⚠️ 새 화면 부품을 만들지 않았다 — 계좌 생성 `CreateAccountForm`, 방식 `ModePicker` + `RuleChoices`(10차 쉬운 선택지·과거 1년),
 * 종목 `TargetSymbolsEditor`, 숫자 `AutoTradeSettings` 를 그대로 쓴다(두 벌이면 갈라진다).
 * ⚠️ **새 기본값을 만들지 않는다** — 설정은 서버에서 그 계좌의 값(새 계좌면 `defaultStrategy()`)을 읽어 출발하고,
 * 확인 화면의 숫자도 **저장될 그 값**에서 읽는다(화면용 숫자를 따로 두지 않는다).
 * ⚠️ [켜기] 전에는 아무것도 저장하지 않는다(새 계좌를 만들었다면 계좌만 남는다 — 닫을 때 알린다).
 * [켜기] 는 설정 창·자동매매 바와 **같은 저장 경로·같은 가드**(종목 0개 · 키 없는 AI형이면 켜지 않는다)다.
 */

type Step = 1 | 2 | 3 | 4;
const STEP_LABEL: Record<Step, string> = { 1: '계좌', 2: '방식', 3: '종목', 4: '확인' };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `요청 실패 (${res.status})`);
  return body as T;
}

const intervalText = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60}시간` : `${minutes}분`;

export default function AutoTradeWizard({
  accounts,
  strategies,
  geminiEnabled,
  onCreateAccount,
  onDone,
  onClose,
}: {
  accounts: AccountOverviewItem[];
  strategies: StrategyOverviewItem[];
  geminiEnabled: boolean;
  /** 계좌 생성 — 모아보기 헤더와 같은 `usePaperAccounts().create` */
  onCreateAccount: (input: CreateAccountInput) => Promise<unknown>;
  /** 켜기 성공 — 그 계좌 상세로 간다 */
  onDone: (accountId: number) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [choice, setChoice] = useState<'new' | 'existing'>('new');
  /** 이 안내에서 새로 만든 계좌 — 닫을 때 "계좌는 남는다" 를 알리는 데 쓴다 */
  const [created, setCreated] = useState<{ id: number; name: string } | null>(null);
  const [existingId, setExistingId] = useState<number | null>(accounts[0]?.account.id ?? null);
  /** 이미 켜진 계좌를 골랐을 때 한 번 더 누른 것 */
  const [overrideOk, setOverrideOk] = useState(false);
  const [draft, setDraft] = useState<AccountStrategy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  const accountId = choice === 'new' ? (created?.id ?? null) : existingId;
  const accountName =
    choice === 'new' ? created?.name : accounts.find((a) => a.account.id === existingId)?.account.name;
  const running = strategies.find((s) => s.strategy.accountId === accountId)?.strategy;
  const runningWarn = choice === 'existing' && running?.enabled ? running : null;

  // 계좌가 정해지면 그 계좌의 **저장된 설정**을 읽어 출발한다(새 계좌면 서버의 기본값)
  useEffect(() => {
    setDraft(null);
    setLoadError(null);
    setOverrideOk(false);
    if (!accountId) return;
    let alive = true;
    json<{ strategy: AccountStrategy }>(`/api/auto-trading/strategies/${accountId}`)
      .then((d) => alive && setDraft(d.strategy))
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [accountId]);

  const patch = (change: Partial<AccountStrategy>) => setDraft((prev) => (prev ? { ...prev, ...change } : prev));
  const pickMode = (mode: StrategyMode) => {
    if (mode === 'ai' && !geminiEnabled) return;
    patch({ mode });
  };

  const canNext =
    step === 1
      ? Boolean(accountId && draft) && (!runningWarn || overrideOk)
      : step === 2
        ? Boolean(draft) && (draft!.mode === 'rule' || geminiEnabled)
        : step === 3
          ? (draft?.symbols.length ?? 0) > 0
          : false;

  const turnOn = async () => {
    if (!draft || !accountId) return;
    // 자동매매 바·모아보기 카드와 같은 가드
    if (draft.symbols.length === 0) {
      toast.warning('대상 종목이 없습니다', '3단계에서 종목을 담아 주세요');
      setStep(3);
      return;
    }
    if (draft.mode === 'ai' && !geminiEnabled) {
      toast.warning('Gemini 키가 설정되지 않았습니다', '규칙형으로 바꾸면 키 없이 동작합니다');
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      await json(`/api/auto-trading/strategies/${accountId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...draft, enabled: true }),
      });
      toast.success('자동매매를 켰습니다', accountName);
      onDone(accountId);
    } catch (e) {
      toast.error('켜지 못했습니다', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestClose = () => {
    if (created && !closing) {
      setClosing(true);
      return;
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[min(640px,85vh)] w-[min(720px,90vw)] flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl">
        {/* 머리줄 — 단계 표시 1/4 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">자동매매 처음 켜기</h2>
          <span className="text-[13px] text-text-muted">
            {step}/4 · {STEP_LABEL[step]}
          </span>
          <ol className="ml-2 flex items-center gap-1 text-[13px]">
            {([1, 2, 3, 4] as Step[]).map((n) => (
              <li
                key={n}
                className={`rounded px-1.5 py-0.5 ${
                  n === step ? 'bg-bg-elevated font-medium text-text-primary' : n < step ? 'text-text-secondary' : 'text-text-muted'
                }`}
              >
                {n < step ? <Check {...ICON_SM} className="inline-block align-[-2px]" /> : `${n}.`} {STEP_LABEL[n]}
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={requestClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {loadError && <p className="text-[13px] text-bearish">설정을 불러오지 못했습니다: {loadError}</p>}

          {step === 1 && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-text-primary">어느 계좌로 돌릴까요?</h3>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['new', '새 모의 계좌 만들기', '지금 계좌와 나란히 비교하려면 새 계좌가 좋습니다'],
                    ['existing', '있는 계좌 고르기', '이미 만든 모의 계좌에서 돌립니다'],
                  ] as const
                ).map(([id, title, desc]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setChoice(id)}
                    aria-pressed={choice === id}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      choice === id ? 'border-text-secondary/70 bg-bg-tertiary' : 'border-border/50 hover:border-text-muted'
                    }`}
                  >
                    <p className={`text-xs font-medium text-text-primary`}>{title}</p>
                    <p className="mt-0.5 text-[13px] text-text-muted">{desc}</p>
                  </button>
                ))}
              </div>

              {choice === 'new' &&
                (created ? (
                  <p className="rounded-lg bg-bullish/10 px-3 py-2 text-[13px] text-text-primary">
                    「{created.name}」 계좌를 만들었습니다. [다음] 으로 넘어가세요.
                  </p>
                ) : (
                  <CreateAccountForm
                    onCreate={onCreateAccount}
                    onDone={(account) => {
                      if (account) setCreated({ id: account.id, name: account.name });
                    }}
                  />
                ))}

              {choice === 'existing' && (
                <div className="space-y-2">
                  {accounts.length === 0 && <p className="text-[13px] text-text-muted">계좌가 없습니다 — 새 계좌를 만들어 주세요.</p>}
                  {accounts.map((a) => {
                    const st = strategies.find((s) => s.strategy.accountId === a.account.id)?.strategy;
                    return (
                      <label key={a.account.id} className="flex w-fit items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="radio"
                          name="wizard-account"
                          checked={existingId === a.account.id}
                          onChange={() => setExistingId(a.account.id)}
                        />
                        <span className="text-text-primary">{a.account.name}</span>
                        <span className="text-text-muted">
                          {st?.enabled ? `자동매매 켜짐 · ${st.mode === 'ai' ? 'AI형' : '규칙형'}` : '자동매매 꺼짐'}
                        </span>
                      </label>
                    );
                  })}
                  {/* ⚠️ 돌고 있는 계좌를 실수로 바꾸지 않게 한 번 더 누르게 한다 */}
                  {runningWarn && (
                    <div className="space-y-1.5 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
                      <p>
                        이 계좌는 지금 <b>{runningWarn.mode === 'ai' ? 'AI형' : '규칙형'}</b>으로 돌고 있습니다. 바꾸면 기존 방식이
                        멈춥니다.
                      </p>
                      {!overrideOk ? (
                        <button
                          type="button"
                          onClick={() => setOverrideOk(true)}
                          className="rounded border border-warning px-2 py-0.5 text-warning hover:bg-warning/10"
                        >
                          이 계좌로 계속
                        </button>
                      ) : (
                        <p className="text-text-secondary">이 계좌로 계속합니다 — [켜기] 를 누르기 전까지는 바뀌지 않습니다.</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {step === 2 && draft && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-text-primary">어떤 방식으로 판단할까요?</h3>
              <ModePicker mode={draft.mode} onMode={pickMode} geminiEnabled={geminiEnabled} />
              {draft.mode === 'rule' && (
                <RuleChoices
                  rule={draft.rule}
                  onChange={(rule) => patch({ rule })}
                  symbols={draft.symbols}
                  hardStopLossPercent={draft.hardStopLossPercent}
                  trailingStopEnabled={draft.trailingStopEnabled}
                  trailingStopPercent={draft.trailingStopPercent}
                />
              )}
            </section>
          )}

          {step === 3 && draft && (
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-text-primary">
                어떤 종목을 볼까요? <span className="font-normal text-text-muted">({draft.symbols.length}개)</span>
              </h3>
              <TargetSymbolsEditor
                symbols={draft.symbols}
                onChange={(symbols) => patch({ symbols })}
                maxPositions={draft.maxPositions}
                marketHoursOnly={draft.marketHoursOnly}
              />
            </section>
          )}

          {step === 4 && draft && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold text-text-primary">이렇게 켭니다</h3>
              <ul className="space-y-1 rounded-lg bg-bg-tertiary/30 px-3 py-2 text-xs text-text-primary">
                <li>계좌: {accountName}</li>
                <li>
                  방식: {draft.mode === 'ai' ? 'AI형' : '규칙형'}
                  {draft.mode === 'rule' &&
                    ` 「${RULE_CHOICES.find((c) => c.id === matchChoice(draft.rule))?.title ?? '직접 설정'}」`}{' '}
                  · 대상 {draft.symbols.length}종목
                </li>
              </ul>
              {/* 숫자는 저장될 설정(draft — 서버가 준 값에서 출발)에서 그대로 읽는다 */}
              <p className="text-xs leading-relaxed text-text-secondary">
                한 종목에 계좌의 <b className="text-text-primary">{draft.positionSizePercent}%</b>까지만 삽니다 · 동시에 최대{' '}
                <b className="text-text-primary">{draft.maxPositions}종목</b> · 산 값보다{' '}
                <b className="text-text-primary">{draft.hardStopLossPercent}%</b> 떨어지면 바로 팝니다 ·{' '}
                {draft.earningsBlackoutDays > 0 ? (
                  <>
                    실적 발표 <b className="text-text-primary">{draft.earningsBlackoutDays}거래일</b> 전부터는 새로 사지 않습니다 ·{' '}
                  </>
                ) : (
                  '실적 발표와 상관없이 삽니다 · '
                )}
                <b className="text-text-primary">{intervalText(draft.intervalMinutes)}</b>마다 판단합니다
                {draft.marketHoursOnly ? '(미국 정규장)' : '(시간 제한 없음)'}.
                {draft.trailingStopEnabled && ` 가장 높았던 값보다 ${draft.trailingStopPercent}% 내려오면 팝니다.`}
                {draft.dailyLossLimitPercent > 0 &&
                  ` 하루에 계좌가 ${draft.dailyLossLimitPercent}% 넘게 줄면 그날은 새로 사지 않습니다.`}
              </p>
              {/* ⚠️ 고정 문구 — 지우지 않는다 */}
              <p className="rounded-md bg-warning/10 px-3 py-1.5 text-[13px] text-warning">모의투자입니다 — 실제 돈은 움직이지 않습니다.</p>
              <p className="rounded-md bg-warning/10 px-3 py-1.5 text-[13px] text-warning">
                어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.
              </p>
              <button
                type="button"
                onClick={() => setDetailOpen(true)}
                className="rounded-md bg-bg-tertiary px-3 py-1 text-[13px] text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
              >
                자세한 설정 열기
              </button>
            </section>
          )}
        </div>

        {/* 닫기 확인 — 새 계좌는 이미 만들어졌다 */}
        {closing && created && (
          <div className="flex shrink-0 items-center gap-2 border-t border-warning/40 bg-warning/10 px-4 py-2 text-[13px] text-warning">
            <span className="min-w-0">
              새 계좌 「{created.name}」 는 이미 만들어져 남습니다. 자동매매 설정은 저장하지 않고 닫을까요?
            </span>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 whitespace-nowrap ml-auto rounded border border-warning px-2 py-0.5 hover:bg-warning/10"
            >
              닫기
            </button>
            <button
              type="button"
              onClick={() => setClosing(false)}
              className="shrink-0 whitespace-nowrap rounded bg-bg-tertiary px-2 py-0.5 text-text-secondary hover:bg-bg-elevated"
            >
              계속하기
            </button>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="min-w-0 text-[13px] text-text-muted">
            자동매매 설정은 [켜기] 를 눌러야 저장됩니다{created ? ' (새 계좌는 만들 때 바로 생겼습니다)' : ''}.
          </span>
          <button
            type="button"
            onClick={requestClose}
            className="shrink-0 whitespace-nowrap ml-auto rounded-md bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            취소
          </button>
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as Step)}
              className="shrink-0 whitespace-nowrap rounded-md bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
            >
              이전
            </button>
          )}
          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s + 1) as Step)}
              disabled={!canNext}
              className="shrink-0 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void turnOn()}
              disabled={busy || !draft}
              className="shrink-0 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? '켜는 중…' : '켜기'}
            </button>
          )}
        </div>
      </div>

      {detailOpen && draft && (
        <AutoTradeSettings
          strategy={draft}
          geminiEnabled={geminiEnabled}
          onSave={async (next) => {
            const merged = { ...draft, ...next };
            setDraft(merged);
            return merged;
          }}
          onClose={() => setDetailOpen(false)}
          doneMessage="안내에 반영했습니다 — [켜기] 를 눌러야 저장됩니다"
          saveLabel="안내에 반영"
        />
      )}
    </div>
  );
}
