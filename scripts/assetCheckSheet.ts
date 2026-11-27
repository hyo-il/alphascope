/**
 * 자산 시트 점검(v2.65.1 · 114차 B) — `npm run -s asset:check-sheet -- --sheet <시트 ID>` · **읽기만**(구글 `values:batchGet` 값 1번 · 수식 1번).
 * 원본 시트로 바꾸기 전에(오라클에서) 「이 시트를 앱에 연결해도 되나」 를 칸마다 「맞음 / 다름」 으로 보인다.
 *
 * - 시트: `--sheet <ID>`(또는 `--sheet=<ID>`) · 없으면 `.env` 의 `ASSET_SHEET_ID`. 열쇠: `.env` 의 `GOOGLE_SA_KEY_FILE`.
 * - 보는 칸은 모두 `server/asset/sheetLayout.ts` 한 곳에서 가져온다(새 목록을 손으로 적지 않는다):
 *   1 열 수 있는가(안 되면 서비스 계정 이메일에 편집자로 공유) · 2 탭 이름 · 머리 글자(`headers` · 목표 비율 머리) · 「현금」 탭 머리 · 총액 줄(`findCashShape` — 은행 계좌 · 퇴직 연금 줄 수 · 총액 줄 위치 · v2.70.4) ·
 *   3 「티커」 종목 줄 수 · 국내/미국 · D열 자산 분류 값 · 4 시트 가격 칸 모양(113차 A-0 와 같은 검사 — `classifyLine`) ·
 *   5 목표 비율 여섯 칸 · 계좌 이름 「( 날짜 )」 모양 · 값 칸(은행 자산 총액 · 퇴직 연금 총액 · 월급 · 구매 평균 환율) · 6 「주식 투자 정리」 보유 줄이 「티커」 와 이어지는가 ·
 *   7 머리 글자로 찾은 보유 구간 · 「티커」 묶음마다 종목 줄 수 · 빈 줄 수 · 빈 줄 칸 모양(새 종목 입력 준비 — v2.66.0) · 구매 평균 환율 칸 모양. 7번은 알림뿐(연결 판단에 넣지 않는다).
 *   8 「적립식 투자」 탭 모양(v2.78.0 · 다음 차수 계좌 · 종목별 구매 목록 준비 — `runSavingTabCheck` · 탭 목록 1번 + 값 1번 + 수식 1번) — 「분할 개월 수」 묶음마다
 *   칸 주소 · 줄 수 · 맞음 / 아님만. 알림뿐(연결 판단에 넣지 않는다). ⚠️ 금액 · 비율 값 · 이름 글자 · 개월 수 값은 출력하지 않는다.
 * - 마지막 줄 「✅ 연결해도 됩니다」(종료 0) 또는 「❌ 연결하지 마세요 — 위 n곳을 먼저 고쳐 주세요」(종료 1). ⚠️ 는 알림(연결은 됨).
 * ⚠️ 금액 · 수량 · 종목 이름 · 코드 · 시트 ID 전체 · 열쇠 값(이메일 말고)을 출력하지 않는다 — 시트는 ID 앞 4글자 + 「…」 · 날짜는 숫자를 # 로.
 * ⚠️ 쓰기 함수(`valuesWrite` · `write…` · 바꾸기 · 되돌리기)를 import 하지 않는다(`assetsheet:test` 가 소스로 확인). DB 도 열지 않는다.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetSheetError, batchGet, sheetTabs, type CellRows } from '../server/asset/google';
import { NAME_DATE, headerOk, linkedTickerRow, one, splitCode, tickerRowCode, wideRange } from '../server/asset/sheet';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HeaderCheck } from '../server/asset/sheetLayout';
import { findCashShape, findSheetShape, tickerRowsOf, type CashShape, type SheetShape } from '../server/asset/sheetShape';
import { classifyLine, tickerLines } from '../server/asset/priceSheet';
import { ASSET_CLASSES, LEGACY_CASH_CLASS } from '../src/types/asset';
import type { AssetSheetConfig } from '../server/asset/config';

type Cell = string | number | boolean | undefined;
const L = SHEET_LAYOUT;
const P = L.prices;
const R = L.targetRatio;

const first = (rows: CellRows | undefined): Cell => rows?.[0]?.[0];
const isFormula = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');
const isNum = (v: Cell) => typeof v === 'number' && Number.isFinite(v);
const blank = (v: Cell) => v == null || String(v).trim() === '';
/** 시트 ID → 앞 4글자 + … */
export const sheetHint = (id: string) => `${id.slice(0, 4)}…`;
/** 날짜 글자의 숫자를 # 로 */
const maskDigits = (s: string) => s.replace(/\d/g, '#');
/** 수식 모양 — 따옴표 안 글자와 숫자를 가린다 */
const maskFormula = (s: string) => s.replace(/"[^"]*"/g, '"…"').replace(/\d+(\.\d+)?/g, '#');
/** 칸 줄 범위의 열 글자(B 부터) */
const colLetter = (i: number) => String.fromCharCode(66 + i);
/** 빈 줄의 칸 모양(값 없이) — 아무것도 없으면 「완전히 빈 줄」 */
export function blankRowShape(row: Cell[] | undefined): string {
  const parts = (row ?? []).flatMap((v, i) => {
    if (blank(v)) return [];
    return [`${colLetter(i)} ${isFormula(v) ? `수식(${maskFormula(String(v).trim())})` : isNum(v) ? '숫자' : '글자'}`];
  });
  return parts.length ? parts.join(' · ') : '완전히 빈 줄';
}

