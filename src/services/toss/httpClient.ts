import { RETRY, type RateLimitGroup } from '../../utils/constants';
import { getAccessToken, invalidateToken } from './auth';
import { acquire, sleep, syncFromHeaders } from './rateLimiter';

export class TossApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'TossApiError';
  }
}

function backoffDelay(attempt: number): number {
  const exponential = RETRY.baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.random() * RETRY.baseDelayMs;
  return Math.min(RETRY.maxDelayMs, exponential + jitter);
}

/**
 * 인증 + Rate Limit + 재시도(지수 백오프)를 모두 처리하는 토스 API GET 요청.
 * - 429: Retry-After 헤더를 우선 존중
 * - 401: 토큰 무효화 후 1회 재발급 재시도
 * - 5xx / 네트워크 오류: 지수 백오프 재시도
 */
export async function tossGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  group: RateLimitGroup,
  /** 계좌 관련 엔드포인트는 x-tossinvest-account 헤더를 요구한다. */
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const baseUrl = process.env.TOSS_BASE_URL ?? 'https://openapi.tossinvest.com';
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY.maxAttempts; attempt++) {
    try {
      const token = await getAccessToken();
      await acquire(group);

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...extraHeaders,
        },
      });

      syncFromHeaders(group, res.headers);

      if (res.ok) return (await res.json()) as T;

      const body = await res.text().catch(() => '');

      if (res.status === 401) {
        invalidateToken();
        lastError = new TossApiError('인증 실패 — 토큰 재발급 후 재시도', 401, body);
        continue;
      }

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffDelay(attempt);
        lastError = new TossApiError('Rate limit 초과', 429, body);
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        lastError = new TossApiError(`서버 오류 (${res.status})`, res.status, body);
        await sleep(backoffDelay(attempt));
        continue;
      }

      // 4xx 는 재시도해도 동일하므로 즉시 실패시킨다.
      throw new TossApiError(
        `토스 API 요청 실패 (${res.status}) ${url.pathname}: ${body.slice(0, 300)}`,
        res.status,
        body,
      );
    } catch (e) {
      if (e instanceof TossApiError && e.status < 500 && e.status !== 429 && e.status !== 401) {
        throw e;
      }
      lastError = e;
      if (attempt < RETRY.maxAttempts) await sleep(backoffDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`토스 API 요청 실패: ${String(lastError)}`);
}
