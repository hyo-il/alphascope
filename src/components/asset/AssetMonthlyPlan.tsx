import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, ICON_SM } from '../ui';
import DataCard, { DataCardList } from '../ui/DataCard';
import LinkButton from '../ui/LinkButton';
import ScrollTable from '../ui/ScrollTable';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NUM_GAP, TOUCH_LIST_ROW } from '../ui/tokens';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import { formatAssetPrice, formatAssetQty, formatAssetWon } from '../../utils/assetFormat';
import { formatNumber } from '../../utils/formatters';
import type { MonthlyBuy, MonthlyBuyAccount, MonthlyPlan, MonthlyPlanRow } from '../../types/asset';

/**
 * 이번 달 구매 — 계좌 · 종목별 목록(v2.79.0 · 152차 · **보여 주기만** — 시트 쓰기 · 주문 없음).
 * - 금액 · 몇 주 · 남는 돈은 서버(`savingPlan.ts` 한 곳) 값 그대로 — 화면에서 다시 계산하지 않는다(숫자 표시만 `assetFormat`).
 * - 「이번 달 구매」 구역의 계좌 줄 아래 펼침(▸ / ▾ · 처음 펼침 · 접은 계좌는 이 기기에 기억 `alphascope.asset.planClosed`).
 * - 1280 이상 · 패드 = 표(`ScrollTable`) · 폰 = 카드(`DataCard` — 카드 전체가 누르는 곳: 설정 「살 종목 잇기」 그 계좌 자리 · 카드 안 줄은 숫자가 잘리지 않게 줄바꿈).
 * - 잇지 않은 줄 = 금액만 · 주 · 남는 돈 「—」 · 「종목을 이어 주세요」 + [설정에서 잇기](표 = `LinkButton` · 폰 카드 = 카드가 그 단추 — 카드 안에 단추를 겹쳐 두지 않는다).
 * - 안내: 시트 값 확인(총 금액 · 개월 수) · 비율 합 100% 아님(목록 없음) · 탭을 못 읽음 · 모양 바뀜 · 읽지 않은 묶음.
 * ⚠️ 금액을 콘솔 · 로컬 저장소에 남기지 않는다(접은 계좌 key 만 기억).
 */

const CLOSED_KEY = 'alphascope.asset.planClosed';
function readClosed(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveClosed(keys: string[]) {
  try {
    localStorage.setItem(CLOSED_KEY, JSON.stringify(keys));
  } catch {
    /* 기억하지 못해도 화면은 그대로 */
  }
}

/** 숫자 칸 — 칸 폭은 표의 colgroup 이 정한다(계좌마다 표가 따로라도 금액 · 가격 · 주 · 남는 돈 세로선이 같게 · 긴 이름이 칸을 밀지 않게) */
const NUM = `${TABLE_NUM_GAP} whitespace-nowrap text-right tabular-nums`;
const won = (v: number | null) => formatAssetWon(v);

/** 한 달 금액 머리 — 「한 달 ₩… (총 ₩… ÷ N개월)」 */
export function planHeadText(plan: MonthlyPlan): string {
  if (plan.monthly == null || plan.total == null || plan.months == null) return '시트 값 확인';
  return `한 달 ${won(plan.monthly)} (총 ${won(plan.total)} ÷ ${formatNumber(plan.months, 0)}개월)`;
}
/** 머리 글 — 「한 달 ₩…」 와 「(총 ₩… ÷ N개월)」 를 각각 한 덩어리로(폰에서 괄호 안이 중간에 꺾이지 않게) */
function HeadText({ plan }: { plan: MonthlyPlan }) {
  const text = planHeadText(plan);
  const at = text.indexOf(' (');
  if (at < 0) return <>{text}</>;
  return (
    <>
      <span className="whitespace-nowrap">{text.slice(0, at)}</span> <span className="whitespace-nowrap">{text.slice(at + 1)}</span>
    </>
  );
}

/** 지금 가격 글자 — 원 가격(미국은 $ × 지금 환율 · 살 주를 셈한 값 그대로 — 금액 · 남는 돈 칸과 같은 원) · 이었는데 가격이 없으면 「가격 없음」 · 잇지 않았으면 「—」 */
const priceText = (r: MonthlyPlanRow) => (r.symbol == null ? '—' : r.price == null || r.priceKrw == null ? '가격 없음' : won(r.priceKrw));
/** 미국 줄 지금 가격의 달러 값 — 「$512.34」 */
const usdPrice = (r: MonthlyPlanRow) => (r.market === 'US' && r.price != null && r.priceKrw != null ? formatAssetPrice(r.price, 'USD') : null);
/** 미국 줄 작은 글 — 「약 $… · 환율 ○」 */
const usdNote = (r: MonthlyPlanRow) => (r.market === 'US' && r.amountUsd != null && r.usdKrw != null ? `약 ${formatAssetPrice(r.amountUsd, 'USD')} · 환율 ${formatNumber(r.usdKrw, 2)}` : null);

/** 줄 이름 → 종목(잇지 않았으면 줄 이름 + 안내) */
function NameCell({ r, onLink }: { r: MonthlyPlanRow; onLink: () => void }) {
  if (r.symbol == null) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-2 break-words text-text-primary" data-tip-clip={r.name}>
          {r.name}
        </span>
        <span className="text-caption text-warning keep-all" data-testid="plan-unlinked">
          종목을 이어 주세요 · <LinkButton onClick={onLink}>설정에서 잇기</LinkButton>
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="line-clamp-2 break-words text-text-primary" data-tip-clip={`${r.name} → ${r.stockName ?? ''}`}>
        {r.name} → {r.stockName}
      </span>
      <span className="text-caption text-text-muted tabular-nums">{r.symbol}</span>
    </span>
  );
}

