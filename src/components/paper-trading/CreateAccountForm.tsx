import { useState } from 'react';
import type { PaperAccount } from '../../types/paper';

export interface CreateAccountInput {
  name: string;
  initialBalance: number;
}

interface Props {
  onCreate: (input: CreateAccountInput) => Promise<unknown>;
  /** 생성 성공 후 — 폼 닫기·목록 새로고침·토스트는 호출부가 맡는다 */
  onDone?: (account: PaperAccount | undefined) => void;
  onCancel?: () => void;
}

const PRESETS = [1_000_000, 10_000_000, 100_000_000];

/**
 * 계좌 생성 폼 — **한 벌만 둔다.**
 *
 * 계좌는 상세 화면(`AccountManager`)과 모아보기 헤더 두 곳에서 만들 수 있는데,
 * 폼을 두 벌로 두면 프리셋·기본값·검증이 갈라져 **어느 화면에서 만들었느냐에 따라
 * 계좌가 달라진다.** 그래서 두 자리가 이 컴포넌트를 공유한다.
 */
export default function CreateAccountForm({ onCreate, onDone, onCancel }: Props) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState(10_000_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      // 이름을 비워 두면 '새 전략' 이다 (기존 동작 그대로).
      const account = await onCreate({ name: name.trim() || '새 전략', initialBalance: balance });
      setName('');
      onDone?.(account as PaperAccount | undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-bg-tertiary/50 px-3 py-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="계좌 이름 (예: 스윙 테스트)"
        className="w-56 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
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
        className="w-36 rounded border border-border bg-bg-tertiary px-2 py-1 text-right text-xs tabular-nums text-text-primary focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        만들기
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-secondary"
        >
          취소
        </button>
      )}
      {error && <span className="text-xs text-bearish">❌ {error}</span>}
    </div>
  );
}
