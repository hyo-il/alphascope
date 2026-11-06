/**
 * 자산 시트 읽기(v2.61.0) — 칸 목록은 `sheetLayout.ts` 한 곳, 구글 호출은 `google.ts`.
 *
 * - 화면을 열 때(그리고 「다시 읽기」)만 읽는다 — 예약 작업 · 반복 읽기 없음. 같은 결과는 30초 캐시(동시에 온 요청은 한 번만 읽는다).
 * - 한 번 읽기 = `values:batchGet` 두 번: ① 값(UNFORMATTED_VALUE) — 머리 글자 · 종목 · 보유 · 값 칸 ② 수식(FORMULA) — 보유 줄의 C(평균 매입가) · F(이을 줄).
 * - 머리 글자가 하나라도 다르면 값을 쓰지 않고 「시트 모양이 바뀌었어요(탭 · 칸)」.
 * ⚠️ 읽은 값은 로그에 찍지 않는다(실패 이유 종류만).
 */
import type { AssetHolding, AssetSection, AssetSheetData, AssetTargetRatio } from '../../src/types/asset';
import { assetSheetConfig } from './config';
import { AssetSheetError, batchGet, type CellRows } from './google';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HoldingSection } from './sheetLayout';

const CACHE_MS = 30_000;

type Cell = string | number | boolean | undefined;

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
const one = (tab: string, cell: string) => `${q(tab)}!${cell}`;
const holdingRange = (s: HoldingSection) => `${q(HOLDINGS_TAB)}!B${s.firstRow}:F${s.lastRow}`;
const tickerRange = () => `${q(TICKER_TAB)}!B${SHEET_LAYOUT.tickers.firstRow}:C${SHEET_LAYOUT.tickers.lastRow}`;

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

/** 「티커」 코드 → 시장 · 거래소 · 종목. `:` 가 있으면 미국(`NASDAQ:NVDA`), 없으면 국내(코드 그대로 — `0072R0` 처럼 영문이 섞여도) */
export function splitCode(code: string): Pick<AssetHolding, 'market' | 'exchange' | 'symbol'> {
  const c = code.trim();
  const at = c.indexOf(':');
  if (at >= 0) return { market: 'US', exchange: c.slice(0, at).trim() || null, symbol: c.slice(at + 1).trim() || null };
  return { market: 'KR', exchange: null, symbol: c };
}

/** C열 — `=(달러값)*('티커'!$F$9)` 이면 달러 원래 값 · USD, 그 밖에는 원화(수식이면 계산된 값) */
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

  // 「티커」 줄 번호 → 코드
  const tickerRows = next();
  const skip = new Set(L.tickers.skipNames.map(squash));
  const codeByRow = new Map<number, string>();
  tickerRows.forEach((r, k) => {
    const name = text(r?.[0]);
    const code = text(r?.[1]);
    if (!name || !code || skip.has(squash(name))) return;
    codeByRow.set(L.tickers.firstRow + k, code);
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
      const tickerRow = linkedTickerRow(f[4]);
      const code = tickerRow != null ? (codeByRow.get(tickerRow) ?? null) : null;
      holdings.push({
        row: s.firstRow + k,
        name,
        code,
        ...(code ? splitCode(code) : { market: null, exchange: null, symbol: null }),
        quantity: num(r[2]),
        ...avgPriceOf(f[1], r[1]),
      });
    }
    const name = (s.nameCell ? headerText(s.nameCell) : '') || s.label || '';
    return { name, combined: s.combined === true, holdings };
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