/** 표(1280 이상 · 패드) */
function PlanTable({ plan, onLink }: { plan: MonthlyPlan; onLink: () => void }) {
  return (
    <ScrollTable>
      <table className="w-full table-fixed text-left text-xs" data-testid="plan-table">
        <colgroup>
          <col />
          <col className="w-48" />
          <col className="w-32" />
          <col className="w-20" />
          <col className="w-32" />
        </colgroup>
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className="pl-4 font-normal">줄 이름 → 종목</th>
            <th className={`${NUM} font-normal`}>금액</th>
            <th className={`${NUM} font-normal`}>지금 가격</th>
            <th className={`${NUM} font-normal`}>살 주</th>
            <th className={`${NUM} pr-4 font-normal`}>남는 돈</th>
          </tr>
        </thead>
        <tbody>
          {plan.rows.map((r) => {
            const note = usdNote(r);
            return (
              <tr key={r.name} className={`border-t border-border/30 ${LIST_TABLE_ROW} py-1`} data-testid="plan-row" data-linked={r.symbol != null}>
                {/* 이름 칸은 남은 폭만(table-fixed) — 긴 이름이 표를 넓혀 숫자 칸을 밀어내지 않게 · 2줄까지, 넘치면 말줄임 + 툴팁 */}
                <td className="py-1 pl-4">
                  <NameCell r={r} onLink={onLink} />
                </td>
                <td className={`${NUM} py-1 text-text-primary`}>
                  <span className="flex flex-col items-end">
                    <span data-testid="plan-amount">{won(r.amount)}</span>
                    {note && <span className="whitespace-nowrap text-caption text-text-muted">{note}</span>}
                  </span>
                </td>
                <td className={`${NUM} py-1 text-text-secondary`}>
                  <span className="flex flex-col items-end">
                    <span>{priceText(r)}</span>
                    {usdPrice(r) && <span className="text-caption text-text-muted">1주 {usdPrice(r)}</span>}
                  </span>
                </td>
                <td className={`${NUM} text-text-primary`} data-testid="plan-shares">
                  {r.shares == null ? '—' : formatAssetQty(r.shares)}
                </td>
                <td className={`${NUM} pr-4 text-text-secondary`} data-testid="plan-rest">
                  {won(r.rest)}
                </td>
              </tr>
            );
          })}
          <tr className={`border-t border-border/50 ${LIST_TABLE_ROW} font-semibold text-text-primary`} data-testid="plan-sum">
            <td className="pl-4">계좌 합계</td>
            <td className={NUM}>{won(plan.sum)}</td>
            <td className={NUM} />
            <td className={NUM} />
            <td className={`${NUM} pr-4`}>{won(plan.restSum)}</td>
          </tr>
        </tbody>
      </table>
    </ScrollTable>
  );
}

/** 카드 한 줄 — 왼쪽(줄바꿈 · 잘리지 않음) · 오른쪽(줄지 않음) · 자리가 모자라면 오른쪽이 다음 줄로 */
function CardLine({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <div className="min-w-0 break-words keep-all">{left}</div>
      <div className="ml-auto shrink-0 text-right">{right}</div>
    </div>
  );
}

/** 카드(폰) — 줄 1: 줄 이름 → 종목 | 금액 · 줄 2: 「지금 ₩… · 살 주 N주」 | 「남는 돈 ₩…」 */
function PlanCards({ plan, onLink }: { plan: MonthlyPlan; onLink: () => void }) {
  return (
    <div className="space-y-2">
      <DataCardList>
        {plan.rows.map((r) => {
          const note = usdNote(r);
          return (
            <DataCard key={r.name} label={`${r.name} — 살 종목 잇기 설정`} onOpen={onLink}>
              <div className="space-y-1 text-xs" data-testid="plan-row" data-linked={r.symbol != null}>
                <CardLine
                  left={<span className="text-text-primary">{r.symbol == null ? r.name : `${r.name} → ${r.stockName}`}</span>}
                  right={<span className="tabular-nums text-text-primary" data-testid="plan-amount">{won(r.amount)}</span>}
                />
                <CardLine
                  left={
                    <span className="tabular-nums text-text-secondary" data-testid="plan-shares">
                      지금 {priceText(r)} · 살 주 {r.shares == null ? '—' : formatAssetQty(r.shares)}
                    </span>
                  }
                  right={
                    <span className="tabular-nums text-text-secondary" data-testid="plan-rest">
                      남는 돈 {won(r.rest)}
                    </span>
                  }
                />
                {note && <p className="text-caption text-text-muted tabular-nums">{`1주 ${usdPrice(r) ?? '—'} · ${note}`}</p>}
                {r.symbol == null && (
                  <p className="text-caption text-warning keep-all" data-testid="plan-unlinked">
                    종목을 이어 주세요 · <span className="text-accent">설정에서 잇기 ›</span>
                  </p>
                )}
              </div>
            </DataCard>
          );
        })}
      </DataCardList>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 text-xs font-semibold text-text-primary tabular-nums" data-testid="plan-sum">
        <span>계좌 합계 {won(plan.sum)}</span>
        <span className="ml-auto font-normal text-text-secondary">남는 돈 {won(plan.restSum)}</span>
      </div>
    </div>
  );
}

