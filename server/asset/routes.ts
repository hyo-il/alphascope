/*
  자산 관리(v2.61.0 · v2.62.0 · v2.64.0 구매 완료 · v2.65.0 시트 가격) 주소 — 모두 로그인 문지기(`authGuard`) 뒤다. `server/index.ts` 가 `app.use(assetRouter)` 로 붙인다(주소는 전체 경로 그대로).
  - 자산 문지기(`assetGuard`)는 이 라우터 맨 앞 **한 곳**에서 모든 `/api/asset/*` 를 막는다 — 잠겨 있으면 403 `asset-locked`.
    빠지는 것은 `status` · `unlock` · `lock` 셋뿐이다(라우트마다 따로 검사하지 않는다).
  - ⚠️ 응답 · 로그에 자산 값(금액 · 수량 · 종목)을 찍지 않는다. 실패 로그는 이유 종류만.
*/
import { Router, type Request, type Response, type NextFunction } from 'express';
import { readSessionCookie } from '../auth';
import { assetLimiter, isAssetPasswordSet, isUnlocked, lockSession, unlockSession, verifyAssetPassword } from './lock';
import { isAssetSyncEnabled, isSheetConfigured } from './config';
import { AssetSheetError } from './google';
import { readAssetSheet, writeAccountDates, writeAssetClasses, writeTargetRatio } from './sheet';
import { currentCycle } from './purchase';
import { assetSummary } from './summary';
import { checkSheetSwitchSafe, sheetSwitchedAt } from './sheetSwitch';
import { convertSheetPrices, restoreSheetPrices } from './priceSheet';
import { historyPoints, isHistoryRange, recordPurchase } from './store';
import { writeAssetSettings } from './settings';
import type { AssetSheetErrorKind, AssetSheetFailure, AssetStatus, PurchaseDoneResult } from '../../src/types/asset';

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

/** 시트가 바뀌었나(v2.65.1) — 자산 요청마다 해시를 견준다(같으면 설정 한 줄 읽기뿐 · 다르면 한 번 정리 — `sheetSwitch.ts`) */
assetRouter.use((req, _res, next) => {
  if (isAssetPath(req.path)) checkSheetSwitchSafe();
  next();
});

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
 * 자산 분류 쓰기(v2.65.2 — 여러 줄 한 요청) — `{ rows: number[], assetClass }`(「티커」 줄 번호들 · 채권 · 금 · 주식 또는 빈칸). 성공하면 다시 읽은 시트 값.
 * 한 줄 고르기도 `rows: [n]`. 옛 모양 `{ row }` 는 받지 않는다(400 not-editable). 칸 · 값 · 수식 칸 · 스위치 확인은 `writeAssetClasses` 한 곳.
 */
