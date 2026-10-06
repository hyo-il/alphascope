import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { useAppStore } from '../../store/appStore';
import { modal, toast } from '../../store/uiStore';
import { autoTradeView } from '../../utils/autoTradeStatus';
import { nearestEngineMa, type AccountStrategy, type AccountStrategyStatus } from '../../types/autoTrading';
import { ruleMethodName, type RuleConditions } from '../../utils/autoTradeExplain';
import { Button, IconButton } from '../ui';
import type { ModalRow } from '../../store/uiStore';

/**
 * [이 조건을 계좌에 적용] (v2.37.0 → v2.38.0) — 백테스트 결과의 조건을 계좌의 규칙형 설정으로.
 *
 * ⚠️ **조건만 저장한다. 대상 종목은 바꾸지 않고, 자동매매를 켜거나 끄지 않는다** — 켜기는 계좌 화면에서 사람이 한다.
 * 저장은 기존 `PUT /api/auto-trading/strategies/:id` 에 `{ mode: 'rule', rule, hardStopLossPercent, trailingStopEnabled, trailingStopPercent }` 만
 * 보낸다(서버 `saveStrategy` 가 지금 설정과 합친다 — 종목·비중·주기·켜짐은 그대로). 새 라우트를 만들지 않는다.
 * 확인 창에는 **바뀌는 것만** "지금 → 바꿀 값" 으로. 켜진 계좌면 다음 판단부터 바로 쓰인다는 사실을 적는다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error((payload.error as string) ?? `요청 실패 (${response.status})`);
  return payload as T;
}

type OverviewItem = { strategy: AccountStrategy; status: AccountStrategyStatus | null };

const onOff = (v: boolean) => (v ? '사용' : '안 씀');

/** 바뀌는 칸만 — 지금 값과 같으면 줄을 만들지 않는다. 이동평균은 판정이 실제로 쓰는 일수로 비교한다 */
export function changeRows(current: AccountStrategy, next: RuleConditions): ModalRow[] {
  const rows: ModalRow[] = [];
  const add = (label: string, a: string, b: string) => a !== b && rows.push({ label, value: `${a} → ${b}` });
  add('판단 방식', current.mode === 'ai' ? 'AI형' : '규칙형', '규칙형');
  const c = current.rule;
  const n = next.rule;
  add('방법', ruleMethodName(c), ruleMethodName(n));
  add('이동평균 교차', onOff(c.useMaCross), onOff(n.useMaCross));
  if (n.useMaCross) add('이동평균(단기·장기)', `${nearestEngineMa(c.maShort)}·${nearestEngineMa(c.maLong)}일`, `${n.maShort}·${n.maLong}일`);
  add('RSI', onOff(c.useRsi), onOff(n.useRsi));
  if (n.useRsi) add('RSI 살 때 · 팔 때', `${c.rsiBuyBelow} · ${c.rsiSellAbove}`, `${n.rsiBuyBelow} · ${n.rsiSellAbove}`);
  add('손절', `${current.hardStopLossPercent}%`, `${next.hardStopLossPercent}%`);
  add(
    '트레일링',
    current.trailingStopEnabled ? `${current.trailingStopPercent}%` : '끔',
    next.trailingStopEnabled ? `${next.trailingStopPercent}%` : '끔',
  );
  return rows;
}

export default function ApplyRuleButton({ conditions }: { conditions: RuleConditions }) {
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
    const rows = changeRows(current, conditions);
    const lines: string[] = [];
    if (!rows.length) lines.push('이 계좌는 이미 같은 조건입니다. 저장해도 바뀌는 것이 없습니다.');
    lines.push('대상 종목은 바꾸지 않습니다.');
    lines.push('자동매매를 켜거나 끄지 않습니다.');
    if (current.enabled) lines.push('이 계좌는 자동매매가 켜져 있어 다음 판단부터 바로 적용됩니다.');
    modal.confirm({
      title: `${name}에 이 조건 적용`,
      rows,
      message: lines.join('\n'),
      confirmText: '적용',
      onConfirm: async () => {
        try {
          // 조건만 보낸다 — 서버가 지금 설정과 합친다(종목·비중·주기·켜짐은 보내지 않는다)
          await json(`/api/auto-trading/strategies/${accountId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              mode: 'rule',
              rule: conditions.rule,
              hardStopLossPercent: conditions.hardStopLossPercent,
              trailingStopEnabled: conditions.trailingStopEnabled,
              trailingStopPercent: conditions.trailingStopPercent,
            }),
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
        이 조건을 계좌에 적용
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="이 조건을 적용할 계좌 고르기"
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-[min(420px,90vw)] rounded-xl bg-bg-secondary p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">이 조건을 적용할 계좌</h3>
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
            <p className="mt-3 text-[13px] text-text-muted">조건(판단 방식·방법 숫자·손절·트레일링)만 저장합니다. 대상 종목은 그대로이고, 자동매매를 켜거나 끄지 않습니다.</p>
          </div>
        </div>
      )}
    </>
  );
}
