import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { DisclosureButton, ICON_SM, Panel, Segmented, Select } from '../ui';
import { SkeletonTable } from '../common/SkeletonLoader';
import AssetSymbolTable, { SYMBOL_FILTERS, type SymbolFilter } from './AssetSymbolTable';
import { ASSET_CLASS_W, LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { ASSET_CLASSES, UNASSIGNED_SHORT, type AssetAccount, type AssetClass, type AssetHolding, type AssetSection, type AssetSheetData, type AssetSymbolRow } from '../../types/asset';

/**
 * 자산 관리 「자산 현황」 탭 (v2.61.0 1단계 확인 표 → v2.62.1 계좌 카드 → v2.62.2 탭).
 * - 요약(현금 · 퇴직 연금 · 월급 · 구매 평균 환율 · 목표 비율) 아래 **계좌마다 카드**(시트 순서) — 머리 = 계좌 이름 · 종목 수 · 평가 금액 합
 *   (가격 못 받은 줄은 빼고 「N줄 빠짐」) · 접기(처음 모두 펼침 · 접은 계좌는 이 기기에 기억).
 * - 시트의 합계 표(「적립식 주식」 — 계좌를 합친 표)는 보이지 않는다(총 자산에도 더하지 않는다 — 서버 계산).
 * - 줄마다 「자산 분류」 고르기 → 시트 「티커」 D열에 바로 쓴다(그 칸만 로딩 · 실패하면 원래 값으로 되돌리고 이유 한 줄).
 *   같은 「티커」 줄에 이어진 줄은 함께 바뀐다(분류는 종목마다 하나).
 * - 연금으로 볼 계좌 · 위성으로 선택한 종목 · 자산 분류 색은 오른쪽 위 「설정」 창(`AssetSettingsDialog`).
 * - 계좌 카드 위 「계좌별 | 종목별」(v2.63.0 — 이 기기에 기억 `alphascope.asset.statusView` · 읽기 실패면 계좌별).
 *   종목별 = 같은 종목을 한 줄로(`AssetSymbolTable` · 「전체 / 코어 / 위성」 거르기) — 자산 분류 고르기는 계좌별에서.
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

/** 칸 안 소수 자릿수 — 같은 열은 같은 자릿수(가장 긴 것 · 최대 4자리) */
function decimalsOf(values: (number | null)[]): number {
  let d = 0;
  for (const v of values) {
    if (v == null || Number.isInteger(v)) continue;
    const frac = String(v).split('.')[1] ?? '';
    d = Math.max(d, Math.min(4, frac.length));
  }
  return d;
}

/** 평균 매입가 — 원래 통화 그대로. 달러는 시트 값(소수 4자리까지)을 줄이지 않는다 */
function avgText(h: AssetHolding, usdDigits: number): string {
  if (h.avgPrice == null) return '—';
  if (h.currency === 'KRW') return formatPrice(h.avgPrice, 'KRW');
  return `$${formatNumber(h.avgPrice, Math.max(2, usdDigits))}`;
}

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
const COLS = 6;
/** 카드 바탕(`Panel` 과 같은 바탕) — 표 칸마다 칠해 카드처럼 보인다 */
const CARD_BG = 'bg-bg-secondary';

/**
 * 자산 분류 고르기 한 칸 — 이을 수 없는 줄은 고를 수 없다(「티커」 줄이 없다). 선택 글자 · 목록 모두 가운데 정렬.
 * 첫 항목 「-」 = 미지정(빈칸 · 세 글자가 아닌 글자 모두 — 옛 「현금」 포함 · v2.65.2) — 고르면 시트 칸을 비운다. 모르는 글자가 있던 줄도 「-」 로 보이고 다른 값을 고르면 덮어쓴다.
 */
function ClassPicker({ h, saving, onPick }: { h: AssetHolding; saving: boolean; onPick: (row: number, value: AssetClass | '') => void }) {
  if (h.tickerRow == null)
    return (
      <span className={`inline-block ${ASSET_CLASS_W} text-center text-text-muted`} title="「티커」 탭과 이을 수식이 없어 고를 수 없습니다">
        —
      </span>
    );
  const value = h.assetClass ?? '';
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        size="sm"
        aria-label={`${h.name} 자산 분류`}
        value={value}
        disabled={saving}
        onChange={(e) => onPick(h.tickerRow!, e.target.value as AssetClass | '')}
        className={`${ASSET_CLASS_W} text-center [text-align-last:center]`}
      >
        <option value="" className="text-center" title="미지정">
          {UNASSIGNED_SHORT}
        </option>
        {ASSET_CLASSES.map((c) => (
          <option key={c} value={c} className="text-center">
            {c}
          </option>
        ))}
      </Select>
      {/* 쓰는 동안 그 칸만 — 자리를 늘 잡아 두어 줄 폭이 흔들리지 않게 */}
      <span className="inline-flex w-4 justify-center" aria-hidden={!saving}>
        {saving && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="쓰는 중" />}
      </span>
    </span>
  );
}

