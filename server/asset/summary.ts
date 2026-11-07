/**
 * 총 자산 계산(v2.62.0 · 자산 관리 3단계) — 금액은 **토스 가격 × 시트 수량**(시트의 가격 칸은 읽지 않는다).
 *
 * - 더하는 것: 「현금」 C25 + **계좌(개별 · 적립식 · ISA · 연금 저축)** 의 보유 평가 금액.
 *   ⚠️ 39~44행 「적립식 주식」(계좌를 합친 표 — `combined`)은 **더하지 않는다**(위 구간과 같은 종목 — 이중 계산).
 * - 평가 = 수량 × 토스 가격(미국은 × 토스 환율). 매입 = 수량 × 평균 매입가(달러 평균가는 × 「티커」 G9 구매 평균 환율 — 시트와 같은 방식).
 * - 「연금 포함」 이 꺼지면 「연금으로 볼 계좌」(설정 — 기본 연금 저축 계좌) 보유와 퇴직 연금(「현금」 C30)을 뺀다.
 *   퇴직 연금은 자산 분류가 없어 따로 한 칸(「퇴직 연금」)으로 둔다 — 분류별 합이 총 자산과 같게.
 * - 분류별: 현금(C25 + 분류 「현금」 종목) · 채권 · 금 · 주식 · 미지정(빈칸 · 네 글자가 아닌 글자 · 이을 수 없는 줄 — 하나의 값).
 * - 코어 · 위성: 분류 「주식」 종목만 — 종목 코드가 「위성으로 선택한 종목」(설정 — 처음 값은 개별 투자의 주식)에 있으면 위성, 그 밖은 코어.
 *   같은 코드는 어느 계좌에 있든 같은 쪽(계좌로 나누지 않는다).
 * - 가격을 못 받은 줄(코드 없음 · 토스 가격 없음 · 캐시된 지난 종가(stale) · 미국인데 환율 없음 · 수량 없음)은 총 자산에서 빼고 개수를 센다.
 * ⚠️ 금액 · 수량을 로그에 찍지 않는다.
 */
import { fetchQuotes } from '../quoteService';
import { isMockMode } from '../mockData';
import { fetchExchangeRate } from '../../src/services/toss/account';
import { ASSET_GROUP_LABEL, type AssetSymbolRow, type AssetAccount, type AssetGroup, type AssetGroupKey, type AssetHolding, type AssetSettings, type AssetSheetData, type AssetSummary, type AssetTotals } from '../../src/types/asset';
import { accountDateTexts, readAssetSheet } from './sheet';
import { readAssetSettings, stockChoices } from './settings';
import { latestRecord } from './store';
import { isAssetSyncEnabled } from './config';
import { computeRebalance } from './rebalance';
import { monthlyBuyOf } from './purchase';

/** 토스 가격(종목 → 원래 통화 값) · 환율(1달러 = N원) */
export interface PriceBook {
  prices: Map<string, number>;
  usdKrw: number | null;
}

const CLASS_GROUP: Record<string, AssetGroupKey> = { 현금: 'cash', 채권: 'bond', 금: 'gold', 주식: 'stock' };

const valuedRow = (h: AssetHolding, book: PriceBook): number | null => {
  if (!h.symbol || h.quantity == null) return null;
  const price = book.prices.get(h.symbol);
  if (price == null || !Number.isFinite(price)) return null;
  if (h.market === 'US') return book.usdKrw == null ? null : h.quantity * price * book.usdKrw;
  return h.quantity * price;
};

const costOf = (h: AssetHolding, avgFxRate: number | null): number | null => {
  if (h.quantity == null || h.avgPrice == null) return null;
  if (h.currency === 'USD') return avgFxRate == null ? null : h.quantity * h.avgPrice * avgFxRate;
  return h.quantity * h.avgPrice;
};

export interface ComputedTotals {
  totals: AssetTotals;
  profit: AssetSummary['profit'];
  missingNames: string[];
}

