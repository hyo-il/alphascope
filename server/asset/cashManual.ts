/**
 * 직접 입출금(v2.72.0 · 143차) — 예수금 · 현금 [입출금] 창의 이체 · 입금 · 출금 `POST /api/asset/cash/manual`.
 *
 * - 쓰기 · 기록 · 되돌리기는 현금 자동 반영과 **같은 길**(`cashMoves.ts` `applyCashMove` → `writeCashMove` · `serial` · `undoCashMove`) — 새 쓰기 코드 없음.
 *   이체 = 빠지는 줄 −금액 · 들어가는 줄 +금액 한 요청 · 입금 = 들어가는 줄 +금액 · 출금 = 빠지는 줄 −금액. 쓰는 칸은 「현금」 탭 은행 계좌 줄 C열뿐.
 * - 켬 조건은 `ASSET_SYNC_ENABLED` 만(「현금 자동 반영」 설정은 보지 않음 — 사용자 결정 2026-11-17) · 자산 잠금은 라우터 맨 앞 자산 문지기 한 곳.
 * - 두 번 쓰지 않기: 화면이 만든 요청 번호(`requestId`) 하나에 기록 한 줄(고유 색인) — 같은 번호가 다시 오면 쓰지 않고 그 기록을 돌려준다.
 * - 같은 번호가 앞 요청을 처리하는 중(「쓰는 중」)에 오면 409 「처리 중」(성공으로 닫지 않게 — 끝난 뒤 다시 보내면 그 결과) · 같은 번호에 다른 내용이면 400.
 * - 시트를 쓴 뒤(반영 · 다시 확인 필요)에는 시트 30초 캐시를 비운다(`resetSheetCache` — 매수 · 매도와 같게) — 화면이 바로 다시 읽어 새 금액을 보게(옛 금액을 보고 다시 저장해 두 번 쓰지 않게).
 * - 메모는 기록의 `label`(선택 · 40자까지 · 앞뒤 공백 · 줄바꿈 정리) — 표 모양은 그대로.
 * ⚠️ 로그에는 기록 id · 종류 · 상태 · 까닭 종류만(금액 · 계좌 이름 · 메모 없음 — `applyCashMove` 로그 그대로).
 */
import {
  ASSET_CASH_MAX,
  ASSET_CASH_MEMO_MAX,
  isAssetCashManualKind,
  type AssetCashKey,
  type AssetCashManualKind,
  type AssetCashManualResult,
} from '../../src/types/asset';
import { AssetSheetError } from './google';
import { CASH_SKIP_TEXT, CashSkip, applyCashMove, manualMoveOf } from './cashMoves';
import { sameCashKey } from './cashKeys';
import { resetSheetCache } from './sheet';
import { kstDay } from './cashSchedule';

/** 요청 번호 모양 — 화면이 만든 글자(영문 · 숫자 · - · _ 8~64자) */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

const isKey = (v: unknown): v is AssetCashKey => {
  const o = v as AssetCashKey | null;
  return o != null && typeof o === 'object' && typeof o.name === 'string' && o.name.trim().length > 0 && Number.isInteger(o.nth) && o.nth >= 1 && (o.of === undefined || (Number.isInteger(o.of) && o.of >= 1));
};
/** 열쇠는 이름 · 몇 번째 · 같은 이름 줄 수만 남긴다(다른 칸은 버림) */
const keyOf = (k: AssetCashKey): AssetCashKey => (k.of === undefined ? { name: k.name, nth: k.nth } : { name: k.name, nth: k.nth, of: k.of });

const sameSide = (a: AssetCashKey | null, b: AssetCashKey | null) => (a == null ? b == null : b != null && sameCashKey(a, b));
const bad = (message: string) => new AssetSheetError('not-editable', message);

export interface ManualInput {
  kind: AssetCashManualKind;
  from: AssetCashKey | null;
  to: AssetCashKey | null;
  amount: number;
  memo: string;
  requestId: string;
}

