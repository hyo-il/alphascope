import { Fragment } from 'react';
import { CircleCheck } from 'lucide-react';
import { Badge, Button, Dialog, ICON_SM, Panel, SectionTitle } from '../ui';
import { LIST_ROW, LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import type { MonthlyBuy, MonthlyBuyAccount, PurchaseStatus } from '../../types/asset';
import ScrollTable from '../ui/ScrollTable';

/**
 * 자산 관리 「이번 달 구매」(v2.64.0 · 자산 관리 5단계 · v2.78.0 계좌마다) — **보여 주기만, 주문 없음**.
 * - 「비율 조정」 탭 아래 구역(`MonthlyBuySection`)과 구매일 팝업(`PurchaseDayDialog`)이 같은 표(`MonthlyBuyTable`) · 같은 계좌 목록(`PurchaseAccountList`)을 그린다.
 * - 금액 · 구매일 · 계좌마다 상태 · 누를 수 있는 단추는 서버 `monthlyBuy`(summary 응답 — `purchase.ts` `purchaseAccountsOf` 한 곳) 그대로 — 화면에서 다시 판단하지 않는다.
 * - 계좌마다 [구매 완료](확인 창 → 그 계좌 이름 날짜만 씀 · 시트 날짜가 이미 그 차례 이후면 그대로 두고 기록만) · [건너뛰기](확인 창 없음 · 기록만) ·
 *   완료 · 건너뜀은 [되돌리기](확인 창 · 기록만 — 시트 날짜는 그대로). 이번 차례를 끝낸 계좌는 다음 차례 줄 「다음 차례(○) — [미리 구매 완료] [건너뛰기]」.
 * - 매달 사지 않는 계좌(자산 관리 설정 › 이번 달 구매)는 목록에 나오지 않는다. 시작 전 차례(`mb.skipped`)는 「시작 전 차례 — 묻지 않음」.
 * - 쓰기 스위치가 꺼진 서버: [구매 완료] 만 막고 안내(건너뛰기 · 되돌리기는 시트를 쓰지 않으므로 됨).
 * - 저장 중(`busy` — 누른 단추)에는 목록 전체를 막는다(`AssetDashboard` 가 요청 · 확인 창 · 다시 받기).
 * ⚠️ 금액은 콘솔 · 로컬 저장소에 남기지 않는다.
 */

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** `2026-11-27` → `2026-11-27(금)` */
export const dayText = (day: string) => `${day}(${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? ''})`;

/**
 * 확인 창에 넣을 「시트에 쓸 날짜」 — 서버가 준 글자(계좌의 `sheetDateText`) 그대로. `2026.11` 이면 「2026.11(이번 구매 차례의 달)로」,
 * 일이 있으면 「…(이번 구매 차례의 날짜)로」(미리 완료면 「다음 구매 차례」). 단어 이음표(U+2060)로 날짜 · 괄호 · 「로」 사이에서 줄이 꺾이지 않게.
 */
export function sheetDateText(date: string | null, which: '이번' | '다음' = '이번'): string {
  if (date == null) return `${which} 구매 차례의 날짜로`;
  const monthOnly = /^\d{4}[.\-/]\d{1,2}$/.test(date);
  return `${date.replace(/([.\-/])/g, '$1\u2060')}\u2060(${which} 구매 차례의 ${monthOnly ? '달' : '날짜'})\u2060로`;
}

/** 누른 단추 — 계좌 · 차례 · 무엇 */
export interface PurchasePress {
  action: 'done' | 'skip' | 'undo';
  cycleDay: string;
  account: MonthlyBuyAccount;
  /** 다음 차례 줄에서 눌렀나 */
  next: boolean;
}
/** 저장 중인 단추 열쇠(`AssetDashboard` 가 들고 있다) */
export const pressKey = (p: Pick<PurchasePress, 'action' | 'cycleDay'> & { section: string }) => `${p.action}:${p.cycleDay}:${p.section}`;

/** 매달 사는 계좌만(시트 순서) */
export const monthlyAccounts = (mb: MonthlyBuy) => mb.accounts.filter((a) => a.buysMonthly);

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;
const pct = (v: number | null) => (v == null ? '—' : formatNumber(v, Number.isInteger(v) ? 0 : 1, '%'));
const won = (v: number | null) => (v == null ? '—' : formatPrice(v, 'KRW'));
const off100 = (v: number | null) => v != null && Math.abs(v - 100) > 1e-6;

/** 표 위 안내 — 월급 없음 · 목표 빈칸 · 목표 합 ≠ 100(비율 조정과 같은 문구) */
function notesOf(mb: MonthlyBuy): string[] {
  return [
    mb.noSalary ? '시트에 월급이 없습니다 — 「월 고정지출」 C5 를 확인하세요.' : null,
    mb.targetMissing ? '시트에 목표 비율이 비어 있는 칸이 있습니다 — 그 줄은 「—」 로 보입니다.' : null,
    off100(mb.assetTargetSum) ? `목표 비율 합이 ${formatNumber(mb.assetTargetSum, 1, '%')}입니다 — 설정에서 바로잡아 주세요.` : null,
    off100(mb.stockTargetSum) ? `코어 · 위성 목표 합이 ${formatNumber(mb.stockTargetSum, 1, '%')}입니다 — 설정에서 바로잡아 주세요.` : null,
  ].filter((x): x is string => x != null);
}

/** 이번 달 구매 표 — 현금 · 채권 · 금 · 주식(아래 코어 · 위성 들여쓰기) · 합계 / 목표 % · 살 금액 */
export function MonthlyBuyTable({ mb }: { mb: MonthlyBuy }) {
  const row = (key: string) => mb.rows.find((r) => r.key === key);
  const notes = notesOf(mb);
  return (
    <div className="space-y-2">
      {notes.length > 0 && (
        <ul className="space-y-0.5 px-4 text-xs text-warning keep-all" role="status" data-monthly-notes>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <ScrollTable>
      <table className="w-full text-left text-xs" data-monthly-table>
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className={`${TABLE_NAME_COL} pl-4 font-normal`}>분류</th>
            <th className={`${NUM} font-normal`}>목표</th>
            <th className={`${NUM} pr-4 font-normal`}>살 금액</th>
          </tr>
        </thead>
        <tbody>
          {(['cash', 'bond', 'gold', 'stock'] as const).map((key) => {
            const r = row(key);
            if (!r) return null;
            return (
              <Fragment key={key}>
                <tr className={`border-t border-border/30 ${LIST_TABLE_ROW} text-text-primary`} data-monthly-row={key}>
                  <td className="pl-4">{r.label}</td>
                  <td className={NUM}>{pct(r.targetPct)}</td>
                  <td className={`${NUM} pr-4`}>{won(r.amount)}</td>
                </tr>
                {key === 'stock' &&
                  (['core', 'satellite'] as const).map((sub) => {
                    const s = row(sub);
                    return s ? (
                      <tr key={sub} className={`${LIST_TABLE_ROW} text-text-secondary`} data-monthly-row={sub}>
                        <td className="pl-10">{s.label}</td>
                        <td className={NUM}>{pct(s.targetPct)}</td>
                        <td className={`${NUM} pr-4`}>{won(s.amount)}</td>
                      </tr>
                    ) : null;
                  })}
              </Fragment>
            );
          })}
          <tr className={`border-t border-border/50 ${LIST_TABLE_ROW} font-semibold text-text-primary`} data-monthly-row="total">
            <td className="pl-4">합계</td>
            <td className={NUM}>{pct(mb.assetTargetSum)}</td>
            <td className={`${NUM} pr-4`}>{won(mb.total)}</td>
          </tr>
        </tbody>
      </table>
      </ScrollTable>
    </div>
  );
}

/** 이번 구매일 · 다음 구매일 · (필요할 때) 휴장일 확인 못 함 · 시작 전 차례 */
function CycleLine({ mb }: { mb: MonthlyBuy }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary" data-monthly-cycle>
      <span className="tabular-nums">
        이번 구매일 <span className="text-text-primary">{dayText(mb.cycleDay)}</span>
      </span>
      {mb.skipped && <Badge>시작 전 차례 — 묻지 않음</Badge>}
      <span className="text-text-muted" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        다음 구매일 <span className="text-text-primary">{dayText(mb.nextDay)}</span>
      </span>
      {mb.calendarUnchecked && <span className="text-caption text-warning keep-all">휴장일 확인 못 함 — 평일로만 셈</span>}
    </div>
  );
}

/** 상태 배지 — 아직 · 완료 ○ · 건너뜀 ○ · 시작 전 */
function StatusBadge({ status, at }: { status: MonthlyBuyAccount['status']; at: string | null }) {
  if (status === 'before-start') return <Badge>시작 전 차례</Badge>;
  if (status === 'todo') return <Badge tone="warning">아직</Badge>;
  if (status === 'done')
    return (
      <Badge tone="bullish">
        <CircleCheck {...ICON_SM} aria-hidden />
        완료 {at}
      </Badge>
    );
  return <Badge>건너뜀 {at}</Badge>;
}

/** 단추 묶음 — 아직이면 [구매 완료] [건너뛰기] · 완료 · 건너뜀이면 [되돌리기] */
function Actions({
  status,
  canDone,
  canSkip,
  canUndo,
  undoTip,
  doneLabel,
  base,
  writeEnabled,
  busyKey,
  onPress,
}: {
  status: PurchaseStatus | 'before-start';
  canDone: boolean;
  canSkip: boolean;
  canUndo: boolean;
  undoTip?: string;
  doneLabel: string;
  base: Omit<PurchasePress, 'action'>;
  writeEnabled: boolean;
  busyKey: string | null;
  onPress: (p: PurchasePress) => void;
}) {
  const key = (action: PurchasePress['action']) => pressKey({ action, cycleDay: base.cycleDay, section: base.account.section });
  const locked = busyKey != null;
  const press = (action: PurchasePress['action']) => onPress({ ...base, action });
  if (status === 'done' || status === 'skip') {
    return (
      <Button size="sm" variant="ghost" busy={busyKey === key('undo')} disabled={locked || !canUndo} data-tip={canUndo ? undefined : undoTip} onClick={() => press('undo')} data-testid="purchase-undo">
        되돌리기
      </Button>
    );
  }
  if (status !== 'todo') return null;
  return (
    <>
      {canDone && (
        <Button size="sm" icon={CircleCheck} busy={busyKey === key('done')} disabled={locked || !writeEnabled} data-tip={writeEnabled ? undefined : '이 서버에서는 시트 쓰기가 꺼져 있습니다'} onClick={() => press('done')} data-testid="purchase-done">
          {doneLabel}
        </Button>
      )}
      {canSkip && (
        <Button size="sm" variant="ghost" busy={busyKey === key('skip')} disabled={locked} onClick={() => press('skip')} data-testid="purchase-skip">
          건너뛰기
        </Button>
      )}
    </>
  );
}

/** 계좌 한 줄 + (이번 차례를 끝냈으면) 다음 차례 줄 */
function AccountRow({ mb, a, writeEnabled, busyKey, note, onPress }: { mb: MonthlyBuy; a: MonthlyBuyAccount; writeEnabled: boolean; busyKey: string | null; note: string | null; onPress: (p: PurchasePress) => void }) {
  const finished = a.status !== 'todo';
  const showNext = finished && (a.next.status !== 'todo' || a.next.canDone || a.next.canSkip);
  return (
    <li className="space-y-1 py-1" data-testid="purchase-account" data-section={a.section} data-status={a.status}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${LIST_ROW}`}>
        <span className="min-w-0 max-w-full truncate text-xs text-text-primary" data-tip={a.name} data-tip-clip data-testid="purchase-account-name">
          {a.name}
        </span>
        <StatusBadge status={a.status} at={a.at} />
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Actions
            status={a.status}
            canDone
            canSkip
            canUndo={a.canUndo}
            undoTip="다음 차례 기록을 먼저 되돌려 주세요"
            doneLabel="구매 완료"
            base={{ cycleDay: mb.cycleDay, account: a, next: false }}
            writeEnabled={writeEnabled}
            busyKey={busyKey}
            onPress={onPress}
          />
        </span>
      </div>
      {showNext && (
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 pl-4 text-xs text-text-secondary ${LIST_ROW}`} data-testid="purchase-next" data-status={a.next.status}>
          <span className="tabular-nums">다음 차례({dayText(mb.nextDay)})</span>
          {a.next.status === 'todo' ? (
            <span className="text-text-muted" aria-hidden>
              —
            </span>
          ) : (
            <StatusBadge status={a.next.status} at={a.next.at} />
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <Actions
              status={a.next.status}
              canDone={a.next.canDone}
              canSkip={a.next.canSkip}
              canUndo
              doneLabel="미리 구매 완료"
              base={{ cycleDay: mb.nextDay, account: a, next: true }}
              writeEnabled={writeEnabled}
              busyKey={busyKey}
              onPress={onPress}
            />
          </span>
        </div>
      )}
      {note && (
        <p className="pl-4 text-caption text-text-muted keep-all" role="status" data-testid="purchase-note">
          {note}
        </p>
      )}
    </li>
  );
}

/** 계좌별 목록(구역 · 팝업 같음) — 매달 사는 계좌만 · 저장 중이면 막음 */
export function PurchaseAccountList({ mb, writeEnabled, busyKey, notes, onPress }: { mb: MonthlyBuy; writeEnabled: boolean; busyKey: string | null; notes: Record<string, string>; onPress: (p: PurchasePress) => void }) {
  const list = monthlyAccounts(mb);
  if (list.length === 0) {
    return (
      <p className="text-xs text-text-muted keep-all" data-testid="purchase-accounts-empty">
        매달 사는 계좌가 없습니다 — 자산 관리 설정 › 이번 달 구매에서 고릅니다.
      </p>
    );
  }
  return (
    <ul className={`divide-y divide-border/30 ${busyKey != null ? 'pointer-events-none' : ''}`} aria-busy={busyKey != null || undefined} data-testid="purchase-accounts">
      {list.map((a) => (
        <AccountRow key={a.section} mb={mb} a={a} writeEnabled={writeEnabled} busyKey={busyKey} note={notes[a.section] ?? null} onPress={onPress} />
      ))}
    </ul>
  );
}

/** 실패 이유 한 줄(팝업 · 구역 그대로 둔다) */
function FailLine({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-purchase-error>
      {message}
    </p>
  );
}

/** 계좌 목록 아래 안내 — 쓰기 스위치가 꺼진 서버 */
function WriteOffNote({ writeEnabled }: { writeEnabled: boolean }) {
  return writeEnabled ? null : (
    <p className="text-caption text-text-muted keep-all" data-testid="purchase-write-off">
      이 서버에서는 시트 쓰기가 꺼져 있어 [구매 완료] 를 누를 수 없습니다 — [건너뛰기] · [되돌리기] 는 됩니다.
    </p>
  );
}

type ListProps = { mb: MonthlyBuy; writeEnabled: boolean; error: string | null; busyKey: string | null; notes: Record<string, string>; onPress: (p: PurchasePress) => void };

/** 「비율 조정」 탭 아래 「이번 달 구매」 구역 */
export function MonthlyBuySection({ mb, writeEnabled, error, busyKey, notes, onPress }: ListProps) {
  return (
    <Panel pad="none" className="space-y-3 pb-1 pt-3" id="as-asset-monthly-buy">
      <div className="space-y-2 px-4">
        <SectionTitle
          aside="월급 × 목표 비율 — 보여 주기만(주문 없음)"
          info="살 금액 = 시트 「월 고정지출」 C5 월급 × 「자산 투자 비율 관리」 목표 비율. 주식은 코어 · 위성으로 한 번 더 나눕니다. 원 단위 반올림 차이는 코어에 더해 합계가 월급과 같습니다. 구매일 = 26일이 든 주의 금요일(26일이 토 · 일이면 바로 앞 금요일), 그날이 한국 휴장일이면 그 전 거래일입니다. [구매 완료] 는 그 계좌 이름의 날짜만 바꿉니다."
        >
          이번 달 구매
        </SectionTitle>
        <CycleLine mb={mb} />
        {error && <FailLine message={error} />}
        <PurchaseAccountList mb={mb} writeEnabled={writeEnabled} busyKey={busyKey} notes={notes} onPress={onPress} />
        <WriteOffNote writeEnabled={writeEnabled} />
      </div>
      <MonthlyBuyTable mb={mb} />
    </Panel>
  );
}

/** 구매일 팝업 — 자산 관리에 들어올 때마다(이번 차례에 「아직」 인 매달 사는 계좌가 있을 때) · [나중에] = 닫기(다음 접속 때 다시) */
export function PurchaseDayDialog({ mb, writeEnabled, error, busyKey, notes, onPress, onLater }: ListProps & { onLater: () => void }) {
  return (
    <Dialog
      title="이번 달 구매일입니다"
      titleAside={dayText(mb.cycleDay)}
      onClose={onLater}
      size="md"
      footer={
        <Button variant="ghost" onClick={onLater} data-purchase-later>
          나중에
        </Button>
      }
    >
      <div className="space-y-3" data-purchase-dialog>
        <CycleLine mb={mb} />
        {error && <FailLine message={error} />}
        <PurchaseAccountList mb={mb} writeEnabled={writeEnabled} busyKey={busyKey} notes={notes} onPress={onPress} />
        <WriteOffNote writeEnabled={writeEnabled} />
        {/* 음수 여백(design:lint 허용 목록): 창 안쪽 여백(16px)을 넘어 표를 창 폭 끝까지 */}
        <div className="-mx-4">
          <MonthlyBuyTable mb={mb} />
        </div>
      </div>
    </Dialog>
  );
}
