import { useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button, Dialog, DialogCancel, FieldError, FieldTouch, FormRow, ICON_SM, Input, NumberField, NumberUnitGroup, Segmented } from '../ui';
import { modal } from '../../store/uiStore';
import { formatAssetWon, formatAssetWonSigned } from '../../utils/assetFormat';
import AssetCashAccountPicker from './AssetCashAccountPicker';
import {
  ASSET_CASH_MANUAL_KINDS,
  ASSET_CASH_MANUAL_LABEL,
  ASSET_CASH_MAX,
  ASSET_CASH_MEMO_MAX,
  cashBankGroups,
  cashKeysOfRows,
  type AssetCashBankFix,
  type AssetCashKey,
  type AssetCashManualKind,
  type AssetCashManualRequest,
  type AssetCashManualResult,
  type AssetCashRow,
  type AssetCashRowOption,
} from '../../types/asset';

/**
 * 「입출금」 창(v2.72.0 · 143차 — 사용자 결정 2026-11-17) — 자산 현황 계좌 머리 「예수금 ₩…」 옆 · 「현금 합계」 상품 줄 옆 [입출금] 이 연다.
 * - 맨 위 묶음 버튼 「이체 | 입금 | 출금」(처음 = 이체 · 계좌 관리 「입금 · 출금」 과 같은 말).
 *   이체 = 「[빠지는 계좌 ▾] → [들어가는 계좌 ▾]」(총 자산 그대로) · 입금 = 「밖에서 → [들어가는 계좌 ▾]」 · 출금 = 「[빠지는 계좌 ▾] → 밖으로」.
 *   계좌 고르기는 공용 `AssetCashAccountPicker`(은행별 묶음 — `cashBankGroups` 한 곳) · 처음 값 = 연 자리의 계좌(`initial` · 예수금 머리 = 들어가는 쪽 · 상품 줄 = 빠지는 쪽).
 * - 계좌 아래에 지금 금액 → 바뀐 뒤 금액(이미 받은 「현금」 탭 값 — 구글 요청 없음) · 빠지는 계좌가 마이너스가 되면 [저장] 전에 확인 창(142차 `askCashMinus` 와 같은 모양).
 * - 빨간 표시는 141차 규칙(`ui/fieldReveal` — 칸을 건드리고 떠난 뒤 · [저장] 을 누른 뒤) · 메모는 선택 칸(40자).
 * - 저장은 `POST /api/asset/cash/manual`(부르는 쪽 `onSend`) · 요청 번호는 보내는 내용이 같으면 같은 번호(두 번 눌러도 · 응답이 끊겨 다시 눌러도 서버가 한 번만 쓴다)
 *   · 내용을 바꾸면 새 번호. 저장 중 로딩 · 두 번 누름 막음 · 실패면 창 그대로 + 까닭 · 「다시 확인 필요」 면 안내 + [닫기].
 * - 바깥 클릭으로 닫지 않는다(입력을 잃는다).
 * ⚠️ 금액 · 계좌 이름 · 메모를 콘솔 · 로컬 저장소에 남기지 않는다.
 */

