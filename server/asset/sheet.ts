/**
 * 자산 시트 읽기 · 자산 분류 쓰기 · 목표 비율 쓰기 · 계좌 이름 날짜 쓰기(v2.61.0 · v2.62.0 · v2.63.0 · v2.64.0) — 칸 목록은 `sheetLayout.ts` 한 곳, 구글 호출은 `google.ts`.
 *
 * - 화면을 열 때 · 「다시 읽기」 · 총 자산 계산(화면이 열린 동안 · 하루 기록 1번)에 읽는다. 같은 결과는 30초 캐시(동시에 온 요청은 한 번만 읽는다).
 * - 쓰기는 세 곳 — `writeAssetClass`(「티커」 D14~D42 종목 줄의 자산 분류 한 칸) · `writeTargetRatio`(목표 비율 여섯 칸) ·
 *   `writeAccountDates`(「구매 완료」 — 「주식 투자 정리」 계좌 이름 칸의 「( 날짜 )」).
 *   셋 다 쓰기 직전에 수식 그대로 다시 읽어 머리 글자 · 수식 칸을 확인한다(구글에 쓰는 함수는 `google.ts` `valuesWrite` 하나).
 * - 한 번 읽기 = `values:batchGet` 두 번: ① 값(UNFORMATTED_VALUE) — 머리 글자 · 종목 · 보유 · 값 칸 ② 수식(FORMULA) — 보유 줄의 C(평균 매입가) · F(이을 줄).
 * - 머리 글자가 하나라도 다르면 값을 쓰지 않고 「시트 모양이 바뀌었어요(탭 · 칸)」.
 * ⚠️ 읽은 값은 로그에 찍지 않는다(실패 이유 종류만).
 */
import { isAssetClass, type AssetClass, type AssetHolding, type AssetSection, type AssetSheetData, type AssetTargetRatio } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows } from './google';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HeaderCheck, type HoldingSection } from './sheetLayout';

const CACHE_MS = 30_000;

type Cell = string | number | boolean | undefined;

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
export const one = (tab: string, cell: string) => `${q(tab)}!${cell}`;
const holdingRange = (s: HoldingSection) => `${q(HOLDINGS_TAB)}!B${s.firstRow}:F${s.lastRow}`;
/** 「티커」 이름(B) · 코드(C) · 자산 분류(D) */
const tickerRange = () => `${q(TICKER_TAB)}!B${SHEET_LAYOUT.tickers.firstRow}:${SHEET_LAYOUT.assetClass.column}${SHEET_LAYOUT.tickers.lastRow}`;

/** 공백을 모두 뺀 글자 — 띄어쓰기만 다른 것은 같은 모양 */
const squash = (v: Cell) => String(v ?? '').replace(/\s+/g, '');

