import { useState } from 'react';
import { Calculator, ChevronDown, ChevronRight, History, Plus, Tags } from 'lucide-react';
import { Button, ICON_SM, IconButton, Panel, Segmented } from '../ui';
import { SkeletonTable } from '../common/SkeletonLoader';
import AssetSymbolTable, { SYMBOL_FILTERS, type SymbolFilter } from './AssetSymbolTable';
import { ASSET_CLASS_W, LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { formatAssetPrice, formatAssetQty } from '../../utils/assetFormat';
import { UNASSIGNED_LABEL, type AssetAccount, type AssetHolding, type AssetSection, type AssetSheetData, type AssetSymbolRow, type AssetTradeSide } from '../../types/asset';

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
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다(로컬 저장소에는 접은 계좌 이름 · 보기 이름만).
 */

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

/** 현금 · 연금 · 월급 · 환율 한 줄, 목표 비율 한 줄 — 칸은 내용 폭(금액이 길어져도 겹치지 않고 다음 줄로) */
function Summary({ data }: { data: AssetSheetData }) {
  const t = data.targetRatio;
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Field label="현금 합계" value={formatPrice(data.cashTotal, 'KRW')} />
        <Field label="퇴직 연금" value={formatPrice(data.retirement, 'KRW')} />
        <Field label="월급" value={formatPrice(data.salary, 'KRW')} />
        <Field label="구매 평균 환율(원/$)" value={data.avgFxRate == null ? '—' : `₩${formatNumber(data.avgFxRate, 2)}`} />
      </div>
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
      <span className={`inline-block ${ASSET_CLASS_W} text-center text-text-muted`} title="「티커」 탭과 이을 수식이 없어 고를 수 없습니다">
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
function AccountCard({
  section,
  account,
  first,
  open,
  onToggle,
  onTrade,
  onCalc,
}: {
  section: AssetSection;
  account: AssetAccount | undefined;
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
            <span className="min-w-0 truncate text-sm font-semibold text-text-primary" title={section.name}>
              {section.name || '이름 없는 계좌'}
            </span>
            <span className="shrink-0 whitespace-nowrap text-caption text-text-muted" data-count>
              {rows.length}종목
            </span>
            <span className="ml-auto shrink-0 whitespace-nowrap text-xs font-semibold tabular-nums text-text-primary" data-value>
              {account ? formatPrice(account.value, 'KRW') : '—'}
            </span>
            {account != null && account.missing > 0 && (
              <span className="shrink-0 whitespace-nowrap text-caption text-warning" title="가격을 받지 못한 줄은 평가 금액 합에서 빠졌습니다">
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
                <span className="block truncate text-text-primary" title={h.name}>
                  {h.name}
                </span>
              </td>
              <td className={`${CARD_BG} ${TEXT} border-t border-border/30 text-text-secondary`} title={h.code ?? '「티커」 탭과 이을 수식이 없습니다'}>
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
function AccountCards({ sections, accounts, onTrade, onCalc }: { sections: AssetSection[]; accounts: AssetAccount[]; onTrade: (section: AssetSection, holding: AssetHolding, side: AssetTradeSide) => void; onCalc: (section: AssetSection, holding: AssetHolding) => void }) {
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
            first={i === 0}
            open={!closed.includes(key)}
            onToggle={() => toggle(key)}
            onTrade={onTrade}
            onCalc={onCalc}
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
}: {
  data: AssetSheetData;
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

  return (
    <div className="space-y-3">
      <Summary data={data} />
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="자산 현황 보기"
          options={VIEWS}
          value={view}
          onChange={(v) => {
            setView(v);
            saveView(v);
          }}
        />
        {view === 'symbol' && <Segmented label="코어 · 위성 거르기" options={SYMBOL_FILTERS} value={filter} onChange={setFilter} />}
        <Button size="md" icon={Tags} onClick={onOpenClassDialog} data-open-class-dialog>
          자산 분류 정하기
        </Button>
        {view === 'account' && (
          <>
            <Button size="md" icon={Plus} onClick={onNewBuy} data-trade-new>
              새 종목 매수
            </Button>
            <Button size="md" icon={History} onClick={onOpenTradeHistory} data-trade-history-open>
              매수 · 매도 기록
            </Button>
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
          <AccountCards sections={data.sections} accounts={accounts} onTrade={onTrade} onCalc={onCalc} />
        </>
      )}
      {view === 'symbol' && (bySymbol == null ? <SkeletonTable rows={6} columns={8} /> : <AssetSymbolTable rows={bySymbol} filter={filter} />)}
    </div>
  );
}
