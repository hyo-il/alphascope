/**
 * 로그인 문지기 — **모든 `/api` 라우트보다 먼저** 선다.
 *
 * ⚠️ **"로컬 요청이면 통과" 같은 예외를 두지 않는다.** 오라클은 nginx 가 모든 요청을
 * `127.0.0.1` 에서 보내므로, 그런 예외는 곧 **인증 전체 해제**다.
 * ⚠️ **비밀번호가 정해지지 않았으면 열어 두지 않고 전부 막는다.** "아직 설정 전이니 통과"
 * 는 서버를 올린 순간부터 비밀번호를 정할 때까지 무방비로 두는 것이다.
 */

import type express from 'express';
import { isPasswordSet, readSessionCookie, touchSession } from './auth';

/** 로그인 없이 지나갈 수 있는 것 — 딱 셋이다 */
const OPEN: { method: string; path: string }[] = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'GET', path: '/api/auth/me' },
  // 버전 배너용. 버전 문자열뿐이라 열어 둔다 (화면이 "서버가 옛 버전" 을 알려야 한다).
  { method: 'GET', path: '/api/version' },
];

const isOpen = (req: express.Request) =>
  OPEN.some((o) => o.method === req.method && o.path === req.path);

// ── 무차별 대입 막기 ─────────────────────────────────────────────────────────

/*
 * 메모리에만 둔다 — 서버를 다시 시작하면 초기화된다(허용).
 * IP 별로 막고, **전체 합계로도** 한 번 더 막는다. IP 를 바꿔 가며 시도하는 경우 대비다.
 */
const WINDOW_MS = 15 * 60_000;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;

interface Bucket {
  count: number;
  firstAt: number;
}
const perIp = new Map<string, Bucket>();
let global: Bucket = { count: 0, firstAt: Date.now() };

function bump(bucket: Bucket): Bucket {
  const now = Date.now();
  if (now - bucket.firstAt > WINDOW_MS) return { count: 1, firstAt: now };
  return { count: bucket.count + 1, firstAt: bucket.firstAt };
}

function blockedFor(bucket: Bucket | undefined, limit: number): number {
  if (!bucket) return 0;
  const now = Date.now();
  if (now - bucket.firstAt > WINDOW_MS) return 0;
  if (bucket.count < limit) return 0;
  return Math.ceil((WINDOW_MS - (now - bucket.firstAt)) / 60_000);
}

/** 지금 이 IP 가 로그인 시도를 할 수 있는가 — 막혀 있으면 남은 분 */
export function loginBlockedMinutes(ip: string): number {
  return Math.max(blockedFor(perIp.get(ip), PER_IP_LIMIT), blockedFor(global, GLOBAL_LIMIT));
}

export function recordLoginFailure(ip: string): void {
  perIp.set(ip, bump(perIp.get(ip) ?? { count: 0, firstAt: Date.now() }));
  global = bump(global);
  // ⚠️ 시각·IP 만 남긴다. 입력한 비밀번호는 절대 남기지 않는다.
  console.warn(`[auth] 로그인 실패 ${new Date().toISOString()} ip=${ip}`);
}

export function recordLoginSuccess(ip: string): void {
  perIp.delete(ip);
}

// ── 미들웨어 ─────────────────────────────────────────────────────────────────

/** 로컬 개발 서버 (Vite 5173 · API 4000 …) */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * 이 오리진이 **우리 것**인가 — CORS 와 CSRF 가 같은 정의를 쓴다(두 벌이면 갈라진다).
 *
 * ⚠️ `Host` 하나만 보고 판단하면 **프록시 뒤에서 깨진다.** Vite 의 `changeOrigin: true` 는
 * Host 를 업스트림(4100)으로 바꿔 버려 브라우저의 Origin(5173)과 달라진다 — 실제로 개발
 * 화면의 로그인이 403 으로 막혔다(검증 중 발견). 그래서 `X-Forwarded-Host` 와 로컬 개발
 * 오리진까지 함께 본다.
 */
export function isOwnOrigin(req: express.Request, origin: string): boolean {
  if (LOCAL_ORIGIN.test(origin) || extraOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).host;
    const forwarded = req.headers['x-forwarded-host'];
    return host === req.headers.host || host === forwarded;
  } catch {
    return false;
  }
}

/**
 * CSRF — 상태를 바꾸는 요청에 `Origin` 이 있으면 우리 오리진이어야 한다.
 * 쿠키가 `SameSite=Lax` 라 이미 대부분 막히지만, 한 겹 더 둔다.
 */
function originMismatch(req: express.Request): boolean {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return false;
  const origin = req.headers.origin;
  if (!origin) return false; // curl 등 브라우저가 아닌 요청
  return !isOwnOrigin(req, origin);
}

export function authGuard(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.path.startsWith('/api')) return next();

  if (originMismatch(req)) {
    return res.status(403).json({ error: '허용되지 않은 요청입니다.' });
  }

  /*
    비밀번호 미설정 = 앱 전체 잠금. 로그인도 할 수 없다(정할 비밀번호가 없으므로).
    `/api/version` 만 열어 둬 화면이 버전 배너를 그릴 수 있게 한다.
  */
  if (!isPasswordSet()) {
    if (req.method === 'GET' && req.path === '/api/version') return next();
    return res.status(503).json({
      error: '서버에서 `npm run auth:set-password` 로 비밀번호를 먼저 정하세요.',
      authNotConfigured: true,
    });
  }

  if (isOpen(req)) return next();

  const token = readSessionCookie(req);
  if (!token || !touchSession(token)) {
    return res.status(401).json({ error: '로그인이 필요합니다.', authRequired: true });
  }

  return next();
}
