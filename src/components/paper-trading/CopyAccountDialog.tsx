import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button, Dialog, Input } from '../ui';
import { ICON_SM } from '../ui/icon';
import { toast } from '../../store/uiStore';
import type { PaperAccount } from '../../types/paper';

/**
 * [계좌 복사] 확인 창 (v2.46.0, A-8) — 같은 초기 자금 · 통화 · 수수료 · 매매 규칙 · 대상 종목 · 계좌 운용 · 안전장치 · AI 검증 설정의 새 계좌.
 * 보유 종목·거래 기록은 복사하지 않고 자동매매는 꺼진 채로 만든다(서버 `autoTrading/copy.ts`). 기본 이름은 서버가 정한다(「<이름> 복사본」, 겹치면 「복사본 2」…).
 */
export default function CopyAccountDialog({
  account,
  onClose,
  onCopied,
}: {
  account: PaperAccount;
  onClose: () => void;
  /** 만든 뒤 — 그 새 계좌 화면으로 간다 */
  onCopied: (copy: PaperAccount) => Promise<void> | void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/paper/accounts/${account.id}/copy-name`)
      .then((r) => r.json())
      .then((b: { name?: string }) => !cancelled && setName(b.name ?? `${account.name} 복사본`))
      .catch(() => !cancelled && setName(`${account.name} 복사본`));
    return () => {
      cancelled = true;
    };
  }, [account.id, account.name]);

  const copy = async () => {
    if (!name?.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/paper/accounts/${account.id}/copy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { account?: PaperAccount; error?: string };
      if (!res.ok || !body.account) throw new Error(body.error ?? `복사하지 못했습니다 (${res.status})`);
      await onCopied(body.account);
      toast.success('계좌를 복사했습니다', '비교하려면 한쪽만 AI 검증을 켜세요.');
      onClose();
    } catch (e) {
      toast.error('계좌를 복사하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title="계좌 복사"
      onClose={saving ? undefined : onClose}
      size="md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void copy()} disabled={saving || !name?.trim()}>
            {saving && <LoaderCircle {...ICON_SM} className="mr-1 animate-spin" />}
            {saving ? '복사하는 중…' : '복사'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 px-4 py-4 text-xs">
        <p className="leading-relaxed text-text-secondary">
          「{account.name}」을 복사합니다 — 같은 초기 자금 · 통화 · 수수료 · 매매 규칙 · 대상 종목 · 계좌 운용 · 안전장치 · AI 검증 설정. 보유 종목·거래 기록은
          복사하지 않고, 자동매매는 꺼진 채로 만들어집니다.
        </p>
        <label className="flex items-center gap-3">
          <span className="shrink-0 text-text-secondary">새 이름</span>
          {name == null ? (
            <span className="text-text-muted">불러오는 중…</span>
          ) : (
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="새 계좌 이름" className="min-w-0 flex-1" />
          )}
        </label>
      </div>
    </Dialog>
  );
}
