/**
 * 일별 자산 변화 「무엇 때문에」 계산 한 곳(v2.70.0) — **순수 함수**(DB · DOM 없음). 서버(`GET /api/asset/history`)와 시험이 함께 쓴다.
 *
 * 입력: 앞 기록 P · 그날 기록 D · P 기록 시각 뒤 ~ D 기록 시각 전의 매수 · 매도 입력(`asset_trades`) · 「연금 포함」 여부.
 * 결과의 몫(원 정수)을 모두 더하면 **총 자산 변화(반올림한 D − 반올림한 P)와 원 단위까지 같다** — 반올림 · 나눌 수 없는 나머지는 「기타」.
 *
 * - 순매수 N(사고판 금액) = 산 금액 − 판 금액(원화 — 미국 매매는 D 환율, 없으면 P 환율, 둘 다 없으면 가까운 기록의 환율 · 그것도 없으면 그 매매는 빼고 「대략」).
 *   매매는 현금 → 종목으로 돈을 옮긴 것이라 총 자산에는 0 — 그래서 몫이 아니라 따로(`traded`) 보여 준다.
 *   매매의 묶음(채권 · 금 · 주식 · 미지정)은 D(없으면 P)의 같은 계좌 · 같은 종목 줄 — 종목별 기록이 없으면 「주식」.
 * - C-1(지난 날짜 · 한쪽이라도 환율 · 종목별 기록이 없음) — 묶음별:
 *   「주식 값」 = 주식 변화 − 주식 순매수 · 「입금 · 출금」 = 현금 변화 + 순매수 · 「채권」 · 「금」 · 「미지정」 = 그 묶음 변화 − 그 묶음 순매수 · 「퇴직 연금」 = 변화 그대로.
 * - C-2(두 날 모두 환율 · 종목별 기록) — 「주식 값」 을 더 나눈다(분류 「주식」 줄만 · 두 날 모두 가격을 받은 같은 계좌 · 같은 종목):
 *   「주가」 = P 수량 × (D 가격 − P 가격) × P 환율(국내 1) · 「환율」 = 미국 줄 P 수량 × D 가격 × (D 환율 − P 환율)
 *   · 수량이 바뀐 몫(매매 · 시트에서 고친 수량) · 새 종목 · 다 판 종목 · 가격 못 받은 줄은 「기타」(순매수는 「입금 · 출금」 쪽에서 맞춘다).
 *   「많이 바뀐 종목」 = 같은 종목 코드를 계좌를 합쳐 주가 + 환율 몫 · 절댓값 큰 것부터 3개.
 * - 비교하지 않음: 앞 기록 없음(`first`) · 시트를 바꾼 뒤 첫 기록(`sheet-switched` — P 기록 시각 < 바꾼 시각 ≤ D 기록 시각, 또는 바꾼 뒤 첫 줄).
 * - 가격 못 받은 줄이 있는 날: 계산은 하되 `missing`(두 날 중 큰 쪽)을 보여 「정확하지 않음」.
 * ⚠️ 금액 · 수량을 로그에 찍지 않는다(이 파일은 로그가 없다).
 */
import { ASSET_DAILY_SHARE_LABEL, type AssetDailyChange, type AssetDailyHolding, type AssetDailyMover, type AssetDailyShare, type AssetDailyShareKey, type AssetGroupKey, type AssetTotals } from '../../src/types/asset';

/** 기록 한 줄(`store.allRecords` 와 같은 모양) */
export interface ChangeRecord {
  day: string;
  recordedAt: string;
  plain: AssetTotals;
  pension: AssetTotals;
  fxUsdKrw: number | null;
  holdings: AssetDailyHolding[] | null;
}

/** 매매 한 줄(`asset_trades` 에서 쓰는 칸만) */
export interface ChangeTrade {
  at: string;
  section: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  currency: 'KRW' | 'USD';
}

