/**
 * 시트 구간 찾기(v2.66.2) — 「주식 투자 정리」 보유 구간 · 「티커」 묶음 · 「현금」 탭(v2.70.4) · 「적립식 투자」 묶음(v2.79.0 · 읽기만)을 **머리 글자로** 찾는다(줄이 늘거나 줄어도 맞게 읽는다). 순수 함수 · 구글 호출 없음.
 * 찾는 글자는 `sheetLayout.ts` 한 곳. 읽을 때마다 · 쓰기 직전에 다시 찾는다(사이에 사용자가 줄을 넣어도 맞는 줄을 본다).
 * 못 찾으면(머리 없음 · 두 번 · 종목 줄 0 · 묶음 순서 다름) `AssetSheetError('shape')` — 값을 만들지도, 쓰지도 않는다.
 * ⚠️ 오류 문구에는 탭 · 머리 글자만(값을 싣지 않는다).
 */
import { AssetSheetError, type CellRows } from './google';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HoldingSection } from './sheetLayout';

type Cell = string | number | boolean | undefined;

/** 찾은 보유 구간 하나 — 줄 번호는 시트 줄 번호 그대로 */
export interface ShapeSection {
  /** 계좌 key · 합친 표는 그 이름 */
  key: string;
  /** 머리 줄(계좌 이름 칸) · 합친 표는 둘째 「내 계좌 정보」 줄 */
  nameRow: number;
  firstRow: number;
  lastRow: number;
  combined: boolean;
}

/** 찾은 「티커」 묶음 하나 */
export interface ShapeTicker {
  group: string;
  headRow: number;
  /** 종목 줄(B · C 중 하나라도 있는 줄 — 빈 줄 · 머리 줄 제외) */
  rows: number[];
}

/** 「현금」 탭에서 찾은 구간 하나(v2.70.4) — 계좌 줄 = 머리 다음 줄 ~ 총액 앞 줄 */
export interface CashBlock {
  headRow: number;
  totalRow: number;
}

/** 「현금」 탭 — 은행 · 퇴직 연금 */
export interface CashShape {
  bank: CashBlock;
  retirement: CashBlock;
}

export interface SheetShape {
  sections: ShapeSection[];
  tickers: ShapeTicker[];
}

const squash = (v: Cell) => String(v ?? '').replace(/\s+/g, '');
const blank = (v: Cell) => squash(v) === '';
const L = SHEET_LAYOUT;

