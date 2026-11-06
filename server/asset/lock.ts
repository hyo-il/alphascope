/**
 * 자산 관리 잠금 (v2.61.0) — 로그인과 **같은 방식 · 다른 비밀번호**.
 *
 * - 해시 · 비교는 로그인과 같은 함수(`server/auth.ts` `storePassword` · `checkPassword`)에 설정 키만 `asset.password` 로 준다.
 * - 무차별 대입 막기도 로그인과 같은 수치(15분 · IP 당 5번 · 전체 30번)의 **따로 세는 통**(`createAttemptLimiter`).
 * - 비밀번호는 서버 명령 `npm run asset:set-password` 로만 정한다 — 화면에서 정하거나 바꾸는 길은 없다.
 * - 풀린 상태는 **서버 메모리에만** (로그인 세션 → 풀림)으로 둔다. 로그아웃 · 세션 끝(다시 로그인하면 새 세션) · 서버 재시작 · 「잠그기」 → 다시 잠김.
 *   세션은 토큰 원문이 아니라 해시(`sessionKeyOf`)로 가리킨다.
 * ⚠️ 비밀번호가 정해지지 않았으면 풀 수 없다 — 자산 API 는 전부 막힌다(열어 두지 않는다 · `authGuard.ts` 머리 주석과 같은 원칙).
 */
import { checkPassword, isPasswordSetFor, sessionKeyOf, storePassword, type PasswordKey } from '../auth';
import { createAttemptLimiter } from '../authGuard';

export const ASSET_PASSWORD_KEY: PasswordKey = 'asset.password';

/** 자산 잠금 풀기 시도 막기 — 로그인과 따로 센다 */
export const assetLimiter = createAttemptLimiter('[asset] 자산 잠금 풀기');

/** 풀린 로그인 세션(토큰 해시) */
const unlockedSessions = new Set<string>();

export const isAssetPasswordSet = () => isPasswordSetFor(ASSET_PASSWORD_KEY);

/** 자산 비밀번호를 정한다 — 로그인 비밀번호 · 세션은 건드리지 않는다. 이 프로세스의 풀림은 모두 잠근다 */
export async function setAssetPassword(password: string): Promise<void> {
  await storePassword(ASSET_PASSWORD_KEY, password);
  unlockedSessions.clear();
}

export const verifyAssetPassword = (password: string) => checkPassword(ASSET_PASSWORD_KEY, password);

export function isUnlocked(token: string | null): boolean {
  return token != null && isAssetPasswordSet() && unlockedSessions.has(sessionKeyOf(token));
}

export function unlockSession(token: string): void {
  unlockedSessions.add(sessionKeyOf(token));
}

export function lockSession(token: string | null): void {
  if (token) unlockedSessions.delete(sessionKeyOf(token));
}
