/**
 * 자산 시트 읽기 · 자산 분류 쓰기 · 목표 비율 쓰기 · 계좌 이름 날짜 쓰기(v2.61.0 · v2.62.0 · v2.63.0 · v2.64.0) — 칸 목록은 `sheetLayout.ts` 한 곳, 구글 호출은 `google.ts`.
 *
 * - 화면을 열 때 · 「다시 읽기」 · 총 자산 계산(화면이 열린 동안 · 하루 기록 1번)에 읽는다. 같은 결과는 30초 캐시(동시에 온 요청은 한 번만 읽는다).
 * - 쓰기는 세 곳 — `writeAssetClasses`(「티커」 종목 줄 D열의 자산 분류 — 여러 줄 한 요청 · v2.65.2) · `writeTargetRatio`(목표 비율 여섯 칸) ·
 *   `writeAccountDates`(「구매 완료」 — 「주식 투자 정리」 계좌 이름 칸의 「( 날짜 )」).
 *   셋 다 쓰기 직전에 수식 그대로 다시 읽어 머리 글자 · 수식 칸을 확인한다(구글에 쓰는 함수는 `google.ts` `valuesWrite` 하나).
 * - 한 번 읽기 = `values:batchGet` 두 번: ① 값(UNFORMATTED_VALUE) — 머리 글자 · 두 탭 넓은 범위 · 값 칸 ② 수식(FORMULA) — 보유 줄의 C(평균 매입가) · F(이을 줄)
 *   + 「티커」 B~D(자산 분류 칸이 수식인지 — 「자산 분류 정하기」 창이 그 줄의 버튼을 감춘다 · v2.65.3 · 같은 요청 안의 범위 하나).
 * - 구간은 고정 줄 번호가 아니라 읽은 넓은 범위에서 머리 글자로 찾는다(`sheetShape.ts` · v2.66.2).
 * - 머리 글자가 하나라도 다르면 값을 쓰지 않고 「시트 모양이 바뀌었어요(탭 · 칸)」.
 * ⚠️ 읽은 값은 로그에 찍지 않는다(실패 이유 종류만).
 */
import { isAssetClass, type AssetClass, type AssetHolding, type AssetSection, type AssetSheetData, type AssetTargetRatio } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows } from './google';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HeaderCheck } from './sheetLayout';
import { findHoldingSections, findSheetShape, findTickerGroups, tickerRowsOf } from './sheetShape';

const CACHE_MS = 30_000;

type Cell = string | number | boolean | undefined;

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
export const one = (tab: string, cell: string) => `${q(tab)}!${cell}`;
/** 넓은 범위 — B1 부터 그 열의 시트 끝까지(줄 수를 정하지 않는다 · 값이 있는 줄까지만 온다). `rows[줄 번호 - 1]` 이 그 줄 */
export const wideRange = (tab: string, lastColumn: string) => `${q(tab)}!B1:${lastColumn}`;
/** 「주식 투자 정리」 이름(B) ~ 이을 수식(F) */
const holdingWide = () => wideRange(HOLDINGS_TAB, 'F');
/** 「티커」 이름(B) · 코드(C) · 자산 분류(D) */
const tickerWide = () => wideRange(TICKER_TAB, SHEET_LAYOUT.assetClass.column);

/** 공백을 모두 뺀 글자 — 띄어쓰기만 다른 것은 같은 모양 */
const squash = (v: Cell) => String(v ?? '').replace(/\s+/g, '');

/** 읽을 범위 — 값 읽기 / 수식 읽기. 순서가 곧 `parseAssetSheet` 가 받는 배열 순서다 */
export function sheetRanges(): { values: string[]; formulas: string[] } {
  const L = SHEET_LAYOUT;
  const ratio = L.targetRatio;
  return {
    values: [
      ...L.headers.map((h) => one(h.tab, h.cell)),
      holdingWide(),
      tickerWide(),
      one(L.cells.cashTotal.tab, L.cells.cashTotal.cell),
      one(L.cells.retirement.tab, L.cells.retirement.cell),
      one(L.cells.salary.tab, L.cells.salary.cell),
      one(L.cells.avgFxRate.tab, L.cells.avgFxRate.cell),
      ...ratio.assets.map((c) => one(ratio.tab, c)),
      ...ratio.coreSatellite.map((c) => one(ratio.tab, c)),
    ],
    // 보유 탭 뒤 = 구매 평균 환율 칸(수식 여부 — v2.66.0) · 맨 끝 = 「티커」(자산 분류 칸 수식 여부 — v2.65.3)
    formulas: [holdingWide(), one(L.cells.avgFxRate.tab, L.cells.avgFxRate.cell), tickerWide()],
  };
}