const shapeError = (tab: string, what: string) => new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${tab}」 탭 — ${what}).`);

/**
 * 보유 구간의 끝 줄. 머리 다음 줄부터 B열이 빈 줄 바로 앞까지 — 다음 머리(`limit`) 앞에서 멈춘다.
 * 계좌 구간(`oneBlankOk`)은 빈 줄 하나 뒤에 이름이 이어지면 계속 읽는다(바꾸기 전과 같게 — 그 아래 종목을 말없이 빼지 않는다).
 * 합친 표는 아래에 다음 머리가 없어 첫 빈 줄에서 끝낸다.
 */
function sectionEnd(rows: CellRows, first: number, limit: number, oneBlankOk: boolean): number {
  let last = first - 1;
  for (let row = first; row < limit; row++) {
    if (!blank(rows[row - 1]?.[0])) {
      last = row;
      continue;
    }
    if (!oneBlankOk || row + 1 >= limit || blank(rows[row]?.[0])) break;
  }
  return last;
}

/** 「주식 투자 정리」 B열부터의 줄(`rows[줄 번호 - 1]`) → 보유 구간(순서 = `sheetLayout` `sections`) */
export function findHoldingSections(rows: CellRows): ShapeSection[] {
  const marks = rows.flatMap((r, i) => (squash(r?.[0]) === squash(L.holdingsMark) ? [i + 1] : []));
  if (marks.length !== 2) throw shapeError(HOLDINGS_TAB, `「${L.holdingsMark}」 줄이 두 번이어야 합니다`);
  const [top, bottom] = marks;

  const accounts = L.sections
    .filter((s: HoldingSection) => !s.combined)
    .map((s: HoldingSection) => {
      const key = s.key as string;
      const found: number[] = [];
      for (let row = top + 1; row < bottom; row++) if (squash(rows[row - 1]?.[0]).startsWith(squash(key))) found.push(row);
      if (found.length === 0) throw shapeError(HOLDINGS_TAB, `「${key}」 로 시작하는 줄이 없습니다`);
      if (found.length > 1) throw shapeError(HOLDINGS_TAB, `「${key}」 로 시작하는 줄이 두 번입니다`);
      return { key, nameRow: found[0] };
    });
  const heads = accounts.map((a) => a.nameRow).sort((a, b) => a - b);

  const sections: ShapeSection[] = L.sections.map((s: HoldingSection) => {
    if (s.combined) {
      const firstRow = bottom + 1;
      return { key: s.label as string, nameRow: bottom, firstRow, lastRow: sectionEnd(rows, firstRow, rows.length + 2, false), combined: true };
    }
    const { key, nameRow } = accounts.find((a) => a.key === s.key) as { key: string; nameRow: number };
    const limit = heads.find((h) => h > nameRow) ?? bottom;
    return { key, nameRow, firstRow: nameRow + 1, lastRow: sectionEnd(rows, nameRow + 1, limit, true), combined: false };
  });
  for (const s of sections) if (s.lastRow < s.firstRow) throw shapeError(HOLDINGS_TAB, `「${s.key}」 구간에 종목 줄이 없습니다`);
  return sections;
}

/** 「티커」 B열부터의 줄(`rows[줄 번호 - 1]`) → 묶음(시트 순서) */
export function findTickerGroups(rows: CellRows): ShapeTicker[] {
  const names = L.tickers.skipNames as readonly string[];
  const groups: ShapeTicker[] = [];
  let at = -1; // 지금까지 나온 묶음의 `skipNames` 번호
  let blanks = 0; // 이어진 빈 줄 수 — 2 이상이면 다음 머리까지 종목 줄이 아니다
  for (let row = L.tickers.headRow + 1; row <= rows.length; row++) {
    const r = rows[row - 1];
    const idx = names.findIndex((n) => squash(n) === squash(r?.[0]));
    if (idx >= 0) {
      if (groups.some((g) => g.group === names[idx])) throw shapeError(TICKER_TAB, `묶음 머리 「${names[idx]}」 가 두 번입니다`);
      if (idx < at) throw shapeError(TICKER_TAB, `묶음 머리 순서가 다릅니다(${names.join(' · ')})`);
      groups.push({ group: names[idx], headRow: row, rows: [] });
      at = idx;
      blanks = 0;
      continue;
    }
    const empty = blank(r?.[0]) && blank(r?.[1]);
    const g = groups[groups.length - 1];
    if (!g) {
      if (!empty) throw shapeError(TICKER_TAB, `종목 줄보다 위에 묶음 머리(${names.join(' · ')})가 없습니다`);
      continue;
    }
    if (empty) {
      blanks++;
    } else if (blanks < 2) {
      g.rows.push(row);
      blanks = 0;
    }
  }
  if (groups.length === 0) throw shapeError(TICKER_TAB, `묶음 머리(${names.join(' · ')})가 없습니다`);
  if (!groups.some((g) => g.rows.length > 0)) throw shapeError(TICKER_TAB, '종목 줄이 없습니다');
  return groups;
}

/** 읽은 두 탭 → 구간 전체. 못 찾으면 `shape` 오류 */
export function findSheetShape(holdingRows: CellRows, tickerRows: CellRows): SheetShape {
  return { sections: findHoldingSections(holdingRows), tickers: findTickerGroups(tickerRows) };
}

/**
 * 「현금」 B열부터의 줄(`rows[줄 번호 - 1]`) → 은행 · 퇴직 연금 구간(v2.70.4). 글자는 `sheetLayout` `cash` — 공백을 빼고 같은 글자.
 * 네 글자가 한 번씩 · 은행 머리 < 은행 총액 < 퇴직 연금 머리 < 퇴직 연금 총액 순서여야 한다. 아니면 `shape` 오류(찾지 못한 글자를 알린다 — 값은 싣지 않는다).
 */
export function findCashShape(rows: CellRows): CashShape {
  const c = L.cash;
  const rowOf = (mark: string): number => {
    const found = rows.flatMap((r, i) => (squash(r?.[0]) === squash(mark) ? [i + 1] : []));
    if (found.length === 0) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${c.tab}」 탭에서 「${mark}」 줄을 찾지 못했어요).`);
    if (found.length > 1) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${c.tab}」 탭에 「${mark}」 줄이 두 번 있어요).`);
    return found[0];
  };
  const marks = [c.bankHead, c.bankTotal, c.retireHead, c.retireTotal];
  const at = marks.map(rowOf);
  for (let i = 1; i < at.length; i++) {
    if (at[i] <= at[i - 1]) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${c.tab}」 탭 — 「${marks[i - 1]}」 줄이 「${marks[i]}」 줄보다 위에 있어야 해요).`);
  }
  return { bank: { headRow: at[0], totalRow: at[1] }, retirement: { headRow: at[2], totalRow: at[3] } };
}