/** 계좌 하나의 목록(펼침) — 이 계좌 묶음이 없으면 그리지 않는다 */
export function AccountPlan({ a, onLink }: { a: MonthlyBuyAccount; onLink: (section: string) => void }) {
  const phone = useLayoutMode() === 'phone';
  const [open, setOpen] = useState(() => !readClosed().includes(a.section));
  const plan = a.plan;
  if (!plan) return null;
  const id = `as-asset-plan-${a.section}`;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    const closed = readClosed().filter((k) => k !== a.section);
    saveClosed(next ? closed : [...closed, a.section]);
  };
  const Arrow = open ? ChevronDown : ChevronRight;
  const link = () => onLink(a.section);
  return (
    <div className="space-y-2" data-testid="plan" data-section={a.section} data-problem={plan.problem ?? ''}>
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-1.5 text-left text-xs text-text-secondary hover:text-text-primary ${TOUCH_LIST_ROW}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={toggle}
        data-testid="plan-toggle"
      >
        <Arrow {...ICON_SM} aria-hidden className="shrink-0" />
        <span className="shrink-0">살 종목</span>
        <span className="min-w-0 tabular-nums text-text-primary keep-all" data-testid="plan-head">
          <HeadText plan={plan} />
        </span>
      </button>
      {open && (
        <div id={id} className="space-y-2">
          {plan.problem === 'values' && (
            <p className="text-xs text-warning keep-all" role="status" data-testid="plan-problem">
              시트 값 확인 — 「적립식 투자」 탭 {plan.headRow}행 묶음의 총 구매할 금액 · 분할 개월 수를 확인해 주세요.
            </p>
          )}
          {plan.problem === 'ratio-sum' && (
            <p className="text-xs text-warning keep-all" role="status" data-testid="plan-problem">
              비율 합이 100% 가 아님(시트 확인{plan.ratioSum != null ? ` — 지금 ${formatNumber(plan.ratioSum, 2, '%')}` : ''}) — 목록을 그리지 않았습니다.
            </p>
          )}
          {plan.problem == null && plan.rows.length > 0 && (phone ? <PlanCards plan={plan} onLink={link} /> : <PlanTable plan={plan} onLink={link} />)}
        </div>
      )}
    </div>
  );
}

/** 구역 위 안내 — 탭을 못 씀(+ [다시 시도]) · 쓰지 않은 묶음 */
export function PlanNotes({ mb, onRetry, retrying }: { mb: MonthlyBuy; onRetry: () => void; retrying: boolean }) {
  const skipped = mb.planSkipped ?? [];
  const rowsOf = (kind: string) => skipped.filter((s) => s.kind === kind).map((s) => `${s.row}행`);
  const lines = [
    rowsOf('shape').length ? `모양이 달라 읽지 않은 묶음 ${rowsOf('shape').length}개(${rowsOf('shape').join(' · ')})` : null,
    rowsOf('no-account').length ? `계좌와 맞지 않아 쓰지 않은 묶음 ${rowsOf('no-account').length}개(${rowsOf('no-account').join(' · ')}) — 머리 줄 첫 낱말을 확인해 주세요` : null,
    rowsOf('same-account').length ? `같은 계좌로 맞아 쓰지 않은 묶음 ${rowsOf('same-account').length}개(${rowsOf('same-account').join(' · ')})` : null,
  ].filter((x): x is string => x != null);
  if (!mb.planError && lines.length === 0) return null;
  return (
    <div className="space-y-1" data-testid="plan-notes">
      {mb.planError && (
        <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-testid="plan-error" data-kind={mb.planError.kind}>
          <span className="min-w-0">계좌별 살 종목 — {mb.planError.message}</span>
          <Button size="sm" variant="ghost" busy={retrying} onClick={onRetry} className="ml-auto">
            다시 시도
          </Button>
        </div>
      )}
      {lines.map((l) => (
        <p key={l} className="text-caption text-text-muted keep-all" role="status" data-testid="plan-skipped">
          {l}
        </p>
      ))}
    </div>
  );
}