const first = (rows: CellRows | undefined): Cell => rows?.[0]?.[0];

/** 숫자 칸 — 숫자가 아니면 null(쉼표가 든 글자도 숫자로) */
function num(v: Cell): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.replace(/,/g, '').trim();
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return Number(t);
  }
  return null;
}

const text = (v: Cell) => (v == null ? '' : String(v).trim());

/** 「티커」 한 줄(B · C …)이 종목 줄이면 그 코드 — 빈 줄 · 이름 없음 · 코드 없음 · 구분 줄(「개별 투자」 등)은 null */
export function tickerRowCode(r: Cell[] | undefined): string | null {
  const name = text(r?.[0]);
  const code = text(r?.[1]);
  if (!name || !code) return null;
  if (SHEET_LAYOUT.tickers.skipNames.some((n) => squash(n) === squash(name))) return null;
  return code;
}

/** 「티커」 넓은 범위 → 지금 종목 줄의 줄 번호 → 코드(머리를 찾지 못하면 `shape` 오류) */
export function tickerCodeMap(rows: CellRows): Map<number, string> {
  const out = new Map<number, string>();
  for (const row of tickerRowsOf(findTickerGroups(rows))) {
    const code = tickerRowCode(rows[row - 1]);
    if (code) out.set(row, code);
  }
  return out;
}

/** 「티커」 코드 → 시장 · 거래소 · 종목. `:` 가 있으면 미국(`NASDAQ:NVDA`), 없으면 국내(코드 그대로 — `0072R0` 처럼 영문이 섞여도) */
export function splitCode(code: string): Pick<AssetHolding, 'market' | 'exchange' | 'symbol'> {
  const c = code.trim();
  const at = c.indexOf(':');
  if (at >= 0) return { market: 'US', exchange: c.slice(0, at).trim() || null, symbol: c.slice(at + 1).trim() || null };
  return { market: 'KR', exchange: null, symbol: c };
}

/** C열 — `=(달러값)*('티커'!$G$9)` 이면 달러 원래 값 · USD, 그 밖에는 원화(수식이면 계산된 값) */
export function avgPriceOf(formula: Cell, value: Cell): { avgPrice: number | null; currency: 'USD' | 'KRW' } {
  if (typeof formula === 'string') {
    const m = formula.trim().match(SHEET_LAYOUT.usdFormula);
    if (m) return { avgPrice: Number(m[1]), currency: 'USD' };
  }
  return { avgPrice: num(value), currency: 'KRW' };
}

/** F열 수식에서 「티커」 줄 번호 */
export function linkedTickerRow(formula: Cell): number | null {
  if (typeof formula !== 'string') return null;
  const m = formula.match(SHEET_LAYOUT.linkFormula);
  return m ? Number(m[1]) : null;
}

/** 매수 · 매도 입력을 받는 줄인가(v2.66.0) — 평균가 칸(`avgF`) · 수량 칸(`qtyF`)은 수식 그대로 읽은 값. 수식 수량 · 시장과 다른 평균가 모양은 받지 않는다 */
function isTradable(combined: boolean, market: AssetHolding['market'], linked: boolean, avgF: Cell, qtyF: Cell): boolean {
  if (combined || !linked || typeof qtyF !== 'number' || !(qtyF > 0)) return false;
  if (market === 'KR') return typeof avgF === 'number' && avgF > 0;
  if (market !== 'US' || typeof avgF !== 'string') return false;
  const m = avgF.trim().match(SHEET_LAYOUT.usdFormula);
  return m != null && Number(m[1]) > 0;
}

