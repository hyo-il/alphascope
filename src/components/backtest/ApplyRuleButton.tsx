import Dialog from '../ui/Dialog';
import { useEffect, useState } from 'react';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { useAppStore } from '../../store/appStore';
import { modal, toast } from '../../store/uiStore';
import { autoTradeView } from '../../utils/autoTradeStatus';
import type { AccountStrategy, AccountStrategyStatus } from '../../types/autoTrading';
import type { TradingRule } from '../../types/tradingRule';
import { methodName, type BacktestCondition, type ConditionLabel } from '../../types/backtest';
import { Button, Segmented } from '../ui';

/**
 * [계좌에 적용] — 시험한 방법의 **매매 규칙**을 계좌의 「① 매매 규칙」 으로 넣는다.
 *
 * ⚠️ **규칙만 바꾼다. 대상 종목은 바꾸지 않고, 자동매매를 켜거나 끄지 않는다** — 켜기는 계좌 화면에서 사람이 한다.
 * 저장은 기존 `PUT /api/auto-trading/strategies/:id` 에 `{ ruleId }` 만 보낸다(서버가 지금 설정과 합친다).
 * 확인 창은 "지금 규칙 → 바꿀 규칙". 켜진 계좌면 다음 판단부터 바로 쓰인다는 사실을 적는다.
 * 시험 뒤 그 규칙이 지워졌으면 적용할 수 없다(이유를 보인다). 시험 뒤 규칙이 바뀌었으면 "지금 내용이 들어간다" 를 적는다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error((payload.error as string) ?? `요청 실패 (${response.status})`);
  return payload as T;
}

type OverviewItem = { strategy: AccountStrategy; status: AccountStrategyStatus | null };

/** 시험 당시 내용과 지금 규칙 내용이 같은가 */
export const sameRuleBody = (a: TradingRule, b: BacktestCondition) =>
  JSON.stringify({ buy: a.buy, sell: a.sell, reentryWaitDays: a.reentryWaitDays }) ===
  JSON.stringify({ buy: b.rule.buy, sell: b.rule.sell, reentryWaitDays: b.rule.reentryWaitDays });

/** 방법이 여럿이면 창 맨 위에서 **어느 방법인지 먼저 고른다**. 하나면 고르는 줄이 없다 */
export default function ApplyRuleButton({ options, rules }: { options: BacktestCondition[]; rules: TradingRule[] | null }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState<ConditionLabel>(options[0]?.label ?? 'A');
  const condition = options.find((o) => o.label === label) ?? options[0];
  const current = rules?.find((r) => r.id === condition.ruleId) ?? null;
  const { accounts, loading } = usePaperAccounts();
  const [overview, setOverview] = useState<OverviewItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const setPage = useAppStore((s) => s.setPage);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    json<{ items: OverviewItem[] }>('/api/auto-trading/overview')
      .then((d) => alive && setOverview(d.items))
      .catch(() => alive && setOverview([]));
    return () => {
      alive = false;
    };
  }, [open]);

  const itemOf = (id: number) => overview?.find((x) => x.strategy.accountId === id) ?? null;
  const nameOfRule = (id: number | null) => (id == null ? '없음' : (rules?.find((r) => r.id === id)?.name ?? '지워진 규칙'));

  const pick = (accountId: number, name: string) => {
    if (!current) return;
    setOpen(false);
    const item = itemOf(accountId);
    const before = item?.strategy.ruleId ?? null;
    // 이미 같은 규칙이면 실행 버튼 없이 알리기만 한다(바뀌는 것이 없는데 [적용] 을 권하지 않는다)
    if (before === current.id) {
      modal.alert({ title: `${name} — 이미 이 규칙을 씁니다`, message: `이 계좌는 이미 규칙 「${current.name}」 을 씁니다. 바뀌는 것이 없습니다.`, confirmText: '닫기' });
      return;
    }
    const lines: string[] = [];
    if (!sameRuleBody(current, condition)) lines.push('시험한 뒤 이 규칙의 내용이 바뀌었습니다 — 지금 내용이 쓰입니다.');
    lines.push('대상 종목은 바꾸지 않습니다.');
    lines.push('자동매매를 켜거나 끄지 않습니다.');
    if (item?.strategy.enabled) lines.push('이 계좌는 자동매매가 켜져 있어 다음 판단부터 바로 쓰입니다.');
    modal.confirm({
      title: `${name}에 규칙 적용`,
      rows: [{ label: '매매 규칙', value: `「${nameOfRule(before)}」 → 「${current.name}」` }],
      message: lines.join('\n'),
      confirmText: '적용',
      onConfirm: async () => {
        setBusy(true);
        try {
          await json(`/api/auto-trading/strategies/${accountId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ruleId: current.id }),
          });
          toast.success(`${name}에 적용했습니다. 자동매매 켜기는 계좌 화면에서 합니다.`);
        } catch (e) {
          toast.error('적용하지 못했습니다', (e as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <>
      <Button busy={busy} size="sm" onClick={() => setOpen(true)} disabled={busy}>
        {busy ? '적용 중…' : '계좌에 적용'}
      </Button>
      {open && (
        <Dialog title="이 규칙을 적용할 계좌" onClose={() => setOpen(false)} size="sm" z={90}>
          {options.length > 1 && (
            <div className="mb-3 space-y-1.5">
              <Segmented
                label="적용할 방법"
                options={options.map((o) => ({ value: o.label, label: methodName(o.label) }))}
                value={label}
                onChange={setLabel}
              />
            </div>
          )}
          <p className="mb-3 text-caption text-text-secondary">규칙 「{condition.ruleName}」</p>
          {!current ? (
            <p className="text-caption text-warning">이 규칙은 시험한 뒤 지워져 계좌에 넣을 수 없습니다. 「퀀트 &gt; 매매 규칙」 에서 다시 만드세요.</p>
          ) : loading && !accounts.length ? (
            <p className="text-caption text-text-muted">계좌를 불러오는 중…</p>
          ) : accounts.length === 0 ? (
            <div className="space-y-3 text-caption text-text-secondary">
              <p>계좌 관리에서 먼저 계좌를 만들어 주세요.</p>
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setPage('portfolio', 'paper');
                }}
              >
                계좌 관리로
              </Button>
            </div>
          ) : (
            <ul className="space-y-1">
              {accounts.map((a) => {
                const item = itemOf(a.id);
                const view = item ? autoTradeView(item.strategy, item.status) : null;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => pick(a.id, a.name)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-caption transition-colors hover:bg-bg-tertiary"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{a.name}</span>
                      <span className="shrink-0 text-text-secondary">
                        {item ? `규칙 「${nameOfRule(item.strategy.ruleId)}」` : '…'}
                        {view ? ` · 자동매매 ${view.short}` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-caption text-text-muted">매매 규칙만 바꿉니다. 대상 종목은 그대로이고, 자동매매를 켜거나 끄지 않습니다.</p>
        </Dialog>
      )}
    </>
  );
}
