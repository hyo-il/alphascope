/**
 * 시트 줄 넣기 · 지우기(v2.67.0 — 새 종목 매수 · 모두 매도). **실제 주문은 없다** — 다른 증권사에서 사고판 것을 시트에 적는다.
 *
 * - 구글에 쓰는 것은 `valuesWrite`(값) · `structureWrite`(구조) 둘뿐 · 구조 쓰기를 부르는 곳은 이 파일 하나.
 * - 새 종목: 「티커」 줄(있으면 그대로 · 빈 줄 · 없으면 줄 넣기) → 보유 줄 넣기 → 합계 범위 확인(안 늘었으면 범위 끝만) → 다시 읽어 확인. 어느 단계든 실패하면 앞에서 바꾼 것을 되돌린다.
 * - 모두 매도: 다른 칸이 그 줄을 가리키는지 · 구간 마지막 줄인지 본 뒤 보유 줄만 지운다(「티커」 줄 · 합친 표는 건드리지 않는다).
 * - 구간은 쓰기 직전에 머리 글자로 다시 찾는다(`sheetShape.ts`).
 * ⚠️ 이름 · 코드 · 금액 · 수량을 로그 · 오류 문구에 싣지 않는다(탭 이름 · 칸 주소만).
 */
import type { AssetCurrency, AssetHolding, AssetSheetData, AssetUsPrefix } from '../../src/types/asset';
import type { AssetSheetConfig } from './config';
import { AssetSheetError, batchGet, sheetTabs, structureWrite, valuesWrite, type CellRows, type CellWrite, type GridRange, type StructureRequest } from './google';
import { wonFormula } from './priceSheet';
import { linkedTickerRow, one, parseAssetSheet, sheetRanges, splitCode, tickerRowCode, wholeTab, wideRange } from './sheet';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB } from './sheetLayout';
import { findSheetShape, tickerRowsOf, type ShapeSection, type SheetShape } from './sheetShape';

type Cell = string | number | boolean | undefined;
const L = SHEET_LAYOUT;

