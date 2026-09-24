/**
 * 주인 계정 로그인 — **회원가입은 없다.**
 *
 * 이 앱은 혼자 쓰는 도구다. 회원제로 만들면 모든 테이블에 사용자 구분이 붙어 앱 전체를
 * 건드려야 하고, 비밀번호 찾기 같은 화면이 오히려 뚫릴 구멍이 된다.
 * 그래서 **비밀번호 하나**만 두고, 그 값은 서버에서 `npm run auth:set-password` 로만 정한다.
 *
 * ⚠️ 새 의존성을 들이지 않는다 — 해시는 Node 내장 `crypto.scrypt`, 쿠키는 직접 읽고 쓴다.
 * ⚠️ **평문 비밀번호는 어디에도 남기지 않는다** (로그·DB·에러 메시지 모두).
 */

import crypto from 'node:crypto';
import type express from 'express';
import { getDb } from './db';

const OWNER_KEY = 'auth.owner';
export const SESSION_COOKIE = 'as_session';

/** 세션 수명. 자주 쓰면 아래 `touch` 가 계속 늘려 준다. */
const SESSION_DAYS = 30;
/** 남은 기간이 이보다 짧아지면 다시 30일로 늘린다 (매 요청 쓰기를 피하려는 것) */
const RENEW_BELOW_DAYS = 15;

/**
 * scrypt 파라미터. **저장값에 함께 적어 둔다** — 나중에 강도를 올려도 옛 비밀번호를
 * 그대로 검증할 수 있어야 한다.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

interface OwnerRecord {
  salt: string;
  hash: string;
  params: { N: number; r: number; p: number; keylen: number };
  updatedAt: string;
}

// ── 비밀번호 ─────────────────────────────────────────────────────────────────

function readOwner(): OwnerRecord | null {
  const row = getDb()
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(OWNER_KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as OwnerRecord;
  } catch {
    return null;
  }
}

/** 비밀번호가 정해져 있는가 — 아니면 앱 전체가 잠긴다 (열어 두지 않는다) */
export function isPasswordSet(): boolean {
  return readOwner() !== null;
}

function derive(password: string, salt: Buffer, params: OwnerRecord['params']): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      params.keylen,
      { N: params.N, r: params.r, p: params.p },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/**
 * 비밀번호를 정한다(바꾼다). **기존 세션은 모두 끊는다** —
 * 비밀번호를 바꾸는 이유는 대개 유출 의심이라, 남아 있는 세션을 살려 두면 의미가 없다.
 */
export async function setPassword(password: string): Promise<void> {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt, SCRYPT);
  const record: OwnerRecord = {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    params: { ...SCRYPT },
    updatedAt: new Date().toISOString(),
  };

  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(OWNER_KEY, JSON.stringify(record));
    db.prepare(`DELETE FROM auth_sessions`).run();
  })();
}

/** 비밀번호 확인. 맞으면 true — **무엇이 틀렸는지 구분해 알리지 않는다.** */
export async function verifyPassword(password: string): Promise<boolean> {
  const owner = readOwner();
  if (!owner) return false;
  try {
    const expected = Buffer.from(owner.hash, 'base64');
    const actual = await derive(password, Buffer.from(owner.salt, 'base64'), owner.params);
    // 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 거른다.
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── 세션 ─────────────────────────────────────────────────────────────────────

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const addDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

export function createSession(userAgent: string | undefined): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (token_hash, created_at, last_seen_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(sha256(token), now, now, addDays(SESSION_DAYS), (userAgent ?? '').slice(0, 200));
  return token;
}

/** 세션이 살아 있으면 true. 곧 만료될 것 같으면 기간을 늘린다. */
export function touchSession(token: string): boolean {
  const hash = sha256(token);
  const row = getDb()
    .prepare(`SELECT expires_at FROM auth_sessions WHERE token_hash = ?`)
    .get(hash) as { expires_at: string } | undefined;
  if (!row) return false;

  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    getDb().prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(hash);
    return false;
  }

  const now = new Date().toISOString();
  const remainingDays = (expires - Date.now()) / 86_400_000;
  if (remainingDays < RENEW_BELOW_DAYS) {
    getDb()
      .prepare(`UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?`)
      .run(now, addDays(SESSION_DAYS), hash);
  } else {
    getDb().prepare(`UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?`).run(now, hash);
  }
  return true;
}

export function deleteSession(token: string): void {
  getDb().prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(sha256(token));
}

export function deleteAllSessions(): number {
  return getDb().prepare(`DELETE FROM auth_sessions`).run().changes;
}

export function countSessions(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM auth_sessions`).get() as { n: number };
  return row.n;
}

/** 만료된 세션 청소 — 서버 시작 때와 하루 1회 */
export function purgeExpiredSessions(): number {
  return getDb()
    .prepare(`DELETE FROM auth_sessions WHERE expires_at <= ?`)
    .run(new Date().toISOString()).changes;
}

// ── 쿠키 ─────────────────────────────────────────────────────────────────────

/** cookie-parser 를 들이지 않는다 — 우리가 읽을 쿠키는 하나뿐이다 */
export function readSessionCookie(req: express.Request): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * ⚠️ `Secure` 는 **https 로 들어온 요청일 때만** 붙인다.
 * 맥의 `http://localhost` 개발에서 무조건 붙이면 브라우저가 쿠키를 버려 로그인이 안 된다.
 * 오라클은 지금 http 라 붙지 않고(정상), 나중에 nginx 가 `X-Forwarded-Proto` 를 넘기면
 * `req.secure` 가 true 가 되어 **코드 변경 없이** 붙는다.
 */
export function setSessionCookie(req: express.Request, res: express.Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_DAYS * 86_400}`,
  ];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const parts = [`${SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
