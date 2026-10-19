import { useState } from 'react';
import { Button, Dialog, FormRow, NumberField } from '../ui';
import { groupNumber } from '../ui/NumberField';
import { toast } from '../../store/uiStore';
import { CURRENCY_DECIMALS, type CashFlowType, type PaperAccount } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';
import { moveAccountCash } from '../../hooks/usePaperTrading';

const LABEL: Record<CashFlowType, string> = { deposit: '입금', withdraw: '출금' };

/**
 * [입금] · [출금] 창 — 넣고 뺀 만큼 원금(초기 자금)도 함께 바뀐다(서버 `moveCash` — 기록 · 현금 · 원금 한 트랜잭션).
 * 출금할 수 있는 돈 = 현금 − 미체결 매수 주문에 묶인 돈(서버가 계좌 상세의 `withdrawable` 로 준다). 넘으면 버튼을 잠근다.
 * 그 밖의 거절(원금이 0 이하가 되는 출금 등)은 서버 이유 문구를 토스트로 보인다.
 */
export default function CashFlowDialog({
  account,
  type,
  withdrawable,
  onClose,
  onDone,
}: {
  account: PaperAccount;
  type: CashFlowType;
  /** 출금할 수 있는 돈(계좌 통화) — 계좌 상세를 받기 전이면 null */
  withdrawable: number | null;
  onClose: () => void;
  /** 성공한 뒤 — 잔고 · 요약 · 거래 내역을 새로 읽는다 */
  onDone: () => Promise<void> | void;
}) {
  const [raw, setRaw] = useState('');
  const [saving, setSaving] = useState(false);
  const label = LABEL[type];
  const currency = account.currency;
  const unit = currency === 'KRW' ? '원' : '달러';
  const amount = raw === '' ? 0 : Number(raw);
  const over = type === 'withdraw' && withdrawable != null && amount > withdrawable;
  const canSubmit = amount > 0 && !over && !(type === 'withdraw' && withdrawable == null);

  const submit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    try {
      await moveAccountCash(account.id, type, amount);
      await onDone();
      toast.success(`${formatPrice(amount, currency)} ${label}했습니다`, account.name);
      onClose();
    } catch (e) {
      toast.error(`${label}하지 못했습니다`, (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      title={label}
      titleAside={account.name}
      onClose={saving ? undefined : onClose}
      size="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            취소
          </Button>
          <Button busy={saving} variant="primary" onClick={() => void submit()} disabled={saving || !canSubmit}>
            {saving ? `${label} 중…` : label}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3 px-4 py-4 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormRow
          label="금액"
          labelW="sm"
          error={over ? '출금할 수 있는 돈보다 많습니다.' : undefined}
        >
          <NumberField
            kind="long"
            thousands
            decimals={CURRENCY_DECIMALS[currency]}
            unit={unit}
            aria-label={`${label}할 금액`}
            autoFocus
            invalid={over}
            value={raw}
            onValue={setRaw}
          />
        </FormRow>
        {type === 'withdraw' && (
          // 금액 칸과 같은 표기 — 쉼표 숫자 + 단위 열(원 · 달러)
          <FormRow label="출금할 수 있는 돈" labelW="sm" unit={withdrawable == null ? undefined : unit}>
            <span className="block text-right tabular-nums text-text-primary">
              {withdrawable == null ? '확인 중…' : groupNumber(withdrawable.toFixed(CURRENCY_DECIMALS[currency]))}
            </span>
          </FormRow>
        )}
        <p className="leading-relaxed text-text-secondary">
          {label}한 만큼 원금(초기 자금)도 {type === 'deposit' ? '늘어' : '줄어'} 총 손익(금액)은 그대로입니다(수익률 = 총 손익 ÷ 새 원금). 거래 내역에 한 줄로 남습니다.
          {type === 'withdraw' && ' 미체결 매수 주문에 묶인 돈은 뺄 수 없습니다.'}
        </p>
        <p className="text-caption text-text-muted">비교 중인 계좌가 있으면 같은 금액을 넣어야 비교가 맞습니다</p>
      </form>
    </Dialog>
  );
}
