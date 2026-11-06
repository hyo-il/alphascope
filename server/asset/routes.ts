/*
  자산 관리(v2.61.0 · v2.62.0) 주소 — 모두 로그인 문지기(`authGuard`) 뒤다. `server/index.ts` 가 `app.use(assetRouter)` 로 붙인다(주소는 전체 경로 그대로).
  - 자산 문지기(`assetGuard`)는 이 라우터 맨 앞 **한 곳**에서 모든 `/api/asset/*` 를 막는다 — 잠겨 있으면 403 `asset-locked`.
    빠지는 것은 `status` · `unlock` · `lock` 셋뿐이다(라우트마다 따로 검사하지 않는다).
  - ⚠️ 응답 · 로그에 자산 값(금액 · 수량 · 종목)을 찍지 않는다. 실패 로그는 이유 종류만.
*/
import { Router, type Request, type Response, type NextFunction } from 'express';
import { readSessionCookie } from '../auth';
import { assetLimiter, isAssetPasswordSet, isUnlocked, lockSession, unlockSession, verifyAssetPassword } from './lock';
import { isSheetConfigured } from './config';
import { AssetSheetError } from './google';
import { readAssetSheet, writeAssetClass } from './sheet';
import type { AssetSheetErrorKind, AssetSheetFailure, AssetStatus } from '../../src/types/asset';

export const assetRouter = Router();

const OPEN = new Set(['GET /api/asset/status', 'POST /api/asset/unlock', 'POST /api/asset/lock']);
const isAssetPath = (p: string) => p === '/api/asset' || p.startsWith('/api/asset/');

/** 자산 문지기 — 자산 비밀번호가 없거나 이 로그인 세션이 풀지 않았으면 403 `asset-locked` */
export function assetGuard(req: Request, res: Response, next: NextFunction) {
  if (!isAssetPath(req.path)) return next();
  if (OPEN.has(`${req.method} ${req.path}`)) return next();
  if (!isUnlocked(readSessionCookie(req))) {
    return res.status(403).json({ error: '자산 관리가 잠겨 있습니다.', code: 'asset-locked' });
  }
  return next();
}

assetRouter.use(assetGuard);

assetRouter.get('/api/asset/status', (req, res) => {
  const body: AssetStatus = {
    passwordSet: isAssetPasswordSet(),
    unlocked: isUnlocked(readSessionCookie(req)),
    sheetConfigured: isSheetConfigured(),
  };
  res.json(body);
});

/** 잠금 풀기 — 맞음 / 틀림(401 `asset-wrong` · 로그인 문지기의 401 과 달리 `authRequired` 없음) / 막힘(429 `asset-blocked` · 남은 분) */
assetRouter.post('/api/asset/unlock', async (req, res) => {
  const token = readSessionCookie(req);
  // 로그인 문지기를 지나왔으면 늘 있다 — 혹시 없으면 로그인 문지기와 같은 응답
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.', authRequired: true });
  if (!isAssetPasswordSet()) {
    return res.status(403).json({ error: '자산 비밀번호가 아직 없습니다.', code: 'asset-no-password' });
  }
  const ip = req.ip ?? 'unknown';
  const blocked = assetLimiter.blockedMinutes(ip);
  if (blocked > 0) {
    return res.status(429).json({ error: `잠시 후 다시 시도하세요 — ${blocked}분`, code: 'asset-blocked', minutes: blocked });
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !(await verifyAssetPassword(password))) {
    assetLimiter.recordFailure(ip);
    return res.status(401).json({ error: '비밀번호가 맞지 않습니다.', code: 'asset-wrong' });
  }
  assetLimiter.recordSuccess(ip);
  unlockSession(token);
  res.json({ ok: true });
});

assetRouter.post('/api/asset/lock', (req, res) => {
  lockSession(readSessionCookie(req));
  res.json({ ok: true });
});

/**
 * 시트에서 읽은 값(1단계 확인 표) — 화면을 열 때 · 「다시 읽기」 때만. 30초 캐시(`sheet.ts`).
 * 실패는 쉬운 말 + 이유 종류 — 연결 정보 · 열쇠 파일은 503(이 서버 설정), 구글 쪽은 502.
 */
assetRouter.get('/api/asset/sheet', async (_req, res) => {
  try {
    res.json(await readAssetSheet());
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/**
 * 자산 분류 한 칸 쓰기 — `{ row, assetClass }`(「티커」 줄 번호 · 네 글자 또는 빈칸). 성공하면 다시 읽은 시트 값.
 * 칸 · 값 · 수식 칸 · 스위치 확인은 `writeAssetClass` 한 곳.
 */
assetRouter.put('/api/asset/class', async (req, res) => {
  try {
    res.json(await writeAssetClass(req.body?.row, req.body?.assetClass));
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/** 이유 종류 → HTTP — 이 서버 설정(연결 정보 · 열쇠 · 스위치)은 503, 요청이 틀림은 400, 수식 칸은 409, 구글 쪽은 502 */
const STATUS: Partial<Record<AssetSheetErrorKind, number>> = { 'not-configured': 503, 'key-file': 503, disabled: 503, 'not-editable': 400, 'formula-cell': 409 };

/** 실패 응답 — 쉬운 말 + 이유 종류. ⚠️ 로그에는 이유 종류만(시트 값 · 응답 본문 · 경로를 찍지 않는다) */
export function sendSheetError(res: Response, e: unknown, action: string): void {
  if (e instanceof AssetSheetError) {
    console.warn(`[asset] 시트 ${action} 실패: ${e.kind}`);
    const body: AssetSheetFailure = { error: e.message, kind: e.kind };
    res.status(STATUS[e.kind] ?? 502).json(body);
    return;
  }
  console.warn(`[asset] 시트 ${action} 실패: 알 수 없는 오류`);
  const body: AssetSheetFailure = { error: `시트를 ${action === '쓰기' ? '쓰지' : '읽지'} 못했습니다.`, kind: 'network' };
  res.status(502).json(body);
}