/** 순수 계산 — 시험이 가짜 시트 · 가짜 가격으로 부른다 */
export function computeAssetTotals(data: AssetSheetData, book: PriceBook, settings: Pick<AssetSettings, 'pensionSections' | 'satelliteSymbols'>, includePension: boolean): ComputedTotals {
  const amounts: Record<AssetGroupKey, number> = { cash: data.cashTotal ?? 0, bond: 0, gold: 0, stock: 0, retirement: includePension ? (data.retirement ?? 0) : 0, none: 0 };
  const satellites = new Set(settings.satelliteSymbols);
  let core = 0;
  let satellite = 0;
  let missing = 0;
  const missingNames: string[] = [];
  let value = 0;
  let cost = 0;
  let costRows = 0;

  for (const section of data.sections) {
    if (section.combined || !section.key) continue; // ⚠️ 합친 표 — 더하지 않는다
    const pension = settings.pensionSections.includes(section.key);
    if (pension && !includePension) continue;
    for (const h of section.holdings) {
      const v = valuedRow(h, book);
      if (v == null) {
        missing++;
        missingNames.push(h.name);
        continue;
      }
      const group = h.assetClass ? CLASS_GROUP[h.assetClass] : 'none';
      amounts[group] += v;
      if (group === 'stock') {
        if (h.symbol && satellites.has(h.symbol)) satellite += v;
        else core += v;
      }
      const c = costOf(h, data.avgFxRate);
      if (c != null) {
        value += v;
        cost += c;
        costRows++;
      }
    }
  }

  const total = Object.values(amounts).reduce((a, b) => a + b, 0);
  const keys: AssetGroupKey[] = includePension ? ['cash', 'bond', 'gold', 'stock', 'retirement', 'none'] : ['cash', 'bond', 'gold', 'stock', 'none'];
  const groups: AssetGroup[] = keys.map((key) => ({ key, label: ASSET_GROUP_LABEL[key], amount: amounts[key], ratio: total > 0 ? amounts[key] / total : null }));
  return {
    totals: { total, groups, core, satellite, missing },
    profit: costRows > 0 ? { amount: value - cost, ratio: cost > 0 ? (value - cost) / cost : null } : null,
    missingNames,
  };
}

/** 계좌마다 평가 금액 합 · 가격 못 받은 줄 수 — 「자산 현황」 계좌 카드 머리(연금 포함과 상관없이 모든 계좌 · 합친 표 제외) */
export function accountValues(data: AssetSheetData, book: PriceBook): AssetAccount[] {
  return data.sections.flatMap((s) => {
    if (s.combined || !s.key) return [];
    let value = 0;
    let missing = 0;
    for (const h of s.holdings) {
      const v = valuedRow(h, book);
      if (v == null) missing++;
      else value += v;
    }
    return [{ key: s.key, name: s.name || s.key, holdings: s.holdings.length, value, missing }];
  });
}

/**
 * 「자산 현황」 종목별(v2.63.0) — 같은 종목 코드를 계좌와 상관없이 한 줄로. **금액은 `valuedRow`(총 자산과 같은 값 계산)** — 새 가격 계산 없음.
 * 합친 표(39~44행)는 더하지 않는다 · 「연금 포함」 이 꺼지면 연금으로 볼 계좌 종목은 빠진다(`computeAssetTotals` 와 같은 규칙).
 * 코어 / 위성은 분류 「주식」 만(위성 = `satelliteSymbols`) — 코어 줄 금액 합 = `totals.core`, 위성 = `totals.satellite`.
 * 비중 기준 = 같은 계산의 총 자산(`total`). 평가 금액 큰 순(금액 없음은 맨 뒤).
 */
