/**
 * 시트 가격 [바꾸기] · [되돌리기](v2.65.0 · 자산 관리 2단계) — 「티커」 가격(E) · 환율(C9)을 시트의 GOOGLEFINANCE 에서 토스 숫자로 바꾸고,
 * 원화 표기(F) 수식을 국내 `=E행` / 미국 `=E행*$C$9` 로 바꾼다. 칸 주소 · 모양은 `sheetLayout.ts` `prices` 한 곳.
 *
 * - 스위치: `ASSET_PRICE_WRITE_ENABLED=true` **그리고** `ASSET_SYNC_ENABLED` 가 켜졌을 때만(`isPriceWriteAllowed` — 맥 기본 꺼짐 · 오라클에서만 켬).
 * - [바꾸기](`convertSheetPrices`): 머리 글자 → C9 · 종목 줄 B~F 를 수식 그대로 읽기 → 토스 시세 1번 · 환율 1번 → 바꿀 줄
 *   (E 가 GOOGLEFINANCE 가격 수식 · F 가 E행 / E행 × 환율로 읽힘 · 토스 가격 있음) → **원래 수식을 `asset_sheet_backup` 에 먼저 저장**(실패면 쓰지 않음)
 *   → C9 · 바꿀 줄 E · F 를 **한 요청**(`USER_ENTERED`) → 다시 읽어 확인. 바꾸지 않은 줄은 이유와 함께 목록(화면에만 이름 · 코드).
 *   이미 토스면 GOOGLEFINANCE 로 남은 줄 중 토스 가격이 생긴 줄만 더 바꾼다(「남은 종목도 토스로 바꾸기」).
 * - [되돌리기](`restoreSheetPrices`): 백업의 칸마다 **원래 수식 글자 그대로** 한 요청(`USER_ENTERED`) → 다시 읽어 같으면 백업을 지움 · 다르면 백업을 남기고 오류.
 * - G · H · I열과 그 밖 칸은 쓰지 않는다. 구글에 쓰는 함수는 `google.ts` `valuesWrite` 하나.
 * ⚠️ 로그에는 줄 번호 · 이유 종류만(가격 · 코드 · 이름 · 수식 없음).
 */
import { isPriceWriteAllowed, assetSheetConfig } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows } from './google';
import { headerOk, one, resetSheetCache, splitCode, tickerRowCode } from './sheet';
import { SHEET_LAYOUT, TICKER_TAB } from './sheetLayout';
import { clearSheetBackup, saveSheetBackup, sheetBackup } from './store';
import { isMockPrices, priceRows, priceSkipped, priceSource, priceTools, runOperation, savePriceState, type PriceRow } from './priceState';
import { priceWriterStatus, seedPriceWriter, syncPriceWriter } from './priceWriter';
import type { AssetPriceSheetStatus, AssetPriceSkip, AssetPriceSkipReason } from '../../src/types/asset';

type Cell = string | number | boolean | undefined;
const P = SHEET_LAYOUT.prices;
const T = SHEET_LAYOUT.tickers;

/** 수식 비교용 — 빈칸 · `$` 를 빼고 대문자 */
const norm = (v: Cell) => String(v ?? '').replace(/[\s$]+/g, '').toUpperCase();
const isFormula = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');
const fx = norm(P.fxCell);

/** 바꾼 뒤 F 수식 — 국내 `=E행` / 미국 `=E행*$C$9` */
export const wonFormula = (row: number, market: 'US' | 'KR') => {
  const abs = P.fxCell.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
  return market === 'US' ? `=${P.priceColumn}${row}*${abs}` : `=${P.priceColumn}${row}`;
};

/** 「티커」 한 종목 줄 — B 이름 · C 코드 · E 가격 칸 · F 원화 표기 칸(수식 그대로 읽은 것) */
export interface TickerLine {
  row: number;
  name: string;
  code: string;
  e: Cell;
  f: Cell;
}