export interface ChangeOptions {
  includePension: boolean;
  /** 「연금으로 볼 계좌」(매매 줄이 연금 계좌인지 — 연금 뺌이면 그 매매는 빼고 셈) */
  pensionSections: string[];
  /** 마지막으로 시트를 바꾼 시각(ISO) — 없으면 null */
  sheetSwitchedAt: string | null;
  /** D · P 모두 환율이 없을 때 쓰는 가까운 기록의 환율 — 없으면 null(미국 매매는 빼고 「대략」) */
  fallbackFx: number | null;
}

const totalsOf = (r: ChangeRecord, includePension: boolean): AssetTotals => (includePension ? r.pension : r.plain);
const groupAmount = (t: AssetTotals, key: AssetGroupKey): number => t.groups.find((g) => g.key === key)?.amount ?? 0;
const holdingKey = (h: { section: string; symbol: string | null; name?: string }): string => `${h.section}|${h.symbol ?? `name:${h.name ?? ''}`}`;
const usable = (r: ChangeRecord, includePension: boolean): AssetDailyHolding[] | null => (r.holdings ? r.holdings.filter((h) => includePension || !h.pension) : null);

/** 같은 계좌 · 같은 종목 줄을 하나로(수량 · 원화 합 · 가격은 첫 줄) */
function byKey(rows: AssetDailyHolding[]): Map<string, AssetDailyHolding> {
  const map = new Map<string, AssetDailyHolding>();
  for (const h of rows) {
    const k = holdingKey(h);
    const prev = map.get(k);
    if (!prev) {
      map.set(k, { ...h });
      continue;
    }
    prev.quantity = prev.quantity == null || h.quantity == null ? (prev.quantity ?? h.quantity) : prev.quantity + h.quantity;
    prev.krw = prev.krw == null || h.krw == null ? null : prev.krw + h.krw;
    prev.missing = prev.missing || h.missing;
  }
  return map;
}

