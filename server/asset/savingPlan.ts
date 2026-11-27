/**
 * 이번 달 구매 — 계좌 · 종목별 목록(v2.79.0 · 152차) — 시트 「적립식 투자」 탭을 **읽기만** 한다(쓰기 없음 · 주문 없음).
 *
 * - 읽기(`readSavingTab`): 따로 — 값(UNFORMATTED_VALUE · B ~ E 넓은 범위) 1번 + D열 수식(FORMULA) 1번(합계 줄 알아보기 — `sheetLayout.ts` `saving`).
 *   30초 캐시(다른 시트 읽기와 같음 · 동시에 온 요청은 한 번만). 탭이 없거나 읽기 실패 → `read` · 머리 글자를 못 찾음 → `shape`
 *   (summary 의 나머지는 그대로 — `planError` 하나만).
 * - 묶음 찾기는 `sheetShape.ts` `findSavingGroups` 한 곳 · 계산은 이 파일 `computeSavingPlans`(순수 함수 — 시험이 가짜 값으로 부른다):
 *   한 달 금액 = 반올림(총 금액 ÷ 개월 수) · 줄 금액 = 반올림(한 달 금액 × 비율) · 반올림 차이는 금액이 가장 큰 줄에(줄 합 = 한 달 금액) ·
 *   0% 줄은 뺀다 · 비율 합이 100%(±0.01%p)가 아니면 목록 없이 `ratio-sum` · 총 금액 · 개월 수가 맞지 않으면 `values`.
 * - 몇 주: 가격은 summary 가격 표(`PriceBook` — 총 자산과 같은 값) · 미국은 가격 × 지금 환율(summary 와 같은 환율) ·
 *   살 주 = 내림(금액 ÷ 원 가격) · 남는 돈 = 금액 − 살 주 × 원 가격(원 반올림 · 0 이상) · 가격이 없으면 null.
 * - 줄 이름 → 종목: `store.ts` `planLinks`(앱 설정) — 지금 줄 이름 · 그 계좌 보유 종목일 때만 쓴다(아니면 「이어 주세요」).
 * ⚠️ 금액 · 비율 · 개월 수 · 줄 이름 · 종목을 로그에 찍지 않는다(개수 · 까닭 종류만).
 */
import type { AssetSheetData, MonthlyPlan, MonthlyPlanError, MonthlyPlanRow, MonthlyPlanSkip } from '../../src/types/asset';
import { assetSheetConfig } from './config';
import { AssetSheetError, batchGet, type CellRows } from './google';
import { one, onSheetCacheReset, wideRange } from './sheet';
import { SHEET_LAYOUT } from './sheetLayout';
import { findSavingGroups, type SavingGroup, type SavingShape } from './sheetShape';
import { planLinks, type PlanLinks } from './store';
import type { PriceBook } from './summary';

const CACHE_MS = 30_000;
const S = SHEET_LAYOUT.saving;
/** 비율 합 허용 — 100% ± 0.01%p */
const RATIO_TOLERANCE = 0.0001;

/** 읽은 탭 — 값(B ~ E) · D열 수식 */
export interface SavingTabRows {
  values: CellRows;
  ratioFormulas: CellRows;
}

let cache: { at: number; rows: SavingTabRows } | null = null;
let inflight: Promise<SavingTabRows> | null = null;

/** 시트 캐시를 비울 때(`sheet.ts` `resetSheetCache` — 쓰기 뒤 · 시트 바꿈 · 시험) 함께 비운다 */
export function resetSavingCache(): void {
  cache = null;
  inflight = null;
}
onSheetCacheReset(resetSavingCache);

