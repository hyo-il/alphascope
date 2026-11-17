import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { Calculator, ChevronDown, ChevronRight, History, Plus, Tags } from 'lucide-react';
import { Button, ICON_SM, IconButton, Panel, Segmented } from '../ui';
import { SkeletonTable } from '../common/SkeletonLoader';
import AssetSymbolTable, { SYMBOL_FILTERS, type SymbolFilter } from './AssetSymbolTable';
import { ASSET_CLASS_W, LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { formatAssetPrice, formatAssetQty, formatAssetWon, formatAssetWonSigned } from '../../utils/assetFormat';
import AssetCashMoveDialog from './AssetCashMoveDialog';
import { UNASSIGNED_LABEL, cashBankGroups, cashBankLabelOf, cashKeysOfRows, cashRowOfKey, type AssetCashManualRequest, type AssetCashManualResult, type AssetAccount, type AssetCashBankFix, type AssetCashKey, type AssetCashRow, type AssetSheetCashBanks, type AssetHolding, type AssetSection, type AssetSheetData, type AssetSymbolRow, type AssetTradeSide } from '../../types/asset';

/**
 * 자산 관리 「자산 현황」 탭 (v2.61.0 1단계 확인 표 → v2.62.1 계좌 카드 → v2.62.2 탭).
 * - 요약(현금 · 퇴직 연금 · 월급 · 구매 평균 환율 · 목표 비율) 아래 **계좌마다 카드**(시트 순서) — 머리 = 계좌 이름 · 종목 수 · 평가 금액 합
 *   (가격 못 받은 줄은 빼고 「N줄 빠짐」) · 머리 줄 끝 작은 화살표(▸ 접힘 / ▾ 펼침) · 접기(처음 모두 펼침 · 접은 계좌는 이 기기에 기억).
 *   카드들 위 안내 한 줄 「계좌를 누르면 종목이 펼쳐져요」(v2.65.3).
 * - 시트의 합계 표(「적립식 주식」 — 계좌를 합친 표)는 보이지 않는다(총 자산에도 더하지 않는다 — 서버 계산).
 * - 줄마다 「자산 분류」 는 **글자로만**(미지정은 흐린 「미지정」 · v2.65.3). 바꾸기는 「자산 분류 정하기」 창에서만 — 「계좌별 | 종목별」 줄 끝 버튼(창은 부모 `AssetDashboard`).
 * - 연금으로 볼 계좌 · 위성으로 선택한 종목 · 자산 분류 색은 오른쪽 위 「설정」 창(`AssetSettingsDialog`).
 * - 계좌 카드 위 「계좌별 | 종목별」(v2.63.0 — 이 기기에 기억 `alphascope.asset.statusView` · 읽기 실패면 계좌별).
 *   종목별 = 같은 종목을 한 줄로(`AssetSymbolTable` · 「전체 / 코어 / 위성」 거르기) — 자산 분류 고르기는 계좌별에서.
 * - 계좌별 줄 끝 [매수] [매도](v2.66.0 — `h.tradable` 인 줄만 · 합친 표 · 수식 칸 · 이을 수 없는 줄은 없음) · 위 [새 종목 매수](v2.67.0 · `AssetNewBuyDialog`) · [매수 · 매도 기록].
 *   계산기 아이콘 버튼(v2.68.0 · v2.68.2 아이콘 — 공용 `IconButton` · 툴팁 · aria-label 「<종목> 평단 계산기」) — 수량 · 평균가가 0 보다 큰 줄이면 [매수] 가 없는 줄에도 보인다(계산만 · `canCalc`).
 * - 「현금 합계」 를 누르면 「현금」 탭 은행 계좌가 **은행별 합계**로 펼쳐진다(v2.71.1 — 은행 순서 = 시트에서 처음 나온 순서 · 은행을 누르면 상품(입출금 · 청년 적금 · 정기 예금 #1 …)이 펼쳐짐 ·
 *   묶기는 `cashBankGroups`(설정 화면 · 서버와 같은 함수) + 시트 응답의 「은행 묶음 고치기」) · 「연금 포함」 이면 퇴직 연금 줄도 따로(v2.70.4 · 펼침은 기억하지 않음).
 *   계좌 합이 시트 총액과 다르면 작은 안내만(총 자산 계산은 시트 총액 그대로 — 서버).
 * - 계좌 카드 머리에 그 계좌와 짝지은 예수금(v2.71.3 · 사용자 결정 2026-11-17) — 「예수금 ₩694,000」 + 작게 은행 · 상품 이름(말줄임 · 잘렸을 때 툴팁).
 *   값은 이미 받은 시트 읽기(「현금」 탭 은행 계좌 줄)와 시트 응답의 짝 설정(`cashDepositPairs`)으로 화면에서 맞춘다(구글 요청 없음) ·
 *   「현금 자동 반영」 이 꺼져 있어도 짝이 있으면 보인다(읽기만) · 짝이 없는 계좌는 아무것도 없음 · 마이너스는 하락 색 숫자 · 「종목별」 보기에는 없음.
 * - [입출금](v2.72.0 · 143차) — 계좌 머리 「예수금 ₩…」 옆(짝이 있는 계좌만 · 처음 계좌 = 그 예수금 · 들어가는 쪽)과 「현금 합계」 펼침의 상품 줄마다(처음 계좌 = 그 줄 · 빠지는 쪽).
 *   작은 글자 버튼(무언가를 바꾸는 버튼) → `AssetCashMoveDialog`(이체 · 입금 · 출금). 잠겼으면 · 시트 쓰기가 꺼졌으면 꺼짐 + 툴팁. 저장되면 부모가 다시 읽는다.
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다(로컬 저장소에는 접은 계좌 이름 · 보기 이름만).
 */

/** [입출금] 을 열 수 있나 — 잠김 · 시트 쓰기 꺼짐이면 꺼짐(툴팁 글) · 아직 모르면 켬(창이 [저장] 을 막는다) */
interface CashMoveGate {
  locked: boolean;
  writeEnabled: boolean | null;
}
const moveOff = (g: CashMoveGate): string | null => (g.locked ? '잠금을 풀면 쓸 수 있어요' : g.writeEnabled === false ? '이 서버에서는 시트 쓰기가 꺼져 있어요' : null);

/** [입출금] 작은 글자 버튼 — 꺼졌으면 툴팁(꺼진 버튼은 마우스 이벤트가 없어 감싼 칸에 단다) */
function CashMoveButton({ name, gate, onOpen }: { name: string; gate: CashMoveGate; onOpen: () => void }) {
  const off = moveOff(gate);
  const button = (
    <Button
      size="sm"
      disabled={off != null}
      aria-label={`${name} 입출금`}
      data-testid="asset-cash-move-open"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      입출금
    </Button>
  );
  return off ? (
    <span className="inline-flex shrink-0" data-tip={off} data-testid="asset-cash-move-off">
      {button}
    </span>
  ) : (
    button
  );
}

/** 값 한 칸 — 이름(13px 회색) 위 · 숫자 아래 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="shrink-0">
      <div className="text-caption text-text-muted">{label}</div>
      <div className="whitespace-nowrap text-sm font-semibold text-text-primary tabular-nums">{value}</div>
    </div>
  );
}

/** 백분율 — 정수면 소수 없이, 아니면 한 자리 */
const pct = (v: number | null) => (v == null ? '—' : formatNumber(v, Number.isInteger(v) ? 0 : 1, '%'));

/** 계좌 줄 합이 시트 총액과 다른가(빈 금액은 빼고 더함 — 시트 SUM 과 같게 · 1원 미만 차이는 같음) */
const sumDiffers = (rows: AssetCashRow[], total: number | null) => total != null && rows.length > 0 && Math.abs(rows.reduce((a, r) => a + (r.amount ?? 0), 0) - total) >= 1;

/** 「현금 합계」 펼침 목록의 최대 폭은 `max-w-xl`(이름이 길어도 금액이 멀리 떨어지지 않게 — 서버도 컴파일하는 `ui/tokens.ts` 는 바꾸지 않는다 · v2.70.4) */

/** 「현금 합계」 펼침 표 끝 칸(v2.72.0) — 은행 표 상품 줄 [입출금] 자리 · 퇴직 연금 표도 같은 폭으로 비워 두 표의 금액 오른쪽 끝을 맞춘다 */
const MOVE_COL = 'pl-3';
/** 끝 칸 안 고정 폭 상자 — 빈 칸도 표 자동 폭에 줄지 않게(버튼 「입출금」 sm 이 들어가는 폭) */
function MoveCell({ children = null }: { children?: ReactNode }) {
  return <div className="flex w-16 justify-end">{children}</div>;
}

/** 「현금」 탭 계좌 줄 한 묶음 — 소제목 · 이름(말줄임) · 금액(오른쪽 정렬) · 합이 총액과 다르면 안내 */
function CashBlock({ heading, rows, total, testId }: { heading: string; rows: AssetCashRow[]; total: number | null; testId: string }) {
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-caption text-text-secondary">{heading}</div>
      {rows.length === 0 ? (
        <p className="text-caption text-text-muted">「현금」 탭에 계좌 줄이 없습니다.</p>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.row} className={LIST_TABLE_ROW} data-cash-row={r.row}>
                <td className={`${TABLE_NAME_COL} max-w-0 border-t border-border/30`}>
                  <span className="block truncate text-text-primary" data-tip-clip={r.name}>
                    {r.name}
                  </span>
                </td>
                <td className={`${NUM} border-t border-border/30 text-text-primary`}>{formatAssetPrice(r.amount, 'KRW')}</td>
                <td className={`${MOVE_COL} border-t border-border/30`}>
                  <MoveCell />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {sumDiffers(rows, total) && (
        <p className="text-caption text-warning" data-testid={`${testId}-mismatch`}>
          계좌 합이 총액과 달라요 — 시트 합계 식을 확인해 주세요
        </p>
      )}
    </div>
  );
}

/** 은행 합 — 빈 금액은 빼고 더함(시트 SUM 과 같게) · 모두 비면 null(「—」) */
const bankSum = (rows: AssetCashRow[]) => (rows.every((r) => r.amount == null) ? null : rows.reduce((a, r) => a + (r.amount ?? 0), 0));

/** 「현금」 탭 은행 계좌 — 은행별 합계(누르면 상품 펼침 · 펼침은 기억하지 않음) · 합이 총액과 다르면 안내 */
function BankCashBlock({
  rows,
  total,
  fix,
  gate,
  onMove,
}: {
  rows: AssetCashRow[];
  total: number | null;
  fix: AssetCashBankFix | undefined;
  gate: CashMoveGate;
  /** 상품 줄 [입출금](v2.72.0) — 그 줄 열쇠로 창 열기 */
  onMove: (key: AssetCashKey) => void;
}) {
  const groups = cashBankGroups(rows, (r) => r.name, fix);
  const keys = new Map(cashKeysOfRows(rows).map((k) => [k.row, k.key]));
  const [open, setOpen] = useState<string[]>([]);
  const testId = 'asset-cash-bank';
  return (
    <div className="space-y-1" data-testid={testId}>
      <div className="text-caption text-text-secondary">은행 계좌 — 은행을 누르면 상품이 펼쳐져요</div>
      {rows.length === 0 ? (
        <p className="text-caption text-text-muted">「현금」 탭에 계좌가 없습니다.</p>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-left text-xs">
          <tbody>
            {groups.map((g) => {
              const isOpen = open.includes(g.bank);
              const Arrow = isOpen ? ChevronDown : ChevronRight;
              const sum = bankSum(g.items.map((it) => it.row));
              return (
                <Fragment key={g.bank}>
                  <tr className={LIST_TABLE_ROW} data-cash-bank={g.bank}>
                    <td className={`${TABLE_NAME_COL} max-w-0 border-t border-border/30`}>
                      <button
                        type="button"
                        className="flex w-full min-w-0 cursor-pointer items-center gap-1 text-left text-text-primary"
                        aria-expanded={isOpen}
                        aria-label={`${g.bank} 상품 ${isOpen ? '접기' : '펼치기'}`}
                        onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== g.bank) : [...o, g.bank]))}
                      >
                        <Arrow {...ICON_SM} className="shrink-0 text-text-muted" />
                        <span className="min-w-0 truncate font-medium" data-tip-clip={g.bank}>
                          {g.bank}
                        </span>
                        <span className="shrink-0 text-caption text-text-muted">{g.items.length}개</span>
                      </button>
                    </td>
                    <td className={`${NUM} border-t border-border/30 font-medium text-text-primary`} data-cash-bank-sum>
                      {formatAssetPrice(sum, 'KRW')}
                    </td>
                    <td className={`${MOVE_COL} border-t border-border/30`}>
                      <MoveCell />
                    </td>
                  </tr>
                  {isOpen &&
                    g.items.map((it) => (
                      <tr key={it.row.row} className={LIST_TABLE_ROW} data-cash-row={it.row.row}>
                        <td className={`${TABLE_NAME_COL} max-w-0 pl-7`}>
                          <span className="block truncate text-text-secondary" data-tip-clip={it.row.name}>
                            {it.label}
                          </span>
                        </td>
                        <td className={`${NUM} text-text-secondary`}>{formatAssetPrice(it.row.amount, 'KRW')}</td>
                        <td className={MOVE_COL}>
                          <MoveCell>{keys.get(it.row) && <CashMoveButton name={it.full} gate={gate} onOpen={() => onMove(keys.get(it.row) as AssetCashKey)} />}</MoveCell>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      {sumDiffers(rows, total) && (
        <p className="text-caption text-warning" data-testid={`${testId}-mismatch`}>
          계좌 합이 총액과 달라요 — 시트 합계 식을 확인해 주세요
        </p>
      )}
    </div>
  );
}

/** 현금 · 연금 · 월급 · 환율 한 줄, 목표 비율 한 줄 — 칸은 내용 폭(금액이 길어져도 겹치지 않고 다음 줄로) */
function Summary({
  data,
  includePension,
  bankFix,
  gate,
  onMove,
}: {
  data: AssetSheetData;
  includePension: boolean;
  bankFix: AssetCashBankFix | undefined;
  gate: CashMoveGate;
  onMove: (key: AssetCashKey) => void;
}) {
  const t = data.targetRatio;
  const [cashOpen, setCashOpen] = useState(false);
  const CashArrow = cashOpen ? ChevronDown : ChevronRight;
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {/* 「현금 합계」 칸 전체가 누르는 곳 — 계좌별 금액 펼침(읽기만) */}
        <button
          type="button"
          className="shrink-0 cursor-pointer text-left"
          aria-expanded={cashOpen}
          aria-controls="as-asset-cashlist"
          aria-label={`현금 합계 ${cashOpen ? '접기' : '은행별로 펼치기'}`}
          data-testid="asset-cash-toggle"
          onClick={() => setCashOpen((v) => !v)}
        >
          <span className="flex items-center gap-1 text-caption text-text-muted">
            현금 합계
            <CashArrow {...ICON_SM} className="shrink-0" />
          </span>
          <span className="block whitespace-nowrap text-sm font-semibold text-text-primary tabular-nums">{formatPrice(data.cashTotal, 'KRW')}</span>
        </button>
        <Field label="퇴직 연금" value={formatPrice(data.retirement, 'KRW')} />
        <Field label="월급" value={formatPrice(data.salary, 'KRW')} />
        <Field label="구매 평균 환율(원/$)" value={data.avgFxRate == null ? '—' : `₩${formatNumber(data.avgFxRate, 2)}`} />
      </div>
      {cashOpen && (
        <div id="as-asset-cashlist" className="max-w-xl space-y-3" data-testid="asset-cash-accounts">
          <BankCashBlock rows={data.cashAccounts} total={data.cashTotal} fix={bankFix} gate={gate} onMove={onMove} />
          {includePension && <CashBlock heading="퇴직 연금" rows={data.retirementAccounts} total={data.retirement} testId="asset-cash-retirement" />}
        </div>
      )}
      {/* 목표 비율 두 묶음 — 자산 배분(합 100%)과 주식 안의 코어 · 위성(합 100%)을 나눠 보인다(한 줄이면 합이 200% 로 읽힌다).
          순서 · 이름은 비율 조정 탭과 같게 현금 · 채권 · 금 · 주식(v2.64.0 — 시트 칸 「투자」 = 화면 「주식」 · 시트 칸 순서는 그대로) */}
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 자산 배분</div>
          <div className="flex gap-x-8">
            <Field label="현금" value={pct(t.cash)} />
            <Field label="채권" value={pct(t.bond)} />
            <Field label="금" value={pct(t.gold)} />
            <Field label="주식" value={pct(t.invest)} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 주식 안의 코어 · 위성</div>
          <div className="flex gap-x-8">
            <Field label="코어" value={pct(t.core)} />
            <Field label="위성" value={pct(t.satellite)} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** 평단 계산기를 열 수 있는 줄 — 수량 · 평균가가 0 보다 큰 숫자(시트 쓰기와 상관없음 · 계산만) */
export const canCalc = (h: AssetHolding) => h.quantity != null && h.quantity > 0 && h.avgPrice != null && h.avgPrice > 0;

/** 「계좌별 | 종목별」 — 이 기기에 기억(읽기 실패 · 모르는 값이면 계좌별) */
type StatusView = 'account' | 'symbol';
const VIEW_KEY = 'alphascope.asset.statusView';
const VIEWS: { value: StatusView; label: string }[] = [
  { value: 'account', label: '계좌별' },
  { value: 'symbol', label: '종목별' },
];
function readView(): StatusView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'symbol' ? 'symbol' : 'account';
  } catch {
    return 'account';
  }
}
function saveView(v: StatusView) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* 기억하지 못해도 화면은 그대로 */
  }
}

/** 접은 계좌(key) — 이 기기에 기억. 처음은 모두 펼침 */
const CLOSED_KEY = 'alphascope.asset.closedAccounts';
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

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;
const TEXT = `${TABLE_NUM_COL} ${TABLE_NUM_GAP}`;
const COLS = 7;
/** 카드 바탕(`Panel` 과 같은 바탕) — 표 칸마다 칠해 카드처럼 보인다 */
const CARD_BG = 'bg-bg-secondary';

/** 자산 분류 글자 한 칸 — 이을 수 없는 줄은 「—」 + 툴팁(「티커」 줄이 없다) · 미지정은 흐린 「미지정」 */
function ClassText({ h }: { h: AssetHolding }) {
  if (h.tickerRow == null)
    return (
      <span className={`inline-block ${ASSET_CLASS_W} text-center text-text-muted`} data-tip="「티커」 탭과 이을 수식이 없어 고를 수 없습니다">
        —
      </span>
    );
  return (
    <span className={`inline-block ${ASSET_CLASS_W} text-center ${h.assetClass ? 'text-text-primary' : 'text-text-muted'}`} data-asset-class>
      {h.assetClass ?? UNASSIGNED_LABEL}
    </span>
  );
}

/**
 * 계좌 카드 하나 = 표의 `tbody` 하나 — 머리 줄(이름 · 종목 수 · 평가 금액 합 · 화살표 ▸/▾ — 머리 줄 아무 곳을 눌러도 펴고 접음) + 칸 이름 줄 + 보유 줄.
 * 카드들을 **표 하나**로 그려 숫자 칸은 내용 폭 그대로 두고 카드끼리 열 자리가 같다(카드마다 표를 따로 두면 열 자리가 어긋난다).
 * 카드 모양 = 칸마다 바탕을 칠하고 머리 · 마지막 줄 끝 칸만 둥글게 · 카드 사이는 빈 줄(바탕 없음 12px).
 */
/** 계좌 머리 예수금 — 짝 줄 이름(은행 · 상품) · 지금 금액(시트 C열 · 숫자 아님 · 줄 못 찾음이면 null) */
interface AccountDeposit {
  /** 짝 줄 열쇠(v2.72.0 — [입출금] 처음 계좌) */
  key: AssetCashKey;
  label: string;
  amount: number | null;
}

/** 시트 응답 값 가운데 읽기 응답에만 오는 것(은행 묶음 고치기 · 예수금 짝) — 쓰기 응답(시트 값만)으로 바뀌어도 마지막 값을 그대로 쓴다 */
function useLastSent<T>(sent: T | undefined): T | undefined {
  const [last, setLast] = useState<T | undefined>(sent);
  useEffect(() => {
    if (sent) setLast(sent);
  }, [sent]);
  return sent ?? last;
}

/** 계좌 key → 머리 예수금(짝이 없으면 없음) */
function depositOf(pairs: Record<string, AssetCashKey> | undefined, rows: AssetCashRow[], fix: AssetCashBankFix | undefined, sectionKey: string | null): AccountDeposit | null {
  const key = sectionKey != null ? pairs?.[sectionKey] : undefined;
  if (!key) return null;
  const label = cashBankLabelOf(key, rows.map((r) => r.name), fix) ?? (key.nth > 1 ? `${key.name} #${key.nth}` : key.name);
  return { key, label, amount: cashRowOfKey(rows, key)?.amount ?? null };
}

function AccountCard({
  section,
  account,
  deposit,
  first,
  open,
  onToggle,
  onTrade,
  onCalc,
  gate,
  onMove,
}: {
  section: AssetSection;
  account: AssetAccount | undefined;
  /** 짝지은 예수금(v2.71.3) — 짝이 없으면 null */
  deposit: AccountDeposit | null;
  gate: CashMoveGate;
  /** 예수금 [입출금](v2.72.0) — 그 예수금 열쇠로 창 열기 */
  onMove: (key: AssetCashKey) => void;
  first: boolean;
  open: boolean;
  onToggle: () => void;
  /** [매수] · [매도] — 입력 창 열기 */
  onTrade: (section: AssetSection, holding: AssetHolding, side: AssetTradeSide) => void;
  /** 계산기 아이콘 — 평단 계산기 열기 */
  onCalc: (section: AssetSection, holding: AssetHolding) => void;
}) {
  const id = `as-asset-account-${section.key}`;
  const rows = section.holdings;
  /** 마지막 줄의 왼쪽 · 오른쪽 끝 칸 둥글게 */
  const lastL = (last: boolean) => (last ? 'rounded-bl-xl' : '');
  const lastR = (last: boolean) => (last ? 'rounded-br-xl' : '');
  const Arrow = open ? ChevronDown : ChevronRight;
  return (
    <tbody data-account={section.key ?? ''}>
      {!first && (
        <tr aria-hidden className="h-3">
          <td colSpan={COLS} />
        </tr>
      )}
      <tr className={LIST_TABLE_ROW}>
        {/* 머리 줄 전체가 누르는 곳 — 마우스 · Enter/Space 로 펴고 접는다(안에 다른 조작 없음 · 화살표는 펼침 상태만 보인다 · v2.65.3) */}
        <th
          colSpan={COLS}
          scope="colgroup"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          aria-controls={id}
          data-account-head
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            onToggle();
          }}
          className={`${CARD_BG} px-4 text-left font-normal ${open ? 'rounded-t-xl border-b border-border/50' : 'rounded-xl'}`}
        >
          <span className="flex items-center gap-3">
            <span className="min-w-0 truncate text-sm font-semibold text-text-primary" data-tip-clip={section.name}>
              {section.name || '이름 없는 계좌'}
            </span>
            <span className="shrink-0 whitespace-nowrap text-caption text-text-muted" data-count>
              {rows.length}종목
            </span>
            {deposit && (
              // 예수금 이름은 표 폭 계산에 넣지 않는다(contain-inline-size — 긴 이름이 계좌 표 전체를 넓히지 않고 남은 자리에서 말줄임)
              <span className="flex min-w-0 flex-1 items-baseline gap-1.5" data-account-deposit={deposit.amount == null ? 'none' : deposit.amount < 0 ? 'minus' : 'plus'}>
                <span className="shrink-0 whitespace-nowrap text-xs text-text-secondary">
                  예수금{' '}
                  <span className={`font-semibold tabular-nums ${deposit.amount != null && deposit.amount < 0 ? 'text-bearish' : 'text-text-primary'}`} data-account-deposit-amount>
                    {deposit.amount != null && deposit.amount < 0 ? formatAssetWonSigned(deposit.amount) : formatAssetWon(deposit.amount)}
                  </span>
                </span>
                <span className="shrink-0 self-center">
                  <CashMoveButton name={`${section.name || '계좌'} 예수금`} gate={gate} onOpen={() => onMove(deposit.key)} />
                </span>
                <span className="min-w-0 flex-1 truncate text-caption text-text-muted contain-inline-size" data-tip-clip={deposit.label} data-account-deposit-label>
                  {deposit.label}
                </span>
              </span>
            )}
            <span className="ml-auto shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-text-primary" data-value>
              {account ? formatPrice(account.value, 'KRW') : '—'}
            </span>
            {account != null && account.missing > 0 && (
              <span className="shrink-0 whitespace-nowrap text-caption text-warning" data-tip="가격을 받지 못한 줄은 평가 금액 합에서 빠졌습니다">
                {account.missing}줄 빠짐
              </span>
            )}
            <Arrow {...ICON_SM} aria-hidden={false} className="shrink-0 text-text-muted" role="img" aria-label={open ? '접기' : '펼치기'} data-account-arrow={open ? 'open' : 'closed'} />
          </span>
        </th>
      </tr>
      {open && rows.length === 0 && (
        <tr id={id} className={LIST_TABLE_ROW}>
          <td colSpan={COLS} className={`${CARD_BG} rounded-b-xl px-4 text-text-muted`}>
            이 계좌에 보유 종목이 없습니다.
          </td>
        </tr>
      )}
      {open && rows.length > 0 && (
        <tr id={id} className={`text-caption text-text-muted ${TABLE_HEAD_ROW}`}>
          <th className={`${CARD_BG} ${TABLE_NAME_COL} pl-4 text-left font-normal`}>종목</th>
          <th className={`${CARD_BG} ${TEXT} text-left font-normal`}>코드</th>
          <th className={`${CARD_BG} ${TEXT} text-left font-normal`}>시장</th>
          <th className={`${CARD_BG} ${NUM} font-normal`}>수량</th>
          <th className={`${CARD_BG} ${NUM} font-normal`}>평균 매입가</th>
          <th className={`${CARD_BG} ${TEXT} text-center font-normal`}>자산 분류</th>
          <th className={`${CARD_BG} ${TEXT} pr-4 text-right font-normal`}>입력</th>
        </tr>
      )}
      {open &&
        rows.map((h, i) => {
          const last = i === rows.length - 1;
          return (
            <tr key={h.row} className={LIST_TABLE_ROW}>
              <td className={`${CARD_BG} ${lastL(last)} max-w-0 border-t border-border/30 pl-4`}>
                <span className="block truncate text-text-primary" data-tip-clip={h.name}>
                  {h.name}
                </span>
              </td>
              <td className={`${CARD_BG} ${TEXT} border-t border-border/30 text-text-secondary`} data-tip={h.code ?? '「티커」 탭과 이을 수식이 없습니다'}>
                {h.symbol ?? '—'}
                {h.exchange && <span className="ml-1 text-caption text-text-muted">{h.exchange}</span>}
              </td>
              <td className={`${CARD_BG} ${TEXT} border-t border-border/30 text-text-secondary`}>{h.market === 'US' ? '미국' : h.market === 'KR' ? '국내' : '—'}</td>
              <td className={`${CARD_BG} ${NUM} border-t border-border/30 text-text-primary`}>{formatAssetQty(h.quantity)}</td>
              <td className={`${CARD_BG} ${NUM} border-t border-border/30 text-text-primary`}>{formatAssetPrice(h.avgPrice, h.currency)}</td>
              <td className={`${CARD_BG} ${TEXT} border-t border-border/30 text-center`}>
                <ClassText h={h} />
              </td>
              <td className={`${CARD_BG} ${lastR(last)} ${TEXT} border-t border-border/30 pr-4 text-right`} data-trade-cell>
                {(h.tradable || canCalc(h)) && (
                  <span className="inline-flex gap-1">
                    {h.tradable && (
                      <>
                        <Button variant="buy" size="sm" onClick={() => onTrade(section, h, 'buy')} aria-label={`${h.name} 매수 입력`} data-trade-buy={h.row}>
                          매수
                        </Button>
                        <Button variant="sell" size="sm" onClick={() => onTrade(section, h, 'sell')} aria-label={`${h.name} 매도 입력`} data-trade-sell={h.row}>
                          매도
                        </Button>
                      </>
                    )}
                    {canCalc(h) && (
                      <IconButton icon={Calculator} label="평단 계산기" aria-label={`${h.name} 평단 계산기`} onClick={() => onCalc(section, h)} data-avgcalc-open={h.row} />
                    )}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
    </tbody>
  );
}

/** 계좌 카드들 — 합계 표(계좌를 합친 표)는 그리지 않는다 · 수량 · 달러 소수 자릿수는 모든 카드가 같다 */
function AccountCards({
  sections,
  accounts,
  cashRows,
  pairs,
  bankFix,
  onTrade,
  onCalc,
  gate,
  onMove,
}: {
  sections: AssetSection[];
  accounts: AssetAccount[];
  gate: CashMoveGate;
  onMove: (key: AssetCashKey) => void;
  /** 「현금」 탭 은행 계좌 줄 · 예수금 짝 · 은행 묶음 고치기(계좌 머리 예수금 — v2.71.3) */
  cashRows: AssetCashRow[];
  pairs: Record<string, AssetCashKey> | undefined;
  bankFix: AssetCashBankFix | undefined;
  onTrade: (section: AssetSection, holding: AssetHolding, side: AssetTradeSide) => void;
  onCalc: (section: AssetSection, holding: AssetHolding) => void;
}) {
  const shown = sections.filter((s) => !s.combined);
  const [closed, setClosed] = useState<string[]>(readClosed);
  const toggle = (key: string) => {
    const next = closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key];
    setClosed(next);
    saveClosed(next);
  };
  return (
    /* 평균 매입가는 줄마다 통화가 다르고(원 정수 · $ 소수 2자리) 수량은 「30주」 · 「0.5주」(끝 0 지움 — `assetFormat.ts`) — design:check 의 「같은 열 소수 자릿수」 는 이 표에서 재지 않는다(`data-rows-differ`) */
    /* 입력 칸이 늘어 좁은 창에서는 표가 칸보다 넓다 — 표만 칸 안에서 가로로 움직인다(넓은 창에서는 변화 없음) */
    <div className="overflow-x-auto" data-account-cards-wrap>
    <table className="w-full border-separate border-spacing-0 text-left text-xs" data-rows-differ data-account-cards>
      {shown.map((s, i) => {
        const key = s.key ?? `#${i}`;
        return (
          <AccountCard
            key={key}
            section={s}
            account={accounts.find((a) => a.key === s.key)}
            deposit={depositOf(pairs, cashRows, bankFix, s.key)}
            first={i === 0}
            open={!closed.includes(key)}
            onToggle={() => toggle(key)}
            onTrade={onTrade}
            onCalc={onCalc}
            gate={gate}
            onMove={onMove}
          />
        );
      })}
    </table>
    </div>
  );
}

/** 「자산 현황」 탭 전체 — 요약 · 보기 고르기 · 계좌 카드(분류는 글자만) / 종목별 표 */
export default function AssetSheetValues({
  data,
  accounts,
  bySymbol,
  onOpenClassDialog,
  onTrade,
  onCalc,
  onNewBuy,
  onOpenTradeHistory,
  newBuyNotes,
  includePension,
  cashGate,
  onCashMove,
  onCashMoved,
}: {
  data: AssetSheetData;
  /** [입출금](v2.72.0) — 잠김 · 시트 쓰기 켬(요약 응답 · 모르면 null) */
  cashGate: CashMoveGate;
  /** 입출금 저장 — `POST /api/asset/cash/manual` */
  onCashMove: (req: AssetCashManualRequest) => Promise<{ error: string } | { result: AssetCashManualResult }>;
  /** 입출금 저장됨 — 다시 읽기 */
  onCashMoved: () => void;
  /** 「연금 포함」 — 켜져 있으면 「현금 합계」 펼침에 퇴직 연금 줄도(v2.70.4) */
  includePension: boolean;
  /** 카드 머리 평가 금액 합 · 가격 못 받은 줄 수(총 자산 요약 응답) */
  accounts: AssetAccount[];
  /** 종목별 줄(총 자산 요약 응답) — 아직 받지 못했으면 null(뼈대) */
  bySymbol: AssetSymbolRow[] | null;
  /** [자산 분류 정하기] — 창 열기 */
  onOpenClassDialog: () => void;
  /** 종목 줄 [매수] · [매도] — 입력 창 열기(v2.66.0) */
  onTrade: (section: AssetSection, holding: AssetHolding, side: AssetTradeSide) => void;
  /** 종목 줄 계산기 아이콘 — 평단 계산기 열기(v2.68.0) */
  onCalc: (section: AssetSection, holding: AssetHolding) => void;
  /** [매수 · 매도 기록] — 창 열기 */
  onNewBuy: () => void;
  onOpenTradeHistory: () => void;
  /** 새 종목을 줄로 넣은 뒤 안내(합친 표 · 비율 탭 — 없으면 빈 배열) */
  newBuyNotes: string[];
}) {
  const [view, setView] = useState<StatusView>(readView);
  const [filter, setFilter] = useState<SymbolFilter>('all');
  const sent = data as AssetSheetData & AssetSheetCashBanks;
  const bankFix = useLastSent(sent.cashBankFix);
  const pairs = useLastSent(sent.cashDepositPairs);
  /** [입출금] 창 — 처음 계좌 · 이체의 그 쪽(예수금 머리 = 들어가는 쪽 · 상품 줄 = 빠지는 쪽) */
  const [move, setMove] = useState<{ key: AssetCashKey; side: 'from' | 'to'; opened: number } | null>(null);

  return (
    <div className="space-y-3">
      <Summary data={data} includePension={includePension} bankFix={bankFix} gate={cashGate} onMove={(key) => setMove({ key, side: 'from', opened: Date.now() })} />
      <div className="flex flex-wrap items-center gap-3">
        {/* 도구 줄 높이 28px 하나(v2.69.0) — 아이콘 버튼 md(28) 와 같은 줄이라 묶음 버튼 · 글자 버튼은 sm */}
        <Segmented
          size="sm"
          label="자산 현황 보기"
          options={VIEWS}
          value={view}
          onChange={(v) => {
            setView(v);
            saveView(v);
          }}
        />
        {view === 'symbol' && <Segmented size="sm" label="코어 · 위성 거르기" options={SYMBOL_FILTERS} value={filter} onChange={setFilter} />}
        {/* 창을 열기만 하는 도구 버튼은 아이콘만(v2.69.0 · 툴팁 = 예전 글자) · 「새 종목 매수」 는 매수 — 글자 그대로 */}
        <IconButton size="md" icon={Tags} label="자산 분류 정하기" onClick={onOpenClassDialog} data-open-class-dialog />
        {view === 'account' && (
          <>
            <Button size="sm" icon={Plus} onClick={onNewBuy} data-trade-new>
              새 종목 매수
            </Button>
            <IconButton size="md" icon={History} label="매수 · 매도 기록" onClick={onOpenTradeHistory} data-trade-history-open />
          </>
        )}
      </div>
      {view === 'account' && (
        <>
          {newBuyNotes.length > 0 && (
            <div className="space-y-0.5" data-newbuy-saved-notes>
              {newBuyNotes.map((note) => (
                <p key={note} className="text-caption text-text-muted keep-all">
                  {note}
                </p>
              ))}
            </div>
          )}
          <p className="text-caption text-text-muted" data-account-hint>
            계좌를 누르면 종목이 펼쳐져요
          </p>
          <AccountCards sections={data.sections} accounts={accounts} cashRows={data.cashAccounts} pairs={pairs} bankFix={bankFix} onTrade={onTrade} onCalc={onCalc} gate={cashGate} onMove={(key) => setMove({ key, side: 'to', opened: Date.now() })} />
        </>
      )}
      {view === 'symbol' && (bySymbol == null ? <SkeletonTable rows={6} columns={8} /> : <AssetSymbolTable rows={bySymbol} filter={filter} />)}
      {move && (
        <AssetCashMoveDialog
          key={move.opened}
          rows={data.cashAccounts}
          fix={bankFix}
          initial={move.key}
          initialSide={move.side}
          writeEnabled={cashGate.writeEnabled}
          onSend={onCashMove}
          onSaved={() => {
            setMove(null);
            onCashMoved();
          }}
          onClose={() => setMove(null)}
        />
      )}
    </div>
  );
}
