import { Fragment } from 'react';
import { CircleCheck } from 'lucide-react';
import { Badge, Button, Dialog, ICON_SM, Panel, SectionTitle } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import type { MonthlyBuy } from '../../types/asset';

/**
 * 자산 관리 「이번 달 구매」(v2.64.0 · 자산 관리 5단계) — **보여 주기만, 주문 없음**.
 * - 「비율 조정」 탭 아래 구역(`MonthlyBuySection`)과 구매일 팝업(`PurchaseDayDialog`)이 같은 표(`MonthlyBuyTable`)를 그린다.
 * - 금액 · 구매일 · 완료 여부는 서버 `monthlyBuy`(summary 응답) 그대로 — 화면에서 다시 계산하지 않는다.
 * - [구매 완료] 는 `AssetDashboard` 가 확인 창(`modal.confirm`)을 띄우고 서버에 보낸다(시트 계좌 이름 날짜를 바꿈 · 되돌리기 없음).
 * - 시작 전 차례(`mb.skipped` — v2.64.1): 이 기능을 쓰기 시작한 날보다 앞선 차례는 묻지 않는다 — [구매 완료] 를 숨기고 「시작 전 차례 — 묻지 않음」 만.
 * - 미리 구매 완료(v2.65.4): 다음 구매일 7일 전부터(`mb.earlyCycle`) 「다음 구매일 ○ · 미리 구매 완료할 수 있어요」 + [구매 완료] ·
 *   미리 완료한 뒤 「다음 구매일 ○ · 완료 ○(미리)」. 팝업은 그대로(구매일 당일부터 · 이번 차례 미완료일 때만 — 미리 완료한 차례는 이미 완료).
 * ⚠️ 금액은 콘솔 · 로컬 저장소에 남기지 않는다.
 */

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
/** `2026-11-27` → `2026-11-27(금)` */
export const dayText = (day: string) => `${day}(${WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? ''})`;

/**
 * 확인 창에 넣을 「시트에 쓸 날짜」 — 서버가 준 글자(`mb.sheetDates`) 그대로. `2026.11` 이면 「2026.11(이번 구매 차례의 달)로」,
 * 일이 있으면 「…(이번 구매 차례의 날짜)로」(미리 완료면 「다음 구매 차례」). 단어 이음표(U+2060)로 날짜 · 괄호 · 「로」 사이에서 줄이 꺾이지 않게.
 */
export function sheetDateText(dates: string[], which: '이번' | '다음' = '이번'): string {
  if (dates.length === 0) return `${which} 구매 차례의 날짜로`;
  const monthOnly = dates.every((d) => /^\d{4}[.\-/]\d{1,2}$/.test(d));
  const joined = dates.map((d) => d.replace(/([.\-/])/g, '$1\u2060')).join(' · ');
  return `${joined}\u2060(${which} 구매 차례의 ${monthOnly ? '달' : '날짜'})\u2060로`;
}

/** 지금 [구매 완료] 를 누르면 다음 차례를 미리 완료하나(이번 차례가 완료 · 시작 전이고 7일 전부터 — 서버 `purchaseTargetOf` 와 같은 규칙) */
export const isEarlyDone = (mb: MonthlyBuy) => (mb.done || mb.skipped) && mb.earlyCycle != null;
/** [구매 완료] 를 보일까 — 미완료인 이번 차례 · 미리 완료할 수 있는 다음 차례 */
export const canPressDone = (mb: MonthlyBuy) => (!mb.done && !mb.skipped) || isEarlyDone(mb);

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
    </div>
  );
}

