/**
 * 현금 자동 반영(v2.71.0) — 줄 알아보기 · 「월 고정지출」 표 읽기. **순수 함수**(구글 호출 · DB 없음 · 시험이 가짜 칸으로 부른다).
 *
 * - 「현금」 은행 계좌 줄 = 이름(두 줄 이름은 공백 하나로) + 같은 이름 가운데 몇 번째(`AssetCashKey`). 줄 번호를 저장하지 않는다 —
 *   사용자가 줄을 넣거나 지워도 읽을 때마다 이름 · 순서로 다시 찾는다. 못 찾으면 null(쓰지 않는다).
 * - 「월 고정지출」 줄 = 분류 + 지출 사유 + 같은 분류 · 사유 가운데 몇 번째(`AssetFixedKey`). 머리 글자 · 표 끝은 `sheetLayout.ts` `fixedCosts`.
 * ⚠️ 이름 · 금액을 로그에 찍지 않는다(오류 문구에도 탭 · 머리 글자만).
 */
import type { AssetCashKey, AssetCashRowOption, AssetFixedItemView, AssetFixedKey } from '../../src/types/asset';
import { AssetSheetError, type CellRows } from './google';
import { SHEET_LAYOUT } from './sheetLayout';
import { findCashShape } from './sheetShape';

type Cell = string | number | boolean | undefined;

/** 공백을 모두 뺀 글자(머리 글자 비교) */
const squash = (v: Cell) => String(v ?? '').replace(/\s+/g, '');
/** 줄 이름 — 앞뒤 공백을 빼고 안쪽 공백(줄바꿈 포함)은 하나로 */
export const cellName = (v: Cell) => (v == null ? '' : String(v).trim().replace(/\s+/g, ' '));

/** 숫자 칸 — 숫자가 아니면 null(쉼표가 든 글자도 숫자로) */
export function cellNumber(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.replace(/,/g, '').trim();
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return Number(t);
  }
  return null;
}

/** 「현금」 은행 계좌 줄 하나 — 시트 줄 번호 · 열쇠 · C열 그대로(값 또는 수식) */
export interface CashLine {
  row: number;
  key: AssetCashKey;
  /** C열 칸 그대로(수식으로 읽었으면 `=…` 글자) */
  cell: Cell;
}

/** 「현금」 넓은 범위(B1:C) → 은행 계좌 줄(머리 다음 ~ 총액 앞 · 이름이 빈 줄은 건너뜀). 머리를 못 찾으면 `shape` 오류 */
export function cashLines(rows: CellRows): CashLine[] {
  const { bank } = findCashShape(rows);
  const seen = new Map<string, number>();
  const out: CashLine[] = [];
  for (let row = bank.headRow + 1; row < bank.totalRow; row++) {
    const name = cellName(rows[row - 1]?.[0]);
    if (!name) continue;
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    out.push({ row, key: { name, nth }, cell: rows[row - 1]?.[1] });
  }
  return out;
}

export const sameCashKey = (a: AssetCashKey | null | undefined, b: AssetCashKey | null | undefined) => a != null && b != null && a.name === b.name && a.nth === b.nth;

/** 지금 같은 이름 줄 수 */
export const cashCount = (lines: { key: AssetCashKey }[], name: string) => lines.filter((l) => l.key.name === name).length;

/**
 * 저장한 열쇠의 지금 줄 — 없으면 null. 열쇠에 저장 때 같은 이름 줄 수(`of`)가 있고 지금 수가 다르면 null
 * (같은 이름 줄을 넣거나 지우면 「#n」 이 밀려 옆 계좌를 가리킨다 — 쓰지 않고 「다시 확인 필요」).
 */
export function findCashLine(lines: CashLine[], key: AssetCashKey): CashLine | null {
  if (key.of != null && cashCount(lines, key.name) !== key.of) return null;
  return lines.find((l) => sameCashKey(l.key, key)) ?? null;
}

/** 설정에 저장할 열쇠 — 지금 같은 이름 줄 수를 함께 */
export const storedCashKey = (lines: { key: AssetCashKey }[], key: AssetCashKey): AssetCashKey => ({ name: key.name, nth: key.nth, of: cashCount(lines, key.name) });

/** 화면 이름 — 같은 이름이 둘 이상이면 「#n」 */
export function cashLabel(key: AssetCashKey, lines: { key: AssetCashKey }[]): string {
  const many = lines.filter((l) => l.key.name === key.name).length > 1 || key.nth > 1;
  return many ? `${key.name} #${key.nth}` : key.name;
}

/** 고르기 목록 — 시트 순서 */
export const cashOptions = (lines: CashLine[]): AssetCashRowOption[] => lines.map((l) => ({ key: l.key, label: cashLabel(l.key, lines), amount: cellNumber(l.cell) }));

/** 「월 고정지출」 표 한 줄 */
export interface FixedLine {
  row: number;
  key: AssetFixedKey;
  amount: number | null;
  reflect: boolean;
}