/**
 * 계좌 카드 하나 = 표의 `tbody` 하나 — 머리 줄(이름 · 종목 수 · 평가 금액 합 · 접기) + 칸 이름 줄 + 보유 줄.
 * 카드들을 **표 하나**로 그려 숫자 칸은 내용 폭 그대로 두고 카드끼리 열 자리가 같다(카드마다 표를 따로 두면 열 자리가 어긋난다).
 * 카드 모양 = 칸마다 바탕을 칠하고 머리 · 마지막 줄 끝 칸만 둥글게 · 카드 사이는 빈 줄(바탕 없음 12px).
 */
function AccountCard({
  section,
  account,
  first,
  qtyDigits,
  usdDigits,
  open,
  onToggle,
  savingRows,
  onPick,
}: {
  section: AssetSection;
  account: AssetAccount | undefined;
  first: boolean;
  qtyDigits: number;
  usdDigits: number;
  open: boolean;
  onToggle: () => void;
  savingRows: Set<number>;
  onPick: (row: number, value: AssetClass | '') => void;
}) {
  const id = `as-asset-account-${section.key}`;
  const rows = section.holdings;
  /** 마지막 줄의 왼쪽 · 오른쪽 끝 칸 둥글게 */
  const lastL = (last: boolean) => (last ? 'rounded-bl-xl' : '');
  const lastR = (last: boolean) => (last ? 'rounded-br-xl' : '');
  return (
    <tbody data-account={section.key ?? ''}>
      {!first && (
        <tr aria-hidden className="h-3">
          <td colSpan={COLS} />
        </tr>
      )}
      <tr className={LIST_TABLE_ROW}>
        <th colSpan={COLS} scope="colgroup" className={`${CARD_BG} px-4 text-left font-normal ${open ? 'rounded-t-xl border-b border-border/50' : 'rounded-xl'}`}>
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
            <DisclosureButton open={open} onToggle={onToggle} label="종목 보기" controls={id} className="shrink-0" />
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
          <th className={`${CARD_BG} ${TEXT} pr-4 text-center font-normal`}>자산 분류</th>
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
              <td className={`${CARD_BG} ${NUM} border-t border-border/30 text-text-primary`}>{h.quantity == null ? '—' : formatNumber(h.quantity, qtyDigits)}</td>
              <td className={`${CARD_BG} ${NUM} border-t border-border/30 text-text-primary`}>{avgText(h, usdDigits)}</td>
              <td className={`${CARD_BG} ${lastR(last)} ${TEXT} border-t border-border/30 pr-4 text-center`}>
                <ClassPicker h={h} saving={h.tickerRow != null && savingRows.has(h.tickerRow)} onPick={onPick} />
              </td>
            </tr>
          );
        })}
    </tbody>
  );
}

