import { RATE_LIMITS, type RateLimitGroup } from '../../utils/constants';

/**
 * 토큰 버킷 Rate Limiter.
 * 그룹별로 버킷을 하나씩 두고, 초당 한도만큼 연속적으로 토큰을 채운다.
 * 토큰이 없으면 채워질 때까지 대기해 호출 자체를 지연시킨다 (드롭하지 않음).
 */
class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly capacity: number) {
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.capacity);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    // 대기 중인 호출이 몰려도 순차적으로 하나씩 토큰을 가져가도록 루프를 돈다.
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      const waitMs = Math.ceil((deficit / this.capacity) * 1000) + 5;
      await sleep(waitMs);
    }
  }

  /** 서버가 알려준 잔여 한도로 버킷을 보정한다 (X-RateLimit-Remaining) */
  syncRemaining(remaining: number) {
    this.refill();
    if (Number.isFinite(remaining)) {
      this.tokens = Math.min(this.tokens, Math.max(0, remaining));
    }
  }
}

const buckets = new Map<RateLimitGroup, TokenBucket>();

function bucketFor(group: RateLimitGroup): TokenBucket {
  let bucket = buckets.get(group);
  if (!bucket) {
    bucket = new TokenBucket(RATE_LIMITS[group].perSecond);
    buckets.set(group, bucket);
  }
  return bucket;
}

/** 해당 그룹의 토큰 1개를 확보할 때까지 대기 */
export function acquire(group: RateLimitGroup): Promise<void> {
  return bucketFor(group).acquire();
}

/** 응답 헤더의 X-RateLimit-Remaining 으로 로컬 버킷을 보정 */
export function syncFromHeaders(group: RateLimitGroup, headers: Headers | Record<string, unknown>) {
  const raw =
    headers instanceof Headers
      ? headers.get('x-ratelimit-remaining')
      : (headers['x-ratelimit-remaining'] as string | undefined);
  if (raw == null) return;
  const remaining = Number(raw);
  if (!Number.isNaN(remaining)) bucketFor(group).syncRemaining(remaining);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