/**
 * 「월 고정지출」 넓은 범위(A1:Z — `rows[줄 - 1][열 번호 0 = A]`) → 표 줄. 머리 줄(분류 · 지출 사유 · 비용 세 글자가 한 줄에)이 없거나 둘 이상이면 `shape` 오류.
 * 분류 빈칸은 위 줄 분류를 이어받는다(합쳐진 칸) · 사유가 빈 줄은 줄이 아니다 · 세 칸이 모두 빈 줄에서 표가 끝난다.
 */
export function fixedLines(rows: CellRows): FixedLine[] {
  const F = SHEET_LAYOUT.fixedCosts;
  const heads = [F.heads.category, F.heads.reason, F.heads.amount].map(squash);
  const found: { row: number; cols: number[] }[] = [];
  rows.forEach((r, i) => {
    const cols = heads.map((h) => (r ?? []).findIndex((c) => squash(c) === h));
    if (cols.every((c) => c >= 0)) found.push({ row: i + 1, cols });
  });
  const where = `「${F.heads.category} · ${F.heads.reason} · ${F.heads.amount}」 머리 줄`;
  if (found.length === 0) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${F.tab}」 탭에서 ${where}을 찾지 못했어요).`);
  if (found.length > 1) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${F.tab}」 탭에 ${where}이 두 번 있어요).`);
  const { row: headRow, cols } = found[0];
  const [cCat, cReason, cAmount] = cols;
  const reflect = new Set(F.reflect.map(squash));
  const seen = new Map<string, number>();
  const out: FixedLine[] = [];
  let category = '';
  for (let row = headRow + 1; row <= rows.length; row++) {
    const r = rows[row - 1] ?? [];
    const cat = cellName(r[cCat]);
    const reason = cellName(r[cReason]);
    const amountCell = r[cAmount];
    if (!cat && !reason && cellName(amountCell) === '') break;
    if (cat) category = cat;
    if (!reason || !category) continue;
    const id = `${category}\u0000${reason}`;
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    out.push({ row, key: { category, reason, nth }, amount: cellNumber(amountCell), reflect: reflect.has(squash(category)) });
  }
  return out;
}

export const sameFixedKey = (a: AssetFixedKey | null | undefined, b: AssetFixedKey | null | undefined) =>
  a != null && b != null && a.category === b.category && a.reason === b.reason && a.nth === b.nth;

const fixedCount = (lines: { key: AssetFixedKey }[], k: AssetFixedKey) => lines.filter((l) => l.key.category === k.category && l.key.reason === k.reason).length;

/** 저장한 열쇠의 지금 줄 — 저장 때 같은 분류 · 사유 줄 수(`of`)와 지금 수가 다르면 null(「#n」 이 밀렸을 수 있음) */
export function findFixedLine(lines: FixedLine[], key: AssetFixedKey): FixedLine | null {
  if (key.of != null && fixedCount(lines, key) !== key.of) return null;
  return lines.find((l) => sameFixedKey(l.key, key)) ?? null;
}

/** 설정에 저장할 열쇠 — 지금 같은 분류 · 사유 줄 수를 함께 */
export const storedFixedKey = (lines: { key: AssetFixedKey }[], key: AssetFixedKey): AssetFixedKey => ({ category: key.category, reason: key.reason, nth: key.nth, of: fixedCount(lines, key) });

/** 화면 이름 — 같은 분류 · 사유가 둘 이상이면 「#n」 */
export function fixedLabel(key: AssetFixedKey, lines: { key: AssetFixedKey }[]): string {
  const many = lines.filter((l) => l.key.category === key.category && l.key.reason === key.reason).length > 1 || key.nth > 1;
  return many ? `${key.reason} #${key.nth}` : key.reason;
}

export const fixedViews = (lines: FixedLine[]): AssetFixedItemView[] => lines.map((l) => ({ key: l.key, label: fixedLabel(l.key, lines), amount: l.amount, reflect: l.reflect }));

/** 「현재 월 급여」 — 머리 칸(`월 고정지출` B5)이 맞을 때 C5 숫자. 머리가 다르면 `shape` 오류 */
export function salaryOf(rows: CellRows): number | null {
  const head = SHEET_LAYOUT.headers.find((h) => h.tab === SHEET_LAYOUT.cells.salary.tab)!;
  const at = (cell: string) => {
    const m = /^([A-Z])(\d+)$/.exec(cell)!;
    return rows[Number(m[2]) - 1]?.[m[1].charCodeAt(0) - 65];
  };
  if (squash(at(head.cell)) !== squash(head.expect)) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${head.tab}」 탭 ${head.cell} — 「${head.expect}」 이어야 합니다).`);
  const v = cellNumber(at(SHEET_LAYOUT.cells.salary.cell));
  return v != null && v > 0 ? v : null;
}
