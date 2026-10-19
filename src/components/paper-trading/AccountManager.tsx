import Select from '../ui/Select';
import Button from '../ui/Button';
import InfoTip from '../ui/InfoTip';
import TrashIcon from '../common/TrashIcon';
import { useState } from 'react';
import type { PaperAccount } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import CreateAccountForm from './CreateAccountForm';
import CopyAccountDialog from './CopyAccountDialog';
import CashFlowDialog from './CashFlowDialog';
import type { CashFlowType } from '../../types/paper';
import { Copy } from 'lucide-react';

interface Props {
  accounts: PaperAccount[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (input: { name: string; initialBalance: number }) => Promise<unknown>;
  onReset: (id: number) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  /** [계좌 복사] 뒤 — 새 계좌 화면으로 */
  onCopied?: (account: PaperAccount) => Promise<void> | void;
  /** 출금할 수 있는 돈(계좌 상세의 `withdrawable`) — 받기 전이면 null */
  withdrawable?: number | null;
  /** [입금] · [출금] 뒤 — 잔고 · 요약 · 거래 내역을 새로 읽는다. 없으면 두 버튼을 그리지 않는다 */
  onCashMoved?: () => Promise<void> | void;
}

/** 계좌 선택 · 생성 · 초기화 — 대시보드 상단 줄 */
export default function AccountManager({
  accounts,
  selectedId,
  onSelect,
  onCreate,
  onReset,
  onDelete,
  onCopied,
  withdrawable = null,
  onCashMoved,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [cashFlow, setCashFlow] = useState<CashFlowType | null>(null);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  // 되돌릴 수 없는 동작이라 반드시 확인을 받는다.
  const confirmReset = () => {
    if (!selected) return;
    modal.confirm({
      title: '계좌 초기화',
      message: `"${selected.name}" 계좌를 초기화합니다.\n보유 종목·주문·거래 내역·입출금 기록이 모두 삭제됩니다. 되돌릴 수 없습니다.`,
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
      message: `"${selected.name}" 계좌를 삭제합니다. 보유 종목·주문·거래 내역·입출금 기록이 함께 사라집니다.\n되돌릴 수 없습니다.`,
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
        </span>
      )}
      {/* 수수료 · 슬리피지는 ⓘ 안 — [입금] · [출금] 이 늘어 1280 에서 줄이 두 줄로 꺾였다 */}
      {selected && (
        <InfoTip label="수수료 · 슬리피지">
          수수료 {(selected.commissionRate * 100).toFixed(2)}% · 슬리피지 {(selected.slippageRate * 100).toFixed(3)}%
        </InfoTip>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="secondary" size="sm"
          onClick={() => setCreating((v) => !v)}>
          + 새 계좌
        </Button>
        {selected && (
          <>
            {/* 같은 설정의 새 계좌 — AI 검증 켠 계좌와 끈 계좌를 같은 조건으로 비교하려고 */}
            {onCopied && (
              <Button variant="secondary" size="sm" icon={Copy}
                onClick={() => setCopying(true)}>
                계좌 복사
              </Button>
            )}
            {/* 넣고 뺀 만큼 원금도 함께 바뀐다(총 손익 그대로) — 「초기화」 옆(사용자 결정) */}
            {onCashMoved && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setCashFlow('deposit')}>
                  입금
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setCashFlow('withdraw')}>
                  출금
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm"
              onClick={confirmReset}>
              초기화
            </Button>
            {/* 화면 안의 삭제 = 빨간 글자(기준표 「버튼」) */}
            <Button variant="danger-text" size="sm"
              onClick={confirmDelete}>
              <TrashIcon className="h-3.5 w-3.5" />
              삭제
            </Button>
          </>
        )}
      </div>

      {copying && selected && onCopied && <CopyAccountDialog account={selected} onClose={() => setCopying(false)} onCopied={onCopied} />}
      {cashFlow && selected && onCashMoved && (
        <CashFlowDialog account={selected} type={cashFlow} withdrawable={withdrawable} onClose={() => setCashFlow(null)} onDone={onCashMoved} />
      )}

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
