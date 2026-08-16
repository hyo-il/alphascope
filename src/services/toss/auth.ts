import type { TossTokenResponse } from '../../types/toss';
import { TOKEN_REFRESH_MARGIN_MS } from '../../utils/constants';
import { acquire, syncFromHeaders } from './rateLimiter';

/**
 * 토스증권 OAuth 2.0 (Client Credentials Grant) 토큰 관리.
 * - 최초 요청 시 발급
 * - 만료 10분 전 자동 갱신 (타이머)
 * - 동시 요청이 겹쳐도 발급은 한 번만 (inflight 공유)
 *
 * 이 모듈은 서버 프로세스에서만 import 한다. CLIENT_SECRET 은 브라우저로 나가면 안 된다.
 */

interface CachedToken {
  accessToken: string;
  /** epoch ms */
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

function config() {
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;
  const baseUrl = process.env.TOSS_BASE_URL ?? 'https://openapi.tossinvest.com';
  if (!clientId || !clientSecret) {
    throw new Error(
      'TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 이 설정되지 않았습니다. .env 파일을 확인하세요.',
    );
  }
  return { clientId, clientSecret, baseUrl };
}

async function requestToken(): Promise<CachedToken> {
  const { clientId, clientSecret, baseUrl } = config();
  await acquire('AUTH');

  // OAuth 2.0 표준대로 form-urlencoded 로 보낸다. JSON 본문은 400 invalid_request 로 거절된다.
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  syncFromHeaders('AUTH', res.headers);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`토큰 발급 실패 (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as TossTokenResponse;
  if (!data.access_token) {
    throw new Error('토큰 응답에 access_token 이 없습니다.');
  }

  const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  return { accessToken: data.access_token, expiresAt };
}

function scheduleRefresh(token: CachedToken) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // 만료 10분 전, 최소 30초 뒤에 갱신
  const delay = Math.max(30_000, token.expiresAt - Date.now() - TOKEN_REFRESH_MARGIN_MS);
  refreshTimer = setTimeout(() => {
    void getAccessToken(true).catch((e) => {
      console.error('[toss/auth] 토큰 자동 갱신 실패:', e);
      // 실패해도 다음 요청 시 재시도되므로 캐시를 비워둔다.
      cached = null;
    });
  }, delay);
  refreshTimer.unref?.();
}

/** 유효한 access token 을 반환한다. 필요하면 발급/갱신한다. */
export async function getAccessToken(forceRefresh = false): Promise<string> {
  const stillValid =
    cached && !forceRefresh && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now();
  if (stillValid) return cached!.accessToken;

  inflight ??= requestToken()
    .then((token) => {
      cached = token;
      scheduleRefresh(token);
      return token;
    })
    .finally(() => {
      inflight = null;
    });

  const token = await inflight;
  return token.accessToken;
}

/** 401 응답을 받았을 때 캐시를 버리고 다음 요청에서 재발급하도록 한다. */
export function invalidateToken() {
  cached = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
}