/** 계좌 카드들 — 합계 표(계좌를 합친 표)는 그리지 않는다 · 수량 · 달러 소수 자릿수는 모든 카드가 같다 */
function AccountCards({ sections, accounts, savingRows, onPick }: { sections: AssetSection[]; accounts: AssetAccount[]; savingRows: Set<number>; onPick: (row: number, value: AssetClass | '') => void }) {
  const shown = sections.filter((s) => !s.combined);
  const all = shown.flatMap((s) => s.holdings);
  const qtyDigits = decimalsOf(all.map((h) => h.quantity));
  const usdDigits = decimalsOf(all.filter((h) => h.currency === 'USD').map((h) => h.avgPrice));
  const [closed, setClosed] = useState<string[]>(readClosed);
  const toggle = (key: string) => {
    const next = closed.includes(key) ? closed.filter((k) => k !== key) : [...closed, key];
    setClosed(next);
    saveClosed(next);
  };
  return (
    /* 평균 매입가는 줄마다 통화가 다르다(원화는 소수 없음 · 달러는 시트 원래 값 소수 4자리까지) — design:check 의 「같은 열 소수 자릿수」 는 이 표에서 재지 않는다(`data-rows-differ`). 수량 열은 `qtyDigits` 로 모든 카드가 같다 */
    <table className="w-full border-separate border-spacing-0 text-left text-xs" data-rows-differ data-account-cards>
      {shown.map((s, i) => {
        const key = s.key ?? `#${i}`;
        return (
          <AccountCard
            key={key}
            section={s}
            account={accounts.find((a) => a.key === s.key)}
            first={i === 0}
            qtyDigits={qtyDigits}
            usdDigits={usdDigits}
            open={!closed.includes(key)}
            onToggle={() => toggle(key)}
            savingRows={savingRows}
            onPick={onPick}
          />
        );
      })}
    </table>
  );
}

/** 접기 안 전체 — 요약 · 계좌 카드(자산 분류 고르기) */
export default function AssetSheetValues({
  data,
  accounts,
  bySymbol,
  onPickClass,
}: {
  data: AssetSheetData;
  /** 카드 머리 평가 금액 합 · 가격 못 받은 줄 수(총 자산 요약 응답) */
  accounts: AssetAccount[];
  /** 종목별 줄(총 자산 요약 응답) — 아직 받지 못했으면 null(뼈대) */
  bySymbol: AssetSymbolRow[] | null;
  /** 시트에 쓴다 — 실패면 이유 문구 */
  onPickClass: (row: number, value: AssetClass | '') => Promise<string | null>;
}) {
  const [shown, setShown] = useState(data);
  const [base, setBase] = useState(data);
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<StatusView>(readView);
  const [filter, setFilter] = useState<SymbolFilter>('all');
  // 바깥에서 새로 읽은 값이 오면 그것을 보인다(쓰는 중인 칸이 없을 때)
  if (data !== base && savingRows.size === 0) {
    setBase(data);
    setShown(data);
  }

  const pick = async (row: number, value: AssetClass | '') => {
    const before = shown;
    setError(null);
    // 그 「티커」 줄에 이어진 모든 줄을 바로 바꿔 보이고, 그 칸만 돈다
    setShown({
      ...shown,
      sections: shown.sections.map((s) => ({
        ...s,
        holdings: s.holdings.map((h) => (h.tickerRow === row ? { ...h, assetClass: value || null } : h)),
      })),
    });
    setSavingRows((prev) => new Set(prev).add(row));
    const failed = await onPickClass(row, value);
    setSavingRows((prev) => {
      const next = new Set(prev);
      next.delete(row);
      return next;
    });
    if (failed) {
      setShown(before); // 원래 값으로 되돌린다
      setError(`자산 분류를 시트에 쓰지 못했습니다 — ${failed}`);
    }
  };

  return (
    <div className="space-y-3">
      <Summary data={shown} />
      {error && (
        <p role="alert" className="rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
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
      </div>
      {view === 'account' && <AccountCards sections={shown.sections} accounts={accounts} savingRows={savingRows} onPick={(r, v) => void pick(r, v)} />}
      {view === 'symbol' && (bySymbol == null ? <SkeletonTable rows={6} columns={8} /> : <AssetSymbolTable rows={bySymbol} filter={filter} />)}
    </div>
  );
}