/** 요청 검사 — 틀리면 `not-editable`(400 · 쓰기 0). 시트에서 계좌를 찾는 것은 쓰기 직전(`writeCashMove`) */
export function parseManual(body: unknown): ManualInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!isAssetCashManualKind(b.kind)) throw bad('종류는 이체 · 입금 · 출금 가운데 하나여야 합니다.');
  if (typeof b.requestId !== 'string' || !REQUEST_ID.test(b.requestId)) throw bad('요청 번호가 올바르지 않습니다.');
  const amount = b.amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0 || amount > ASSET_CASH_MAX) throw bad('금액은 0 보다 큰 원 단위 정수여야 합니다.');
  let memo = '';
  if (b.memo !== undefined && b.memo !== null) {
    if (typeof b.memo !== 'string') throw bad('메모가 올바르지 않습니다.');
    memo = b.memo.replace(/\s+/g, ' ').trim();
    if ([...memo].length > ASSET_CASH_MEMO_MAX) throw bad(`메모는 ${ASSET_CASH_MEMO_MAX}자까지입니다.`);
  }
  const needFrom = b.kind !== 'deposit';
  const needTo = b.kind !== 'withdraw';
  if (needFrom ? !isKey(b.from) : b.from != null) throw bad(needFrom ? '빠지는 계좌를 골라 주세요.' : '입금에는 빠지는 계좌가 없습니다.');
  if (needTo ? !isKey(b.to) : b.to != null) throw bad(needTo ? '들어가는 계좌를 골라 주세요.' : '출금에는 들어가는 계좌가 없습니다.');
  const from = needFrom ? keyOf(b.from as AssetCashKey) : null;
  const to = needTo ? keyOf(b.to as AssetCashKey) : null;
  if (from && to && sameCashKey(from, to)) throw bad('빠지는 계좌와 들어가는 계좌가 같습니다.');
  return { kind: b.kind, from, to, amount, memo, requestId: b.requestId };
}

/**
 * 직접 입출금 한 건 — 검사 → (같은 요청 번호가 있으면 그 기록) → `applyCashMove(manual)` → 기록 + 쓴 뒤 금액.
 * 쓰기 전 실패는 기록 없이 까닭(`sheet-changed` 409 · 구글 오류 그대로) · 쓴 뒤 다시 읽은 값이 다르거나 확인하지 못하면 기록은 「다시 확인 필요」(200 · 화면이 안내).
 */
export async function applyManualCash(body: unknown, now = Date.now()): Promise<AssetCashManualResult> {
  const m = parseManual(body);
  const itemKey = `manual:${m.requestId}`;
  const had = manualMoveOf(itemKey);
  if (had) {
    const same = had.move.kind === m.kind && had.move.amount === m.amount && sameSide(had.move.from, m.from) && sameSide(had.move.to, m.to);
    if (!same) throw bad('같은 요청 번호에 다른 내용이 왔습니다.');
    if (had.move.status === 'pending') throw new AssetSheetError('busy', '앞 요청을 처리하는 중이에요 — 잠시 뒤 다시 저장해 주세요(같은 내용이면 한 번만 씁니다).');
    return { ...had, duplicate: true };
  }
  const today = kstDay(now);
  let outcome;
  try {
    outcome = await applyCashMove({ kind: m.kind, itemKey, label: m.memo, month: today.slice(0, 7), day: today, from: m.from, to: m.to, amount: m.amount }, { manual: true });
  } catch (e) {
    // 쓰기 요청 뒤 실패도 「다시 확인 필요」 로 끝나 여기 오지 않는다 — 여기는 쓰기 전 실패(시트 그대로)
    if (e instanceof CashSkip) throw new AssetSheetError('sheet-changed', `쓰지 않았어요 — ${CASH_SKIP_TEXT[e.reason] ?? '시트를 확인해 주세요'}(시트 「현금」 탭을 확인한 뒤 다시 해 주세요).`);
    throw e;
  }
  if (outcome.status !== 'duplicate') resetSheetCache();
  const rec = manualMoveOf(itemKey);
  if (!rec) throw new AssetSheetError('network', '기록을 찾지 못했습니다.');
  return { ...rec, duplicate: outcome.status === 'duplicate' };
}
