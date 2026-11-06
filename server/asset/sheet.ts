/**
 * 자산 시트 읽기 · 자산 분류 쓰기(v2.61.0 · v2.62.0) — 칸 목록은 `sheetLayout.ts` 한 곳, 구글 호출은 `google.ts`.
 *
 * - 화면을 열 때 · 「다시 읽기」 · 총 자산 계산(화면이 열린 동안 · 하루 기록 1번)에 읽는다. 같은 결과는 30초 캐시(동시에 온 요청은 한 번만 읽는다).
 * - 쓰기는 `writeAssetClass` 한 곳 — 「티커」 D14~D42 종목 줄의 자산 분류 한 칸만(쓰기 직전에 다시 읽어 수식 칸이면 멈춘다).
 * - 한 번 읽기 = `values:batchGet` 두 번: ① 값(UNFORMATTED_VALUE) — 머리 글자 · 종목 · 보유 · 값 칸 ② 수식(FORMULA) — 보유 줄의 C(평균 매입가) · F(이을 줄).
 * - 머리 글자가 하나라도 다르면 값을 쓰지 않고 「시트 모양이 바뀌었어요(탭 · 칸)」.
 * ⚠️ 읽은 값은 로그에 찍지 않는다(실패 이유 종류만).
 */
import { isAssetClass, type AssetClass, type AssetHolding, type AssetSection, type AssetSheetData, type AssetTargetRatio } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled } from './config';
import { AssetSheetError, batchGet, valuesUpdate, type CellRows } from './google';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HoldingSection } from './sheetLayout';

const CACHE_MS = 30_000;

type Cell = string | number | boolean | undefined;

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const one = (tab: string, cell: string) => `${q(tab)}!${cell}`;
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
function tickerRowCode(r: Cell[] | undefined): string | null {
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
        assetClass: isAssetClass(cls) ? cls : null,
        assetClassUnknown: cls && !isAssetClass(cls) ? cls : null,
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
  if (squash(first(headRows)) !== squash(header.expect)) {
    throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${header.tab}」 탭 ${header.cell} — 「${header.expect}」 이어야 합니다).`);
  }
  const line = lineRows[0];
  if (!tickerRowCode(line)) throw refuse('not-editable', `「${TICKER_TAB}」 ${row}행은 종목 줄이 아닙니다(구분 줄 · 빈 줄에는 쓰지 않습니다).`);
  if (typeof line?.[2] === 'string' && line[2].trim().startsWith('=')) {
    throw refuse('formula-cell', `「${TICKER_TAB}」 ${L.assetClass.column}${row} 칸에 수식이 있어 쓰지 않았습니다(수식을 덮어쓰지 않습니다).`);
  }
  await valuesUpdate(config, one(L.assetClass.tab, `${L.assetClass.column}${row}`), value as AssetClass | '');
  resetSheetCache();
  return readAssetSheet();
}