/** 목표 비율 묶음을 백분율로 — 합이 1 근처면 비율(0.3)로 적힌 것(×100), 아니면 이미 백분율 */
function asPercent(values: (number | null)[]): (number | null)[] {
  const known = values.filter((v): v is number => v != null);
  const sum = known.reduce((a, b) => a + b, 0);
  const fraction = known.length > 0 && sum <= 1.0001;
  return values.map((v) => (v == null ? null : fraction ? Math.round(v * 1_000_000) / 10_000 : v));
}

/**
 * 읽은 범위들 → 화면 값. 순수 함수(시험이 가짜 값으로 부른다).
 * 머리 글자가 다르면 `AssetSheetError('shape')` — 값은 쓰지 않는다.
 */
export function parseAssetSheet(values: CellRows[], formulas: CellRows[], readAt: string): AssetSheetData {
  const L = SHEET_LAYOUT;
  let i = 0;
  const next = () => values[i++] ?? [];

  for (const h of L.headers) {
    if (!headerOk(h, first(next()))) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  }
  const holdingRows = next();
  const tickerRows = next();
  const shape = findSheetShape(holdingRows, tickerRows); // 못 찾으면 shape 오류 — 값을 만들지 않는다

  // 「티커」 줄 번호 → 코드 · 자산 분류(D)
  /** 「티커」 수식(맨 끝 범위) — 없으면(모양 확인 단계 · 옛 호출) 수식 아님 */
  const tickerFormulas = formulas[2] ?? [];
  const codeByRow = new Map<number, { code: string; cls: string; clsFormula: boolean }>();
  for (const row of tickerRowsOf(shape.tickers)) {
    const r = tickerRows[row - 1];
    const code = tickerRowCode(r);
    const f = tickerFormulas[row - 1]?.[2];
    if (code) codeByRow.set(row, { code, cls: text(r?.[2]), clsFormula: typeof f === 'string' && f.trim().startsWith('=') });
  }

  const holdingFormulas = formulas[0] ?? [];
  const sections: AssetSection[] = shape.sections.map((s) => {
    const holdings: AssetHolding[] = [];
    for (let row = s.firstRow; row <= s.lastRow; row++) {
      const r = holdingRows[row - 1] ?? [];
      const f = holdingFormulas[row - 1] ?? [];
      const name = text(r[0]);
      if (!name) continue;
      const linked = linkedTickerRow(f[4]);
      const ticker = linked != null ? (codeByRow.get(linked) ?? null) : null;
      const code = ticker?.code ?? null;
      const cls = ticker?.cls ?? '';
      const where = code ? splitCode(code) : { market: null, exchange: null, symbol: null };
      const avg = avgPriceOf(f[1], r[1]);
      holdings.push({
        row,
        name,
        code,
        ...where,
        quantity: num(r[2]),
        ...avg,
        tradable: isTradable(s.combined, where.market, ticker != null, f[1], f[2]),
        avgFormula: avg.currency === 'USD' && typeof f[1] === 'string' ? f[1].trim() : null,
        tickerRow: ticker ? linked : null,
        assetClass: isAssetClass(cls) ? cls : null, // 빈칸 · 세 글자가 아닌 글자(옛 「현금」 포함) → 「미지정」(null)
        classFormula: ticker?.clsFormula ?? false,
      });
    }
    // 합친 표는 머리 줄이 「내 계좌 정보」 라 정해 둔 이름 · 계좌는 그 칸의 글자 그대로
    const name = s.combined ? s.key : text(holdingRows[s.nameRow - 1]?.[0]);
    return { key: s.combined ? null : s.key, name, combined: s.combined, holdings };
  });

  const cashTotal = num(first(next()));
  const retirement = num(first(next()));
  const salary = num(first(next()));
  const avgFxRate = num(first(next()));
  const [cash, gold, bond, invest] = asPercent(L.targetRatio.assets.map(() => num(first(next()))));
  const [core, satellite] = asPercent(L.targetRatio.coreSatellite.map(() => num(first(next()))));
  const targetRatio: AssetTargetRatio = { cash, gold, bond, invest, core, satellite };

  const fxFormula = first(formulas[1]);
  const avgFxFormula = typeof fxFormula === 'string' && fxFormula.trim().startsWith('=');
  return { readAt, sections, cashTotal, retirement, targetRatio, salary, avgFxRate, avgFxFormula };
}

