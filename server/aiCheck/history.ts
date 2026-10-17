/**
 * AI 검증 기록·채점 — 계좌 화면 「AI 검증 기록」 · 「퀀트 > 검증 기록 > AI 검증」(모든 계좌 또는 계좌 하나).
 *
 * 채점은 **저장하지 않고 읽을 때** 캔들에서 구한다(Gemini 적중률 · 매수 판단 성과와 같은 방식 — 기준을 고쳐도 옛 기록까지 같은 기준으로).
 * 수익률 = 검증 때 가격(`price_at_check`) → 검증한 날(그 종목 시장 날짜) 뒤 N번째 거래일 **종가**. 끝난 봉만 쓴다.
 * 「위험으로 막은 것」 과 「통과해서 산 것」 을 같은 기준으로 비교하는 것이라 비용은 빼지 않는다.
 */
import { getCandles } from '../candleService';
import { loadCandles } from '../db';
import { completedDaily } from '../rules/engine';
import { marketDate } from '../../src/utils/marketDate';
import {
  AI_CHECK_OUTCOME_DAYS,
  type AiCheckHistory,
  type AiCheckRecord,
  type AiGroupStats,
  type AiOutcomeDays,
} from '../../src/types/aiCheck';
import { countUses, listUses, type UseRow } from './store';

type Bar = { timestamp: number; close: number };

/** 검증한 날 뒤 N번째 끝난 거래일 종가로 낸 수익률(%) — 그날 봉이 아직 없거나 N일이 안 지났으면 null */
export function checkReturns(bars: Bar[], completedCount: number, symbol: string, checkDay: string, priceAtCheck: number | null): Record<AiOutcomeDays, number | null> {
  const out = {} as Record<AiOutcomeDays, number | null>;
  // 검증한 날 「뒤」 의 첫 봉 위치 — 그날 봉이 캐시에 없어도(휴장 등) 뒤 봉부터 센다
  const firstAfter = bars.findIndex((b) => marketDate(b.timestamp, symbol) > checkDay);
  for (const n of AI_CHECK_OUTCOME_DAYS) {
    const idx = firstAfter < 0 ? -1 : firstAfter + n - 1;
    const exit = idx >= 0 && idx < completedCount ? bars[idx] : undefined;
    out[n] = exit && priceAtCheck && priceAtCheck > 0 ? Math.round((exit.close / priceAtCheck - 1) * 10_000) / 100 : null;
  }
  return out;
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

function groupStats(rows: AiCheckRecord[]): AiGroupStats {
  const n = {} as AiGroupStats['n'];
  const a = {} as AiGroupStats['avg'];
  for (const d of AI_CHECK_OUTCOME_DAYS) {
    const xs = rows.map((r) => r.returns[d]).filter((v): v is number => v != null);
    n[d] = xs.length;
    a[d] = avg(xs);
  }
  return { n, avg: a };
}

function toRecord(r: UseRow, returns: AiCheckRecord['returns'], accounts?: AiCheckRecord['accounts']): AiCheckRecord {
  return {
    useId: r.use_id,
    checkId: r.id,
    marketDate: r.market_date,
    symbol: r.symbol,
    verdict: r.verdict,
    reasons: JSON.parse(r.reasons_json) as string[],
    unavailableReason: r.unavailable_reason,
    action: r.action,
    priceAtCheck: r.price_at_check,
    returns,
    createdAt: r.used_at,
    accounts: accounts ?? [{ accountId: r.account_id, action: r.action }],
  };
}

/**
 * 모든 계좌 보기(A-6) — 같은 검증(check)을 여러 계좌가 썼으면 **한 줄**로 묶는다(AI 호출은 한 번이다).
 * 그 줄의 행동은 한 계좌라도 샀으면 「샀음」, 계좌별 행동은 `accounts` 에. 채점은 계좌 하나 보기와 **같은 함수**(`checkReturns`·`groupStats`).
 */
function groupByCheck(rows: UseRow[]): { row: UseRow; accounts: AiCheckRecord['accounts'] }[] {
  const byCheck = new Map<number, { row: UseRow; accounts: AiCheckRecord['accounts'] }>();
  for (const r of rows) {
    const g = byCheck.get(r.id);
    if (!g) byCheck.set(r.id, { row: r, accounts: [{ accountId: r.account_id, action: r.action }] });
    else {
      if (!g.accounts.some((a) => a.accountId === r.account_id)) g.accounts.push({ accountId: r.account_id, action: r.action });
      else if (r.action === 'bought') g.accounts = g.accounts.map((a) => (a.accountId === r.account_id ? { ...a, action: 'bought' } : a));
      if (r.action === 'bought') g.row = { ...g.row, action: 'bought' };
    }
  }
  return [...byCheck.values()].map((g) => ({ ...g, accounts: [...g.accounts].sort((a, b) => a.accountId - b.accountId) }));
}

/**
 * 계좌 하나(또는 `accountId` null = 모든 계좌)의 기록 — 표는 최근 `limit` 건(+ offset), 채점 한 줄은 **고른 범위 전체**로.
 * 성과가 아직 다 안 나온 종목만 일봉을 새로 받는다(종목마다 한 번, 실패하면 캐시로).
 */
export async function aiCheckHistory(accountId: number | null, limit = 50, offset = 0, now = Date.now()): Promise<AiCheckHistory> {
  const uses = countUses(accountId);
  const all = listUses(accountId, Math.max(uses, 1), 0);
  const groups = accountId == null ? groupByCheck(all) : all.map((row) => ({ row, accounts: undefined }));
  const total = groups.length;
  const recentCut = (s: string) => marketDate(now - 40 * 86_400_000, s);
  const pending = [...new Set(all.filter((r) => r.market_date >= recentCut(r.symbol)).map((r) => r.symbol))];
  for (const s of pending) await getCandles(s, '1d', 60).catch(() => []);
  const cache = new Map<string, { bars: Bar[]; completed: number }>();
  const barsOf = (s: string) => {
    let c = cache.get(s);
    if (!c) {
      const bars = loadCandles(s, '1d', 400);
      c = { bars, completed: completedDaily(bars, s, now).length };
      cache.set(s, c);
    }
    return c;
  };
  const records = groups.map(({ row: r, accounts }) => {
    const { bars, completed } = barsOf(r.symbol);
    return toRecord(r, checkReturns(bars, completed, r.symbol, r.market_date, r.price_at_check), accounts);
  });
  return {
    rows: records.slice(offset, offset + limit),
    total,
    stats: {
      blocked: groupStats(records.filter((r) => r.verdict === 'risk' && r.action === 'skipped')),
      passed: groupStats(records.filter((r) => r.verdict === 'pass' && r.action === 'bought')),
      unavailable: records.filter((r) => r.verdict === 'unavailable').length,
    },
  };
}