/** 열 번호(0부터) → 열 이름 */
function colName(i: number): string {
  let n = i + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ───────── 수식 속 칸 주소 ─────────

/** 수식 속 칸 주소 하나 — `A1` · `'탭'!$A$1` · `A1:A9` · `A1:A`(끝 줄 없음) */
export interface CellRef {
  /** 시작 글자 위치 · 끝 글자 위치(수식 글자 기준) */
  at: number;
  end: number;
  /** 탭 이름(없으면 그 수식의 탭) */
  tab: string | null;
  prefix: string;
  colAbs: string;
  col: string;
  rowAbs: string;
  row: number;
  range: boolean;
  endColAbs: string;
  endCol: string | null;
  endRowAbs: string;
  endRow: number | null;
}

const REF = /(?<![A-Za-z0-9_.$'!가-힣])((?:'(?:[^']|'')+'|[A-Za-z0-9_.가-힣]+)!)?(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(?:(\$?)(\d+))?)?(?![A-Za-z0-9_(])/g;

/** 수식 속 칸 주소 전부 — 큰따옴표 글자 안은 보지 않는다 · 함수 이름(`LOG10(`)은 칸이 아니다 */
export function parseRefs(formula: string): CellRef[] {
  const masked = formula.replace(/"[^"]*"/g, (s) => ' '.repeat(s.length));
  return [...masked.matchAll(REF)].map((m) => {
    const prefix = m[1] ?? '';
    const name = prefix.slice(0, -1);
    return {
      at: m.index,
      end: m.index + m[0].length,
      tab: prefix ? (name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name) : null,
      prefix,
      colAbs: m[2],
      col: m[3],
      rowAbs: m[4],
      row: Number(m[5]),
      range: m[7] != null,
      endColAbs: m[6] ?? '',
      endCol: m[7] ?? null,
      endRowAbs: m[8] ?? '',
      endRow: m[9] != null ? Number(m[9]) : null,
    };
  });
}

const refText = (r: CellRef) => `${r.prefix}${r.colAbs}${r.col}${r.rowAbs}${r.row}${r.range ? `:${r.endColAbs}${r.endCol}${r.endRow != null ? `${r.endRowAbs}${r.endRow}` : ''}` : ''}`;

/** 주소마다 바꾸기(`fn` 이 null 이면 그대로) — 다른 글자는 그대로 둔다 */
function rewriteRefs(formula: string, fn: (r: CellRef) => CellRef | null): string {
  let out = formula;
  for (const r of parseRefs(formula).reverse()) {
    const next = fn(r);
    if (next) out = out.slice(0, r.at) + refText(next) + out.slice(r.end);
  }
  return out;
}

const isTickerLink = (r: CellRef) => r.tab === TICKER_TAB && r.col === L.prices.wonColumn && !r.range;

/** 복사한 줄의 F 수식 — 구글이 복사할 때처럼 상대 줄 번호를 `delta` 만큼 옮기고, 「티커」 이음 줄 번호만 `tickerRow` 로 */
export function linkFormulaFor(source: string, delta: number, tickerRow: number): string {
  return rewriteRefs(source, (r) => {
    if (isTickerLink(r)) return { ...r, row: tickerRow };
    const row = r.rowAbs ? r.row : r.row + delta;
    const endRow = r.endRow != null && !r.endRowAbs ? r.endRow + delta : r.endRow;
    return row === r.row && endRow === r.endRow ? null : { ...r, row, endRow };
  });
}

// ───────── 읽기 ─────────

/** 쓰기 직전에 읽은 시트 — `holding` · `ticker` 는 수식 그대로(`rows[줄 - 1][0]` = B열) · `tickerValues` 는 「티커」 계산된 값(코드 칸이 수식인 줄도 코드로 알아본다) · `tabs` 는 탭 전체 수식(`[0]` = A열 — `allTabs` 일 때만) */
export interface SheetGrid {
  data: AssetSheetData;
  shape: SheetShape;
  holding: CellRows;
  ticker: CellRows;
  tickerValues: CellRows;
  tabs: Map<string, CellRows>;
}

const tickerLinesRange = () => wideRange(TICKER_TAB, L.shapeLastColumn);
const fromB = (rows: CellRows): CellRows => rows.map((r) => r.slice(1));

/**
 * 쓰기 직전 읽기 — 구글 요청 두 번(값 · 수식 — 머리 글자가 다르면 수식은 읽지 않는다). 보유 탭은 칸 수를 정하지 않으려고 탭 전체를 읽는다.
 * `allTabs`(모두 매도)면 둘째 요청에 모든 탭의 수식을 함께 읽는다(같은 탭 · 다른 탭이 지울 줄을 가리키는지 본다 · 탭 번호 읽기 포함 시트마다 한 번 더).
 */
export async function readGrid(config: AssetSheetConfig, allTabs = false): Promise<SheetGrid> {
  const base = sheetRanges();
  const values = await batchGet(config, base.values, 'UNFORMATTED_VALUE');
  const at = new Date().toISOString();
  parseAssetSheet(values, [], at); // 머리 글자 먼저 — 다르면 여기서 멈춘다
  const names = allTabs ? [...(await sheetTabs(config)).keys()] : [HOLDINGS_TAB];
  if (!names.includes(HOLDINGS_TAB) || (allTabs && !names.includes(TICKER_TAB))) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${HOLDINGS_TAB}」 탭을 찾지 못했습니다).`);
  const got = await batchGet(config, [...base.formulas, tickerLinesRange(), ...names.map(wholeTab)], 'FORMULA');
  const start = base.formulas.length + 1;
  const tabs = new Map(names.map((name, i) => [name, got[start + i] ?? []]));
  const data = parseAssetSheet(values, got, at);
  const shape = findSheetShape(values[L.headers.length] ?? [], values[L.headers.length + 1] ?? []);
  return { data, shape, holding: fromB(tabs.get(HOLDINGS_TAB) ?? []), ticker: got[base.formulas.length] ?? [], tickerValues: values[L.headers.length + 1] ?? [], tabs: allTabs ? tabs : new Map() };
}

// ───────── 합계 범위 ─────────

/** 합계 줄의 범위가 든 칸 하나 — `col` 은 B열 = 0 */
export interface SumCell {
  row: number;
  col: number;
}

const isHere = (r: CellRef) => r.tab == null || r.tab === HOLDINGS_TAB;
/** 이 구간을 덮는 범위인가 — 시작이 머리 줄 ~ 첫 종목 줄 · 끝이 `lastRow` 또는 그 아래 빈 줄 */
const coversSection = (r: CellRef, s: Pick<ShapeSection, 'nameRow' | 'firstRow'>, lastRow: number) => isHere(r) && r.range && r.endRow != null && r.row >= s.nameRow && r.row <= s.firstRow && r.endRow >= lastRow && r.endRow <= lastRow + 1;

/** 구간 아래(다음 머리 앞) 줄의 칸 중 구간을 덮는 범위가 든 칸 — 없으면 빈 목록 */
export function findSumCells(holding: CellRows, s: ShapeSection, limit: number): SumCell[] {
  const out: SumCell[] = [];
  for (let row = s.lastRow + 1; row < limit; row++) {
    (holding[row - 1] ?? []).forEach((v, col) => {
      if (typeof v === 'string' && v.trim().startsWith('=') && parseRefs(v).some((r) => coversSection(r, s, s.lastRow))) out.push({ row, col });
    });
  }
  return out;
}

const nextHead = (shape: SheetShape, s: ShapeSection) => Math.min(...shape.sections.map((x) => x.nameRow).filter((n) => n > s.nameRow), Number.MAX_SAFE_INTEGER);

/** 지울 줄 / 넣을 줄 뒤 합계 칸의 지금 자리 */
const sumAddress = (c: SumCell, shift: number) => one(HOLDINGS_TAB, `${colName(c.col + 1)}${c.row + shift}`);

/**
 * 줄을 넣은 뒤 합계 칸 — 범위가 새 줄을 품었으면 그대로, 끝이 옛 마지막 줄에 머물렀으면 **범위 끝만** 새 줄로 바꾼 수식을 돌려준다(그 밖 모양은 `mismatch`).
 * 다른 칸 · 다른 탭 수식은 건드리지 않는다.
 */
export function sumFixes(after: CellRows, sums: SumCell[], s: ShapeSection, newRow: number): CellWrite[] {
  const fixes: CellWrite[] = [];
  for (const c of sums) {
    const f = after[c.row]?.[c.col]; // 줄이 하나 늘어 한 칸 아래
    const refs = typeof f === 'string' ? parseRefs(f).filter((r) => isHere(r) && r.range && r.row >= s.nameRow && r.row <= s.firstRow && r.endRow != null) : [];
    if (typeof f !== 'string' || refs.length === 0) throw new AssetSheetError('mismatch', `「${HOLDINGS_TAB}」 합계 줄이 다르게 읽혔습니다 — 줄을 되돌렸습니다.`);
    if (refs.every((r) => (r.endRow as number) >= newRow)) continue;
    fixes.push({
      range: sumAddress(c, 1),
      value: rewriteRefs(f, (r) => (isHere(r) && r.range && r.row >= s.nameRow && r.row <= s.firstRow && r.endRow === newRow - 1 ? { ...r, endRow: newRow } : null)),
    });
  }
  return fixes;
}

// ───────── 새 종목 — 어디에 쓸지 정하기 ─────────

export interface StockInfo {
  symbol: string;
  name: string;
  market: 'KR' | 'US';
  /** 종목 목록의 시장 — KOSPI · KOSDAQ · NASDAQ · NYSE · AMEX */
  listing: string;
  currency: AssetCurrency;
}

export type TickerSpot = { status: 'existing'; row: number; code: string } | { status: 'blank' | 'insert'; row: number; source: number };

export interface NewHoldingDecision {
  section: ShapeSection;
  group: string;
  stock: StockInfo;
  /** 시트에 쓸 코드(이미 있는 줄이면 그 줄의 코드) */
  code: string;
  prefix: AssetUsPrefix | null;
  ticker: TickerSpot;
  /** 그 계좌에 같은 종목 줄이 이미 있으면 그 줄(새 줄 없이 매수로) */
  existing: AssetHolding | null;
  /** 복사할 보유 줄(그 구간 맨 아래 이을 수 있는 줄) */
  shapeRow: number;
  sums: SumCell[];
}

const sameStock = (code: string, stock: StockInfo) => {
  const c = splitCode(code);
  return c.market === stock.market && (c.symbol ?? '').toUpperCase() === stock.symbol.toUpperCase();
};

/** 미국 코드 앞부분 — NASDAQ · NYSE 는 그대로 · AMEX 는 시트에 이미 쓰인 NYSEARCA / NYSEAMERICAN 중 있는 것(없으면 NYSEARCA) */
export function defaultPrefix(listing: string, inSheet: Set<string>): AssetUsPrefix {
  if (listing === 'NASDAQ') return 'NASDAQ';
  if (listing === 'NYSE') return 'NYSE';
  return inSheet.has('NYSEARCA') || !inSheet.has('NYSEAMERICAN') ? 'NYSEARCA' : 'NYSEAMERICAN';
}

const isBlankLine = (r: Cell[] | undefined) => (r ?? []).every((v) => String(v ?? '').trim() === '');

/** 「티커」 어디에 쓸지 — 같은 코드면 그 줄(같은 묶음 먼저) · 없으면 묶음의 첫 빈 줄(빈 줄은 다음 묶음 머리 앞까지만 — 마지막 묶음은 없다) · 그것도 없으면 묶음 마지막 종목 다음에 줄 넣기 */
function tickerSpot(grid: SheetGrid, group: string, stock: StockInfo): TickerSpot {
  const groups = grid.shape.tickers;
  const g = groups.find((x) => x.group === group);
  if (!g) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${TICKER_TAB}」 탭 — 「${group}」 묶음이 없습니다).`);
  const lines = [...g.rows, ...tickerRowsOf(groups).filter((r) => !g.rows.includes(r))];
  for (const row of lines) {
    const code = tickerRowCode(grid.tickerValues[row - 1]);
    if (code && sameStock(code, stock)) return { status: 'existing', row, code };
  }
  const last = g.rows[g.rows.length - 1];
  const next = groups.map((x) => x.headRow).filter((h) => h > g.headRow).sort((a, b) => a - b)[0];
  if (next != null) {
    for (let row = g.headRow + 1; row < next; row++) {
      if (!isBlankLine(grid.ticker[row - 1])) continue;
      const source = [...g.rows].reverse().find((r) => r < row) ?? g.rows[0];
      if (source == null) break;
      return { status: 'blank', row, source };
    }
  }
  if (last == null) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${TICKER_TAB}」 「${group}」 묶음에 본보기 종목 줄이 없습니다).`);
  return { status: 'insert', row: last + 1, source: last };
}

/**
 * 새 종목을 어디에 쓸지 정한다(구글 호출 없음 · 쓰기 전 검사 전부). 구간 · 묶음 · 복사할 줄 · 합계 칸을 못 찾으면 쓰지 않고 오류.
 * `exchange` 는 미국 종목의 앞부분(없으면 시장에 맞춘 기본) — 「티커」 에 이미 있는 종목이면 그 줄의 코드를 쓴다.
 */
export function decideNewHolding(grid: SheetGrid, sectionKey: string, stock: StockInfo, exchange: AssetUsPrefix | null): NewHoldingDecision {
  const section = grid.shape.sections.find((s) => !s.combined && s.key === sectionKey);
  const group = (L.tickers.groupOfSection as Record<string, string>)[sectionKey];
  if (!section || !group) throw new AssetSheetError('not-editable', '이 계좌에는 새 종목을 넣을 수 없습니다.');
  const holdings = grid.data.sections.find((s) => !s.combined && s.key === sectionKey)?.holdings ?? [];
  const existing = holdings.find((h) => h.code != null && sameStock(h.code, stock)) ?? null;
  const ticker = tickerSpot(grid, group, stock);

  const inSheet = new Set(tickerRowsOf(grid.shape.tickers).flatMap((r) => {
    const c = tickerRowCode(grid.tickerValues[r - 1]);
    const ex = c ? splitCode(c).exchange : null;
    return ex ? [ex.toUpperCase()] : [];
  }));
  const prefix = stock.market === 'US' ? (exchange ?? defaultPrefix(stock.listing, inSheet)) : null;
  const code = ticker.status === 'existing' ? ticker.code : prefix ? `${prefix}:${stock.symbol}` : stock.symbol;

  if (existing) return { section, group, stock, code, prefix, ticker, existing, shapeRow: section.lastRow, sums: [] };

  let shapeRow = 0;
  for (let row = section.lastRow; row >= section.firstRow && !shapeRow; row--) if (linkedTickerRow(grid.holding[row - 1]?.[4]) != null) shapeRow = row;
  if (!shapeRow) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${HOLDINGS_TAB}」 「${sectionKey}」 구간에 「${TICKER_TAB}」 와 이어진 줄이 없습니다).`);
  const sums = findSumCells(grid.holding, section, nextHead(grid.shape, section));
  if (sums.length === 0) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${HOLDINGS_TAB}」 「${sectionKey}」 구간의 합계 줄을 찾지 못해 쓰지 않았습니다).`);
  return { section, group, stock, code, prefix, ticker, existing: null, shapeRow, sums };
}

// ───────── 새 종목 — 쓰기 ─────────

export interface NewHoldingOrder {
  qty: number;
  price: number;
  assetClass: string;
  /** 시트 가격이 토스면 토스 가격 · GOOGLEFINANCE 면 null */
  tossPrice: number | null;
}

export interface NewHoldingDone {
  holdingRow: number;
  tickerRow: number;
  /** 「티커」 에 줄을 넣었으면 그 줄 번호 */
  tickerInserted: number | null;
  /** 「티커」 에 새로 쓴 줄(빈 줄 · 새 줄)인가 */
  tickerWritten: boolean;
  sumExtended: boolean;
}

const rowRange = (sheetId: number, row: number) => ({ sheetId, dimension: 'ROWS' as const, startIndex: row - 1, endIndex: row });
const insertRow = (sheetId: number, row: number): StructureRequest => ({ insertDimension: { range: rowRange(sheetId, row), inheritFromBefore: true } });
const deleteRow = (sheetId: number, row: number): StructureRequest => ({ deleteDimension: { range: rowRange(sheetId, row) } });
const lineRange = (sheetId: number, row: number, columns?: [number, number]): GridRange => ({
  sheetId,
  startRowIndex: row - 1,
  endRowIndex: row,
  ...(columns ? { startColumnIndex: columns[0], endColumnIndex: columns[1] } : {}),
});
const copyLine = (sheetId: number, from: number, to: number, columns?: [number, number]): StructureRequest => ({
  copyPaste: { source: lineRange(sheetId, from, columns), destination: lineRange(sheetId, to, columns), pasteType: 'PASTE_NORMAL', pasteOrientation: 'NORMAL' },
});

/** 「티커」 복사 · 비우는 칸 — B ~ `shapeLastColumn` */
const TICKER_COLUMNS: [number, number] = [1, L.shapeLastColumn.charCodeAt(0) - 64];
const tickerCell = (col: string, row: number) => one(TICKER_TAB, `${col}${row}`);

/** 글자 · 숫자는 RAW(종목 코드 「005930」 이 숫자로 바뀌지 않게) · 수식은 USER_ENTERED — 값 쓰기는 이 두 줄뿐 */
async function writeCells(config: AssetSheetConfig, raw: CellWrite[], formulas: CellWrite[]): Promise<void> {
  if (raw.length > 0) await valuesWrite(config, raw);
  if (formulas.length > 0) await valuesWrite(config, formulas, 'USER_ENTERED');
}

/** 가격 칸 — 토스면 숫자 + `=E행`(시트 가격 바꾼 뒤 모양) · GOOGLEFINANCE 면 위 줄과 같은 모양 */
function tickerPriceCells(row: number, market: 'KR' | 'US', tossPrice: number | null, sourceWon: Cell): { raw: CellWrite[]; formulas: CellWrite[] } {
  const P = L.prices;
  const fx = P.fxCell.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
  if (tossPrice != null) return { raw: [{ range: tickerCell(P.priceColumn, row), value: tossPrice }], formulas: [{ range: tickerCell(P.wonColumn, row), value: wonFormula(row, market) }] };
  const googleStyle = /GOOGLEFINANCE/i.test(String(sourceWon ?? ''));
  const won = googleStyle
    ? market === 'US' ? `=GOOGLEFINANCE($${P.codeColumn}${row},"price")*${fx}` : `=GOOGLEFINANCE(${P.codeColumn}${row},"price")`
    : wonFormula(row, market);
  return {
    raw: [],
    formulas: [
      { range: tickerCell(P.priceColumn, row), value: `=GOOGLEFINANCE(${P.codeColumn}${row},"price")` },
      { range: tickerCell(P.wonColumn, row), value: won },
    ],
  };
}

const sameValue = (got: Cell, want: string | number) => (typeof want === 'number' ? typeof got === 'number' && Math.abs(got - want) < 1e-9 : String(got ?? '') === want);

/**
 * 새 종목을 시트에 쓴다 — 단계마다 실패하면 앞에서 바꾼 것을 뒤에서부터 되돌리고 오류를 낸다. `commit` 은 시트 확인이 끝난 뒤 기록(실패하면 시트도 되돌린다).
 * 순서: ① 「티커」(이미 있으면 건너뜀 · 빈 줄이면 위 종목 줄 복사 뒤 값 · 없으면 줄 넣기 + 복사 뒤 값) ② 보유 줄(맨 아래 다음에 넣기 + 위 줄 복사 뒤 값) ③ 다시 읽어 확인 · 합계 범위(안 늘었으면 범위 끝만) ④ `commit`.
 */
export async function insertNewHolding<T>(config: AssetSheetConfig, grid: SheetGrid, d: NewHoldingDecision, order: NewHoldingOrder, commit: (done: NewHoldingDone) => T): Promise<{ done: NewHoldingDone; committed: T }> {
  const tabs = await sheetTabs(config);
  const tickerId = tabs.get(TICKER_TAB);
  const holdingId = tabs.get(HOLDINGS_TAB);
  if (tickerId == null || holdingId == null) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${TICKER_TAB}」 · 「${HOLDINGS_TAB}」 탭을 찾지 못했습니다).`);

  const undo: (() => Promise<void>)[] = [];
  try {
    // ① 「티커」
    const t = d.ticker;
    const tickerRow = t.row;
    if (t.status !== 'existing') {
      if (t.status === 'insert') {
        await structureWrite(config, [insertRow(tickerId, t.row), copyLine(tickerId, t.source, t.row, TICKER_COLUMNS)]);
        undo.push(() => structureWrite(config, [deleteRow(tickerId, t.row)]));
      } else {
        await structureWrite(config, [copyLine(tickerId, t.source, t.row, TICKER_COLUMNS)]);
        const cleared: CellWrite[] = [];
        for (let c = TICKER_COLUMNS[0]; c < TICKER_COLUMNS[1]; c++) cleared.push({ range: tickerCell(colName(c), t.row), value: '' });
        undo.push(() => valuesClear(config, cleared));
      }
      const P = L.prices;
      const price = tickerPriceCells(t.row, d.stock.market, order.tossPrice, grid.ticker[t.source - 1]?.[4]);
      await writeCells(
        config,
        [
          { range: tickerCell('B', t.row), value: d.stock.name },
          { range: tickerCell(P.codeColumn, t.row), value: d.code },
          { range: tickerCell(L.assetClass.column, t.row), value: order.assetClass },
          ...price.raw,
        ],
        price.formulas,
      );
    }

    // ② 보유 줄
    const newRow = d.section.lastRow + 1;
    await structureWrite(config, [insertRow(holdingId, newRow), copyLine(holdingId, d.shapeRow, newRow)]);
    undo.push(() => structureWrite(config, [deleteRow(holdingId, newRow)]));
    const usd = d.stock.market === 'US';
    const avgCell = one(HOLDINGS_TAB, `C${newRow}`);
    const avgFormula = `=(${order.price})*('${TICKER_TAB}'!$G$9)`;
    const link = linkFormulaFor(String(grid.holding[d.shapeRow - 1]?.[4]), newRow - d.shapeRow, tickerRow);
    await writeCells(
      config,
      [
        { range: one(HOLDINGS_TAB, `B${newRow}`), value: d.stock.name },
        { range: one(HOLDINGS_TAB, `D${newRow}`), value: order.qty },
        ...(usd ? [] : [{ range: avgCell, value: order.price }]),
      ],
      [...(usd ? [{ range: avgCell, value: avgFormula }] : []), { range: one(HOLDINGS_TAB, `F${newRow}`), value: link }],
    );

    // ③ 다시 읽어 확인 · 합계 범위
    const verifyRanges = [wholeTab(HOLDINGS_TAB), tickerLinesRange()];
    const [wholeHolding, tickerNow] = await batchGet(config, verifyRanges, 'FORMULA');
    const holdingNow = fromB(wholeHolding);
    const line = holdingNow[newRow - 1] ?? [];
    const tickerLine = tickerNow[tickerRow - 1] ?? [];
    const avgOk = usd ? String(line[1] ?? '').replace(/\s/g, '') === avgFormula.replace(/\s/g, '') : sameValue(line[1], order.price);
    const holdingOk = sameValue(line[0], d.stock.name) && sameValue(line[2], order.qty) && avgOk && linkedTickerRow(line[4]) === tickerRow;
    const tickerOk = t.status === 'existing' || (sameValue(tickerLine[1], d.code) && sameValue(tickerLine[0], d.stock.name));
    if (!holdingOk || !tickerOk) throw new AssetSheetError('mismatch', '시트에 쓴 값이 다르게 읽혔습니다 — 넣은 줄을 되돌렸습니다.');

    const fixes = sumFixes(holdingNow, d.sums, d.section, newRow);
    if (fixes.length > 0) {
      await writeCells(config, [], fixes);
      const back = await batchGet(config, fixes.map((f) => f.range), 'FORMULA');
      if (!fixes.every((f, i) => String(back[i]?.[0]?.[0] ?? '').replace(/\s/g, '') === String(f.value).replace(/\s/g, ''))) throw new AssetSheetError('mismatch', '합계 범위가 다르게 읽혔습니다 — 넣은 줄을 되돌렸습니다.');
    }

    // ④ 기록
    const done: NewHoldingDone = { holdingRow: newRow, tickerRow, tickerInserted: t.status === 'insert' ? t.row : null, tickerWritten: t.status !== 'existing', sumExtended: fixes.length > 0 };
    return { done, committed: commit(done) };
  } catch (e) {
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch {
        throw new AssetSheetError('mismatch', '시트에 쓰다 실패했고 되돌리지도 못했습니다 — 시트를 열어 넣은 줄을 확인해 주세요(버전 기록으로 되돌릴 수 있습니다).');
      }
    }
    throw e;
  }
}

