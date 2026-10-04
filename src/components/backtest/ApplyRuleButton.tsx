import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { useAppStore } from '../../store/appStore';
import { modal, toast } from '../../store/uiStore';
import { autoTradeView } from '../../utils/autoTradeStatus';
import { RULE_CHOICES, type RuleChoice } from '../../types/ruleChoices';
import type { AccountStrategy, AccountStrategyStatus } from '../../types/autoTrading';
import { Button, IconButton } from '../ui';
import { STOP_LOSS_TESTED } from './constants';

/**
 * [이 방법을 계좌에 적용] (v2.37.0) — 백테스트 결과에서 바로 계좌의 규칙형 설정으로.
 *
 * ⚠️ **저장만 한다. 자동매매를 켜거나 끄지 않는다** — 켜기는 계좌 화면에서 사람이 한다.
 * 저장은 기존 `PUT /api/auto-trading/strategies/:id` — 그 계좌의 지금 설정을 읽어 **`mode: 'rule'` 과 `rule` 의 방법 값만** 바꿔 보낸다
 * (대상 종목·손절·트레일링·켜짐 상태·주기 등은 그대로). 새 라우트를 만들지 않는다.
 * 켜진 계좌면 다음 판단부터 바로 쓰이므로 확인 창에 그 사실을 적는다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error((payload.error as string) ?? `요청 실패 (${response.status})`);
  return payload as T;
}

type OverviewItem = { strategy: AccountStrategy; status: AccountStrategyStatus | null };

export default function ApplyRuleButton({ choiceId }: { choiceId: RuleChoice['id'] }) {
  const choice = RULE_CHOICES.find((c) => c.id === choiceId)!;
  const [open, setOpen] = useState(false);
  const { accounts, loading } = usePaperAccounts();
  const [overview, setOverview] = useState<OverviewItem[] | null>(null);
  const setPage = useAppStore((s) => s.setPage);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    json<{ items: OverviewItem[] }>('/api/auto-trading/overview')
      .then((d) => alive && setOverview(d.items))
      .catch(() => alive && setOverview([]));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const itemOf = (id: number) => overview?.find((x) => x.strategy.accountId === id) ?? null;

  const pick = async (accountId: number, name: string) => {
    setOpen(false);
    let current: AccountStrategy;
    try {
      current = (await json<{ strategy: AccountStrategy }>(`/api/auto-trading/strategies/${accountId}`)).strategy;
    } catch (e) {
      toast.error('계좌 설정을 읽지 못했습니다', (e as Error).message);
      return;
    }
    const lines: string[] = [];
    lines.push(current.mode === 'ai' ? '판단 방식: AI형 → 규칙형으로 바뀝니다.' : '판단 방식: 규칙형(그대로)');
    lines.push(`사고파는 조건: 산다 — ${choice.buy} / 판다 — ${choice.sell}`);
    if (current.hardStopLossPercent !== STOP_LOSS_TESTED) {
      lines.push(`이 계좌의 손절은 ${current.hardStopLossPercent}% 입니다. 백테스트는 ${STOP_LOSS_TESTED}% 로 계산했습니다.`);
    }
    if (current.enabled) lines.push('이 계좌는 자동매매가 켜져 있어 다음 판단부터 바로 적용됩니다.');
    lines.push('자동매매를 켜거나 끄지 않습니다. 대상 종목·손절·트레일링 등 다른 설정은 그대로입니다.');
    modal.confirm({
      title: `${name}에 '${choice.title}' 적용`,
      message: lines.join('\n'),
      confirmText: '적용',
      onConfirm: async () => {
        try {
          // 방법 값만 바꾼다 — rule 의 나머지 칸(있다면)과 다른 설정은 지금 값 그대로
          await json(`/api/auto-trading/strategies/${accountId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode: 'rule', rule: { ...current.rule, ...choice.rule } }),
          });
          toast.success(`${name}에 적용했습니다. 자동매매 켜기는 계좌 화면에서 합니다.`);
        } catch (e) {
          toast.error('적용하지 못했습니다', (e as Error).message);
        }
      },
    });
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        이 방법을 계좌에 적용
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`'${choice.title}' 을 적용할 계좌 고르기`}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-[min(420px,90vw)] rounded-xl bg-bg-secondary p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">'{choice.title}' 을 적용할 계좌</h3>
              <IconButton icon={X} label="닫기" size="sm" className="ml-auto" onClick={() => setOpen(false)} />
            </div>
            {loading && !accounts.length ? (
              <p className="text-[13px] text-text-muted">계좌를 불러오는 중…</p>
            ) : accounts.length === 0 ? (
              <div className="space-y-3 text-[13px] text-text-secondary">
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
                        onClick={() => void pick(a.id, a.name)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors hover:bg-bg-tertiary"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{a.name}</span>
                        <span className="shrink-0 text-text-secondary">
                          {item ? (item.strategy.mode === 'ai' ? 'AI형' : '규칙형') : '…'}
                          {view ? ` · 자동매매 ${view.short}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-[13px] text-text-muted">규칙형 설정만 저장합니다. 자동매매를 켜거나 끄지 않습니다.</p>
          </div>
        </div>
      )}
    </>
  );
}
