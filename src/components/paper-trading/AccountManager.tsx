import Select from '../ui/Select';
import Button from '../ui/Button';
import TrashIcon from '../common/TrashIcon';
import { useState } from 'react';
import type { PaperAccount } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import CreateAccountForm from './CreateAccountForm';

interface Props {
  accounts: PaperAccount[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (input: { name: string; initialBalance: number }) => Promise<unknown>;
  onReset: (id: number) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}

/** 계좌 선택 · 생성 · 초기화 — 대시보드 상단 줄 */
export default function AccountManager({
  accounts,
  selectedId,
  onSelect,
  onCreate,
  onReset,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  // 되돌릴 수 없는 동작이라 반드시 확인을 받는다.
  const confirmReset = () => {
    if (!selected) return;
    modal.confirm({
      title: '계좌 초기화',
      message: `"${selected.name}" 계좌를 초기화합니다.\n보유 종목·주문·거래 내역이 모두 삭제됩니다. 되돌릴 수 없습니다.`,
      rows: [{ label: '잔고', value: formatPrice(selected.initialBalance, selected.currency) }],
      confirmText: '초기화',
      danger: true,
      onConfirm: async () => {
        await onReset(selected.id);
        toast.success('계좌를 초기화했습니다.', selected.name);
      },
    });
  };

  const confirmDelete = () => {
    if (!selected) return;
    modal.confirm({
      title: '계좌 삭제',
      message: `"${selected.name}" 계좌를 삭제합니다. 보유 종목·주문·거래 내역이 함께 사라집니다.\n되돌릴 수 없습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        await onDelete(selected.id);
        toast.success('계좌를 삭제했습니다.', selected.name);
      },
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <span className="text-xs text-text-secondary">계좌</span>

      <Select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}>
        {!accounts.length && <option value="">계좌 없음</option>}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>

      {selected && (
        <span className="text-xs text-text-muted">
          초기자금{' '}
          <span className="tabular-nums text-text-secondary">
            {formatPrice(selected.initialBalance, selected.currency)}
          </span>
          <span className="mx-1.5 text-border">·</span>
          수수료 {(selected.commissionRate * 100).toFixed(2)}%
          <span className="mx-1.5 text-border">·</span>
          슬리피지 {(selected.slippageRate * 100).toFixed(3)}%
        </span>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="secondary" size="sm"
          onClick={() => setCreating((v) => !v)}>
          + 새 계좌
        </Button>
        {selected && (
          <>
            <Button variant="secondary" size="sm"
              onClick={confirmReset}>
              초기화
            </Button>
            <Button variant="secondary" size="sm"
              onClick={confirmDelete}>
              <TrashIcon className="h-3.5 w-3.5" />
              삭제
            </Button>
          </>
        )}
      </div>

      {creating && (
        <CreateAccountForm
          onCreate={onCreate}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
