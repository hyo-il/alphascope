/**
 * 자산 관리 잠금 (v2.61.0) — 로그인과 **같은 방식 · 다른 비밀번호**.
 *
 * - 해시 · 비교는 로그인과 같은 함수(`server/auth.ts` `storePassword` · `checkPassword`)에 설정 키만 `asset.password` 로 준다.
 * - 무차별 대입 막기도 로그인과 같은 수치(15분 · IP 당 5번 · 전체 30번)의 **따로 세는 통**(`createAttemptLimiter`).
 * - 비밀번호는 서버 명령 `npm run asset:set-password` 로만 정한다 — 화면에서 정하거나 바꾸는 길은 없다.
 * - 풀린 상태는 **서버 메모리에만** (로그인 세션 → 마지막으로 화면을 쓴 시각 `lastActiveAt`)으로 둔다. 로그아웃 · 세션 끝(다시 로그인하면 새 세션) ·
 *   서버 재시작 · 「잠그기」 → 다시 잠김. 세션은 토큰 원문이 아니라 해시(`sessionKeyOf`)로 가리킨다.
 * - 잠금 시간(v2.65.4 · 설정 `asset.lockMinutes` — 10 · 30 · 60 · 0 = 끄기 · 처음 값 30): 자산 요청을 받을 때 `지금 − lastActiveAt > 잠금 시간` 이면
 *   **그 세션을 잠그고** 잠김으로 본다(문지기가 `asset-locked` — 지금 잠김 응답과 같은 모양 · `status` 는 `idleLocked`).
 *   ⚠️ 10초 폴링(summary)은 화면을 쓴 것이 아니다 — `lastActiveAt` 을 늘리는 것은 ① 풀기 ② `POST /api/asset/touch` ③ 쓰기 요청뿐(`routes.ts` `ACTIVE`).
 * ⚠️ 비밀번호가 정해지지 않았으면 풀 수 없다 — 자산 API 는 전부 막힌다(열어 두지 않는다 · `authGuard.ts` 머리 주석과 같은 원칙).
 */
import { checkPassword, isPasswordSetFor, sessionKeyOf, storePassword, type PasswordKey } from '../auth';
import { createAttemptLimiter } from '../authGuard';
import { readLockMinutes } from './settings';

export const ASSET_PASSWORD_KEY: PasswordKey = 'asset.password';

/** 자산 잠금 풀기 시도 막기 — 로그인과 따로 센다 */
export const assetLimiter = createAttemptLimiter('[asset] 자산 잠금 풀기');

/** 풀린 로그인 세션(토큰 해시) → 마지막으로 화면을 쓴 시각(ms) */
const unlockedSessions = new Map<string, number>();
/** 쓰지 않아 저절로 잠긴 세션 — 다시 풀거나 「잠그기」 까지(잠금 화면 안내 한 줄) */
const idleLockedSessions = new Set<string>();

let clock: () => number = () => Date.now();
/** 시험이 시계를 바꿔 끼운다(null = 실제) */
export function setLockClockForTest(now: (() => number) | null): void {
  clock = now ?? (() => Date.now());
}

export const isAssetPasswordSet = () => isPasswordSetFor(ASSET_PASSWORD_KEY);

/** 자산 비밀번호를 정한다 — 로그인 비밀번호 · 세션은 건드리지 않는다. 이 프로세스의 풀림은 모두 잠근다 */
export async function setAssetPassword(password: string): Promise<void> {
  await storePassword(ASSET_PASSWORD_KEY, password);
  unlockedSessions.clear();
  idleLockedSessions.clear();
}

export const verifyAssetPassword = (password: string) => checkPassword(ASSET_PASSWORD_KEY, password);

/**
 * 이 세션의 잠금 상태 — 잠금 시간이 지났으면 **여기서 잠근다**(그 뒤로는 잠김 · `idleLocked`).
 * `remainingMs` = 저절로 잠길 때까지 남은 ms(풀려 있고 잠금 시간이 켜져 있을 때만).
 */
export function lockStateOf(token: string | null): { unlocked: boolean; lockMinutes: number; remainingMs: number | null; idleLocked: boolean } {
  const lockMinutes = readLockMinutes();
  if (token == null || !isAssetPasswordSet()) return { unlocked: false, lockMinutes, remainingMs: null, idleLocked: false };
  const key = sessionKeyOf(token);
  const last = unlockedSessions.get(key);
  if (last == null) return { unlocked: false, lockMinutes, remainingMs: null, idleLocked: idleLockedSessions.has(key) };
  if (lockMinutes === 0) return { unlocked: true, lockMinutes, remainingMs: null, idleLocked: false };
  const idle = clock() - last;
  const limit = lockMinutes * 60_000;
  if (idle > limit) {
    unlockedSessions.delete(key);
    idleLockedSessions.add(key);
    return { unlocked: false, lockMinutes, remainingMs: null, idleLocked: true };
  }
  return { unlocked: true, lockMinutes, remainingMs: limit - idle, idleLocked: false };
}

export const isUnlocked = (token: string | null): boolean => lockStateOf(token).unlocked;

export function unlockSession(token: string): void {
  const key = sessionKeyOf(token);
  unlockedSessions.set(key, clock());
  idleLockedSessions.delete(key);
}

/** 화면을 쓴 것으로 센다(풀린 세션만 — 잠긴 세션은 늘리지 않는다) */
export function touchSession(token: string | null): void {
  if (!token) return;
  const key = sessionKeyOf(token);
  if (unlockedSessions.has(key)) unlockedSessions.set(key, clock());
}

export function lockSession(token: string | null): void {
  if (!token) return;
  const key = sessionKeyOf(token);
  unlockedSessions.delete(key);
  idleLockedSessions.delete(key);
}