/** 서비스 계정 이메일만(열쇠의 다른 값은 읽어도 쓰지 않는다) — 없으면 null */
function clientEmail(keyFile: string): string | null {
  try {
    const v = (JSON.parse(fs.readFileSync(keyFile, 'utf8')) as { client_email?: unknown }).client_email;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** 값 읽기 · 수식 읽기 범위 — 순서가 곧 아래에서 꺼내는 순서 */
function ranges() {
  const ticker = wideRange(TICKER_TAB, L.shapeLastColumn);
  const holding = wideRange(HOLDINGS_TAB, L.shapeLastColumn);
  const ratioCells = [...R.assets, ...R.coreSatellite];
  const cells = Object.values(L.cells);
  return {
    headers: [...L.headers, ...R.headers] as HeaderCheck[],
    ratioCells,
    cells,
    values: [
      ...L.headers.map((h) => one(h.tab, h.cell)),
      ...R.headers.map((h) => one(h.tab, h.cell)),
      ticker,
      holding,
      wideRange(L.cash.tab, L.cash.lastColumn),
      ...cells.map((c) => one(c.tab, c.cell)),
      ...ratioCells.map((c) => one(R.tab, c)),
    ],
    formulas: [one(TICKER_TAB, P.fxCell), ticker, ...ratioCells.map((c) => one(R.tab, c)), holding, one(L.cells.avgFxRate.tab, L.cells.avgFxRate.cell)],
  };
}

export interface CheckResult {
  ok: boolean;
  /** ❌ 곳 수 */
  problems: number;
  /** 구글 읽기 요청 수(값 · 수식) */
  reads: number;
}

/**
 * 점검 한 번 — `say` 로 한 줄씩 내보낸다(시험이 잡는다). 구글 읽기는 값 1번 · 수식 1번 이하.
 */
export async function runSheetCheck(config: AssetSheetConfig, say: (line: string) => void): Promise<CheckResult> {
  let problems = 0;
  let reads = 0;
  const bad = (line: string) => {
    problems++;
    say(`   ❌ ${line}`);
  };
  const warn = (line: string) => say(`   ⚠️ ${line}`);
  const email = clientEmail(config.keyFile);
  say(`자산 시트 점검 — 시트 ${sheetHint(config.sheetId)} (읽기만 · 쓰기 0)`);

  // 1. 열기 — 값 읽기 1번
  const r = ranges();
  let values: CellRows[];
  try {
    reads++;
    values = await batchGet(config, r.values, 'UNFORMATTED_VALUE');
  } catch (e) {
    const err = e instanceof AssetSheetError ? e : null;
    say(`1. 열기 — 다름`);
    if (err?.kind === 'not-shared') bad(`시트를 열 수 없습니다 — 서비스 계정(${email ?? '열쇠 파일의 client_email'})에 이 시트를 편집자로 공유해 주세요`);
    else if (err?.kind === 'shape') bad(`탭 이름이 시트에 없습니다${err.tab ? ` — 「${err.tab}」 탭` : ''}(앱이 찾는 탭: ${[...new Set(r.headers.map((h) => h.tab))].map((t) => `「${t}」`).join(' · ')})`);
    else if (err) bad(err.message);
    else bad('시트를 읽지 못했습니다(알 수 없는 오류)');
    say(`❌ 연결하지 마세요 — 위 ${problems}곳을 먼저 고쳐 주세요`);
    return { ok: false, problems, reads };
  }
  say(`1. 열기 — 맞음 (서비스 계정 ${email ?? '—'})`);

  // 2. 탭 이름 · 머리 글자
  let i = 0;
  const nextV = () => values[i++] ?? [];
  const headerVals = r.headers.map(() => first(nextV()));
  const wrongHeads = r.headers.filter((h, k) => !headerOk(h, headerVals[k]));
  say(`2. 탭 · 머리 글자 — ${wrongHeads.length ? '다름' : `맞음 (${r.headers.length}칸)`}`);
  for (const h of wrongHeads) bad(`「${h.tab}」 ${h.cell} — 「${h.expect}」${h.prefix ? ' 로 시작해야' : ' 이어야'} 합니다`);

  // 구간 찾기 — 머리 글자로(읽기 앱과 같은 함수). 못 찾으면 어디인지 말하고 끝낸다
  const tickerRows = nextV();
  const holdingRows = nextV();
  let found: SheetShape;
  try {
    found = findSheetShape(holdingRows, tickerRows);
  } catch (e) {
    bad(e instanceof AssetSheetError ? e.message : '구간을 찾지 못했습니다');
    say(`❌ 연결하지 마세요 — 위 ${problems}곳을 먼저 고쳐 주세요`);
    return { ok: false, problems, reads };
  }

  // 「현금」 탭 — 머리 · 총액 글자로(읽기 앱과 같은 함수 · v2.70.4). 줄 수 · 줄 위치만(이름 · 금액은 내보내지 않는다)
  const cashRows = nextV();
  let cash: CashShape | null = null;
  try {
    cash = findCashShape(cashRows);
  } catch (e) {
    bad(e instanceof AssetSheetError ? e.message : `「${L.cash.tab}」 탭 구간을 찾지 못했습니다`);
  }
  if (cash) {
    const named = (b: CashShape['bank']) => Array.from({ length: b.totalRow - b.headRow - 1 }, (_, k) => b.headRow + 1 + k).filter((row) => !blank(cashRows[row - 1]?.[0])).length;
    say(
      `   「${L.cash.tab}」 탭 — 맞음 (은행 계좌 ${named(cash.bank)}줄 · 퇴직 연금 ${named(cash.retirement)}줄 · 총액 줄 「${L.cash.bankTotal}」 B${cash.bank.totalRow} · 「${L.cash.retireTotal}」 B${cash.retirement.totalRow})`,
    );
  }

  // 3. 「티커」 종목 줄 · 자산 분류(D열)
  const lines: { row: number; code: string; cls: Cell }[] = [];
  for (const row of tickerRowsOf(found.tickers)) {
    const code = tickerRowCode(tickerRows[row - 1]);
    if (code) lines.push({ row, code, cls: tickerRows[row - 1]?.[2] });
  }
  const us = lines.filter((l) => splitCode(l.code).market === 'US').length;
  const cls = Object.fromEntries(ASSET_CLASSES.map((c) => [c, lines.filter((l) => l.cls === c).length]));
  const clsBlank = lines.filter((l) => blank(l.cls)).length;
  // 옛 글자 「현금」(v2.65.2 에 고르기 목록에서 뺐다) — 앱은 미지정으로 본다 · 「그 밖」 과 따로 센다
  const clsCash = lines.filter((l) => l.cls === LEGACY_CASH_CLASS).length;
  const clsOther = lines.filter((l) => !blank(l.cls) && l.cls !== LEGACY_CASH_CLASS && !(ASSET_CLASSES as readonly Cell[]).includes(l.cls));
  say(
    `3. 「${TICKER_TAB}」 종목 줄 — ${lines.length ? '맞음' : '다름'} (${lines.length}줄 · 국내 ${lines.length - us} · 미국 ${us} · 자산 분류 ${ASSET_CLASSES.map((c) => `${c} ${cls[c]}`).join(' · ')} · 빈칸 ${clsBlank} · 미지정(${LEGACY_CASH_CLASS} — 고르기 목록에 없음) ${clsCash}줄 · 그 밖 ${clsOther.length})`,
  );
  if (!lines.length) bad(`「${TICKER_TAB}」 에 종목 줄이 없습니다(B 이름 · C 코드)`);
  if (clsOther.length) warn(`${L.assetClass.column}열에 ${ASSET_CLASSES.join(' · ')} · 빈칸이 아닌 값 ${clsOther.length}줄(${clsOther.map((l) => `${l.row}행`).join(' · ')}) — 앱은 「미지정」 으로 봅니다`);
  if (clsBlank) warn(`${L.assetClass.column}열 빈칸 ${clsBlank}줄 — 연결한 뒤 「자산 현황」 에서 고르세요`);

  const cellVals = r.cells.map(() => first(nextV()));
  const ratioVals = r.ratioCells.map(() => first(nextV()));

  // 수식 읽기 1번
  let formulas: CellRows[];
  try {
    reads++;
    formulas = await batchGet(config, r.formulas, 'FORMULA');
  } catch (e) {
    bad(`수식을 읽지 못했습니다 — ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    say(`❌ 연결하지 마세요 — 위 ${problems}곳을 먼저 고쳐 주세요`);
    return { ok: false, problems, reads };
  }
  let j = 0;
  const nextF = () => formulas[j++] ?? [];

  // 4. 시트 가격 칸 — C9 · E · F
  const c9 = first(nextF());
  const tickerF = nextF();
  const priceLines = tickerLines(tickerF, found.tickers);
  const kinds = priceLines.map((l) => ({ l, kind: classifyLine(l, true) }));
  const gf = kinds.filter((k) => k.kind === 'convert').length;
  const done = kinds.filter((k) => k.kind === 'done').length;
  const shapeBad = kinds.filter((k) => k.kind === 'price-shape' || k.kind === 'won-shape');
  const c9Google = typeof c9 === 'string' && P.fxFormula.test(c9.trim());
  const c9Ok = c9Google || isNum(c9);
  say(
    `4. 시트 가격 칸 — ${c9Ok && !shapeBad.length ? '맞음' : '다름'} (${P.fxCell} ${c9Google ? 'GOOGLEFINANCE' : isNum(c9) ? '이미 숫자(토스)' : '다른 모양'} · GOOGLEFINANCE ${gf}줄 · 이미 토스 ${done}줄 · 다른 모양 ${shapeBad.length}줄)`,
  );
  if (!c9Ok) bad(`「${TICKER_TAB}」 ${P.fxCell} — GOOGLEFINANCE 환율 수식(=GOOGLEFINANCE("CURRENCY:USDKRW"))이어야 합니다`);
  for (const { l, kind } of shapeBad) {
    bad(
      kind === 'price-shape'
        ? `「${TICKER_TAB}」 ${P.priceColumn}${l.row} — 가격 칸이 =GOOGLEFINANCE(${P.codeColumn}${l.row},"price") 모양이 아닙니다`
        : `「${TICKER_TAB}」 ${P.wonColumn}${l.row} — 원화 표기 칸이 ${splitCode(l.code).market === 'US' ? `=${P.priceColumn}${l.row}*$C$9 또는 GOOGLEFINANCE × $C$9` : `=${P.priceColumn}${l.row} 또는 GOOGLEFINANCE`} 모양이 아닙니다`,
    );
  }

  // 5. 목표 비율 여섯 칸 · 계좌 이름 「( 날짜 )」 · 값 칸
  const ratioF = r.ratioCells.map(() => first(nextF()));
  const shape = (f: Cell, v: Cell) => (isFormula(f) ? '수식' : blank(v) ? '빈칸' : isNum(v) ? (v as number) <= 1 ? '비율' : '%' : '글자');
  const ratioShapes = r.ratioCells.map((c, k) => ({ c, s: shape(ratioF[k], ratioVals[k]) }));
  const ratioText = ratioShapes.filter((x) => x.s === '글자');
  say(`5. 목표 비율 「${R.tab}」 — ${ratioText.length ? '다름' : '맞음'} (${ratioShapes.map((x) => `${x.c} ${x.s}`).join(' · ')})`);
  for (const x of ratioText) bad(`「${R.tab}」 ${x.c} — 숫자(비율 · %)여야 합니다`);
  const formulaRatio = ratioShapes.filter((x) => x.s === '수식');
  if (formulaRatio.length) warn(`${formulaRatio.map((x) => x.c).join(' · ')} 이 수식 — 앱 설정 창에서 목표 비율을 저장할 수 없습니다(읽기는 됨)`);
  const blankRatio = ratioShapes.filter((x) => x.s === '빈칸');
  if (blankRatio.length) warn(`${blankRatio.map((x) => x.c).join(' · ')} 이 빈칸 — 비율 조정 · 이번 달 구매에서 「—」 로 보입니다`);

  const nameShapes = found.sections.filter((s) => !s.combined).map((s) => {
    const v = holdingRows[s.nameRow - 1]?.[0];
    const m = typeof v === 'string' ? v.match(NAME_DATE) : null;
    return { cell: `B${s.nameRow}`, date: m ? maskDigits(m[0]) : null };
  });
  const noDate = nameShapes.filter((x) => !x.date);
  say(`   계좌 이름 「( 날짜 )」 — ${nameShapes.map((x) => `${x.cell} ${x.date ?? '날짜 없음'}`).join(' · ')}`);
  if (noDate.length === nameShapes.length) warn(`계좌 이름 칸에 「( 날짜 )」 가 없어 [구매 완료] 가 날짜를 쓰지 못합니다`);

  const cellNames: Record<string, string> = { salary: '현재 월 급여', avgFxRate: '구매 평균 환율' };
  const cellKeys = Object.keys(L.cells);
  // 「현금」 총액 두 칸(찾은 총액 줄의 C열) + 값 칸
  const totals = cash
    ? [
        { c: { tab: L.cash.tab, cell: `C${cash.bank.totalRow}` }, key: L.cash.bankTotal, v: cashRows[cash.bank.totalRow - 1]?.[1] },
        { c: { tab: L.cash.tab, cell: `C${cash.retirement.totalRow}` }, key: L.cash.retireTotal, v: cashRows[cash.retirement.totalRow - 1]?.[1] },
      ]
    : [];
  const valueCells = [...totals, ...r.cells.map((c, k) => ({ c, key: cellNames[cellKeys[k]] ?? cellKeys[k], v: cellVals[k] }))];
  const notNum = valueCells.filter((x) => !isNum(x.v));
  say(`   값 칸 — ${notNum.length ? `숫자 아님 ${notNum.length}칸` : `맞음 (${valueCells.length}칸 숫자)`}`);
  for (const x of notNum) warn(`「${x.c.tab}」 ${x.c.cell}(${x.key}) 이 숫자가 아닙니다 — 그 값은 빠지고 계산됩니다`);

  // 6. 「주식 투자 정리」 보유 줄 ↔ 「티커」
  const tickerRowSet = new Set(lines.map((l) => l.row));
  let linked = 0;
  let total = 0;
  const unlinked: string[] = [];
  const holdingF = nextF();
  for (const s of found.sections) {
    for (let row = s.firstRow; row <= s.lastRow; row++) {
      const cells = holdingF[row - 1] ?? [];
      if (blank(cells[0])) continue;
      total++;
      const t = linkedTickerRow(cells[4]);
      if (t != null && tickerRowSet.has(t)) linked++;
      else unlinked.push(`F${row}`);
    }
  }
  say(`6. 「${HOLDINGS_TAB}」 보유 줄 — ${unlinked.length || !total ? '다름' : '맞음'} (「${TICKER_TAB}」 와 이어진 줄 ${linked} / ${total})`);
  if (!total) bad(`「${HOLDINGS_TAB}」 보유 줄이 없습니다`);
  for (const c of unlinked) bad(`「${HOLDINGS_TAB}」 ${c} — ='${TICKER_TAB}'!$F$행 으로 「${TICKER_TAB}」 종목 줄을 가리켜야 합니다`);

  // 7. 칸 모양(새 종목 · 모두 매도 입력 준비 — 값 없이)
  say(`7. 칸 모양 — 보유 구간 · 「${TICKER_TAB}」 묶음의 줄 수와 빈 줄 (값 없음)`);
  const blankAt = (rows: CellRows, row: number) => (blank(rows[row - 1]?.[0]) && blank(rows[row - 1]?.[1]) ? [`${row}행 ${blankRowShape(rows[row - 1])}`] : []);
  for (const s of found.sections) {
    const count = s.lastRow - s.firstRow + 1;
    const blanks = Array.from({ length: count }, (_, k) => blankAt(holdingF, s.firstRow + k)).flat();
    say(`   보유 「${s.key}」${s.combined ? '(합친 표)' : ''} ${s.firstRow}~${s.lastRow}행 — 종목 줄 ${count - blanks.length} · 빈 줄 ${blanks.length}${blanks.length ? ` (${blanks.join(' / ')})` : ''}`);
  }
  found.tickers.forEach((g, i) => {
    // 묶음의 빈 줄 = 다음 머리 앞까지(마지막 묶음은 마지막 종목 줄까지 — 시트 아래쪽 빈 줄은 묶음이 아니다)
    const end = found.tickers[i + 1] ? found.tickers[i + 1].headRow - 1 : (g.rows.at(-1) ?? g.headRow);
    const blanks = Array.from({ length: Math.max(0, end - g.headRow) }, (_, k) => blankAt(tickerF, g.headRow + 1 + k)).flat();
    say(`   「${TICKER_TAB}」 묶음 「${g.group}」(머리 ${g.headRow}행) — 종목 줄 ${g.rows.length} · 빈 줄 ${blanks.length}${blanks.length ? ` (${blanks.join(' / ')})` : ''}`);
  });
  const fxF = first(nextF());
  say(`   구매 평균 환율 칸 — ${isFormula(fxF) ? `수식(${maskFormula(String(fxF).trim())})` : isNum(fxF) ? '숫자' : '숫자 아님'}`);

  say(problems ? `❌ 연결하지 마세요 — 위 ${problems}곳을 먼저 고쳐 주세요` : '✅ 연결해도 됩니다');
  return { ok: problems === 0, problems, reads };
}

// ── 8. 「적립식 투자」 탭 모양(v2.78.0 · 읽기만 · 모양만) ─────────────────────────────────────────────
/** 찾는 탭 이름 · 묶음 머리 글자 · 총 금액 칸 옆 글자에서 볼 낱말 */
export const SAVING_TAB = '적립식 투자';
const SAVING_ANCHOR = '분할 개월 수';
const AMOUNT_WORDS = ['금액', '총', '구매'] as const;
/** 읽는 범위(A1 부터 — 탭 모양을 모른다) */
const SAVING_LAST = { col: 'Z', row: 300 } as const;

const sq = (v: Cell) => String(v ?? '').replace(/\s+/g, '');
const addr = (r: number, c: number) => `${String.fromCharCode(65 + c)}${r + 1}`;
const colOf = (c: number) => String.fromCharCode(65 + c);
const isText = (v: Cell) => typeof v === 'string' && v.trim() !== '' && !isFormula(v);

/** 묶음 하나의 모양(값 없이) */
export interface SavingGroupShape {
  anchor: string;
  months: { cell: string; isNumber: boolean } | null;
  amountCandidates: { cell: string; label: { length: number; words: boolean } | null }[];
  ratio: { column: string; firstRow: number; lastRow: number; rows: number; zeroRows: number } | null;
  nameColumns: string[];
  sum: { cell: string; is100: boolean } | null;
  account: string | null;
  /** 계좌 이름이 앞 낱말만 맞았나(「ISA」 · 「연금」 처럼) */
  accountPartial: boolean;
  formulaCells: number;
  /** 「합계」 글자가 든 칸(묶음 안) */
  sumLabels: string[];
  /** 줄마다 칸 종류 지도(값 없음) — `행: A· B글 C수 …` */
  map: string[];
}

/**
 * 탭 값 · 수식(A1 부터 줄 단위)에서 「분할 개월 수」 묶음마다 모양만 뽑는다 — 순수 함수(시험이 가짜 탭으로 부른다).
 * - 개월 수 칸: 머리 칸 오른쪽(세 칸까지) · 바로 아래에서 처음 만난 값 칸.
 * - 총 금액 후보: 머리 칸 옆 · 위 · 아래(머리 줄 ±1 · 머리 열 −1 ~ +4)의 숫자 칸(개월 수 칸 제외) — 그 칸 왼쪽 / 위 글자는 길이 · 낱말(금액 · 총 · 구매) 있음 / 없음만.
 * - 비율 줄: 머리 줄 아래에서 0 ~ 1 숫자(또는 0 ~ 100)가 가장 많은 열 · 빈 줄 두 줄 · 다음 머리 · 「합계」 글자 줄 앞까지. 합계 줄 = 그 열에서 「합계」 글자가 든 줄 또는 비율 줄 바로 아래 숫자 칸.
 * - 계좌 이름: 묶음 위(세 줄) · 왼쪽 글자 중 계좌 key(「주식 투자 정리」 계좌 구간 — 공백 무시)로 시작하는 것.
 */
export function savingTabShape(values: CellRows, formulas: CellRows): SavingGroupShape[] {
  const V = (r: number, c: number): Cell => values[r]?.[c];
  const F = (r: number, c: number): Cell => formulas[r]?.[c];
  const rows = Math.max(values.length, formulas.length);
  const cols = Math.max(0, ...values.map((x) => x?.length ?? 0), ...formulas.map((x) => x?.length ?? 0));
  const anchors: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (typeof V(r, c) === 'string' && sq(V(r, c)).includes(sq(SAVING_ANCHOR))) anchors.push([r, c]);
  const keys = L.sections.flatMap((x) => (x.combined || !x.key ? [] : [x.key]));
  const valued = (r: number, c: number) => !blank(V(r, c)) || !blank(F(r, c));
  return anchors.map(([ar, ac], gi) => {
    const nextAnchorRow = anchors[gi + 1]?.[0] ?? rows;
    // 개월 수
    const monthsAt =
      [[ar, ac + 1], [ar, ac + 2], [ar, ac + 3], [ar + 1, ac], [ar + 1, ac + 1]].find(([r, c]) => isNum(V(r, c))) ??
      [[ar, ac + 1], [ar, ac + 2], [ar, ac + 3], [ar + 1, ac]].find(([r, c]) => valued(r, c));
    const months = monthsAt ? { cell: addr(monthsAt[0], monthsAt[1]), isNumber: isNum(V(monthsAt[0], monthsAt[1])) } : null;
    // 총 금액 후보
    const amountCandidates: SavingGroupShape['amountCandidates'] = [];
    for (let r = ar - 1; r <= ar + 1; r++) {
      for (let c = Math.max(0, ac - 1); c <= ac + 4; c++) {
        if (r < 0 || (r === ar && c === ac) || (monthsAt && r === monthsAt[0] && c === monthsAt[1]) || !isNum(V(r, c))) continue;
        const lab = [V(r, c - 1), V(r - 1, c)].find((x) => isText(x) && !sq(x).includes(sq(SAVING_ANCHOR)));
        amountCandidates.push({ cell: addr(r, c), label: lab == null ? null : { length: String(lab).trim().length, words: AMOUNT_WORDS.some((w) => String(lab).includes(w)) } });
      }
    }
    // 비율 줄 — 머리 아래 줄들에서 0~1(또는 0~100) 숫자가 가장 많은 열
    const start = ar + 1;
    let end = start;
    for (let r = start, empty = 0; r < nextAnchorRow; r++) {
      const any = Array.from({ length: cols }, (_, c) => valued(r, c)).some(Boolean);
      empty = any ? 0 : empty + 1;
      if (empty >= 2) break;
      if (any) end = r;
    }
    const isSumRow = (r: number) => Array.from({ length: cols }, (_, c) => V(r, c)).some((x) => typeof x === 'string' && sq(x).includes('합계'));
    // 비율 칸은 % 모양이면 0 ~ 1 로 읽힌다 — 그런 열이 없으면 0 ~ 100 숫자(「25」 처럼 % 없이 적은 칸)로 한 번 더
    const inRange = (v: Cell, bound: number) => isNum(v) && (v as number) >= 0 && (v as number) <= bound;
    const bestOf = (bound: number) => {
      let out: { c: number; n: number; bound: number } | null = null;
      for (let c = 0; c < cols; c++) {
        let n = 0;
        for (let r = start; r <= end; r++) if (!isSumRow(r) && inRange(V(r, c), bound) && !(monthsAt && r === monthsAt[0] && c === monthsAt[1])) n++;
        if (n > 0 && (!out || n > out.n)) out = { c, n, bound };
      }
      return out;
    };
    const best = bestOf(1) ?? bestOf(100);
    let ratio: SavingGroupShape['ratio'] = null;
    let sum: SavingGroupShape['sum'] = null;
    const nameCols = new Set<string>();
    if (best) {
      const rc = best.c;
      const ratioRows: number[] = [];
      let sumRow: number | null = null;
      for (let r = start; r <= end; r++) {
        const v = V(r, rc);
        if (isSumRow(r)) {
          if (isNum(v)) sumRow = r;
          continue;
        }
        if (inRange(v, best.bound) && !(monthsAt && r === monthsAt[0] && rc === monthsAt[1])) ratioRows.push(r);
      }
      if (sumRow == null && ratioRows.length && isNum(V(ratioRows.at(-1)! + 1, rc))) sumRow = ratioRows.at(-1)! + 1;
      if (ratioRows.length) {
        ratio = { column: colOf(rc), firstRow: ratioRows[0] + 1, lastRow: ratioRows.at(-1)! + 1, rows: ratioRows.length, zeroRows: ratioRows.filter((r) => V(r, rc) === 0).length };
        for (const r of ratioRows) for (let c = 0; c < cols; c++) if (c !== rc && isText(V(r, c))) nameCols.add(colOf(c));
      }
      if (sumRow != null) {
        const v = V(sumRow, rc) as number;
        sum = { cell: addr(sumRow, rc), is100: Math.abs(v - 1) < 1e-6 || Math.abs(v - 100) < 1e-6 };
      }
    }
    // 계좌 이름 — 앞 묶음 끝 다음 줄 ~ 머리 줄의 모든 글자(공백 무시) · 없으면 계좌 key 앞 낱말(「ISA」 · 「연금」 …)만 맞는 것
    const top = gi === 0 ? 0 : anchors[gi - 1][0] + 1;
    const near: Cell[] = [];
    for (let r = Math.max(top, ar - 3); r <= ar; r++) for (let c = 0; c < cols; c++) near.push(V(r, c));
    const texts = near.filter((x): x is string => typeof x === 'string').map(sq);
    const full = keys.find((k) => texts.some((x) => x.includes(sq(k))));
    const part = full ? undefined : keys.find((k) => texts.some((x) => x.includes(sq(k.split(' ')[0]))));
    const account = full ?? part ?? null;
    const sumLabels: string[] = [];
    for (let r = ar; r <= end; r++) for (let c = 0; c < cols; c++) if (typeof V(r, c) === 'string' && sq(V(r, c)).includes('합계')) sumLabels.push(addr(r, c));
    // 칸 종류 지도 — 머리 위 한 줄 ~ 끝 줄 · 내용이 있는 열만(빈칸 · 글 · 수 · 비(0~1) · 식(수식) — 값 없음)
    const mapCols = Array.from({ length: cols }, (_, c) => c).filter((c) => Array.from({ length: end - ar + 2 }, (_, k) => ar - 1 + k).some((r) => r >= 0 && valued(r, c)));
    const kind = (r: number, c: number) => (isFormula(F(r, c)) ? '식' : isNum(V(r, c)) ? ((V(r, c) as number) >= 0 && (V(r, c) as number) <= 1 ? '비' : '수') : isText(V(r, c)) ? '글' : '·');
    const map: string[] = [];
    for (let r = Math.max(0, ar - 1); r <= end; r++) map.push(`${r + 1}행: ${mapCols.map((c) => `${colOf(c)}${kind(r, c)}`).join(' ')}`);
    // 이 묶음 칸 중 수식(머리 위 세 줄 ~ 비율 끝 · 머리 열 −2 ~ +6)
    let formulaCells = 0;
    for (let r = Math.max(0, ar - 3); r <= Math.max(end, ar + 1); r++) for (let c = Math.max(0, ac - 2); c <= ac + 6; c++) if (isFormula(F(r, c))) formulaCells++;
    return { anchor: addr(ar, ac), months, amountCandidates, ratio, nameColumns: [...nameCols].sort(), sum, account, accountPartial: part != null && full == null, formulaCells, sumLabels, map };
  });
}

/** 묶음 모양 → 출력 줄(값 없음) */
export function savingTabLines(tabMatch: 'exact' | 'spacing' | 'none', groups: SavingGroupShape[]): string[] {
  if (tabMatch === 'none') return [`8. 「${SAVING_TAB}」 탭 — 없음(이 시트에 그 이름의 탭이 없습니다 · 공백 차이도 없음)`];
  const out = [`8. 「${SAVING_TAB}」 탭 — 있음(${tabMatch === 'exact' ? '이름 그대로 맞음' : '공백만 다름'}) · 「${SAVING_ANCHOR}」 묶음 ${groups.length}개 (값 없음 — 칸 주소 · 개수만)`];
  groups.forEach((g, i) => {
    out.push(`   묶음 ${i + 1} — 머리 ${g.anchor} · 계좌 ${g.account ? `「${g.account}」${g.accountPartial ? '(앞 낱말만 맞음)' : ''}` : '못 찾음'} · 수식 칸 ${g.formulaCells}`);
    out.push(`      개월 수 칸 — ${g.months ? `${g.months.cell} (${g.months.isNumber ? '숫자 맞음' : '숫자 아님'})` : '못 찾음'}`);
    out.push(
      `      총 금액 후보 — ${g.amountCandidates.length ? g.amountCandidates.map((a) => `${a.cell}${a.label ? `(옆 글자 ${a.label.length}자 · 낱말 ${a.label.words ? '있음' : '없음'})` : '(옆 글자 없음)'}`).join(' · ') : '없음'}`,
    );
    out.push(`      비율 줄 — ${g.ratio ? `${g.ratio.column}${g.ratio.firstRow} ~ ${g.ratio.column}${g.ratio.lastRow} · ${g.ratio.rows}줄 · 0% ${g.ratio.zeroRows}줄 · 이름 열 ${g.nameColumns.join(' · ') || '없음'}` : '못 찾음'}`);
    out.push(`      합계 줄 — ${g.sum ? `${g.sum.cell} · 100% ${g.sum.is100 ? '맞음' : '아님'}` : '못 찾음'}${g.sumLabels.length ? ` · 「합계」 글자 ${g.sumLabels.join(' · ')}` : ''}`);
    out.push(`      칸 지도(값 없음 — · 빈칸 · 글 글자 · 수 숫자 · 비 0~1 숫자 · 식 수식)`);
    for (const m of g.map) out.push(`         ${m}`);
  });
  return out;
}

/** 8 — 탭 목록 1번 + 값 1번 + 수식 1번(탭이 없으면 목록만) · 읽기만. 돌려주는 값은 구글 읽기 수 */
export async function runSavingTabCheck(config: AssetSheetConfig, say: (line: string) => void): Promise<{ reads: number }> {
  let reads = 1;
  const titles = [...(await sheetTabs(config)).keys()];
  const exact = titles.find((t) => t === SAVING_TAB);
  const loose = exact ?? titles.find((t) => sq(t) === sq(SAVING_TAB));
  if (!loose) {
    for (const l of savingTabLines('none', [])) say(l);
    return { reads };
  }
  const range = one(loose, `A1:${SAVING_LAST.col}${SAVING_LAST.row}`);
  reads++;
  const [vals] = await batchGet(config, [range], 'UNFORMATTED_VALUE');
  reads++;
  const [forms] = await batchGet(config, [range], 'FORMULA');
  for (const l of savingTabLines(exact ? 'exact' : 'spacing', savingTabShape(vals, forms))) say(l);
  return { reads };
}

/** 명령 인자 `--sheet <ID>` · `--sheet=<ID>` */
export function sheetArg(argv: string[]): string | null {
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '--sheet') return argv[k + 1]?.trim() || null;
    if (a.startsWith('--sheet=')) return a.slice('--sheet='.length).trim() || null;
  }
  return null;
}

async function main(): Promise<number> {
  const sheetId = sheetArg(process.argv.slice(2)) ?? process.env.ASSET_SHEET_ID?.trim() ?? '';
  const keyFile = process.env.GOOGLE_SA_KEY_FILE?.trim() ?? '';
  if (!sheetId) {
    console.log('❌ 시트 ID 가 없습니다 — `--sheet <시트 ID>` 를 붙이거나 .env 의 ASSET_SHEET_ID 를 확인하세요');
    return 1;
  }
  if (!keyFile) {
    console.log('❌ 서비스 계정 열쇠 파일 경로가 없습니다 — .env 의 GOOGLE_SA_KEY_FILE 을 확인하세요');
    return 1;
  }
  const r = await runSheetCheck({ sheetId, keyFile }, (line) => console.log(line));
  // 8 — 알림뿐(연결 판단에 넣지 않는다 · 읽기 실패도 이유 종류 한 줄만)
  try {
    await runSavingTabCheck({ sheetId, keyFile }, (line) => console.log(line));
  } catch (e) {
    console.log(`8. 「${SAVING_TAB}」 탭 — 읽지 못함(${e instanceof AssetSheetError ? e.kind : '알 수 없는 오류'})`);
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    () => {
      console.log('❌ 점검 중 알 수 없는 오류');
      process.exit(1);
    },
  );
}