assetRouter.put('/api/asset/class', async (req, res) => {
  try {
    res.json(await writeAssetClasses(req.body?.rows, req.body?.assetClass));
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/**
 * 목표 비율 여섯 칸 쓰기(v2.63.0) — `{ cash, bond, gold, invest, core, satellite }`(정수 %). 성공하면 다시 읽은 시트 값.
 * 스위치 · 값 · 합 · 머리 글자 · 수식 칸 · 다시 읽어 같은지 확인은 `writeTargetRatio` 한 곳.
 */
assetRouter.put('/api/asset/target-ratio', async (req, res) => {
  try {
    res.json(await writeTargetRatio(req.body));
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/**
 * 「구매 완료」(v2.64.0) — 이번 구매 차례(오늘 기준 가장 최근에 지난 구매일)를 완료로 기록하고, 시트 「주식 투자 정리」 계좌 이름의
 * 「( 날짜 )」 를 **그 차례의 날짜**(`YYYY.MM` 모양이면 차례의 달 — 늦게 눌러도 · v2.64.1)로 바꾼다. 되돌리기 없음(날짜는 사용자가 시트에서 직접 고친다). 순서:
 * ① 스위치 꺼짐 → 503 `disabled` ② 시작 전 차례 → 409 `before-start` ③ 이번 차례가 이미 완료 → 409 `already-done` ④ 시트 쓰기(`writeAccountDates`)
 * ⑤ **시트 쓰기가 성공했을 때만** `asset_purchase` 에 한 줄(`done_at` = 누른 날). 같은 서버에서 동시에 두 번 누르면 뒤의 것은 409(쓰기 한 번).
 */
let purchaseBusy = false;
assetRouter.post('/api/asset/purchase-done', async (_req, res) => {
  try {
    if (!isAssetSyncEnabled()) throw new AssetSheetError('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
    const before = currentCycle();
    if (before.skipped) throw new AssetSheetError('before-start', `이 기능을 쓰기 전 구매 차례라 기록하지 않습니다 — 다음 구매일 ${before.nextDay}`);
    if (before.done || purchaseBusy) throw new AssetSheetError('already-done', `이미 구매 완료를 눌렀습니다(${before.doneDay ?? '저장 중'}).`);
    purchaseBusy = true;
    try {
      const { cells } = await writeAccountDates(before.cycleDay);
      recordPurchase(before.cycleDay, before.today);
      const body: PurchaseDoneResult = { cycleDay: before.cycleDay, doneDay: before.today, cells };
      res.json(body);
    } finally {
      purchaseBusy = false;
    }
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/**
 * 시트 가격(v2.65.0) — [시트 가격을 토스로 바꾸기](이미 토스면 남은 종목) · [되돌리기]. 성공하면 「시트 가격」 상태(summary 의 `priceSheet` 와 같은 모양).
 * 스위치(`ASSET_PRICE_WRITE_ENABLED` · `ASSET_SYNC_ENABLED`) · 머리 글자 · 칸 모양 · 백업 · 한 요청 · 다시 읽기 확인은 `priceSheet.ts` 한 곳.
 */
assetRouter.post('/api/asset/price-source/convert', async (_req, res) => {
  try {
    res.json(await convertSheetPrices());
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});
assetRouter.post('/api/asset/price-source/restore', async (_req, res) => {
  try {
    res.json(await restoreSheetPrices());
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/** 총 자산 · 분류별 · 코어/위성 · 어제보다 — 화면이 열린 동안 10초마다(시트는 30초 캐시 · 가격은 토스 /prices 한 번 + 환율 60초 캐시) */
assetRouter.get('/api/asset/summary', async (req, res) => {
  try {
    res.json(await assetSummary(req.query.pension === '1'));
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 하루 기록 — 총 자산 선 차트(기간 1m · 3m · 1y · all) */
assetRouter.get('/api/asset/history', (req, res) => {
  const range = req.query.range ?? '1m';
  if (!isHistoryRange(range)) return res.status(400).json({ error: '기간은 1m · 3m · 1y · all 중 하나입니다.' });
  res.json({ range, points: historyPoints(range, req.query.pension === '1'), since: sheetSwitchedAt() });
});

/**
 * 설정 창 — `{ pensionSections?, satelliteSymbols?, classColors?, rebalanceBand? }`(연금으로 볼 계좌 · 위성으로 선택한 종목 · 자산 분류 색 · 비율 조정 범위).
 * 계좌 · 종목 코드는 지금 시트에 있는 것만이라 시트를 먼저 읽는다(30초 캐시). 검사는 `writeAssetSettings` 한 곳.
 */
assetRouter.put('/api/asset/settings', async (req, res) => {
  try {
    const saved = writeAssetSettings(req.body, await readAssetSheet());
    if (!saved) return res.status(400).json({ error: '설정 값이 올바르지 않습니다 — 시트에 없는 계좌 · 종목이거나 고를 수 없는 색 · 범위(1~20 정수 밖)입니다.' });
    res.json(saved);
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 이유 종류 → HTTP — 이 서버 설정(연결 정보 · 열쇠 · 스위치)은 503, 요청이 틀림은 400, 수식 칸 · 날짜 없음 · 이미 구매 완료 · 시작 전 차례 · 시트 가격(도는 중 · 바꿀 줄 없음 · 백업 없음)은 409, 구글 쪽은 502 */
const STATUS: Partial<Record<AssetSheetErrorKind, number>> = { 'not-configured': 503, 'key-file': 503, disabled: 503, 'not-editable': 400, 'formula-cell': 409, 'no-date': 409, 'already-done': 409, 'before-start': 409, busy: 409, 'no-rows': 409, 'no-backup': 409 };

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