/** 「적립식 투자」 탭 읽기(30초 캐시) — 실패는 `AssetSheetError`(그대로) */
export async function readSavingTab(): Promise<SavingTabRows> {
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  if (inflight) return inflight;
  inflight = (async () => {
    const [values] = await batchGet(config, [wideRange(S.tab, S.lastColumn)], 'UNFORMATTED_VALUE');
    const [ratioFormulas] = await batchGet(config, [one(S.tab, `${S.ratioColumn}1:${S.ratioColumn}`)], 'FORMULA');
    const rows = { values, ratioFormulas };
    cache = { at: Date.now(), rows };
    return rows;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 원 금액 = 반올림 정수 */
const won = (v: number) => Math.round(v);

/** 계좌 보유 종목(코드가 있는 줄 · 시트 순서 · 같은 코드는 한 번) */
function choicesOf(data: Pick<AssetSheetData, 'sections'>, section: string) {
  const s = data.sections.find((x) => !x.combined && x.key === section);
  const seen = new Map<string, { symbol: string; name: string; market: 'US' | 'KR' | null }>();
  for (const h of s?.holdings ?? []) if (h.symbol && !seen.has(h.symbol)) seen.set(h.symbol, { symbol: h.symbol, name: h.name, market: h.market });
  return [...seen.values()];
}

/** 몇 주 — 원 가격 · 살 주(내림) · 남는 돈(원 · 0 이상). 가격이 없으면 모두 null */
export function sharesOf(amount: number, price: number | null, market: 'US' | 'KR' | null, usdKrw: number | null): Pick<MonthlyPlanRow, 'priceKrw' | 'shares' | 'rest'> {
  const priceKrw = price == null || !Number.isFinite(price) || price <= 0 ? null : market === 'US' ? (usdKrw == null ? null : price * usdKrw) : price;
  if (priceKrw == null) return { priceKrw: null, shares: null, rest: null };
  // 아주 작은 값을 더해 내림 — 나누기 찌꺼기(2.9999…)로 한 주 덜 나오지 않게
  const shares = Math.max(0, Math.floor(amount / priceKrw + 1e-9));
  return { priceKrw, shares, rest: Math.max(0, won(amount - shares * priceKrw)) };
}

/** 묶음 하나 → 계좌 계산(순수) */
export function planOfGroup(g: SavingGroup, data: Pick<AssetSheetData, 'sections'>, book: PriceBook, links: PlanLinks): MonthlyPlan {
  const choices = choicesOf(data, g.account as string);
  const linked = links[g.account as string] ?? {};
  const symbolOf = (name: string) => {
    const sym = linked[name];
    return sym != null && choices.some((c) => c.symbol === sym) ? sym : null;
  };
  const live = g.lines.filter((l) => l.ratio != null && l.ratio > 0);
  const known = g.lines.every((l) => l.ratio != null);
  const ratioSum = known ? Math.round(g.lines.reduce((a, l) => a + (l.ratio as number), 0) * 1_000_000) / 10_000 : null;
  const base: MonthlyPlan = {
    headRow: g.headRow,
    total: g.total,
    months: g.months,
    monthly: null,
    rows: [],
    sum: null,
    restSum: null,
    problem: null,
    ratioSum,
    links: live.map((l) => ({ name: l.name, symbol: symbolOf(l.name) })),
    choices: choices.map(({ symbol, name }) => ({ symbol, name })),
  };
  if (g.problem === 'values' || g.total == null || g.months == null || g.months <= 0) return { ...base, problem: 'values' };
  const monthly = won(g.total / g.months);
  if (ratioSum == null || Math.abs(ratioSum / 100 - 1) > RATIO_TOLERANCE) return { ...base, monthly, problem: 'ratio-sum' };
  const amounts = live.map((l) => won(monthly * (l.ratio as number)));
  // 반올림 차이는 금액이 가장 큰 줄(같으면 위 줄)에 — 줄 합 = 한 달 금액
  const diff = monthly - amounts.reduce((a, b) => a + b, 0);
  if (diff !== 0 && amounts.length > 0) {
    const top = amounts.indexOf(Math.max(...amounts));
    amounts[top] += diff;
  }
  const rows: MonthlyPlanRow[] = live.map((l, i) => {
    const symbol = symbolOf(l.name);
    const c = symbol ? choices.find((x) => x.symbol === symbol) : undefined;
    const market = c?.market ?? null;
    const price = symbol ? (book.prices.get(symbol) ?? null) : null;
    const usd = market === 'US' ? book.usdKrw : null;
    const s = symbol ? sharesOf(amounts[i], price, market, book.usdKrw) : { priceKrw: null, shares: null, rest: null };
    return {
      name: l.name,
      symbol,
      stockName: c?.name ?? null,
      market,
      ratio: l.ratio as number,
      amount: amounts[i],
      price: symbol ? price : null,
      ...s,
      usdKrw: usd,
      amountUsd: usd != null && usd > 0 ? amounts[i] / usd : null,
    };
  });
  const rests = rows.filter((r) => r.rest != null).map((r) => r.rest as number);
  return { ...base, monthly, rows, sum: amounts.reduce((a, b) => a + b, 0), restSum: rests.length ? rests.reduce((a, b) => a + b, 0) : null };
}

/** 찾은 묶음 → 계좌 key → 계산(쓰는 묶음만 · 순수) */
export function computeSavingPlans(shape: SavingShape, data: Pick<AssetSheetData, 'sections'>, book: PriceBook, links: PlanLinks): Map<string, MonthlyPlan> {
  const out = new Map<string, MonthlyPlan>();
  for (const g of shape.groups) if (g.account) out.set(g.account, planOfGroup(g, data, book, links));
  return out;
}

/** summary 에 붙일 것 — 계좌마다 계산 · 쓰지 않은 묶음 · 못 씀 */
export interface SavingPlanResult {
  plans: Map<string, MonthlyPlan>;
  skipped: MonthlyPlanSkip[];
  error: MonthlyPlanError | null;
}

export const PLAN_ERROR_TEXT = {
  read: `「${S.tab}」 탭을 읽지 못함`,
  shape: `시트 모양이 바뀌었어요(${S.tab})`,
} as const;

/** 읽은 탭 → 묶음(계좌 key = 그 시트의 계좌 구간) */
export function savingShapeOf(rows: SavingTabRows, data: Pick<AssetSheetData, 'sections'>): SavingShape {
  const keys = data.sections.flatMap((s) => (s.combined || !s.key ? [] : [s.key]));
  return findSavingGroups(rows.values, rows.ratioFormulas, keys);
}

/**
 * summary 가 부른다 — 탭 읽기 · 묶음 찾기 · 계산. 실패해도 던지지 않는다(나머지 summary 는 그대로 · `error` 하나).
 * 로그는 까닭 종류 · 개수만.
 */
export async function savingPlansFor(data: AssetSheetData, book: PriceBook): Promise<SavingPlanResult> {
  let rows: SavingTabRows;
  try {
    rows = await readSavingTab();
  } catch (e) {
    console.warn(`[asset] 「적립식 투자」 탭 읽기 실패(${e instanceof AssetSheetError ? e.kind : 'unknown'})`);
    return { plans: new Map(), skipped: [], error: { kind: 'read', message: PLAN_ERROR_TEXT.read } };
  }
  let shape: SavingShape;
  try {
    shape = savingShapeOf(rows, data);
  } catch (e) {
    if (!(e instanceof AssetSheetError)) throw e;
    console.warn('[asset] 「적립식 투자」 탭 모양이 다름(머리 글자 없음)');
    return { plans: new Map(), skipped: [], error: { kind: 'shape', message: PLAN_ERROR_TEXT.shape } };
  }
  return { plans: computeSavingPlans(shape, data, book, planLinks()), skipped: shape.skipped, error: null };
}