export function holdingsBySymbol(data: AssetSheetData, book: PriceBook, settings: Pick<AssetSettings, 'pensionSections' | 'satelliteSymbols'>, includePension: boolean, total: number): AssetSymbolRow[] {
  const satellites = new Set(settings.satelliteSymbols);
  const map = new Map<string, AssetSymbolRow>();
  for (const section of data.sections) {
    if (section.combined || !section.key) continue; // ⚠️ 합친 표 — 더하지 않는다
    if (settings.pensionSections.includes(section.key) && !includePension) continue;
    for (const h of section.holdings) {
      const id = h.symbol ?? `name:${h.name}`;
      const row = map.get(id) ?? {
        id,
        name: h.name,
        symbol: h.symbol,
        exchange: h.exchange,
        assetClass: h.assetClass,
        side: h.assetClass === '주식' ? (h.symbol && satellites.has(h.symbol) ? 'satellite' : 'core') : null,
        sections: [],
        quantity: null,
        value: null,
        missing: 0,
        ratio: null,
      };
      if (!row.sections.includes(section.key)) row.sections.push(section.key);
      if (h.quantity != null) row.quantity = (row.quantity ?? 0) + h.quantity;
      const v = valuedRow(h, book);
      if (v == null) row.missing++;
      else row.value = (row.value ?? 0) + v;
      map.set(id, row);
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, ratio: r.value != null && total > 0 ? r.value / total : null }));
  return rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
}

// ── 가격 받기 (지금 있는 함수 그대로 — 관심 목록과 같은 토스 /prices 묶음 · 환율 60초 캐시) ──

type PriceSource = (data: AssetSheetData) => Promise<PriceBook>;

const tossPriceBook: PriceSource = async (data) => {
  const holdings = data.sections.filter((s) => !s.combined).flatMap((s) => s.holdings);
  const symbols = [...new Set(holdings.flatMap((h) => (h.symbol ? [h.symbol] : [])))];
  const prices = new Map<string, number>();
  for (const q of await fetchQuotes(symbols)) {
    // 캐시된 지난 종가(stale — 토스가 막힘)는 지금 가격이 아니다 → 「가격 못 받음」
    if (q.price != null && Number.isFinite(q.price) && !q.stale) prices.set(q.symbol, q.price);
  }
  let usdKrw: number | null = null;
  if (holdings.some((h) => h.market === 'US')) {
    try {
      const rate = isMockMode() ? 1380 : (await fetchExchangeRate('USD', 'KRW')).rate;
      usdKrw = Number.isFinite(rate) && rate > 0 ? rate : null;
    } catch {
      usdKrw = null; // 미국 줄은 「가격 못 받음」
    }
  }
  return { prices, usdKrw };
};

let priceSource: PriceSource = tossPriceBook;

/** 시험이 가짜 가격을 끼운다(null = 토스) */
export function setAssetPriceSourceForTest(fn: PriceSource | null): void {
  priceSource = fn ?? tossPriceBook;
}

/** 시트 한 번(30초 캐시) + 가격 한 번 — 하루 기록이 두 갈래(연금 뺌 · 포함)를 함께 계산하려고 나눴다 */
export async function loadInputs(): Promise<{ data: AssetSheetData; book: PriceBook; settings: AssetSettings }> {
  const data = await readAssetSheet();
  return { data, book: await priceSource(data), settings: readAssetSettings(data) };
}

/** `GET /api/asset/summary` — 카드 · 분류별 · 코어/위성 · 어제보다(가장 최근 하루 기록) */
export async function assetSummary(includePension: boolean): Promise<AssetSummary> {
  const { data, book, settings } = await loadInputs();
  const c = computeAssetTotals(data, book, settings, includePension);
  const last = latestRecord();
  const lastTotal = last ? (includePension ? last.totalPension : last.total) : null;
  return {
    readAt: data.readAt,
    pricedAt: new Date().toISOString(),
    includePension,
    totals: c.totals,
    profit: c.profit,
    vsLast: last && lastTotal != null ? { day: last.day, amount: c.totals.total - lastTotal, ratio: lastTotal > 0 ? (c.totals.total - lastTotal) / lastTotal : null } : null,
    missingNames: c.missingNames,
    settings,
    accounts: accountValues(data, book),
    bySymbol: holdingsBySymbol(data, book, settings, includePension, c.totals.total),
    stockChoices: stockChoices(data, settings),
    rebalance: computeRebalance(c.totals, data.targetRatio, settings.rebalanceBand),
    targetRatio: data.targetRatio,
    writeEnabled: isAssetSyncEnabled(),
    monthlyBuy: monthlyBuyOf(data.salary, data.targetRatio, (day) => accountDateTexts(data, day)),
  };
}
