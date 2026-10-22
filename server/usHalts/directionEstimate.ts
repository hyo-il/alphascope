/**
 * LULD 정지 방향 **추정** — 위로 멈췄나(상승 중 정지) · 아래로 멈췄나(하락 중 정지).
 *
 * RSS 에는 상한 / 하한 칸이 없고 `PauseThresholdPrice` 는 늘 빈칸이다(62차 조사). 그래서 토스 1분봉으로 짐작한다:
 * - 정지 시각 직전 봉(정지가 들어 있는 1분 칸까지)의 종가 vs **그 5분 전 봉**(5~7분 앞 — 그보다 멀면 쓰지 않는다)의 종가 — LULD 가격 범위가 「직전 5분 평균가」 기준이라
 *   5분 동안 어느 쪽으로 움직였는지가 어느 쪽 끝에 닿았는지와 가장 가깝다.
 * - 오르면 up · 내리면 down. 같거나 · 봉이 모자라거나 · 직전 봉이 정지보다 2분 넘게 앞서거나(거래가 뜸해 그 사이 값을 모름) ·
 *   토스에 없는 종목(카탈로그 밖 · 404)이면 unknown.
 * - 결과는 추정이다 — 정답 칸이 없어 맞았는지 확인할 수 없다. 매매에 쓰지 않는다.
 *
 * 정지 전 5분 거래대금(v2.56.1) — **같은 1분봉 한 번으로** 낸다(LULD 가 아닌 정지도 이것 때문에 한 번 부른다 · 방향은 LULD 만):
 * - 정지가 들어 있는 1분 칸 **앞의 1분 칸 5개**(봉 시각 ∈ [정지 칸 − 5분, 정지 칸)) 의 Σ(종가 × 거래량). 토스 거래량 = 주식 수 → 달러.
 * - 그 5칸에 봉이 하나도 없으면 0(거래 없음). 단 받은 봉이 아예 없거나(토스 반영 지연과 구별할 수 없다) 5칸 안 봉의 거래량이 숫자가 아니면 null(모름) —
 *   0 은 숨기기 대상이라 「모름」 을 0 으로 적지 않는다. 토스에 없음 · 404 · 받기 실패 · 모의 모드도 null.
 * - ⚠️ **정지 1건당 토스 호출 1번**(`tossGet` 한 번 — 429 · 5xx 의 재시도는 `tossGet` 의 것). 실패해도 다시 부르지 않는다.
 */
import { fetchCandlePage } from '../../src/services/toss/market';
import { TossApiError } from '../../src/services/toss/httpClient';
import type { Candle } from '../../src/types/toss';
import type { DirectionUnknownReason } from '../../src/types/usHalts';

const MINUTE = 60_000;
/** 한 번에 받는 1분봉 수 — 정지 앞 15분(5분 전 봉을 찾기에 넉넉하다) */
export const ESTIMATE_BARS = 15;
/** 직전 봉이 정지보다 이만큼 넘게 앞서면 판정하지 않는다 */
const STALE_MS = 2 * MINUTE;
/** 거래대금을 더하는 구간 — 정지 칸 앞 5분 */
const TURNOVER_MS = 5 * MINUTE;

export type EstimateFetcher = (symbol: string, haltAtMs: number) => Promise<Candle[]>;

/** 실제 받기 — 정지가 들어 있는 1분 칸까지 오도록 `before` = 정지 + 1분 */
export const tossMinuteBars: EstimateFetcher = async (symbol, haltAtMs) =>
  (await fetchCandlePage(symbol, '1m', ESTIMATE_BARS, new Date(haltAtMs + MINUTE).toISOString())).candles;

export interface DirectionEstimateResult {
  est: 'up' | 'down' | 'unknown';
  detail: {
    reason?: DirectionUnknownReason;
    lastBar?: { t: string; close: number };
    baseBar?: { t: string; close: number };
    error?: string;
  };
}

/** 받은 봉으로 판정 — 시험이 가짜 봉으로 부른다 */
export function judgeDirection(bars: Candle[], haltAtMs: number): DirectionEstimateResult {
  // 정지가 들어 있는 1분 칸까지(봉 시각 = 그 1분의 시작)
  const before = bars.filter((b) => b.timestamp <= haltAtMs).sort((a, b) => a.timestamp - b.timestamp);
  const last = before.at(-1);
  if (!last) return { est: 'unknown', detail: { reason: 'few_bars' } };
  if (haltAtMs - last.timestamp > STALE_MS) return { est: 'unknown', detail: { reason: 'stale', lastBar: barOf(last) } };
  // 5~7분 앞의 봉만 — 거래가 뜸해 더 먼 봉(장 전 봉 등)과 비교하면 「직전 5분」 근거에서 벗어난다
  const base = [...before].reverse().find((b) => b.timestamp <= last.timestamp - 5 * MINUTE && b.timestamp >= last.timestamp - 7 * MINUTE);
  if (!base) return { est: 'unknown', detail: { reason: 'few_bars', lastBar: barOf(last) } };
  const detail = { lastBar: barOf(last), baseBar: barOf(base) };
  if (last.close > base.close) return { est: 'up', detail };
  if (last.close < base.close) return { est: 'down', detail };
  return { est: 'unknown', detail: { ...detail, reason: 'flat' } };
}

const barOf = (b: Candle) => ({ t: new Date(b.timestamp).toISOString(), close: b.close });

/** 정지 전 5분 거래대금(달러) — 5칸에 봉이 없으면 0, 받은 봉이 아예 없거나 거래량을 모르면 null. 시험이 가짜 봉으로 부른다 */
export function turnoverBefore(bars: Candle[], haltAtMs: number): number | null {
  if (!bars.length) return null;
  const haltMinute = Math.floor(haltAtMs / MINUTE) * MINUTE;
  const inWindow = bars.filter((b) => b.timestamp >= haltMinute - TURNOVER_MS && b.timestamp < haltMinute);
  if (inWindow.some((b) => !Number.isFinite(b.volume) || !Number.isFinite(b.close))) return null;
  return inWindow.reduce((sum, b) => sum + b.close * b.volume, 0);
}

export interface HaltAnalysis {
  /** LULD 일 때만 */
  direction: DirectionEstimateResult | null;
  /** 정지 전 5분 거래대금(달러) — null = 모름 */
  turnover5mUsd: number | null;
}

/** 한 정지 — 1분봉을 많아야 한 번 받아 방향(LULD 만)과 거래대금을 함께 낸다 */
export async function analyzeHalt(
  symbol: string,
  haltAtMs: number,
  opts: { luld: boolean; inToss: boolean; mock: boolean; fetcher?: EstimateFetcher },
): Promise<HaltAnalysis> {
  const unknown = (detail: DirectionEstimateResult['detail']): HaltAnalysis => ({
    direction: opts.luld ? { est: 'unknown', detail } : null,
    turnover5mUsd: null,
  });
  if (opts.mock) return unknown({ reason: 'mock' });
  if (!opts.inToss) return unknown({ reason: 'not_in_toss' });
  let bars: Candle[];
  try {
    bars = await (opts.fetcher ?? tossMinuteBars)(symbol, haltAtMs);
  } catch (e) {
    if (e instanceof TossApiError && e.status === 404) return unknown({ reason: 'not_found' });
    return unknown({ reason: 'fetch_failed', error: (e as Error).message.slice(0, 200) });
  }
  return { direction: opts.luld ? judgeDirection(bars, haltAtMs) : null, turnover5mUsd: turnoverBefore(bars, haltAtMs) };
}