/** 빈 줄에 복사 · 쓴 칸 비우기(되돌리기) — 빈 글자 RAW */
const valuesClear = (config: AssetSheetConfig, cells: CellWrite[]) => writeCells(config, cells, []);

// ───────── 모두 매도 ─────────

/** 그 줄을 **한 칸으로** 가리키는 수식의 자리 — 그 줄 자신 · `skip`(합계 칸 — `열줄`) 제외 · 여러 줄 범위는 구글이 줄여 주므로 넣지 않는다(「탭」 칸 주소) */
export function findRowRefs(tabs: Map<string, CellRows>, targetTab: string, row: number, skip: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const [tab, rows] of tabs) {
    rows.forEach((line, y) => {
      if (tab === targetTab && y + 1 === row) return;
      line.forEach((v, x) => {
        if (typeof v !== 'string' || !v.trim().startsWith('=') || (tab === targetTab && skip.has(`${colName(x)}${y + 1}`))) return;
        const hit = parseRefs(v).some((r) => (r.tab ?? tab) === targetTab && r.row === row && (!r.range || r.endRow === row));
        if (hit) out.push(`「${tab}」 ${colName(x)}${y + 1}`);
      });
    });
  }
  return out;
}

const SHOW_REFS = 3;

/** 모두 매도가 막힌 이유 — 어느 칸 때문인지 앞에(처음 3칸 + 「외 n칸」) */
export function rowReferencedMessage(refs: string[]): string {
  const shown = refs.slice(0, SHOW_REFS).join(' · ');
  const subject = refs.length > SHOW_REFS ? `${shown} 외 ${refs.length - SHOW_REFS}칸이` : `${shown} 칸이`;
  return `${subject} 이 종목을 써요. 그 칸을 먼저 정리한 뒤 다시 눌러 주세요.`;
}

