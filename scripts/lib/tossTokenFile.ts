/**
 * 점검 도구(`ussample:run` · `ussample:judge`)가 같이 쓰는 토스 토큰 파일.
 *
 * 서버 토큰은 서버 프로세스 메모리에만 있어 나눠 쓸 수 없다. 대신 받은 토큰을 기록 폴더의 파일(권한 600)에 두고 만료 10분 전까지
 * 다시 쓴다 — 발급은 1시간에 한 번쯤. 발급이 실패하면 그 실행은 더 발급하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { setTokenStore, type CachedToken } from '../../src/services/toss/auth';

/** 기록 파일과 같은 폴더의 토큰 파일 */
export const tokenFileOf = (sampleFile: string) => path.join(path.dirname(sampleFile), '.toss-token.json');

/**
 * 받은 토큰을 파일에 둔다(권한 600) — 다음 실행이 다시 쓴다. **한 번 실행에 발급 시도는 1번까지**(실패 · 네트워크 오류 포함) —
 * 401 이 나서 다시 받아야 하면 그 회차는 멈춘다(토스가 새 발급 때 예전 토큰을 끊는다면 서버와 서로 끊는 일이 5분에 한 번을 넘지 않게).
 */
export function fileTokenStore(file: string) {
  let attempts = 0;
  return {
    canIssue: () => attempts++ < 1,
    load(): CachedToken | null {
      try {
        const t = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedToken;
        return typeof t.accessToken === 'string' && typeof t.expiresAt === 'number' ? t : null;
      } catch {
        return null;
      }
    },
    save(token: CachedToken) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // 이미 있던 파일은 mode 가 적용되지 않는다 — 쓰기 전에 권한부터 좁힌다
      if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
      fs.writeFileSync(file, JSON.stringify(token), { mode: 0o600 });
    },
    clear() {
      fs.rmSync(file, { force: true });
    },
  };
}

/** 이 실행의 토스 토큰을 기록 폴더의 파일로 — 기록 파일 경로를 넘긴다 */
export function useTokenFile(sampleFile: string): void {
  setTokenStore(fileTokenStore(tokenFileOf(sampleFile)));
}
