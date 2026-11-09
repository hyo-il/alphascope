/**
 * 자산 시트 점검(v2.65.1 · 114차 B) — `npm run -s asset:check-sheet -- --sheet <시트 ID>` · **읽기만**(구글 `values:batchGet` 값 1번 · 수식 1번).
 * 원본 시트로 바꾸기 전에(오라클에서) 「이 시트를 앱에 연결해도 되나」 를 칸마다 「맞음 / 다름」 으로 보인다.
 *
 * - 시트: `--sheet <ID>`(또는 `--sheet=<ID>`) · 없으면 `.env` 의 `ASSET_SHEET_ID`. 열쇠: `.env` 의 `GOOGLE_SA_KEY_FILE`.
 * - 보는 칸은 모두 `server/asset/sheetLayout.ts` 한 곳에서 가져온다(새 목록을 손으로 적지 않는다):
 *   1 열 수 있는가(안 되면 서비스 계정 이메일에 편집자로 공유) · 2 탭 이름 · 머리 글자(`headers` · 목표 비율 머리) ·
 *   3 「티커」 종목 줄 수 · 국내/미국 · D열 자산 분류 값 · 4 시트 가격 칸 모양(113차 A-0 와 같은 검사 — `classifyLine`) ·
 *   5 목표 비율 여섯 칸 · 계좌 이름 「( 날짜 )」 모양 · 값 칸(현금 · 퇴직 연금 · 월급 · 구매 평균 환율) · 6 「주식 투자 정리」 보유 줄이 「티커」 와 이어지는가 ·
 *   7 보유 구간 · 「티커」 묶음마다 종목 줄 수 · 빈 줄 수 · 빈 줄 칸 모양(새 종목 입력 준비 — v2.66.0) · 구매 평균 환율 칸 모양. 7번은 알림뿐(연결 판단에 넣지 않는다).
 * - 마지막 줄 「✅ 연결해도 됩니다」(종료 0) 또는 「❌ 연결하지 마세요 — 위 n곳을 먼저 고쳐 주세요」(종료 1). ⚠️ 는 알림(연결은 됨).
 * ⚠️ 금액 · 수량 · 종목 이름 · 코드 · 시트 ID 전체 · 열쇠 값(이메일 말고)을 출력하지 않는다 — 시트는 ID 앞 4글자 + 「…」 · 날짜는 숫자를 # 로.
 * ⚠️ 쓰기 함수(`valuesWrite` · `write…` · 바꾸기 · 되돌리기)를 import 하지 않는다(`assetsheet:test` 가 소스로 확인). DB 도 열지 않는다.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssetSheetError, batchGet, type CellRows } from '../server/asset/google';
import { NAME_DATE, headerOk, linkedTickerRow, one, splitCode, tickerRowCode } from '../server/asset/sheet';
import { HOLDINGS_TAB, SHEET_LAYOUT, TICKER_TAB, type HeaderCheck, type HoldingSection } from '../server/asset/sheetLayout';
import { classifyLine, tickerLines } from '../server/asset/priceSheet';
import { ASSET_CLASSES, LEGACY_CASH_CLASS } from '../src/types/asset';
import type { AssetSheetConfig } from '../server/asset/config';

type Cell = string | number | boolean | undefined;
const L = SHEET_LAYOUT;
const P = L.prices;
const T = L.tickers;
const R = L.targetRatio;

const q = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
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
  const tickerBD = `${q(TICKER_TAB)}!B${T.firstRow}:${L.assetClass.column}${T.lastRow}`;
  const tickerBF = `${q(TICKER_TAB)}!B${T.firstRow}:${P.wonColumn}${T.lastRow}`;
  const ratioCells = [...R.assets, ...R.coreSatellite];
  const holding = (s: HoldingSection) => `${q(HOLDINGS_TAB)}!B${s.firstRow}:F${s.lastRow}`;
  const cells = Object.values(L.cells);
  return {
    headers: [...L.headers, ...R.headers] as HeaderCheck[],
    ratioCells,
    cells,
    values: [
      ...L.headers.map((h) => one(h.tab, h.cell)),
      ...R.headers.map((h) => one(h.tab, h.cell)),
      tickerBD,
      ...cells.map((c) => one(c.tab, c.cell)),
      ...ratioCells.map((c) => one(R.tab, c)),
    ],
    formulas: [
      one(TICKER_TAB, P.fxCell),
      tickerBF,
      ...ratioCells.map((c) => one(R.tab, c)),
      ...L.sections.map(holding),
      // 7번(칸 모양) — 첫 묶음 머리 줄(「티커」 종목 범위 바로 윗줄) · 「티커」 넓은 범위 · 보유 구간 넓은 범위 · 구매 평균 환율
      one(TICKER_TAB, `B${T.firstRow - 1}`),
      `${q(TICKER_TAB)}!B${T.firstRow}:${L.shapeLastColumn}${T.lastRow}`,
      ...L.sections.map((s: HoldingSection) => `${q(HOLDINGS_TAB)}!B${s.firstRow}:${L.shapeLastColumn}${s.lastRow}`),
      one(L.cells.avgFxRate.tab, L.cells.avgFxRate.cell),
    ],
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

  // 3. 「티커」 종목 줄 · 자산 분류(D열)
  const tickerRows = nextV();
  const lines: { row: number; code: string; cls: Cell }[] = [];
  tickerRows.forEach((row, k) => {
    const code = tickerRowCode(row);
    if (code) lines.push({ row: T.firstRow + k, code, cls: row[2] });
  });
  const us = lines.filter((l) => splitCode(l.code).market === 'US').length;
  const cls = Object.fromEntries(ASSET_CLASSES.map((c) => [c, lines.filter((l) => l.cls === c).length]));
  const clsBlank = lines.filter((l) => blank(l.cls)).length;
  // 옛 글자 「현금」(v2.65.2 에 고르기 목록에서 뺐다) — 앱은 미지정으로 본다 · 「그 밖」 과 따로 센다
  const clsCash = lines.filter((l) => l.cls === LEGACY_CASH_CLASS).length;
  const clsOther = lines.filter((l) => !blank(l.cls) && l.cls !== LEGACY_CASH_CLASS && !(ASSET_CLASSES as readonly Cell[]).includes(l.cls));
  say(
    `3. 「${TICKER_TAB}」 종목 줄 — ${lines.length ? '맞음' : '다름'} (${lines.length}줄 · 국내 ${lines.length - us} · 미국 ${us} · 자산 분류 ${ASSET_CLASSES.map((c) => `${c} ${cls[c]}`).join(' · ')} · 빈칸 ${clsBlank} · 미지정(${LEGACY_CASH_CLASS} — 고르기 목록에 없음) ${clsCash}줄 · 그 밖 ${clsOther.length})`,
  );
  if (!lines.length) bad(`「${TICKER_TAB}」 ${T.firstRow}~${T.lastRow}행에 종목 줄이 없습니다(B 이름 · C 코드)`);
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
  const priceLines = tickerLines(nextF());
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

  const names = L.sections.flatMap((s: HoldingSection) => (s.nameCell ? [s.nameCell] : []));
  const nameShapes = names.map((cell) => {
    const k = r.headers.findIndex((h) => h.tab === HOLDINGS_TAB && h.cell === cell);
    const v = k >= 0 ? headerVals[k] : undefined;
    const m = typeof v === 'string' ? v.match(NAME_DATE) : null;
    return { cell, date: m ? maskDigits(m[0]) : null };
  });
  const noDate = nameShapes.filter((x) => !x.date);
  say(`   계좌 이름 「( 날짜 )」 — ${nameShapes.map((x) => `${x.cell} ${x.date ?? '날짜 없음'}`).join(' · ')}`);
  if (noDate.length === nameShapes.length) warn(`계좌 이름 칸에 「( 날짜 )」 가 없어 [구매 완료] 가 날짜를 쓰지 못합니다`);

  const cellNames: Record<string, string> = { cashTotal: '은행 자산 총액', retirement: '퇴직 연금 총액', salary: '현재 월 급여', avgFxRate: '구매 평균 환율' };
  const cellKeys = Object.keys(L.cells);
  const notNum = r.cells.map((c, k) => ({ c, key: cellKeys[k], v: cellVals[k] })).filter((x) => !isNum(x.v));
  say(`   값 칸 — ${notNum.length ? `숫자 아님 ${notNum.length}칸` : `맞음 (${r.cells.length}칸 숫자)`}`);
  for (const x of notNum) warn(`「${x.c.tab}」 ${x.c.cell}(${cellNames[x.key] ?? x.key}) 이 숫자가 아닙니다 — 그 값은 빠지고 계산됩니다`);

  // 6. 「주식 투자 정리」 보유 줄 ↔ 「티커」
  const tickerRowSet = new Set(lines.map((l) => l.row));
  let linked = 0;
  let total = 0;
  const unlinked: string[] = [];
  L.sections.forEach((s: HoldingSection) => {
    const rows = nextF();
    for (let k = 0; k <= s.lastRow - s.firstRow; k++) {
      const row = rows[k] ?? [];
      if (blank(row[0])) continue;
      total++;
      const t = linkedTickerRow(row[4]);
      if (t != null && tickerRowSet.has(t)) linked++;
      else unlinked.push(`F${s.firstRow + k}`);
    }
  });
  say(`6. 「${HOLDINGS_TAB}」 보유 줄 — ${unlinked.length || !total ? '다름' : '맞음'} (「${TICKER_TAB}」 와 이어진 줄 ${linked} / ${total})`);
  if (!total) bad(`「${HOLDINGS_TAB}」 보유 줄이 없습니다`);
  for (const c of unlinked) bad(`「${HOLDINGS_TAB}」 ${c} — ='${TICKER_TAB}'!$F$행 으로 「${TICKER_TAB}」 종목 줄을 가리켜야 합니다`);

  // 7. 칸 모양(새 종목 · 모두 매도 입력 준비 — 값 없이)
  say(`7. 칸 모양 — 보유 구간 · 「${TICKER_TAB}」 묶음의 줄 수와 빈 줄 (값 없음)`);
  const blankLines = (rows: (Cell[] | undefined)[], first: number) => rows.flatMap((row, k) => (blank(row?.[0]) && blank(row?.[1]) ? [`${first + k}행 ${blankRowShape(row)}`] : []));
  const headAbove = first(nextF());
  const shapeRows = nextF();
  L.sections.forEach((s: HoldingSection) => {
    const rows = nextF();
    const all = Array.from({ length: s.lastRow - s.firstRow + 1 }, (_, k) => rows[k]);
    const blanks = blankLines(all, s.firstRow);
    say(`   보유 「${s.key ?? s.label}」${s.combined ? '(합친 표)' : ''} ${s.firstRow}~${s.lastRow}행 — 종목 줄 ${all.length - blanks.length} · 빈 줄 ${blanks.length}${blanks.length ? ` (${blanks.join(' / ')})` : ''}`);
  });
  const headName = (v: Cell) => T.skipNames.find((n) => headerOk({ tab: TICKER_TAB, cell: '', expect: n }, v)) ?? null;
  type Group = { name: string; head: number | null; lines: number; blanks: string[] };
  const aboveName = headName(headAbove);
  const groups: Group[] = [{ name: aboveName ?? '머리 줄 없음', head: aboveName ? T.firstRow - 1 : null, lines: 0, blanks: [] }];
  for (let k = 0; k <= T.lastRow - T.firstRow; k++) {
    const row = shapeRows[k];
    const name = headName(row?.[0]);
    if (name) {
      groups.push({ name, head: T.firstRow + k, lines: 0, blanks: [] });
      continue;
    }
    const g = groups[groups.length - 1];
    if (blank(row?.[0]) && blank(row?.[1])) g.blanks.push(`${T.firstRow + k}행 ${blankRowShape(row)}`);
    else g.lines++;
  }
  for (const g of groups.filter((x) => x.head != null || x.lines > 0 || x.blanks.length > 0)) {
    say(`   「${TICKER_TAB}」 묶음 「${g.name}」${g.head != null ? `(머리 ${g.head}행)` : ''} — 종목 줄 ${g.lines} · 빈 줄 ${g.blanks.length}${g.blanks.length ? ` (${g.blanks.join(' / ')})` : ''}`);
  }
  const fxF = first(nextF());
  say(`   구매 평균 환율 칸 — ${isFormula(fxF) ? `수식(${maskFormula(String(fxF).trim())})` : isNum(fxF) ? '숫자' : '숫자 아님'}`);
  if (!isNum(fxF)) warn(`구매 평균 환율 칸이 숫자가 아닙니다 — 매수 입력에서 환율을 받지 않습니다(수량 · 평균가는 입력됨)`);

  say(problems ? `❌ 연결하지 마세요 — 위 ${problems}곳을 먼저 고쳐 주세요` : '✅ 연결해도 됩니다');
  return { ok: problems === 0, problems, reads };
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
