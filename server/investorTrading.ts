/**
 * 투자자 동향 (국내 종목) — 라우트와 Gemini 입력이 함께 쓰는 한 곳 (v2.23.0).
 *
 * - **국내 종목이 아니면 토스를 부르지 않는다**(`isKrSymbol`) — 미국 종목은 API 가 400 이고, 요청 자체가 낭비다.
 * - 캐시(종목별, 메모리 + 진행 중 요청 공유): 일별 데이터라 짧게 둔다.
 *   KST 09:00~21:00 은 **5분** — 장중 잠정치가 갱신되고, 확정치(개인·기타법인)는 **그날 저녁**에 들어온다.
 *   ⚠️ 지시서의 "장 마감 뒤에는 다음 장 시작까지" 를 그대로 따르면 15:30 에 받은 잠정치(개인 없음)를
 *   밤새 들고 있게 된다 — 그래서 21:00 까지는 5분을 유지하고, 그 뒤 받은 값만 다음 09:00 까지 둔다.
 * - 20 **확정일**을 채우려고 21건을 받는다(당일 잠정 1건이 섞일 수 있다).
 */

import { fetchInvestorTrading } from '../src/services/toss/market';
import { isKrSymbol } from '../src/utils/market';
import { FLOW_DAYS, flowPeriod, sumFlow, type InvestorFlow } from '../src/utils/investorFlow';

const SHORT_TTL_MS = 5 * 60_000;
const KST_OFFSET_MS = 9 * 3_600_000;

const cache = new Map<string, { at: number; expires: number; flow: InvestorFlow }>();
const inflight = new Map<string, Promise<InvestorFlow>>();

/** 이 시각에 받은 값을 언제까지 쓸까 */
export function flowExpiry(now: number): number {
  const kst = new Date(now + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  if (hour >= 9 && hour < 21) return now + SHORT_TTL_MS;
  // 21:00 이후·09:00 이전 — 다음 09:00 KST 까지
  const next = new Date(kst);
  next.setUTCHours(9, 0, 0, 0);
  if (hour >= 21) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - KST_OFFSET_MS;
}

export class FlowUnsupportedError extends Error {}

/** 국내 종목의 최근 동향 — 국내가 아니면 FlowUnsupportedError(토스 호출 없음) */
export async function getInvestorFlow(symbol: string, now = Date.now()): Promise<InvestorFlow> {
  const key = symbol.toUpperCase();
  if (!isKrSymbol(key)) throw new FlowUnsupportedError('투자자 동향은 국내 종목만 제공됩니다(토스 API 제공 범위)');

  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.flow;
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const records = await fetchInvestorTrading(key, FLOW_DAYS + 1);
    const flow: InvestorFlow = {
      symbol: key,
      records,
      sums: sumFlow(records),
      period: flowPeriod(records),
      updatedAt: records[0]?.updatedAt ?? null,
    };
    cache.set(key, { at: now, expires: flowExpiry(now), flow });
    return flow;
  })();
  inflight.set(key, request);
  try {
    return await request;
  } finally {
    inflight.delete(key);
  }
}
