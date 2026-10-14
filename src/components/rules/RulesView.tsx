import { useState } from 'react';
import { Copy, Eye, Plus, Trash2 } from 'lucide-react';
import { useTradingRules } from '../../hooks/useTradingRules';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { isUsed, type TradingRule } from '../../types/tradingRule';
import { usageText } from './usage';
import { modal, toast } from '../../store/uiStore';
import { Button, PageHeader } from '../ui';
import { LIST_TABLE_ROW, TABLE_NAME_COL } from '../ui/tokens';
import { SkeletonText } from '../common/SkeletonLoader';
import RuleDialog from './RuleDialog';

/**
 * 「퀀트 > 매매 규칙」 (v2.43.0 — 퀀트 다시 만들기 1단계).
 * 규칙 목록 · 만들기/보기 팝업. ⚠️ 이 단계에서는 매수 판단·계좌·백테스트가 이 규칙을 쓰지 않는다(2·3단계에서 연결).
 */
export default function RulesView() {
  const r = useTradingRules();
  const { accounts } = usePaperAccounts();
  const accountName = (id: number) => accounts.find((a) => a.id === id)?.name ?? `계좌 ${id}`;
  /** 열린 팝업 — 'new' = 새 규칙(빈 규칙), 숫자 = 그 규칙 보기 */
  const [open, setOpen] = useState<'new' | number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const copy = async (rule: TradingRule) => {
    setBusyId(rule.id);
    try {
      await r.copy(rule.id);
    } catch (e) {
      toast.error('복사하지 못했습니다', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = (rule: TradingRule) => {
    const used = isUsed(rule.usedBy);
    const n = rule.usedBy.accounts.length;
    modal.confirm({
      title: '매매 규칙 삭제',
      message: used
        ? `「${rule.name}」 — 계좌 ${n}개가 이 규칙을 씁니다(${usageText(rule.usedBy, accountName)}). 지우면 그 계좌의 자동매매가 꺼집니다.\n되돌릴 수 없습니다.`
        : `「${rule.name}」 규칙을 삭제합니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        try {
          await r.remove(rule.id);
        } catch (e) {
          toast.error('삭제하지 못했습니다', (e as Error).message);
        }
      },
    });
  };

  const openRule = typeof open === 'number' ? r.rules?.find((x) => x.id === open) ?? null : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="매매 규칙"
        right={
          <Button variant="primary" icon={Plus} onClick={() => setOpen('new')} disabled={r.rules == null}>
            새 규칙 만들기
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]">
        <p className="text-xs text-text-secondary">
          매매 규칙은 매수·매도 조건을 담은 묶음입니다. 매수 조건마다 점수를 정하고, 합계가 기준 점수 이상이면 매수합니다.
          <br />
          <span className="text-text-muted">
            지금은 규칙을 만들고 살펴보는 단계입니다 — 매수 판단 도우미·계좌 자동매매·백테스트는 아직 예전 방식 그대로이고, 다음 단계에서 여기 규칙을 골라 쓰게 됩니다.
          </span>
        </p>

        {r.rules == null && !r.error && <SkeletonText lines={3} />}
        {r.error && r.rules == null && (
          <div className="flex items-center gap-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            <span className="min-w-0">매매 규칙을 불러오지 못했습니다 — {r.error}</span>
            <Button size="sm" onClick={() => void r.reload()}>
              다시 시도
            </Button>
          </div>
        )}

        {r.rules?.length === 0 && (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-bg-secondary p-4">
            <p className="text-xs text-text-secondary">매매 규칙이 없습니다. 규칙이 없으면 자동매매가 동작하지 않습니다.</p>
            <Button icon={Plus} onClick={() => setOpen('new')}>
              새 규칙 만들기
            </Button>
          </div>
        )}

        {!!r.rules?.length && (
          <div className="rounded-xl bg-bg-secondary px-4 py-2">
            <table className="w-full text-left text-xs">
              <thead className="text-caption text-text-muted">
                <tr className="border-b border-border/50">
                  <th className={`${TABLE_NAME_COL} py-2 pr-4`}>규칙 이름</th>
                  <th className="whitespace-nowrap py-2 pr-6">적용된 곳</th>
                  <th className="py-2" aria-label="동작" />
                </tr>
              </thead>
              <tbody>
                {r.rules.map((rule) => (
                  <tr key={rule.id} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW}`}>
                    <td className="max-w-0 py-1 pr-4">
                      <span className="block truncate font-medium text-text-primary" title={rule.name}>
                        {rule.name}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-1 pr-6 text-text-secondary">{usageText(rule.usedBy, accountName)}</td>
                    <td className="py-1">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" icon={Eye} onClick={() => setOpen(rule.id)}>
                          조건 보기
                        </Button>
                        <Button size="sm" icon={Copy} onClick={() => void copy(rule)} disabled={busyId === rule.id}>
                          {busyId === rule.id ? '복사 중…' : '복사'}
                        </Button>
                        <Button size="sm" variant="danger-text" icon={Trash2} onClick={() => confirmRemove(rule)}>
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open === 'new' && (
        <RuleDialog
          rule={null}
          onClose={() => setOpen(null)}
          onSave={async (name, body) => {
            const saved = await r.create(name, body);
            setOpen(saved.id);
          }}
          accountName={accountName}
        />
      )}
      {openRule && (
        <RuleDialog
          key={openRule.id}
          rule={openRule}
          onClose={() => setOpen(null)}
          onSave={async (name, body) => {
            await r.update(openRule.id, name, body);
          }}
          accountName={accountName}
        />
      )}
    </div>
  );
}