/** 받침이 있으면 「이」 · 없으면 「가」(한글이 아니면 「이」) */
const josa = (word: string) => {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 0 ? '가' : '이';
};
const idOf = (o: AssetCashRowOption) => `${o.key.name}\u0000${o.key.nth}`;
const won = (v: number) => (v < 0 ? formatAssetWonSigned(v) : formatAssetWon(v));
const newRequestId = () => `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** 요청 번호 — 보내는 내용이 같으면 같은 번호 */
function useRequestId() {
  const last = useRef<{ sig: string; id: string } | null>(null);
  return (sig: string) => {
    if (!last.current || last.current.sig !== sig) last.current = { sig, id: newRequestId() };
    return last.current.id;
  };
}

/** 계좌 한 칸 아래 「지금 → 바뀐 뒤」 */
function Change({ option, delta, side }: { option: AssetCashRowOption | null; delta: number | null; side: 'from' | 'to' }) {
  if (!option) return null;
  const now = option.amount;
  const after = now != null && delta != null ? now + (side === 'from' ? -delta : delta) : null;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-caption tabular-nums text-text-muted" data-cash-move-change={side}>
      <span className={now != null && now < 0 ? 'text-bearish' : ''} data-cash-move-now>
        {now == null ? '—' : won(now)}
      </span>
      {after != null && (
        <>
          <ArrowRight {...ICON_SM} className="shrink-0 self-center" aria-label="바뀐 뒤" />
          <span className={`font-medium ${after < 0 ? 'text-bearish' : 'text-text-primary'}`} data-cash-move-after>
            {won(after)}
          </span>
        </>
      )}
      {now == null && <span className="text-warning">금액 칸이 숫자가 아니에요</span>}
    </span>
  );
}

export default function AssetCashMoveDialog({
  rows,
  fix,
  initial,
  initialSide,
  writeEnabled,
  onSend,
  onSaved,
  onClose,
}: {
  /** 「현금」 탭 은행 계좌 줄(이미 받은 시트 읽기) */
  rows: AssetCashRow[];
  fix: AssetCashBankFix | undefined;
  /** 처음 계좌 — 연 자리의 계좌 */
  initial: AssetCashKey;
  /** 이체의 처음 계좌 쪽 — 예수금 머리 = 들어가는 쪽 · 상품 줄 = 빠지는 쪽 */
  initialSide: 'from' | 'to';
  /** 이 서버에서 시트 쓰기가 켜져 있나 — 아직 모르면 null */
  writeEnabled: boolean | null;
  onSend: (req: AssetCashManualRequest) => Promise<{ error: string } | { result: AssetCashManualResult }>;
  /** 저장됨(창 닫고 다시 읽기) */
  onSaved: () => void;
  onClose: () => void;
}) {
  const options: AssetCashRowOption[] = cashKeysOfRows(rows).map(({ row, key }) => ({ key, label: row.name, amount: row.amount }));
  const groups = cashBankGroups(options, (o) => o.key.name, fix);
  const labelOf = (o: AssetCashRowOption | null) => (o ? (groups.flatMap((g) => g.items).find((it) => it.row === o)?.full ?? o.key.name) : '');
  const startId = options.find((o) => o.key.name === initial.name && o.key.nth === initial.nth);
  const start = startId ? idOf(startId) : '';

  const [kind, setKind] = useState<AssetCashManualKind>('transfer');
  const [fromId, setFromId] = useState(initialSide === 'from' ? start : '');
  const [toId, setToId] = useState(initialSide === 'to' ? start : '');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 쓰였는지 확인하지 못함 — 안내 + [닫기] 만 */
  const [unsure, setUnsure] = useState(false);
  const requestId = useRequestId();

  const needFrom = kind !== 'deposit';
  const needTo = kind !== 'withdraw';
  const from = needFrom ? (options.find((o) => idOf(o) === fromId) ?? null) : null;
  const to = needTo ? (options.find((o) => idOf(o) === toId) ?? null) : null;
  const amountN = amount === '' ? NaN : Number(amount);
  const amountOk = Number.isInteger(amountN) && amountN > 0 && amountN <= ASSET_CASH_MAX;
  const same = from != null && to != null && idOf(from) === idOf(to);
  const valid = amountOk && (!needFrom || from != null) && (!needTo || to != null) && !same;
  const canSave = writeEnabled === true && valid && !busy && !unsure;
  const delta = amountOk ? amountN : null;

  const pickKind = (k: AssetCashManualKind) => {
    // 바꾼 종류에 고른 계좌가 없으면 다른 쪽 계좌를 옮겨 온다(처음 계좌를 잃지 않게)
    if (k === 'deposit' && !toId) setToId(fromId);
    if (k === 'withdraw' && !fromId) setFromId(toId);
    setKind(k);
    setError(null);
  };

  const save = async () => {
    if (!canSave) return;
    const body = { kind, from: from?.key ?? null, to: to?.key ?? null, amount: amountN, memo: memo.trim() };
    const req: AssetCashManualRequest = { ...body, requestId: requestId(JSON.stringify(body)) };
    setBusy(true);
    setError(null);
    const r = await onSend(req);
    setBusy(false);
    if ('error' in r) return setError(r.error);
    if (r.result.move.status === 'check') return setUnsure(true);
    onSaved();
  };
  const askSave = () => {
    if (!canSave) return;
    const left = from?.amount != null && delta != null ? from.amount - delta : null;
    if (left == null || left >= 0) return void save();
    const name = labelOf(from);
    modal.confirm({
      title: '계좌 금액이 마이너스가 됩니다',
      message: `저장하면 ${name}${josa(name)} ${formatAssetWonSigned(left)} 가 됩니다. 그래도 저장할까요?`,
      confirmText: '저장',
      cancelText: '취소',
      onConfirm: () => void save(),
    });
  };

  const picker = (side: 'from' | 'to') => (
    <div className="min-w-0 flex-1 space-y-1">
      <AssetCashAccountPicker
        label={side === 'from' ? '빠지는 계좌' : '들어가는 계좌'}
        value={side === 'from' ? fromId : toId}
        groups={groups}
        idOf={idOf}
        disabled={busy || unsure}
        onPick={(v) => (side === 'from' ? setFromId(v) : setToId(v))}
        className="w-full"
      />
      <Change option={side === 'from' ? from : to} delta={delta} side={side} />
    </div>
  );
  const outside = (text: string) => (
    <span className="flex h-7 min-w-0 flex-1 items-center rounded-md bg-bg-tertiary/40 px-2 text-xs text-text-muted" data-cash-move-outside>
      {text}
    </span>
  );
  // 바꾼 것 — 연 때 값(종류 「옮기기」 · 처음 계좌 · 빈 금액 · 빈 메모)과 다르면(공통 3-3 · 되돌리면 다시 없음)
  const dirty = !unsure && (kind !== 'transfer' || fromId !== (initialSide === 'from' ? start : '') || toId !== (initialSide === 'to' ? start : '') || amount !== '' || memo !== '');
  const accountError = (needFrom && !from) || (needTo && !to) ? '계좌를 골라 주세요' : same ? '빠지는 계좌와 들어가는 계좌가 같아요' : undefined;

  return (
    <Dialog
      title="입출금"
      titleAside={kind === 'transfer' ? '계좌끼리 옮겨요 — 총 자산은 그대로예요' : kind === 'deposit' ? '밖에서 들어온 돈 — 총 자산이 늘어요' : '밖으로 나간 돈 — 총 자산이 줄어요'}
      onClose={() => !busy && (unsure ? onSaved() : onClose())}
      closeOnBackdrop={false}
      size="md"
      busy={busy}
      dirty={dirty}
      footer={
        unsure ? (
          <Button variant="primary" onClick={onSaved} data-testid="asset-cash-move-close">
            닫기
          </Button>
        ) : (
          <>
            <DialogCancel disabled={busy} data-testid="asset-cash-move-cancel" />
            <Button variant="primary" busy={busy} disabled={!canSave} onClick={askSave} submit data-testid="asset-cash-move-save">
              저장
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3" data-testid="asset-cash-move-dialog" data-cash-move-kind={kind}>
        <Segmented
          label="입출금 종류"
          options={ASSET_CASH_MANUAL_KINDS.map((k) => ({ value: k, label: ASSET_CASH_MANUAL_LABEL[k], disabled: busy || unsure }))}
          value={kind}
          onChange={pickKind}
        />
        {/* 계좌 줄은 창 폭 전체(두 계좌 이름 · 지금 → 바뀐 뒤 금액이 들어가게) — 오류 글은 같은 빨간 표시 규칙(FieldTouch · FieldError) */}
        <FieldTouch>
          <div className="space-y-1">
            <div className="text-xs text-text-secondary">계좌</div>
            <div className="flex min-w-0 items-start gap-2" data-testid="asset-cash-move-accounts">
              {needFrom ? picker('from') : outside('밖에서')}
              <ArrowRight {...ICON_SM} className="mt-1.5 shrink-0 text-text-muted" aria-hidden />
              {needTo ? picker('to') : outside('밖으로')}
            </div>
            <FieldError className="block">{accountError}</FieldError>
          </div>
        </FieldTouch>
        <NumberUnitGroup w="sm">
          <FormRow label="금액" error={amountOk ? undefined : '0 보다 큰 금액을 넣어 주세요'}>
            <NumberField kind="long" thousands decimals={0} unit="원" value={amount} onValue={setAmount} invalid={!amountOk} aria-label="금액" disabled={busy || unsure} data-testid="asset-cash-move-amount" />
          </FormRow>
        </NumberUnitGroup>
        <FormRow label="메모" hint="선택">
          <Input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={ASSET_CASH_MEMO_MAX} placeholder="예: 보너스" aria-label="메모" disabled={busy || unsure} className="w-full" data-testid="asset-cash-move-memo" />
        </FormRow>
        {writeEnabled === false && (
          <p className="text-caption text-text-muted keep-all" data-testid="asset-cash-move-write-off">
            이 서버에서는 시트 쓰기가 꺼져 있습니다.
          </p>
        )}
        {unsure && (
          <p role="alert" className="rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-warning keep-all" data-testid="asset-cash-move-unsure">
            시트에 쓰였는지 확인하지 못했어요 — 시트 「현금」 탭을 확인해 주세요(반영 기록은 「다시 확인 필요」).
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-testid="asset-cash-move-error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