/**
 * 모두 매도 — 보유 줄 하나만 지운다(「티커」 줄 · 합친 표는 그대로). 순서:
 * ① 합계 줄 말고 다른 칸이 이 줄을 가리키면 409 `row-referenced`(어디) ② 구간에 종목이 한 줄뿐이면 409 `last-row` ③ `deleteDimension` ④ 다시 읽어 줄이 빠졌는지 · 합계 범위 끝이 한 줄 줄었는지 확인.
 */
export async function deleteHoldingRow(config: AssetSheetConfig, grid: SheetGrid, sectionKey: string, h: AssetHolding): Promise<void> {
  const section = grid.shape.sections.find((s) => !s.combined && s.key === sectionKey);
  if (!section) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${HOLDINGS_TAB}」 「${sectionKey}」 구간이 없습니다).`);
  const sums = findSumCells(grid.holding, section, nextHead(grid.shape, section));
  const refs = findRowRefs(grid.tabs, HOLDINGS_TAB, h.row, new Set(sums.map((c) => `${colName(c.col + 1)}${c.row}`)));
  if (refs.length > 0) throw new AssetSheetError('row-referenced', rowReferencedMessage(refs));
  const holdings = grid.data.sections.find((s) => !s.combined && s.key === sectionKey)?.holdings ?? [];
  if (holdings.length <= 1) throw new AssetSheetError('last-row', '마지막 종목은 시트에서 직접 정리해 주세요.');

  const holdingId = (await sheetTabs(config)).get(HOLDINGS_TAB);
  if (holdingId == null) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${HOLDINGS_TAB}」 탭을 찾지 못했습니다).`);
  const beforeSums = sums.map((c) => grid.holding[c.row - 1]?.[c.col] as string);

  await structureWrite(config, [deleteRow(holdingId, h.row)]);

  const failed = () => new AssetSheetError('mismatch', '줄을 지운 뒤 시트가 다르게 읽혔습니다 — 시트를 열어 그 계좌의 합계를 확인해 주세요(버전 기록으로 되돌릴 수 있습니다).');
  const [whole] = await batchGet(config, [wholeTab(HOLDINGS_TAB)], 'FORMULA');
  const after = fromB(whole);
  // 지운 자리에 다음 줄이 올라왔는가
  if (String(after[h.row - 1]?.[0] ?? '') !== String(grid.holding[h.row]?.[0] ?? '')) throw failed();
  sums.forEach((c, i) => {
    const f = after[c.row - 2]?.[c.col]; // 한 줄 위로
    const was = parseRefs(beforeSums[i]).filter((r) => coversSection(r, section, section.lastRow));
    const now = typeof f === 'string' ? parseRefs(f).filter((r) => coversSection(r, section, section.lastRow - 1)) : [];
    if (now.length !== was.length || !now.every((r, j) => r.endRow === (was[j].endRow as number) - 1)) throw failed();
  });
}
