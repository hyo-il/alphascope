import { useState } from 'react';
import { Button, Dialog, NumberField } from '../ui';
import { groupNumber } from '../ui/NumberField';
import { toast } from '../../store/uiStore';
import { CASH_MAX, CURRENCY_DECIMALS, type CashFlowType, type PaperAccount } from '../../types/paper';
import { formatPrice } from '../../utils/formatters';
import { moveAccountCash } from '../../hooks/usePaperTrading';

const LABEL: Record<CashFlowType, string> = { deposit: '입금', withdraw: '출금' };

/**
 * [입금] · [출금] 창 — 넣고 뺀 만큼 원금(초기 자금)도 함께 바뀐다(서버 `moveCash` — 기록 · 현금 · 원금 한 트랜잭션).
 * 창은 금액 칸 하나(설명 문구 없음 — 사용자 결정) + 출금이면 「출금할 수 있는 돈」 한 줄. 금액은 `CASH_MAX` 보다 큰 수가 쳐지지 않는다.
 * 출금할 수 있는 돈 = min(주문 가능 금액, 원금 − 최소 단위)(서버가 계좌 상세의 `withdrawable` 로 준다). 넘으면 버튼을 잠근다.
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
        {/* 간단한 입력 — 금액 칸 하나(창 너비에 꽉 차게, 사용자 결정). 상한(CASH_MAX)보다 큰 수는 쳐지지 않는다 */}
        <div className="flex items-center gap-1.5">
          <NumberField
            thousands
            decimals={CURRENCY_DECIMALS[currency]}
            max={CASH_MAX[currency]}
            maxText={`최대 ${formatPrice(CASH_MAX[currency], currency)}`}
            className="flex-1"
            aria-label={`${label}할 금액`}
            autoFocus
            invalid={over}
            value={raw}
            onValue={setRaw}
          />
          <span className="shrink-0 text-caption text-text-muted">{unit}</span>
        </div>
        {over && <p className="text-caption text-danger">출금할 수 있는 돈보다 많습니다.</p>}
        {type === 'withdraw' && (
          // 숫자 정보라 남긴다 — 금액 칸과 같은 표기(쉼표 숫자 + 단위), 오른쪽 끝을 금액 칸 단위에 맞춘다
          <p className="flex items-center justify-between gap-2">
            <span className="text-text-secondary">출금할 수 있는 돈</span>
            <span className="tabular-nums text-text-primary">
              {withdrawable == null ? '확인 중…' : `${groupNumber(withdrawable.toFixed(CURRENCY_DECIMALS[currency]))} ${unit}`}
            </span>
          </p>
        )}
      </form>
    </Dialog>
  );
}