/**
 * 한 줄의 처지 — `convert`(바꿀 줄) · `done`(이미 토스 — E 숫자 · F 가 바꾼 뒤 모양) · 그 밖은 바꾸지 않는 이유.
 * 순수 함수(시험이 부른다). 토스 가격은 바꿀 수 있는 모양일 때만 본다(모양이 다르면 그 이유가 먼저).
 */
export function classifyLine(line: TickerLine, hasPrice: boolean): 'convert' | 'done' | Exclude<AssetPriceSkipReason, 'code-changed'> {
  const { market } = splitCode(line.code);
  const target = norm(wonFormula(line.row, market as 'US' | 'KR'));
  if (typeof line.e === 'number' && norm(line.f) === target) return 'done';
  const m = typeof line.e === 'string' ? line.e.trim().match(P.priceFormula) : null;
  if (!m) return 'price-shape';
  const arg = norm(m[1]);
  // 첫 인자 = 그 줄의 코드 칸(C행) 또는 그 코드 글자
  if (arg !== `${P.codeColumn}${line.row}` && arg !== `"${line.code.toUpperCase()}"`) return 'price-shape';
  const e = `${P.priceColumn}${line.row}`;
  const gf = `GOOGLEFINANCE(${arg},"PRICE")`;
  const ok = market === 'US' ? [`=${e}*${fx}`, `=${fx}*${e}`, `=${gf}*${fx}`, `=${fx}*${gf}`] : [`=${e}`, `=${gf}`];
  if (!ok.includes(norm(line.f))) return 'won-shape';
  return hasPrice ? 'convert' : 'no-toss-price';
}

/** 읽은 「티커」 B~F(14~42) → 종목 줄(구분 줄 · 빈 줄 제외) */
export function tickerLines(rows: CellRows): TickerLine[] {
  const out: TickerLine[] = [];
  rows.forEach((r, k) => {
    const code = tickerRowCode(r);
    if (code) out.push({ row: T.firstRow + k, name: String(r[0] ?? '').trim(), code, e: r[3], f: r[4] });
  });
  return out;
}

const symbolOf = (code: string) => splitCode(code).symbol ?? code;
const marketOf = (code: string) => splitCode(code).market as 'US' | 'KR';
const tickerHeaders = () => SHEET_LAYOUT.headers.filter((h) => h.tab === TICKER_TAB);
const linesRange = () => `'${TICKER_TAB}'!B${T.firstRow}:${P.wonColumn}${T.lastRow}`;

function guard(): NonNullable<ReturnType<typeof assetSheetConfig>> {
  if (!isPriceWriteAllowed()) throw new AssetSheetError('disabled', '이 서버에서는 시트 가격 쓰기가 꺼져 있습니다(오라클에서만 켬).');
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  if (isMockPrices()) throw new AssetSheetError('disabled', '토스 키가 없어(모의 데이터 모드) 시트 가격을 쓰지 않습니다.');
  return config;
}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const r = await runOperation(fn);
  if (!r.ok) throw new AssetSheetError('busy', '시트 가격 바꾸기 · 되돌리기가 이미 도는 중입니다.');
  return r.value;
}

/** 머리 글자(「티커」 B12 · D12) 확인 — 다르면 「모양 바뀜」 */
function checkHeaders(got: CellRows[]): void {
  tickerHeaders().forEach((h, i) => {
    if (!headerOk(h, got[i]?.[0]?.[0])) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  });
}