/** 한 줄 비교 결과 — 앞 기록 P 와 그날 D */
export function dailyChangeOf(P: ChangeRecord | null, D: ChangeRecord, trades: ChangeTrade[], opts: ChangeOptions): AssetDailyChange {
  const dT = totalsOf(D, opts.includePension);
  const total = Math.round(dT.total);
  const base: AssetDailyChange = { day: D.day, total, prevDay: null, change: null, ratio: null, shares: [], traded: null, movers: [], split: false, approx: false, missing: dT.missing, skip: null, note: null };
  if (!P) return { ...base, skip: opts.sheetSwitchedAt ? 'sheet-switched' : 'first' };
  if (opts.sheetSwitchedAt && P.recordedAt < opts.sheetSwitchedAt && opts.sheetSwitchedAt <= D.recordedAt) return { ...base, skip: 'sheet-switched' };

  const pT = totalsOf(P, opts.includePension);
  const change = total - Math.round(pT.total);
  const ratio = pT.total > 0 ? change / Math.round(pT.total) : null;
  const pRows = usable(P, opts.includePension);
  const dRows = usable(D, opts.includePension);
  const pMap = pRows ? byKey(pRows) : null;
  const dMap = dRows ? byKey(dRows) : null;

  // ── 순매수(묶음별) ──
  const tradeFx = D.fxUsdKrw ?? P.fxUsdKrw ?? opts.fallbackFx;
  let approx = false;
  const netBy: Partial<Record<AssetGroupKey, number>> = {};
  let anyTrade = false;
  for (const t of trades) {
    if (!(P.recordedAt < t.at && t.at < D.recordedAt)) continue;
    if (!opts.includePension && opts.pensionSections.includes(t.section)) continue;
    let krw = t.qty * t.price;
    if (t.currency === 'USD') {
      if (tradeFx == null) {
        approx = true;
        continue;
      }
      if (D.fxUsdKrw == null && P.fxUsdKrw == null) approx = true;
      krw *= tradeFx;
    }
    const k = holdingKey({ section: t.section, symbol: t.symbol });
    const group = dMap?.get(k)?.group ?? pMap?.get(k)?.group ?? 'stock';
    netBy[group] = (netBy[group] ?? 0) + (t.side === 'buy' ? krw : -krw);
    anyTrade = true;
  }
  const net = (g: AssetGroupKey) => netBy[g] ?? 0;
  const netAll = Object.values(netBy).reduce((a, b) => a + b, 0);

  const raw: [AssetDailyShareKey, number][] = [];
  const delta = (g: AssetGroupKey) => groupAmount(dT, g) - groupAmount(pT, g);
  raw.push(['flow', delta('cash') + netAll]);
  raw.push(['bond', delta('bond') - net('bond')]);
  raw.push(['gold', delta('gold') - net('gold')]);
  raw.push(['none', delta('none') - net('none')]);
  if (opts.includePension) raw.push(['retirement', delta('retirement')]);

  // ── C-2: 주가 · 환율로 나누기(두 날 모두 환율 · 종목별 기록) ──
  const split = pMap != null && dMap != null && P.holdings != null && D.holdings != null && (P.fxUsdKrw != null || !P.holdings.some((h) => h.market === 'US')) && (D.fxUsdKrw != null || !D.holdings.some((h) => h.market === 'US'));
  const movers: AssetDailyMover[] = [];
  if (split && pMap && dMap) {
    let price = 0;
    let fx = 0;
    const bySymbol = new Map<string, AssetDailyMover>();
    for (const [k, p] of pMap) {
      const d = dMap.get(k);
      if (!d || d.group !== 'stock' || p.missing || d.missing || p.price == null || d.price == null || p.quantity == null || p.currency !== d.currency) continue;
      const us = p.currency === 'USD';
      const pFx = us ? (P.fxUsdKrw ?? 0) : 1;
      const dFx = us ? (D.fxUsdKrw ?? 0) : 1;
      const priceShare = p.quantity * (d.price - p.price) * pFx;
      const fxShare = us ? p.quantity * d.price * (dFx - pFx) : 0;
      price += priceShare;
      fx += fxShare;
      if (d.symbol) {
        const m = bySymbol.get(d.symbol) ?? { symbol: d.symbol, name: d.name, amount: 0 };
        m.amount += priceShare + fxShare;
        bySymbol.set(d.symbol, m);
      }
    }
    raw.push(['price', price]);
    raw.push(['fx', fx]);
    movers.push(
      ...[...bySymbol.values()]
        .map((m) => ({ ...m, amount: Math.round(m.amount) }))
        .filter((m) => m.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 3),
    );
  } else {
    raw.push(['stock', delta('stock') - net('stock')]);
  }

  // 원 정수로 · 나머지(반올림 · 수량이 바뀐 몫 · 가격 못 받은 줄)는 「기타」 — 합 = change
  const shares: AssetDailyShare[] = raw.map(([key, v]) => ({ key, label: ASSET_DAILY_SHARE_LABEL[key], amount: Math.round(v) }));
  const other = change - shares.reduce((a, s) => a + s.amount, 0);
  shares.push({ key: 'other', label: ASSET_DAILY_SHARE_LABEL.other, amount: other });

  return {
    ...base,
    prevDay: P.day,
    change,
    ratio,
    shares: shares.filter((s) => s.amount !== 0),
    traded: anyTrade ? Math.round(netAll) : null,
    movers,
    split,
    approx,
    missing: Math.max(dT.missing, pT.missing),
  };
}

/** 모든 기록(날짜 순)을 줄마다 바로 앞 기록과 견준다 — 결과도 날짜 순 */
export function dailyChanges(records: ChangeRecord[], trades: ChangeTrade[], opts: Omit<ChangeOptions, 'fallbackFx'>): AssetDailyChange[] {
  return records.map((D, i) => {
    const P = i > 0 ? records[i - 1] : null;
    return dailyChangeOf(P, D, trades, { ...opts, fallbackFx: nearestFx(records, i) });
  });
}

/** i 번째 기록에서 가장 가까운(날짜 순 거리) 기록의 환율 — 없으면 null */
function nearestFx(records: ChangeRecord[], i: number): number | null {
  for (let d = 0; d < records.length; d++) {
    for (const j of [i - d, i + d]) {
      const fx = records[j]?.fxUsdKrw;
      if (fx != null && Number.isFinite(fx) && fx > 0) return fx;
    }
  }
  return null;
}
