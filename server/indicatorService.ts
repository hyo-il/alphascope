import type { Candle } from '../src/types/toss';
import type { IndicatorSeries } from '../src/types/chart';

/**
 * Python 지표 엔진(python/indicators.py) 브릿지.
 *
 * 별도 HTTP 서비스로 띄워 두고 호출한다. 매 요청마다 프로세스를 새로 띄우면
 * pandas import 만으로 1초 이상 걸리기 때문이다.
 */

const INDICATORS_URL =
  process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

export class IndicatorEngineError extends Error {}

export async function computeIndicators(candles: Candle[]): Promise<IndicatorSeries> {
  let res: Response;
  try {
    res = await fetch(`${INDICATORS_URL}/indicators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candles }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new IndicatorEngineError(
      `지표 엔진에 연결하지 못했습니다 (${INDICATORS_URL}). ` +
        '`npm run dev` 로 함께 띄우거나 `npm run dev:py` 를 실행하세요. ' +
        `원인: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const payload = (await res.json()) as IndicatorSeries & { error?: string };
  if (!res.ok || payload.error) {
    throw new IndicatorEngineError(payload.error ?? `지표 계산 실패 (${res.status})`);
  }
  return payload;
}

/** 지표 엔진이 떠 있는지 확인 */
export async function indicatorEngineHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${INDICATORS_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