/** [시트 가격을 토스로 바꾸기] · [남은 종목도 토스로 바꾸기] */
export async function convertSheetPrices(): Promise<AssetPriceSheetStatus> {
  const config = guard();
  return exclusive(async () => {
    const heads = tickerHeaders();
    const got = await batchGet(config, [...heads.map((h) => one(h.tab, h.cell)), one(TICKER_TAB, P.fxCell), linesRange()], 'FORMULA');
    checkHeaders(got);
    const source = priceSource();
    const c9 = got[heads.length]?.[0]?.[0];
    const c9Google = typeof c9 === 'string' && P.fxFormula.test(c9.trim());
    if (!c9Google && !(source === 'toss' && typeof c9 === 'number')) {
      throw new AssetSheetError('shape', `「${TICKER_TAB}」 ${P.fxCell} 이 GOOGLEFINANCE 환율 수식이 아니라 바꾸지 않았습니다.`);
    }
    const lines = tickerLines(got[heads.length + 1] ?? []);
    const before = new Map(priceRows().map((r) => [r.row, r]));

    // 토스 시세 1번(이미 토스인 줄은 빼고) · 환율 1번
    const ask = [...new Set(lines.filter((l) => !(typeof l.e === 'number' && before.has(l.row))).map((l) => symbolOf(l.code)))];
    const tools = priceTools();
    const prices = ask.length ? await tools.quotes(ask) : new Map<string, number>();
    const rate = await tools.rate();
    if (rate == null) throw new AssetSheetError('network', '토스 환율을 받지 못해 바꾸지 않았습니다(잠시 뒤 다시 누르세요).');

    const convert: TickerLine[] = [];
    const rows: PriceRow[] = [];
    const skipped: AssetPriceSkip[] = [];
    for (const l of lines) {
      const kind = classifyLine(l, prices.has(symbolOf(l.code)));
      const market = marketOf(l.code);
      if (kind === 'convert') convert.push(l);
      else if (kind === 'done') {
        const was = before.get(l.row);
        if (was && was.code !== l.code) {
          rows.push(was); // 바꾼 그 줄 그대로 두고 쓰지 않는다(10초 쓰기가 코드를 다시 본다)
          skipped.push({ row: l.row, name: l.name, code: l.code, reason: 'code-changed' });
        } else rows.push({ row: l.row, code: l.code, market });
      } else skipped.push({ row: l.row, name: l.name, code: l.code, reason: kind });
    }
    if (convert.length === 0) throw new AssetSheetError('no-rows', '토스로 바꿀 줄이 없습니다(이미 토스 · 토스 가격 없음 · 칸 모양이 다름).');

    // ① 원래 수식을 먼저 저장 — 실패면 쓰지 않는다
    const backup = [
      ...(c9Google ? [{ cell: P.fxCell, formula: String(c9) }] : []),
      ...convert.flatMap((l) => [
        { cell: `${P.priceColumn}${l.row}`, formula: String(l.e) },
        { cell: `${P.wonColumn}${l.row}`, formula: String(l.f) },
      ]),
    ];
    try {
      saveSheetBackup(backup, new Date().toISOString());
    } catch {
      throw new AssetSheetError('no-backup', '원래 수식을 앱 DB 에 저장하지 못해 시트에 쓰지 않았습니다.');
    }
    const kept = new Set(sheetBackup().map((b) => b.cell));
    if (!backup.every((b) => kept.has(b.cell))) throw new AssetSheetError('no-backup', '원래 수식을 앱 DB 에 저장하지 못해 시트에 쓰지 않았습니다.');

    // ② 한 요청(USER_ENTERED — F 는 수식)
    const writes: { cell: string; value: string | number }[] = [
      { cell: P.fxCell, value: rate },
      ...convert.flatMap((l) => [
        { cell: `${P.priceColumn}${l.row}`, value: prices.get(symbolOf(l.code))! },
        { cell: `${P.wonColumn}${l.row}`, value: wonFormula(l.row, marketOf(l.code)) },
      ]),
    ];
    await valuesWrite(config, writes.map((w) => ({ range: one(TICKER_TAB, w.cell), value: w.value })), 'USER_ENTERED');
    for (const l of convert) rows.push({ row: l.row, code: l.code, market: marketOf(l.code) });
    savePriceState({ source: 'toss', rows, skipped });
    seedPriceWriter(new Map(writes.filter((w) => typeof w.value === 'number').map((w) => [w.cell, w.value as number])));
    resetSheetCache();
    syncPriceWriter();
    console.log(`[asset] 시트 가격 토스로 바꿈 · ${convert.length}줄 · 그대로 ${skipped.length}줄`);

    // ③ 다시 읽어 확인
    const back = await batchGet(config, writes.map((w) => one(TICKER_TAB, w.cell)), 'FORMULA');
    const same = writes.every((w, i) => {
      const v = back[i]?.[0]?.[0];
      return typeof w.value === 'number' ? typeof v === 'number' && Math.abs(v - w.value) < 1e-9 * Math.max(1, Math.abs(w.value)) : norm(v) === norm(w.value);
    });
    if (!same) throw new AssetSheetError('mismatch', '시트에 쓴 가격 · 수식이 다르게 읽혔습니다(시트 「티커」 를 확인하세요 — [되돌리기] 로 원래 수식을 넣을 수 있습니다).');
    return priceSheetStatus();
  });
}