/** 이번 구매일 · 완료 여부 · 다음 구매일 · (필요할 때) 휴장일 확인 못 함 */
function CycleLine({ mb }: { mb: MonthlyBuy }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary" data-monthly-cycle>
      <span className="tabular-nums">
        이번 구매일 <span className="text-text-primary">{dayText(mb.cycleDay)}</span>
      </span>
      {mb.skipped ? (
        <Badge>시작 전 차례 — 묻지 않음</Badge>
      ) : mb.done ? (
        <Badge tone="bullish">
          <CircleCheck {...ICON_SM} aria-hidden />
          완료 {mb.doneDay}
        </Badge>
      ) : (
        <Badge tone="warning">아직 안 함</Badge>
      )}
      <span className="text-text-muted" aria-hidden>
        ·
      </span>
      <span className="tabular-nums">
        다음 구매일 <span className="text-text-primary">{dayText(mb.nextDay)}</span>
      </span>
      {mb.nextDoneDay ? (
        <>
          <span className="text-text-muted" aria-hidden>
            ·
          </span>
          <Badge tone="bullish" data-monthly-early-done>
            <CircleCheck {...ICON_SM} aria-hidden />
            완료 {mb.nextDoneDay}(미리)
          </Badge>
        </>
      ) : (
        isEarlyDone(mb) && (
          <>
            <span className="text-text-muted" aria-hidden>
              ·
            </span>
            {/* 날짜 값(흰 글자)과 섞여 읽히지 않게 흐린 글자 · 앞 칸과 같은 「·」 구분(캡처 검토) */}
            <span className="text-text-secondary" data-monthly-early>
              미리 구매 완료할 수 있어요
            </span>
          </>
        )
      )}
      {mb.calendarUnchecked && <span className="text-caption text-warning keep-all">휴장일 확인 못 함 — 평일로만 셈</span>}
    </div>
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

/** 「비율 조정」 탭 아래 「이번 달 구매」 구역 */
export function MonthlyBuySection({ mb, writeEnabled, error, onDone }: { mb: MonthlyBuy; writeEnabled: boolean; error: string | null; onDone: () => void }) {
  return (
    <Panel pad="none" className="space-y-3 pb-1 pt-3" id="as-asset-monthly-buy">
      <div className="space-y-2 px-4">
        <SectionTitle
          aside="월급 × 목표 비율 — 보여 주기만(주문 없음)"
          info="살 금액 = 시트 「월 고정지출」 C5 월급 × 「자산 투자 비율 관리」 목표 비율. 주식은 코어 · 위성으로 한 번 더 나눕니다. 원 단위 반올림 차이는 코어에 더해 합계가 월급과 같습니다. 구매일 = 26일이 든 주의 금요일(26일이 토 · 일이면 바로 앞 금요일), 그날이 한국 휴장일이면 그 전 거래일입니다."
          right={
            !canPressDone(mb) ? undefined : (
              <Button size="sm" icon={CircleCheck} disabled={!writeEnabled} title={writeEnabled ? undefined : '이 서버에서는 시트 쓰기가 꺼져 있습니다'} onClick={onDone} data-purchase-done>
                구매 완료
              </Button>
            )
          }
        >
          이번 달 구매
        </SectionTitle>
        <CycleLine mb={mb} />
        {error && <FailLine message={error} />}
      </div>
      <MonthlyBuyTable mb={mb} />
    </Panel>
  );
}

/** 구매일 팝업 — 자산 관리에 들어올 때마다(이번 차례 미완료일 때) · [나중에] = 닫기(다음 접속 때 다시) */
export function PurchaseDayDialog({ mb, writeEnabled, error, onLater, onDone }: { mb: MonthlyBuy; writeEnabled: boolean; error: string | null; onLater: () => void; onDone: () => void }) {
  return (
    <Dialog
      title="이번 달 구매일입니다"
      titleAside={dayText(mb.cycleDay)}
      onClose={onLater}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onLater} data-purchase-later>
            나중에
          </Button>
          <Button variant="primary" icon={CircleCheck} disabled={!writeEnabled} onClick={onDone} data-purchase-done>
            구매 완료
          </Button>
        </>
      }
    >
      <div className="space-y-3" data-purchase-dialog>
        <CycleLine mb={mb} />
        {!writeEnabled && <p className="text-caption text-text-muted keep-all">이 서버에서는 시트 쓰기가 꺼져 있어 [구매 완료] 를 누를 수 없습니다.</p>}
        {error && <FailLine message={error} />}
        <div className="-mx-4">
          <MonthlyBuyTable mb={mb} />
        </div>
      </div>
    </Dialog>
  );
}