let cache: { at: number; data: AssetSheetData } | null = null;
let inflight: Promise<AssetSheetData> | null = null;

/** 시험이 캐시를 비운다 */
export function resetSheetCache(): void {
  cache = null;
  inflight = null;
}

/** 시트를 읽는다(30초 캐시). 실패는 `AssetSheetError` */
export async function readAssetSheet(): Promise<AssetSheetData> {
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    const ranges = sheetRanges();
    const values = await batchGet(config, ranges.values, 'UNFORMATTED_VALUE');
    // 머리 글자를 먼저 본다 — 모양이 다르면 수식은 읽지 않는다
    parseAssetSheet(values, [], new Date().toISOString());
    const formulas = await batchGet(config, ranges.formulas, 'FORMULA');
    const data = parseAssetSheet(values, formulas, new Date().toISOString());
    cache = { at: Date.now(), data };
    return data;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 머리 글자 하나가 맞는가 — 공백을 모두 빼고 비교 · `prefix` 는 앞부분만 */
export const headerOk = (h: HeaderCheck, got: Cell) => (h.prefix ? squash(got).startsWith(squash(h.expect)) : squash(got) === squash(h.expect));

/** 쓰기 실패 중 시트와 상관없는 것(칸 · 값 · 스위치) — 화면에는 문구 그대로 */
const refuse = (kind: 'disabled' | 'not-editable' | 'formula-cell', message: string) => new AssetSheetError(kind, message);

/** 한 요청에 받는 줄 번호 수의 상한(잘못된 요청을 시트에 읽으러 가기 전에 막는다 · 실제 종목 줄인지는 시트를 읽어 본다) */
export const ASSET_CLASS_MAX_ROWS = 200;

/**
 * 요청의 줄 번호를 지금 줄로(v2.66.2 — 화면이 본 뒤 사용자가 시트에 줄을 넣어도 맞는 줄에 쓴다). 순수 함수.
 * 코드마다: 요청한 줄이 모두 지금도 그 코드면 그대로 · 아니면 지금 그 코드의 줄 수가 요청과 같을 때만 지금 줄들(같은 값을 쓰는 묶음이라 순서는 상관없다) · 그 밖은 `sheet-changed`.
 * `codes` 를 안 보낸 요청(빈 글자 포함)은 줄 번호 그대로.
 */
export function resolveClassRows(rows: number[], codes: string[] | null, codeAt: Map<number, string>): number[] {
  if (!codes) return [...new Set(rows)].sort((a, b) => a - b);
  const asked = new Map<string, Set<number>>();
  const out = new Set<number>();
  rows.forEach((row, i) => {
    if (!codes[i]) out.add(row);
    else asked.set(codes[i], (asked.get(codes[i]) ?? new Set<number>()).add(row));
  });
  for (const [code, want] of asked) {
    const now = [...codeAt].filter(([, c]) => c === code).map(([r]) => r);
    let target: number[];
    if ([...want].every((r) => codeAt.get(r) === code)) target = [...want];
    else if (now.length === want.size) target = now;
    else throw new AssetSheetError('sheet-changed', '시트가 바뀌었어요 — 다시 열어 주세요.');
    for (const r of target) out.add(r);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 자산 분류 쓰기(v2.65.2 — 여러 줄 한 번에 · 한 줄 고르기도 `rows: [n]`) — 「티커」 D열에 쓰는 **유일한 곳**. 검사는 모두 여기 한 곳. 순서:
 * ① 스위치(`ASSET_SYNC_ENABLED=false` → 「꺼짐」) ② 줄 번호 목록 · 값 확인(양의 정수 · 중복은 한 번 · 채권 · 금 · 주식 또는 빈칸 — 「현금」 은 거절 · `codes` 는 줄마다 화면이 본 코드)
 * ③ 쓰기 직전에 머리 D12 와 「티커」 를 **수식 그대로** 한 번 다시 읽어 묶음을 다시 찾는다 — 머리가 다르면 「모양 바뀜」 · 코드로 지금 줄을 정한다(`resolveClassRows`) · 종목 줄이 아닌 줄(구분 줄 · 빈 줄)이 하나라도 있으면 거절 ·
 *    그 칸 중 하나라도 `=` 로 시작하면(수식) **하나도 쓰지 않고** 409 `formula-cell`
 * ④ `valuesWrite` **한 요청**(RAW — 칸 여럿) ⑤ 쓴 칸을 다시 읽어 보낸 값과 같은지 확인(다르면 `mismatch`) ⑥ 30초 캐시를 비우고 다시 읽은 시트 값을 돌려준다.
 * ⚠️ 쓴 값 · 읽은 값을 로그에 찍지 않는다.
 */
export async function writeAssetClasses(rows: unknown, value: unknown, codes?: unknown): Promise<AssetSheetData> {
  if (!isAssetSyncEnabled()) throw refuse('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const L = SHEET_LAYOUT;
  const col = L.assetClass.column;
  const okRow = (r: unknown): r is number => typeof r === 'number' && Number.isInteger(r) && r >= 1;
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every(okRow)) {
    throw refuse('not-editable', `자산 분류는 「${TICKER_TAB}」 탭 ${col}열의 종목 줄에만 쓸 수 있습니다(요청 모양 { rows: [줄 번호…], assetClass }).`);
  }
  if (new Set(rows).size > ASSET_CLASS_MAX_ROWS) throw refuse('not-editable', `한 번에 ${ASSET_CLASS_MAX_ROWS}줄까지 쓸 수 있습니다.`);
  if (value !== '' && !isAssetClass(value)) throw refuse('not-editable', `자산 분류는 ${L.assetClass.values.join(' · ')} 중 하나이거나 빈칸이어야 합니다.`);
  if (codes !== undefined && !(Array.isArray(codes) && codes.length === rows.length && codes.every((c) => typeof c === 'string'))) {
    throw refuse('not-editable', '요청 모양이 올바르지 않습니다(codes 는 줄마다 하나).');
  }
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');

  const header = L.headers.find((h) => h.tab === TICKER_TAB && h.cell === `${col}${L.tickers.headRow}`)!;
  const [headRows, grid] = await batchGet(config, [one(TICKER_TAB, header.cell), tickerWide()], 'FORMULA');
  if (!headerOk(header, first(headRows))) {
    throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${header.tab}」 탭 ${header.cell} — 「${header.expect}」 이어야 합니다).`);
  }
  const unique = resolveClassRows(rows, (codes as string[] | undefined) ?? null, tickerCodeMap(grid));
  const lineOf = (row: number) => grid[row - 1];
  const stockRows = new Set(tickerRowsOf(findTickerGroups(grid)));
  const notLine = unique.filter((row) => !stockRows.has(row) || !tickerRowCode(lineOf(row)));
  if (notLine.length > 0) {
    throw refuse('not-editable', `「${TICKER_TAB}」 ${notLine.map((r) => `${r}행`).join(' · ')}은 종목 줄이 아닙니다(구분 줄 · 빈 줄에는 쓰지 않습니다 — 하나도 쓰지 않았습니다).`);
  }
  const formulaAt = unique.filter((row) => {
    const v = lineOf(row)?.[2];
    return typeof v === 'string' && v.trim().startsWith('=');
  });
  if (formulaAt.length > 0) {
    throw refuse('formula-cell', `「${TICKER_TAB}」 ${formulaAt.map((r) => `${col}${r}`).join(' · ')} 칸에 수식이 있어 하나도 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  const ranges = unique.map((row) => one(L.assetClass.tab, `${col}${row}`));
  await valuesWrite(config, ranges.map((range) => ({ range, value: value as AssetClass | '' })));
  resetSheetCache();
  const back = await batchGet(config, ranges, 'FORMULA');
  if (!ranges.every((_, i) => (first(back[i]) ?? '') === value)) {
    throw new AssetSheetError('mismatch', `시트에 쓴 자산 분류가 다르게 읽혔습니다(시트를 열어 「${TICKER_TAB}」 ${col}열을 확인하세요).`);
  }
  return readAssetSheet();
}

/** 저장할 목표 비율 — 여섯 칸 모두 정수 % */
export type TargetRatioInput = Record<keyof AssetTargetRatio, number>;
/** 시트 칸 순서 그대로(현금 · 금 · 채권 · 투자 / 코어 · 위성) — `SHEET_LAYOUT.targetRatio.assets` · `coreSatellite` 와 짝 */
const RATIO_ASSET_KEYS = ['cash', 'gold', 'bond', 'invest'] as const;
const RATIO_STOCK_KEYS = ['core', 'satellite'] as const;

/** 목표 비율 검사 — 여섯 칸 정수 0~100 · 네 칸 합 100 · 코어 + 위성 100. 틀리면 null */
export function checkTargetRatio(input: unknown): TargetRatioInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const keys = [...RATIO_ASSET_KEYS, ...RATIO_STOCK_KEYS];
  if (!keys.every((k) => typeof o[k] === 'number' && Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) <= 100)) return null;
  const r = Object.fromEntries(keys.map((k) => [k, o[k] as number])) as TargetRatioInput;
  if (RATIO_ASSET_KEYS.reduce((a, k) => a + r[k], 0) !== 100) return null;
  if (RATIO_STOCK_KEYS.reduce((a, k) => a + r[k], 0) !== 100) return null;
  return r;
}

/**
 * 한 묶음(네 칸 · 두 칸)이 시트에 어떤 모양으로 적혀 있나 — 숫자 합이 1 이하면 비율(0.1), 아니면 %(10).
 * 읽기의 `asPercent` 와 같은 기준. 숫자가 하나도 없으면(빈칸뿐) 비율(시트 칸이 % 서식 — 2026-11-07 시험용 시트로 확인).
 */
function ratioForm(cells: Cell[]): 'fraction' | 'percent' {
  const known = cells.map(num).filter((v): v is number => v != null);
  if (known.length === 0) return 'fraction';
  return known.reduce((a, b) => a + b, 0) <= 1.0001 ? 'fraction' : 'percent';
}

/**
 * 목표 비율 여섯 칸 쓰기(v2.63.0 · 설정 창 「목표 비율」 저장). **검사는 이 함수 한 곳**. 순서:
 * ① 스위치(`ASSET_SYNC_ENABLED=false` → 「꺼짐」) ② 값 확인(정수 0~100 · 네 칸 합 100 · 코어 + 위성 100 — `checkTargetRatio`)
 * ③ 쓰기 직전에 머리 글자(`targetRatio.headers`)와 여섯 칸을 **수식 그대로** 다시 읽는다 — 머리가 다르면 「모양 바뀜」,
 *    여섯 칸 중 하나라도 수식이면 **하나도 쓰지 않고** 거절(409 `formula-cell`) · 숫자가 아닌 글자가 있으면 거절
 * ④ 원래 모양 그대로(비율 0.1 / % 10 — 묶음마다) **숫자로** `valuesWrite` 한 요청
 * ⑤ 캐시를 비우고 다시 읽어 여섯 값이 보낸 값과 같은지 확인 — 다르면 `mismatch` 오류.
 * ⚠️ 칸 순서는 시트 그대로(현금 · 금 · 채권 · 투자 = C · D · E · F) — 화면 순서와 섞지 않는다. 쓴 값 · 읽은 값을 로그에 찍지 않는다.
 */
export async function writeTargetRatio(input: unknown): Promise<AssetSheetData> {
  if (!isAssetSyncEnabled()) throw refuse('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const ratio = checkTargetRatio(input);
  if (!ratio) throw refuse('not-editable', '목표 비율은 0~100 정수이고, 현금 · 채권 · 금 · 주식 합과 코어 + 위성 합이 각각 100이어야 합니다.');
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');

  const T = SHEET_LAYOUT.targetRatio;
  const cells = [...T.assets, ...T.coreSatellite];
  const got = await batchGet(config, [...T.headers.map((h) => one(h.tab, h.cell)), ...cells.map((c) => one(T.tab, c))], 'FORMULA');
  T.headers.forEach((h, i) => {
    if (!headerOk(h, first(got[i]))) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  });
  const now = cells.map((_, i) => first(got[T.headers.length + i]));
  const formulaAt = cells.filter((_, i) => typeof now[i] === 'string' && (now[i] as string).trim().startsWith('='));
  if (formulaAt.length > 0) {
    throw refuse('formula-cell', `「${T.tab}」 ${formulaAt.join(' · ')} 칸에 수식이 있어 하나도 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  const textAt = cells.filter((_, i) => now[i] != null && text(now[i]) !== '' && num(now[i]) == null);
  if (textAt.length > 0) throw refuse('not-editable', `「${T.tab}」 ${textAt.join(' · ')} 칸이 숫자가 아니라 쓰지 않았습니다.`);

  const assetForm = ratioForm(now.slice(0, T.assets.length));
  const stockForm = ratioForm(now.slice(T.assets.length));
  const asCell = (v: number, form: 'fraction' | 'percent') => (form === 'fraction' ? Math.round(v * 100) / 10_000 : v);
  await valuesWrite(config, [
    ...T.assets.map((c, i) => ({ range: one(T.tab, c), value: asCell(ratio[RATIO_ASSET_KEYS[i]], assetForm) })),
    ...T.coreSatellite.map((c, i) => ({ range: one(T.tab, c), value: asCell(ratio[RATIO_STOCK_KEYS[i]], stockForm) })),
  ]);
  resetSheetCache();
  const data = await readAssetSheet();
  const same = [...RATIO_ASSET_KEYS, ...RATIO_STOCK_KEYS].every((k) => {
    const v = data.targetRatio[k];
    return v != null && Math.abs(v - ratio[k]) < 1e-6;
  });
  if (!same) throw new AssetSheetError('mismatch', '시트에 쓴 값이 다르게 읽혔습니다(시트를 열어 목표 비율 칸을 확인하세요).');
  return data;
}

/**
 * 계좌 이름 속 날짜 — 「개별 투자 ( 2026.07 )」 의 괄호 안. 연 4자리 + 구분 글자(. - /) + 월 1~2자리 + (같은 구분 글자 + 일 1~2자리).
 * 괄호 안팎 빈칸은 그대로 둔다(칸마다 다를 수 있다 — 2026-11-07 시험용 시트).
 */
export const NAME_DATE = /([(（]\s*)(\d{4})([.\-/])(\d{1,2})(?:\3(\d{1,2}))?(\s*[)）])/;

/**
 * 이름의 날짜 부분만 `day`(YYYY-MM-DD)로 바꾼 새 글자 — 날짜가 없으면 null. 순수 함수(시험이 부른다).
 * 모양은 원래 그대로: 구분 글자 · 일이 있는지 · 월 · 일 자릿수(「07」 이면 두 자리, 「7」 이면 한 자리 그대로).
 */
export function replaceNameDate(name: string, day: string): string | null {
  const r = nameDate(name, day);
  return r && r.name;
}

/** 이름 속 날짜를 `day` 로 바꾼 새 이름과 그 날짜 글자(모양 그대로 — 「2026.11」 · 「2026.11.27」) */
function nameDate(name: string, day: string): { name: string; date: string } | null {
  const m = name.match(NAME_DATE);
  if (!m) return null;
  const [, open, , sep, mm, dd, close] = m;
  const pad = (v: string, like: string) => (like.length >= 2 ? v.padStart(2, '0') : String(Number(v)));
  const [y, mo, d] = day.split('-');
  const date = `${y}${sep}${pad(mo, mm)}${dd != null ? `${sep}${pad(d, dd)}` : ''}`;
  return { name: name.slice(0, m.index) + open + date + close + name.slice((m.index ?? 0) + m[0].length), date };
}

/**
 * [구매 완료] 때 시트에 쓸 날짜 글자(v2.64.1 — 확인 창이 그대로 보인다) — 읽은 시트의 계좌 이름(합친 표 제외) 중 날짜가 든 칸마다
 * `writeAccountDates` 와 같은 함수(`nameDate`)로 만든 글자, 겹치지 않게. 순수 함수(시험이 부른다).
 */
export function accountDateTexts(data: AssetSheetData, day: string): string[] {
  const texts = data.sections.flatMap((s) => {
    const r = !s.combined && s.name ? nameDate(s.name, day) : null;
    return r ? [r.date] : [];
  });
  return [...new Set(texts)];
}

/**
 * 「구매 완료」 — 「주식 투자 정리」 계좌 이름 칸(머리 글자로 찾은 네 줄의 B열) 중 **「( 날짜 )」 가 든 칸 전부**의 날짜를
 * `day`(**구매 차례 날짜** · 한국 날짜 — 모양이 `YYYY.MM` 이면 그 달 · 일이 있으면 그 구매일 · v2.64.1)로 바꾼다. 순서:
 * ① 스위치(`ASSET_SYNC_ENABLED=false` → 「꺼짐」) ② B열을 값으로 읽어 구간을 다시 찾고(이름 칸이 수식이어도 찾게) 네 칸을 **수식 그대로** 다시 읽는다
 * ③ 네 칸 중 하나라도 수식이면 **하나도 쓰지 않고** 409 `formula-cell` · 날짜가 든 칸이 없으면 409 `no-date`
 * ④ 날짜 부분만 같은 모양으로 바꾼 글자를 `valuesWrite` **한 요청**으로(RAW — 글자 그대로)
 * ⑤ 그 칸들을 다시 읽어 보낸 글자와 같은지 확인 — 다르면 `mismatch` ⑥ 30초 캐시를 비운다.
 * 돌려주는 값은 바꾼 칸 수뿐. ⚠️ 계좌 이름 · 날짜를 로그에 찍지 않는다.
 */
export async function writeAccountDates(day: string): Promise<{ cells: number }> {
  if (!isAssetSyncEnabled()) throw refuse('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw refuse('not-editable', '날짜 모양이 올바르지 않습니다.');
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');

  const columnB = wideRange(HOLDINGS_TAB, 'B');
  const [shown] = await batchGet(config, [columnB], 'UNFORMATTED_VALUE');
  const names = findHoldingSections(shown).filter((s) => !s.combined);
  const nameCells = names.map((s) => `B${s.nameRow}`);
  const [raw] = await batchGet(config, [columnB], 'FORMULA');
  const now = names.map((s) => first([raw[s.nameRow - 1] ?? []]));
  const isFormula = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');
  const formulaAt = nameCells.filter((_, i) => isFormula(now[i]));
  if (formulaAt.length > 0) {
    throw refuse('formula-cell', `「${HOLDINGS_TAB}」 ${formulaAt.join(' · ')} 칸에 수식이 있어 하나도 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  const writes = nameCells.flatMap((cell, i) => {
    const next = typeof now[i] === 'string' ? replaceNameDate(now[i] as string, day) : null;
    return next == null ? [] : [{ cell, value: next }];
  });
  if (writes.length === 0) throw new AssetSheetError('no-date', `「${HOLDINGS_TAB}」 계좌 이름 칸(${nameCells.join(' · ')})에 「( 날짜 )」 가 없어 쓰지 않았습니다.`);

  await valuesWrite(config, writes.map((w) => ({ range: one(HOLDINGS_TAB, w.cell), value: w.value })));
  resetSheetCache();
  const back = await batchGet(config, writes.map((w) => one(HOLDINGS_TAB, w.cell)), 'FORMULA');
  const same = writes.every((w, i) => first(back[i]) === w.value);
  if (!same) throw new AssetSheetError('mismatch', '시트에 쓴 계좌 이름이 다르게 읽혔습니다(시트를 열어 「주식 투자 정리」 계좌 이름 칸을 확인하세요).');
  return { cells: writes.length };
}