/** [되돌리기] — 저장해 둔 원래 GOOGLEFINANCE 수식을 다시 넣는다 */
export async function restoreSheetPrices(): Promise<AssetPriceSheetStatus> {
  const config = guard();
  return exclusive(async () => {
    const backup = sheetBackup();
    if (backup.length === 0) throw new AssetSheetError('no-backup', '되돌릴 원래 수식이 앱 DB 에 없습니다.');
    const heads = tickerHeaders();
    checkHeaders(await batchGet(config, heads.map((h) => one(h.tab, h.cell)), 'FORMULA'));
    await valuesWrite(config, backup.map((b) => ({ range: one(TICKER_TAB, b.cell), value: b.formula })), 'USER_ENTERED');
    // 쓴 뒤에는 10초 쓰기를 멈춘다(되돌린 칸에 숫자를 다시 쓰지 않게) — 확인이 틀려도 백업은 남아 다시 [되돌리기] 할 수 있다
    savePriceState({ source: 'google', rows: [], skipped: [] });
    syncPriceWriter();
    resetSheetCache();
    const back = await batchGet(config, backup.map((b) => one(TICKER_TAB, b.cell)), 'FORMULA');
    const same = backup.every((b, i) => {
      const v = back[i]?.[0]?.[0];
      return v === b.formula || (isFormula(v) && norm(v) === norm(b.formula));
    });
    if (!same) throw new AssetSheetError('mismatch', '되돌린 수식이 다르게 읽혔습니다 — 원래 수식은 앱에 남겨 두었습니다(시트 「티커」 를 확인하고 [되돌리기] 를 다시 누르세요).');
    clearSheetBackup();
    console.log(`[asset] 시트 가격 되돌림 · ${backup.length}칸`);
    return priceSheetStatus();
  });
}

/** 설정 창 「시트 가격」 상태 — summary 응답에 더한다 */
export function priceSheetStatus(): AssetPriceSheetStatus {
  const enabled = isPriceWriteAllowed();
  const source = priceSource();
  const w = priceWriterStatus();
  const rows = priceRows();
  const stored = priceSkipped();
  // 10초 쓰기가 찾은 「줄 코드가 바뀜」 — 저장된 목록에 없으면 더한다(이름은 모름 — 화면은 줄 번호 · 코드)
  const changed = rows.filter((r) => w.codeChanged.includes(r.row) && !stored.some((s) => s.row === r.row && s.reason === 'code-changed'));
  const skipped = [...stored, ...changed.map((r) => ({ row: r.row, name: '', code: r.code, reason: 'code-changed' as const }))].sort((a, b) => a.row - b.row);
  return {
    enabled,
    source,
    lastWrittenAt: w.lastWrittenAt,
    state: !enabled ? 'off' : source === 'google' ? 'idle' : w.open ? 'writing' : 'closed',
    rows: rows.length,
    remaining: source === 'toss' ? w.remaining : 0,
    hasBackup: sheetBackup().length > 0,
    skipped,
  };
}