// ── 「적립식 투자」 탭(v2.79.0 · 읽기만) ─────────────────────────────────────────────

/** 묶음의 줄 하나 — 줄 번호는 시트 줄 번호 그대로 · 비율은 0 ~ 1(0% 줄도 들어 있다 — 빼는 것은 계산 쪽) */
export interface SavingLine {
  row: number;
  name: string;
  ratio: number | null;
}

/** 찾은 묶음 하나 — `account` 는 맞는 계좌 key(없음 · 다른 묶음과 같은 계좌면 null — 그 까닭은 `skipped`) */
export interface SavingGroup {
  headRow: number;
  account: string | null;
  /** 총 구매할 금액(값) · 분할 개월 수 — 숫자가 아니면 null */
  total: number | null;
  months: number | null;
  lines: SavingLine[];
  /** `values` = 총 금액 없음 · 개월 수 0 이하 · 빈칸 · 글자 · 줄 이름이나 비율이 맞지 않음(「시트 값 확인」) */
  problem: 'values' | null;
}

/** 쓰지 않는 묶음 — `shape` 모양이 다름(읽지 않음) · `no-account` 맞는 계좌 없음 · `same-account` 두 묶음이 같은 계좌 */
export interface SavingSkip {
  row: number;
  kind: 'shape' | 'no-account' | 'same-account';
}

export interface SavingShape {
  groups: SavingGroup[];
  skipped: SavingSkip[];
}

const firstWord = (v: Cell) => String(v ?? '').trim().split(/\s+/)[0] ?? '';
const isNumberCell = (v: Cell): v is number => typeof v === 'number' && Number.isFinite(v);
const isTextCell = (v: Cell) => typeof v === 'string' && v.trim() !== '';
const isFormulaCell = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');

/**
 * 「적립식 투자」 탭 → 묶음(v2.79.0 · 순수 함수 · 구글 호출 없음). 모양 규칙은 `sheetLayout.ts` `saving` 한 곳.
 * - `values`: B 부터 `lastColumn` 까지(`rows[줄 번호 - 1]` · B = 0) · `ratioFormulas`: D열 수식(`rows[줄 번호 - 1][0]`).
 * - `accountKeys`: 「주식 투자 정리」 계좌 key(합친 표 제외) — 머리 줄 B 의 첫 낱말과 key 의 첫 낱말이 같은 것 하나.
 * - 머리 줄(D = 「분할 개월 수」)이 하나도 없으면 `shape` 오류(쓰지 않는다 — 다른 탭과 같은 말).
 * ⚠️ 오류 · 까닭에는 줄 번호 · 종류만(값을 싣지 않는다).
 */
