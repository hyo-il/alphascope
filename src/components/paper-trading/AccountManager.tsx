import { useState } from 'react';
import type { PaperAccount } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';

interface Props {
  accounts: PaperAccount[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: (input: { name: string; initialBalance: number }) => Promise<unknown>;
  onReset: (id: number) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
}

const PRESETS = [1_000_000, 10_000_000, 100_000_000];

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
  const [name, setName] = useState('');
  const [balance, setBalance] = useState(10_000_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim() || '새 전략', initialBalance: balance });
      setCreating(false);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async () => {
    if (!selected) return;
    // 되돌릴 수 없는 동작이라 반드시 확인을 받는다.
    if (
      !window.confirm(
        `"${selected.name}" 계좌를 초기화합니다.\n보유 종목·주문·거래 내역이 모두 삭제되고 잔고가 ${formatPrice(selected.initialBalance, selected.currency)} 로 돌아갑니다.\n\n진행할까요?`,
      )
    )
      return;
    await onReset(selected.id);
  };

  const confirmDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`"${selected.name}" 계좌를 삭제합니다. 되돌릴 수 없습니다.\n\n진행할까요?`))
      return;
    await onDelete(selected.id);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
      <span className="text-xs text-text-secondary">계좌</span>

      <select
        value={selectedId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
        className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        {!accounts.length && <option value="">계좌 없음</option>}
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>

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
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          + 새 계좌
        </button>
        {selected && (
          <>
            <button
              type="button"
              onClick={() => void confirmReset()}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-warning"
            >
              🔄 초기화
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
            >
              삭제
            </button>
          </>
        )}
      </div>

      {creating && (
        <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-bg-tertiary/50 px-3 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="계좌 이름 (예: 스윙 테스트)"
            className="w-56 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          <span className="text-xs text-text-muted">초기 자금</span>
          {PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setBalance(value)}
              className={`rounded px-2 py-1 text-xs transition-colors ${
                balance === value
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-text-secondary hover:bg-bg-tertiary'
              }`}
            >
              {(value / 10_000).toLocaleString('ko-KR')}만
            </button>
          ))}
          <input
            type="number"
            value={balance}
            onChange={(e) => setBalance(Number(e.target.value))}
            className="w-36 rounded border border-border bg-bg-primary px-2 py-1 text-right text-xs tabular-nums text-text-primary focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            만들기
          </button>
          {error && <span className="text-xs text-bearish">❌ {error}</span>}
        </div>
      )}
    </div>
  );
}
