import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Badge, ICON_SM, Panel, Select } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { ASSET_CLASSES, type AssetClass, type AssetHolding, type AssetSection, type AssetSettings, type AssetSheetData } from '../../types/asset';

/**
 * 자산 관리 맨 아래 접기 「시트에서 읽은 값」 (v2.61.0 1단계 확인 표 → v2.62.0 접기 안으로).
 * - 요약(현금 · 퇴직 연금 · 월급 · 구매 평균 환율 · 목표 비율) + 계좌 구간별 보유 한 표.
 * - 줄마다 「자산 분류」 고르기 → 시트 「티커」 D열에 바로 쓴다(그 칸만 로딩 · 실패하면 원래 값으로 되돌리고 이유 한 줄).
 *   같은 「티커」 줄에 이어진 줄(합계 표 등)은 함께 바뀐다(분류는 종목마다 하나).
 * - 연금 구간 · 위성 구간 설정(작은 체크 칸).
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다.
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
      {/* 목표 비율 두 묶음 — 자산 배분(합 100%)과 투자 안의 코어 · 위성(합 100%)을 나눠 보인다(한 줄이면 합이 200% 로 읽힌다) */}
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 자산 배분</div>
          <div className="flex gap-x-8">
            <Field label="현금" value={pct(t.cash)} />
            <Field label="금" value={pct(t.gold)} />
            <Field label="채권" value={pct(t.bond)} />
            <Field label="투자" value={pct(t.invest)} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 투자 안의 코어 · 위성</div>
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

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right`;
const TEXT = `${TABLE_NUM_COL} ${TABLE_NUM_GAP}`;
const COLS = 6;

/** 자산 분류 고르기 한 칸 — 이을 수 없는 줄은 고를 수 없다(「티커」 줄이 없다) */
function ClassPicker({ h, saving, onPick }: { h: AssetHolding; saving: boolean; onPick: (row: number, value: AssetClass | '') => void }) {
  if (h.tickerRow == null) return <span className="text-text-muted" title="「티커」 탭과 이을 수식이 없어 고를 수 없습니다">—</span>;
  const value = h.assetClass ?? (h.assetClassUnknown ? '?' : '');
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        size="sm"
        aria-label={`${h.name} 자산 분류`}
        value={value}
        disabled={saving}
        onChange={(e) => onPick(h.tickerRow!, e.target.value as AssetClass | '')}
        className="w-28"
      >
        <option value="">분류 없음</option>
        {ASSET_CLASSES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
        {h.assetClassUnknown && (
          <option value="?" disabled>
            알 수 없음 · {h.assetClassUnknown}
          </option>
        )}
      </Select>
      {/* 쓰는 동안 그 칸만 — 자리를 늘 잡아 두어 줄 폭이 흔들리지 않게 */}
      <span className="inline-flex w-4 justify-center" aria-hidden={!saving}>
        {saving && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="쓰는 중" />}
      </span>
    </span>
  );
}

/**
 * 계좌 구간별 보유 — **표 하나**에 구간 머리 줄을 넣는다(구간마다 표를 따로 두면 열 위치가 구간마다 달라진다).
 * 합계 표(계좌를 합친 표)는 배지로 따로 표시한다.
 */
function HoldingsTable({ sections, savingRows, onPick }: { sections: AssetSection[]; savingRows: Set<number>; onPick: (row: number, value: AssetClass | '') => void }) {
  const all = sections.flatMap((s) => s.holdings);
  const qtyDigits = decimalsOf(all.map((h) => h.quantity));
  const usdDigits = decimalsOf(all.filter((h) => h.currency === 'USD').map((h) => h.avgPrice));
  return (
    <Panel pad="none" className="pb-1">
      {/* 평균 매입가는 줄마다 통화가 다르다(원화는 소수 없음 · 달러는 시트 원래 값 소수 4자리까지) — design:check 의 「같은 열 소수 자릿수」 는 이 표에서 재지 않는다(`data-rows-differ`). 수량 열은 위 `qtyDigits` 로 맞춘다 */}
      <table className="w-full text-left text-xs" data-rows-differ>
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className={`${TABLE_NAME_COL} py-2 pl-4 font-normal`}>종목</th>
            <th className={`${TEXT} py-2 font-normal`}>코드</th>
            <th className={`${TEXT} py-2 font-normal`}>시장</th>
            <th className={`${NUM} py-2 font-normal`}>수량</th>
            <th className={`${NUM} py-2 font-normal`}>평균 매입가</th>
            <th className={`${TEXT} py-2 pr-4 font-normal`}>자산 분류</th>
          </tr>
        </thead>
        {sections.map((s, i) => (
          <tbody key={`${i}-${s.name}`}>
            <tr className={LIST_TABLE_ROW}>
              <th colSpan={COLS} scope="colgroup" className="px-4 pt-3 pb-1 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{s.name || '이름 없는 구간'}</span>
                  {s.combined && <Badge title="계좌를 합친 표입니다 — 위 계좌 구간과 같은 종목이 겹칩니다. 총 자산에는 더하지 않습니다.">합계 표</Badge>}
                  <span className="text-caption text-text-muted">{s.holdings.length}종목</span>
                </span>
              </th>
            </tr>
            {s.holdings.length === 0 && (
              <tr className={LIST_TABLE_ROW}>
                <td colSpan={COLS} className="px-4 text-text-muted">
                  이 구간에 보유 종목이 없습니다.
                </td>
              </tr>
            )}
            {s.holdings.map((h) => (
              <tr key={h.row} className={`border-t border-border/30 ${LIST_TABLE_ROW}`}>
                <td className="max-w-0 py-1.5 pl-4">
                  <span className="block truncate text-text-primary" title={h.name}>
                    {h.name}
                  </span>
                </td>
                <td className={`${TEXT} py-1.5 text-text-secondary`} title={h.code ?? '「티커」 탭과 이을 수식이 없습니다'}>
                  {h.symbol ?? '—'}
                  {h.exchange && <span className="ml-1 text-caption text-text-muted">{h.exchange}</span>}
                </td>
                <td className={`${TEXT} py-1.5 text-text-secondary`}>{h.market === 'US' ? '미국' : h.market === 'KR' ? '국내' : '—'}</td>
                <td className={`${NUM} py-1.5 tabular-nums text-text-primary`}>{h.quantity == null ? '—' : formatNumber(h.quantity, qtyDigits)}</td>
                <td className={`${NUM} py-1.5 tabular-nums text-text-primary`}>{avgText(h, usdDigits)}</td>
                <td className={`${TEXT} py-1 pr-4`}>
                  <ClassPicker h={h} saving={h.tickerRow != null && savingRows.has(h.tickerRow)} onPick={onPick} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Panel>
  );
}

/** 구간 고르기 한 줄 — 작은 체크 칸(구간 key) */
function SectionChecks({ label, keys, value, busy, onChange }: { label: string; keys: string[]; value: string[]; busy: boolean; onChange: (next: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="w-24 shrink-0 text-xs text-text-secondary">{label}</span>
      {keys.map((k) => (
        <label key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-primary">
          <input
            type="checkbox"
            checked={value.includes(k)}
            disabled={busy}
            onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))}
          />
          {k}
        </label>
      ))}
      {busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}
    </div>
  );
}

/** 연금 구간 · 위성 구간 설정 */
export function SectionSettings({ settings, keys, onSave }: { settings: AssetSettings; keys: string[]; onSave: (patch: Partial<AssetSettings>) => Promise<string | null> }) {
  const [busy, setBusy] = useState<'pensionSections' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (field: 'pensionSections', next: string[]) => {
    setBusy(field);
    setError(await onSave({ [field]: next }));
    setBusy(null);
  };
  return (
    <Panel className="space-y-2">
      <div className="text-xs font-semibold text-text-primary">계좌 구간 설정</div>
      <SectionChecks label="연금 구간" keys={keys} value={settings.pensionSections} busy={busy === 'pensionSections'} onChange={(v) => void save('pensionSections', v)} />
      <p className="text-caption leading-relaxed text-text-muted keep-all">
        「연금 포함」 을 끄면 연금 구간 보유와 퇴직 연금이 빠집니다. 위성 구간의 「주식」 종목은 위성, 그 밖 구간의 「주식」 종목은 코어입니다.
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger keep-all">
          {error}
        </p>
      )}
    </Panel>
  );
}

/** 접기 안 전체 — 요약 · 보유 표(자산 분류 고르기) */
export default function AssetSheetValues({
  data,
  onPickClass,
}: {
  data: AssetSheetData;
  /** 시트에 쓴다 — 실패면 이유 문구 */
  onPickClass: (row: number, value: AssetClass | '') => Promise<string | null>;
}) {
  const [shown, setShown] = useState(data);
  const [base, setBase] = useState(data);
  const [savingRows, setSavingRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
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
        holdings: s.holdings.map((h) => (h.tickerRow === row ? { ...h, assetClass: value || null, assetClassUnknown: null } : h)),
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
      <HoldingsTable sections={shown.sections} savingRows={savingRows} onPick={(r, v) => void pick(r, v)} />
    </div>
  );
}