export function findSavingGroups(values: CellRows, ratioFormulas: CellRows, accountKeys: string[]): SavingShape {
  const S = L.saving;
  const B = 0;
  const C = 1;
  const D = 2;
  const at = (row: number, col: number): Cell => values[row - 1]?.[col];
  const formulaD = (row: number): Cell => ratioFormulas[row - 1]?.[0];
  const heads = values.flatMap((r, i) => (squash(r?.[D]) === squash(S.anchor) ? [i + 1] : []));
  if (heads.length === 0) throw shapeError(S.tab, `「${S.anchor}」 줄이 없습니다`);

  const groups: SavingGroup[] = [];
  const skipped: SavingSkip[] = [];
  heads.forEach((head, gi) => {
    const limit = heads[gi + 1] ?? values.length + 1;
    const lines: SavingLine[] = [];
    let bad = false;
    for (let row = head + 2; row < limit; row++) {
      if (isFormulaCell(formulaD(row))) break; // 합계 줄
      const name = at(row, B);
      const ratio = at(row, D);
      if (blank(name) && blank(ratio)) break; // 빈 줄
      if (!isTextCell(name) || (!blank(ratio) && !(isNumberCell(ratio) && ratio >= 0 && ratio <= 1))) bad = true;
      lines.push({ row, name: String(name ?? '').trim(), ratio: isNumberCell(ratio) ? ratio : null });
    }
    // 비율 열에 숫자가 하나도 없으면 모양이 다른 묶음(원본 28행 — 개월 수가 E · 비율 열 없음)
    if (!isTextCell(at(head, B)) || !lines.some((l) => l.ratio != null)) {
      skipped.push({ row: head, kind: 'shape' });
      return;
    }
    if (lines.some((l) => l.ratio == null)) bad = true;
    const totalCell = at(head + 1, C);
    const monthsCell = at(head + 1, D);
    const total = isNumberCell(totalCell) ? totalCell : null;
    const months = isNumberCell(monthsCell) ? monthsCell : null;
    if (total == null || months == null || months <= 0) bad = true;
    const word = squash(firstWord(at(head, B)));
    const matched = accountKeys.filter((k) => squash(firstWord(k)) === word);
    groups.push({ headRow: head, account: matched.length === 1 ? matched[0] : null, total, months, lines, problem: bad ? 'values' : null });
    if (matched.length !== 1) skipped.push({ row: head, kind: 'no-account' });
  });
  // 두 묶음이 같은 계좌로 맞으면 그 계좌의 묶음은 모두 쓰지 않는다(어느 쪽이 맞는지 모른다)
  const count = new Map<string, number>();
  for (const g of groups) if (g.account) count.set(g.account, (count.get(g.account) ?? 0) + 1);
  for (const g of groups) {
    if (g.account && (count.get(g.account) ?? 0) > 1) {
      skipped.push({ row: g.headRow, kind: 'same-account' });
      g.account = null;
    }
  }
  skipped.sort((a, b) => a.row - b.row);
  return { groups, skipped };
}

/** 「티커」 종목 줄 번호 전부(시트 순서) */
export const tickerRowsOf = (groups: ShapeTicker[]): number[] => groups.flatMap((g) => g.rows);

/**
 * 저장해 둔 줄(줄 번호 + 그때 코드)의 지금 자리 — `codeAt` 은 지금 「티커」 줄 → 코드(시트 가격 · v2.66.2).
 * 그 줄의 코드가 그대로면 그 줄(「티커」 에 같은 종목 두 줄은 있을 수 있다 — 자리가 그대로면 헷갈리지 않는다) ·
 * 아니면 그 코드의 줄이 하나일 때만 그 줄 · 둘 이상이면 `duplicate` · 없으면 `missing`.
 */
export function locateRow(stored: { row: number; code: string }, codeAt: Map<number, string>): number | 'missing' | 'duplicate' {
  if (codeAt.get(stored.row) === stored.code) return stored.row;
  const found = [...codeAt].filter(([, c]) => c === stored.code).map(([r]) => r);
  if (found.length === 0) return 'missing';
  return found.length === 1 ? found[0] : 'duplicate';
}