/** 읽을 범위 — 값 읽기 / 수식 읽기. 순서가 곧 `parseAssetSheet` 가 받는 배열 순서다 */
export function sheetRanges(): { values: string[]; formulas: string[] } {
  const L = SHEET_LAYOUT;
  const ratio = L.targetRatio;
  return {
    values: [
      ...L.headers.map((h) => one(h.tab, h.cell)),
      tickerRange(),
      ...L.sections.map(holdingRange),
      one(L.cells.cashTotal.tab, L.cells.cashTotal.cell),
      one(L.cells.retirement.tab, L.cells.retirement.cell),
      one(L.cells.salary.tab, L.cells.salary.cell),
      one(L.cells.avgFxRate.tab, L.cells.avgFxRate.cell),
      ...ratio.assets.map((c) => one(ratio.tab, c)),
      ...ratio.coreSatellite.map((c) => one(ratio.tab, c)),
    ],
    formulas: L.sections.map(holdingRange),
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
    const got = squash(first(next()));
    const want = squash(h.expect);
    const ok = h.prefix ? got.startsWith(want) : got === want;
    if (!ok) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  }
  /** 구간 이름 — 머리 글자로 확인한 그 칸의 글자 그대로 */
  const headerText = (cell: string) => {
    const idx = L.headers.findIndex((h) => h.tab === HOLDINGS_TAB && h.cell === cell);
    return idx >= 0 ? text(first(values[idx])) : '';
  };

  // 「티커」 줄 번호 → 코드 · 자산 분류(D)
  const tickerRows = next();
  const codeByRow = new Map<number, { code: string; cls: string }>();
  tickerRows.forEach((r, k) => {
    const code = tickerRowCode(r);
    if (code) codeByRow.set(L.tickers.firstRow + k, { code, cls: text(r?.[2]) });
  });

  const sections: AssetSection[] = L.sections.map((s: HoldingSection, si) => {
    const rows = next();
    const fRows = formulas[si] ?? [];
    const holdings: AssetHolding[] = [];
    for (let k = 0; k <= s.lastRow - s.firstRow; k++) {
      const r = rows[k] ?? [];
      const f = fRows[k] ?? [];
      const name = text(r[0]);
      if (!name) continue;
      const linked = linkedTickerRow(f[4]);
      const ticker = linked != null ? (codeByRow.get(linked) ?? null) : null;
      const code = ticker?.code ?? null;
      const cls = ticker?.cls ?? '';
      holdings.push({
        row: s.firstRow + k,
        name,
        code,
        ...(code ? splitCode(code) : { market: null, exchange: null, symbol: null }),
        quantity: num(r[2]),
        ...avgPriceOf(f[1], r[1]),
        tickerRow: ticker ? linked : null,
        assetClass: isAssetClass(cls) ? cls : null, // 빈칸 · 네 글자가 아닌 글자 → 「미지정」(null)
      });
    }
    const name = (s.nameCell ? headerText(s.nameCell) : '') || s.label || '';
    return { key: s.key ?? null, name, combined: s.combined === true, holdings };
  });

  const cashTotal = num(first(next()));
  const retirement = num(first(next()));
  const salary = num(first(next()));
  const avgFxRate = num(first(next()));
  const [cash, gold, bond, invest] = asPercent(L.targetRatio.assets.map(() => num(first(next()))));
  const [core, satellite] = asPercent(L.targetRatio.coreSatellite.map(() => num(first(next()))));
  const targetRatio: AssetTargetRatio = { cash, gold, bond, invest, core, satellite };

  return { readAt, sections, cashTotal, retirement, targetRatio, salary, avgFxRate };
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

/**
 * 자산 분류 한 칸 쓰기 — **이 앱에서 시트에 쓰는 유일한 곳**(v2.62.0). 순서:
 * ① 스위치(`ASSET_SYNC_ENABLED=false` → 「꺼짐」) ② 줄 번호 · 값 확인(「티커」 D14~D42 · 네 글자 또는 빈칸)
 * ③ 쓰기 직전에 그 줄과 머리 D12 를 **수식 그대로** 다시 읽는다 — 머리가 다르면 「모양 바뀜」, 종목 줄이 아니면(구분 줄 · 빈 줄) 거절,
 *    그 칸이 `=` 로 시작하면 쓰지 않고 멈춤(수식을 덮어쓰지 않는다)
 * ④ `values.update` 한 칸(RAW) ⑤ 30초 캐시를 비우고 다시 읽은 값을 돌려준다.
 * ⚠️ 쓴 값 · 읽은 값을 로그에 찍지 않는다.
 */
export async function writeAssetClass(row: unknown, value: unknown): Promise<AssetSheetData> {
  if (!isAssetSyncEnabled()) throw refuse('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const L = SHEET_LAYOUT;
  const { firstRow, lastRow } = L.tickers;
  if (typeof row !== 'number' || !Number.isInteger(row) || row < firstRow || row > lastRow) {
    throw refuse('not-editable', `자산 분류는 「${TICKER_TAB}」 탭 ${L.assetClass.column}${firstRow}~${L.assetClass.column}${lastRow} 의 종목 줄에만 쓸 수 있습니다.`);
  }
  if (value !== '' && !isAssetClass(value)) throw refuse('not-editable', `자산 분류는 ${L.assetClass.values.join(' · ')} 중 하나이거나 빈칸이어야 합니다.`);
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');

  const header = L.headers.find((h) => h.tab === TICKER_TAB && h.cell === `${L.assetClass.column}12`)!;
  const [headRows, lineRows] = await batchGet(config, [one(TICKER_TAB, header.cell), `${q(TICKER_TAB)}!B${row}:${L.assetClass.column}${row}`], 'FORMULA');
  if (!headerOk(header, first(headRows))) {
    throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${header.tab}」 탭 ${header.cell} — 「${header.expect}」 이어야 합니다).`);
  }
  const line = lineRows[0];
  if (!tickerRowCode(line)) throw refuse('not-editable', `「${TICKER_TAB}」 ${row}행은 종목 줄이 아닙니다(구분 줄 · 빈 줄에는 쓰지 않습니다).`);
  if (typeof line?.[2] === 'string' && line[2].trim().startsWith('=')) {
    throw refuse('formula-cell', `「${TICKER_TAB}」 ${L.assetClass.column}${row} 칸에 수식이 있어 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  await valuesWrite(config, [{ range: one(L.assetClass.tab, `${L.assetClass.column}${row}`), value: value as AssetClass | '' }]);
  resetSheetCache();
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
 * [구매 완료] 때 시트에 쓸 날짜 글자(v2.64.1 — 확인 창이 그대로 보인다) — 읽은 시트의 계좌 이름 칸(`nameCell`) 중 날짜가 든 칸마다
 * `writeAccountDates` 와 같은 함수(`nameDate`)로 만든 글자, 겹치지 않게. 순수 함수(시험이 부른다).
 */
export function accountDateTexts(data: AssetSheetData, day: string): string[] {
  const texts = SHEET_LAYOUT.sections.flatMap((s: HoldingSection, i) => {
    const name = s.nameCell ? data.sections[i]?.name : undefined;
    const r = name ? nameDate(name, day) : null;
    return r ? [r.date] : [];
  });
  return [...new Set(texts)];
}

/**
 * 「구매 완료」 — 「주식 투자 정리」 계좌 이름 칸(B4 · B12 · B21 · B29 — `sections` 의 `nameCell`) 중 **「( 날짜 )」 가 든 칸 전부**의 날짜를
 * `day`(**구매 차례 날짜** · 한국 날짜 — 모양이 `YYYY.MM` 이면 그 달 · 일이 있으면 그 구매일 · v2.64.1)로 바꾼다. 순서:
 * ① 스위치(`ASSET_SYNC_ENABLED=false` → 「꺼짐」) ② 머리 글자(B3 · 네 이름 칸의 앞부분 — `writeAssetClass` 와 같은 확인)와 네 칸을 **수식 그대로** 다시 읽는다
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

  const L = SHEET_LAYOUT;
  const nameCells = L.sections.flatMap((s: HoldingSection) => (s.nameCell ? [s.nameCell] : []));
  const headers = L.headers.filter((h) => h.tab === HOLDINGS_TAB && (h.cell === 'B3' || nameCells.includes(h.cell)));
  const got = await batchGet(config, [...headers.map((h) => one(h.tab, h.cell)), ...nameCells.map((c) => one(HOLDINGS_TAB, c))], 'FORMULA');
  const now = nameCells.map((_, i) => first(got[headers.length + i]));
  const isFormula = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');
  // 수식 칸을 먼저 본다 — 수식 그대로 읽으면 이름 칸 머리(앞부분) 확인이 수식 글자로 틀려 「모양 바뀜」 으로 보이기 때문
  const formulaAt = nameCells.filter((_, i) => isFormula(now[i]));
  if (formulaAt.length > 0) {
    throw refuse('formula-cell', `「${HOLDINGS_TAB}」 ${formulaAt.join(' · ')} 칸에 수식이 있어 하나도 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  headers.forEach((h, i) => {
    if (!headerOk(h, first(got[i]))) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  });
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
