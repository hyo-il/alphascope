/*
  자산 관리(v2.61.0 · v2.62.0 · v2.64.0 구매 완료(v2.78.0 계좌마다) · v2.65.0 시트 가격) 주소 — 모두 로그인 문지기(`authGuard`) 뒤다. `server/index.ts` 가 `app.use(assetRouter)` 로 붙인다(주소는 전체 경로 그대로).
  - 자산 문지기(`assetGuard`)는 이 라우터 맨 앞 **한 곳**에서 모든 `/api/asset/*` 를 막는다 — 잠겨 있으면 403 `asset-locked`.
    빠지는 것은 `status` · `unlock` · `lock` 셋뿐이다(라우트마다 따로 검사하지 않는다).
  - 잠금 시간(v2.65.4): 잠겼는지 볼 때 잠금 시간이 지났으면 그 세션을 잠근다(`lock.ts` `lockStateOf`). 통과한 요청 중 `ACTIVE`(touch · 쓰기)만
    「화면을 쓴 것」 으로 `lastActiveAt` 을 늘린다 — 10초 폴링(summary) · 읽기는 늘리지 않는다.
  - ⚠️ 응답 · 로그에 자산 값(금액 · 수량 · 종목)을 찍지 않는다. 실패 로그는 이유 종류만.
*/
import { Router, type Request, type Response, type NextFunction } from 'express';
import { readSessionCookie } from '../auth';
import { assetLimiter, isAssetPasswordSet, isUnlocked, lockSession, lockStateOf, touchSession, unlockSession, verifyAssetPassword } from './lock';
import { assetSheetConfig, isAssetSyncEnabled, isSheetConfigured } from './config';
import { AssetSheetError, batchGet } from './google';
import { readAssetSheet, writeAccountDate, writeAssetClasses, writeTargetRatio } from './sheet';
import { purchaseAccountsInput, purchaseActionCheck, purchaseStateOf } from './purchase';
import { assetSummary, usdKrwNow } from './summary';
import { checkSheetSwitchSafe, sheetSwitchedAt } from './sheetSwitch';
import { convertSheetPrices, restoreSheetPrices } from './priceSheet';
import { allRecords, dailyNotes, historyPoints, isHistoryRange, purchaseMonthlyOff, recordPurchase, saveDailyNote, savePlanLink, savePurchaseMonthlyOff, undoPurchase } from './store';
import { readSavingTab, savingShapeOf } from './savingPlan';
import { readPensionSections, writeAssetSettings } from './settings';
import { listTrades, planNewHolding, recordNewHolding, recordTrade, tradesForChange } from './trade';
import { dailyChanges } from './dailyChange';
import { cashWide, isCashWriteOn, parseCashAmount, readCashSettings, tradeCash, undoCashMove, writeCashSettings } from './cashMoves';
import { buildCashPreview, buildCashView, cashSheetNow } from './cashView';
import { cashLines, cellNumber, findCashLine } from './cashKeys';
import { readCashBankFix, writeCashBankFix } from './cashBanks';
import { applyManualCash } from './cashManual';
import { kstDay } from './cashSchedule';
import { cashBankLabelOf, type AssetCashPairView, type AssetSheetCashBanks, type AssetSheetErrorKind, AssetSheetFailure, AssetStatus, AssetTouchResult, PurchaseActionRequest, PurchaseActionResult, PurchaseMonthlyRequest, PlanLinkRequest } from '../../src/types/asset';

export const assetRouter = Router();

const OPEN = new Set(['GET /api/asset/status', 'POST /api/asset/unlock', 'POST /api/asset/lock']);
/** 「화면을 쓴 것」 — `lastActiveAt` 을 늘리는 요청(풀기는 `unlockSession`). ⚠️ summary 폴링 · 읽기는 넣지 않는다 */
export const ACTIVE = new Set([
  'POST /api/asset/touch',
  'PUT /api/asset/class',
  'PUT /api/asset/settings',
  'PUT /api/asset/target-ratio',
  'POST /api/asset/purchase/done',
  'POST /api/asset/purchase/skip',
  'POST /api/asset/purchase/undo',
  'PUT /api/asset/purchase/monthly-accounts',
  'PUT /api/asset/purchase/plan-link',
  'POST /api/asset/price-source/convert',
  'POST /api/asset/price-source/restore',
  'POST /api/asset/trade',
  'POST /api/asset/trade/new',
  'POST /api/asset/trade/new/plan',
  'PUT /api/asset/daily-note',
  'PUT /api/asset/cash/settings',
  'POST /api/asset/cash/undo',
  'PUT /api/asset/cash/banks',
  'POST /api/asset/cash/manual',
]);
const isAssetPath = (p: string) => p === '/api/asset' || p.startsWith('/api/asset/');

/** 자산 문지기 — 자산 비밀번호가 없거나 이 로그인 세션이 풀지 않았거나 잠금 시간이 지났으면 403 `asset-locked` · 통과한 `ACTIVE` 요청은 시간을 늘린다 */
function assetGuard(req: Request, res: Response, next: NextFunction) {
  if (!isAssetPath(req.path)) return next();
  const route = `${req.method} ${req.path}`;
  if (OPEN.has(route)) return next();
  const token = readSessionCookie(req);
  if (!isUnlocked(token)) {
    return res.status(403).json({ error: '자산 관리가 잠겨 있습니다.', code: 'asset-locked' });
  }
  if (ACTIVE.has(route)) touchSession(token);
  return next();
}

/** 시트가 바뀌었나(v2.65.1) — 자산 요청마다 해시를 견준다(같으면 설정 한 줄 읽기뿐 · 다르면 한 번 정리 — `sheetSwitch.ts`) */
assetRouter.use((req, _res, next) => {
  if (isAssetPath(req.path)) checkSheetSwitchSafe();
  next();
});

assetRouter.use(assetGuard);

assetRouter.get('/api/asset/status', (req, res) => {
  // 묻기만 — 시간을 늘리지 않는다(잠금 시간이 지났으면 여기서 잠긴다)
  const lock = lockStateOf(readSessionCookie(req));
  const body: AssetStatus = {
    passwordSet: isAssetPasswordSet(),
    unlocked: lock.unlocked,
    sheetConfigured: isSheetConfigured(),
    lockMinutes: lock.lockMinutes,
    remainingMs: lock.remainingMs,
    idleLocked: lock.idleLocked,
  };
  res.json(body);
});

/** 화면을 쓴 것으로 셈(v2.65.4) — 화면이 사용자 입력이 있을 때 1분에 한 번 이하로 보낸다. 시간은 문지기가 늘린다(`ACTIVE`) */
assetRouter.post('/api/asset/touch', (req, res) => {
  const lock = lockStateOf(readSessionCookie(req));
  const body: AssetTouchResult = { ok: true, lockMinutes: lock.lockMinutes, remainingMs: lock.remainingMs };
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
    // 「현금 합계」 은행별 묶음의 고치기(앱에만 저장 · v2.71.1) · 계좌 머리 예수금 짝(v2.71.3 — 꺼져 있어도 · 앱 DB 만 읽음)을 함께
    const banks: AssetSheetCashBanks = { cashBankFix: readCashBankFix(), cashDepositPairs: readCashSettings().depositPairs };
    res.json({ ...(await readAssetSheet()), ...banks });
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/**
 * 자산 분류 쓰기(v2.65.2 — 여러 줄 한 요청) — `{ rows: number[], assetClass, codes?: string[] }`(「티커」 줄 번호들 · 채권 · 금 · 주식 또는 빈칸 · 줄마다 화면이 본 코드 — 그 사이 줄이 옮겨져도 맞는 줄에 쓴다). 성공하면 다시 읽은 시트 값.
 * 한 줄 고르기도 `rows: [n]`. 옛 모양 `{ row }` 는 받지 않는다(400 not-editable). 칸 · 값 · 수식 칸 · 스위치 확인은 `writeAssetClasses` 한 곳.
 */
assetRouter.put('/api/asset/class', async (req, res) => {
  try {
    res.json(await writeAssetClasses(req.body?.rows, req.body?.assetClass, req.body?.codes));
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
 * 이번 달 구매(v2.78.0 — 계좌마다) — 요청 몸 `{ cycleDay, section }`. 받을지는 `purchase.ts` `purchaseActionCheck` 한 곳
 * (화면 목록 · 팝업과 같은 `purchaseAccountsOf` 결과 — 처리할 수 없는 차례 409 · 모르는 계좌 · 매달 사지 않는 계좌 400).
 * - `done`: ① 스위치 꺼짐 → 503 `disabled`(이것만 막힘) ② 검사 ③ 같은 계좌가 처리 중 → 409 `busy` ④ `writeAccountDate`(그 계좌 칸 하나 —
 *   시트 날짜가 이미 그 차례 달 이후면 쓰지 않음) ⑤ **시트 쓰기가 성공했을 때만**(또는 쓸 필요가 없었을 때) 기록 `done`(누른 날).
 * - `skip`: 시트를 쓰지 않고 기록 `skip` · `undo`: 기록만 지움(**시트 날짜는 되돌리지 않는다**).
 * 같은 계좌를 동시에 두 번 누르면 뒤의 것은 409(쓰기 한 번).
 */
const purchaseBusy = new Set<string>();
type PurchaseRoute = 'done' | 'skip' | 'undo';
async function purchaseAction(action: PurchaseRoute, req: Request, res: Response): Promise<void> {
  try {
    if (action === 'done' && !isAssetSyncEnabled()) throw new AssetSheetError('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
    const { cycleDay, section } = (req.body ?? {}) as Partial<PurchaseActionRequest>;
    const state = purchaseStateOf(purchaseAccountsInput(await readAssetSheet()));
    const ok = purchaseActionCheck(state, action, cycleDay, section);
    if (!ok.ok) throw new AssetSheetError(ok.kind, ok.message);
    const day = cycleDay as string;
    const key = ok.account.section;
    if (purchaseBusy.has(key)) throw new AssetSheetError('busy', '그 계좌를 처리하는 중입니다 — 잠시 뒤 다시 보세요.');
    purchaseBusy.add(key);
    try {
      let body: PurchaseActionResult;
      if (action === 'undo') {
        if (!undoPurchase(day, key)) throw new AssetSheetError('not-yet', '되돌릴 기록이 없습니다.');
        body = { cycleDay: day, section: key, status: 'todo', at: state.today };
      } else if (action === 'skip') {
        if (!recordPurchase(day, key, 'skip', state.today)) throw new AssetSheetError('already-done', '이미 처리한 차례입니다.');
        body = { cycleDay: day, section: key, status: 'skip', at: state.today };
      } else {
        const w = await writeAccountDate(day, key);
        if (!recordPurchase(day, key, 'done', state.today)) throw new AssetSheetError('already-done', '이미 처리한 차례입니다.');
        body = { cycleDay: day, section: key, status: 'done', at: state.today, written: w.written, sheetDate: w.sheetDate };
      }
      res.json(body);
    } finally {
      purchaseBusy.delete(key);
    }
  } catch (e) {
    sendSheetError(res, e, action === 'done' ? '쓰기' : '기록');
  }
}
assetRouter.post('/api/asset/purchase/done', (req, res) => void purchaseAction('done', req, res));
assetRouter.post('/api/asset/purchase/skip', (req, res) => void purchaseAction('skip', req, res));
assetRouter.post('/api/asset/purchase/undo', (req, res) => void purchaseAction('undo', req, res));

/** 매달 사는 계좌(v2.78.0) — `{ section, monthly }` 계좌 하나를 켜고 끈다(앱 DB · 시트를 쓰지 않음). 시트에 없는 계좌는 400 */
assetRouter.put('/api/asset/purchase/monthly-accounts', async (req, res) => {
  try {
    const { section, monthly } = (req.body ?? {}) as Partial<PurchaseMonthlyRequest>;
    const keys = purchaseAccountsInput(await readAssetSheet()).map((a) => a.key);
    if (typeof section !== 'string' || !keys.includes(section) || typeof monthly !== 'boolean') throw new AssetSheetError('not-editable', '그 계좌를 시트에서 찾지 못했습니다.');
    const off = purchaseMonthlyOff().filter((k) => k !== section);
    savePurchaseMonthlyOff(monthly ? off : [...off, section]);
    res.json({ section, monthly });
  } catch (e) {
    sendSheetError(res, e, '기록');
  }
});

/**
 * 「적립식 투자」 줄 이름 → 종목 잇기(v2.79.0) — `{ section, name, symbol | null }`(앱 DB 만 · 시트를 쓰지 않음 — 자산 잠금은 문지기 · 쓰기 스위치와 상관없음).
 * 받는 것: 시트 계좌(합친 표 제외) · 지금 그 계좌 묶음의 줄 이름(0% 아닌 줄) · 그 계좌 보유 종목(코드가 있는 줄) 코드 또는 null(끊기). 다른 값은 400 `not-editable`.
 */
assetRouter.put('/api/asset/purchase/plan-link', async (req, res) => {
  try {
    const { section, name, symbol } = (req.body ?? {}) as Partial<PlanLinkRequest>;
    const data = await readAssetSheet();
    const sec = data.sections.find((s) => !s.combined && s.key === section);
    if (typeof section !== 'string' || !sec) throw new AssetSheetError('not-editable', '그 계좌를 시트에서 찾지 못했습니다.');
    const group = savingShapeOf(await readSavingTab(), data).groups.find((g) => g.account === section);
    if (typeof name !== 'string' || !group || !group.lines.some((l) => l.name === name && l.ratio != null && l.ratio > 0)) {
      throw new AssetSheetError('not-editable', '「적립식 투자」 탭에서 그 줄을 찾지 못했습니다 — 다시 읽어 보세요.');
    }
    if (symbol !== null && (typeof symbol !== 'string' || !sec.holdings.some((h) => h.symbol === symbol))) {
      throw new AssetSheetError('not-editable', '그 계좌의 보유 종목만 고를 수 있습니다.');
    }
    savePlanLink(section, name, symbol);
    res.json({ section, name, symbol });
  } catch (e) {
    sendSheetError(res, e, '기록');
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

/**
 * 매수 · 매도 입력(v2.66.0) — 다른 증권사에서 사고판 것을 적어 시트 수량 · 평균가를 갱신한다(실제 주문 없음). 스위치 · 검사 · 쓰기 · 기록은 `recordTrade` 한 곳.
 * 예수금(v2.71.0): `cashAmount`(원) 검사는 보유 쓰기 **전** · 보유 쓰기가 성공한 뒤에만 예수금 줄을 쓴다(`tradeCash` — 실패해도 보유는 그대로 · 응답 `cash` 에 안내).
 */
assetRouter.post('/api/asset/trade', async (req, res) => {
  try {
    const cashAmount = parseCashAmount(req.body);
    const result = await recordTrade(req.body);
    const side = req.body?.side === 'sell' ? 'sell' : 'buy';
    res.json({ ...result, ...(await tradeCash(side, String(req.body?.section), result.id, req.body?.expect?.name, cashAmount, kstDay(Date.now()))) });
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/** 새 종목 — 어디에 쓸지(저장 전 확인 화면 · v2.67.0 · 시트를 바꾸지 않는다) */
assetRouter.post('/api/asset/trade/new/plan', async (req, res) => {
  try {
    res.json(await planNewHolding(req.body));
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/**
 * 새 종목 매수(v2.67.0) — 시트에 줄을 넣고 「티커」 에 종목을 더한다(실제 주문 없음) · 이미 가진 종목이면 매수로 더한다. 검사 · 쓰기 · 되돌리기 · 기록은 `recordNewHolding` 한 곳.
 * 예수금(v2.71.0)은 `/api/asset/trade` 와 같다(매수 · 이름은 종목 코드).
 */
assetRouter.post('/api/asset/trade/new', async (req, res) => {
  try {
    const cashAmount = parseCashAmount(req.body);
    const result = await recordNewHolding(req.body);
    res.json({ ...result, ...(await tradeCash('buy', String(req.body?.section), result.id, req.body?.symbol, cashAmount, kstDay(Date.now()))) });
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/**
 * 매수 · 매도 창 예수금 줄(v2.71.0) — 그 계좌의 짝 · 켜짐 · 지금 환율 · 지금 예수금(v2.71.3 `balance`). 짝이 있고 켜졌을 때만 「현금」 탭을 읽는다(같은 이름 「#n」 표시).
 * 꺼졌거나 짝이 없으면 시트 · 환율을 읽지 않는다(`balance: null`). 예수금은 같은 읽기의 짝 줄 C열 — 줄을 못 찾거나 숫자가 아니면 null(쓰기와 같은 `findCashLine`).
 */
assetRouter.get('/api/asset/cash/pair', async (req, res) => {
  try {
    const section = typeof req.query.section === 'string' ? req.query.section : '';
    const enabled = isCashWriteOn();
    const key = readCashSettings().depositPairs[section] ?? null;
    if (!enabled || !key) {
      const body: AssetCashPairView = { enabled, pair: null, usdKrw: null, balance: null };
      return res.json(body);
    }
    const config = assetSheetConfig();
    if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
    const [[rows], usdKrw] = await Promise.all([batchGet(config, [cashWide()], 'UNFORMATTED_VALUE'), usdKrwNow()]);
    // 은행 · 상품 이름(v2.71.1 — 설정 화면 · 「현금 합계」 와 같은 함수) · 시트에 없으면 저장한 이름 그대로
    const lines = cashLines(rows);
    const names = lines.map((l) => l.key.name);
    const label = cashBankLabelOf(key, names, readCashBankFix()) ?? (key.nth > 1 ? `${key.name} #${key.nth}` : key.name);
    const line = findCashLine(lines, key);
    const body: AssetCashPairView = { enabled, pair: { key, label }, usdKrw, balance: line ? cellNumber(line.cell) : null };
    res.json(body);
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 매수 · 매도 기록 — 최근 순 · `limit`(기본 50 · 최대 1000 — 화면은 50씩 늘려 다시 받는다) */
assetRouter.get('/api/asset/trades', (req, res) => {
  res.json(listTrades(req.query.limit));
});

/** 총 자산 · 분류별 · 코어/위성 · 어제보다 — 화면이 열린 동안 10초마다(시트는 30초 캐시 · 가격은 토스 /prices 한 번 + 환율 60초 캐시) */
assetRouter.get('/api/asset/summary', async (req, res) => {
  try {
    res.json(await assetSummary(req.query.pension === '1'));
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/**
 * 하루 기록 — 총 자산 선 차트(기간 1m · 3m · 1y · all) + 일별 변화 표(v2.70.0 · 같은 날짜 · 같은 응답).
 * 표의 줄은 모든 기록을 바로 앞 기록과 견준 뒤(기간 첫 줄도 기간 밖 앞 기록과) 기간 안 날짜만 남긴다 · 계산은 `dailyChange.ts` 한 곳 · 시트 · 구글 호출 없음.
 */
assetRouter.get('/api/asset/history', (req, res) => {
  const range = req.query.range ?? '1m';
  if (!isHistoryRange(range)) return res.status(400).json({ error: '기간은 1m · 3m · 1y · all 중 하나입니다.' });
  const includePension = req.query.pension === '1';
  const since = sheetSwitchedAt();
  const points = historyPoints(range, includePension);
  const days = new Set(points.map((p) => p.day));
  const notes = dailyNotes();
  const rows = dailyChanges(allRecords(), tradesForChange(), { includePension, pensionSections: readPensionSections(), sheetSwitchedAt: since })
    .filter((r) => days.has(r.day))
    .map((r) => ({ ...r, note: notes.get(r.day) ?? null }));
  res.json({ range, points, since, rows });
});

/** 날짜별 메모(v2.70.0) — `{ day, note }` · 빈 글이면 지움 · 40자까지 · 앱에만 저장(시트에 쓰지 않는다) · 잠금은 맨 앞 자산 문지기 */
assetRouter.put('/api/asset/daily-note', (req, res) => {
  const body = (req.body ?? {}) as { day?: unknown; note?: unknown };
  const r = saveDailyNote(body.day, body.note, new Date().toISOString());
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ day: body.day, note: r.note });
});

/**
 * 설정 창 — `{ pensionSections?, satelliteSymbols?, classColors?, rebalanceBand?, lockMinutes? }`(연금으로 볼 계좌 · 위성으로 선택한 종목 · 자산 분류 색 · 비율 조정 범위 · 잠금 시간).
 * 계좌 · 종목 코드는 지금 시트에 있는 것만이라 시트를 먼저 읽는다(30초 캐시). 검사는 `writeAssetSettings` 한 곳.
 */
assetRouter.put('/api/asset/settings', async (req, res) => {
  try {
    const saved = writeAssetSettings(req.body, await readAssetSheet());
    if (!saved) return res.status(400).json({ error: '설정 값이 올바르지 않습니다 — 시트에 없는 계좌 · 종목이거나 고를 수 없는 색 · 범위(1~20 정수 밖) · 잠금 시간(10 · 30 · 60분 · 끄기 밖)입니다.' });
    res.json(saved);
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 설정 창 「현금 자동 반영」(v2.71.0) — 설정 · 「현금」 줄 · 「월 고정지출」 줄 · 다음 반영 날 · 반영 기록(최근 50). 시트는 읽기만 */
assetRouter.get('/api/asset/cash', async (_req, res) => {
  try {
    res.json(await buildCashView());
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/**
 * 현금 자동 반영 설정 고치기(v2.71.0) — 고칠 칸만(`AssetCashSettingsPatch`). 「현금」 · 「월 고정지출」 줄은 지금 시트에 있는 것만이라 먼저 읽는다.
 * 검사는 `writeCashSettings` 한 곳 · 성공하면 화면 응답 전체(다음 반영 날이 바뀐다). 앱 DB 에만 쓴다(시트 쓰기 없음).
 */
assetRouter.put('/api/asset/cash/settings', async (req, res) => {
  try {
    const now = await cashSheetNow();
    const saved = writeCashSettings(req.body, now, kstDay(Date.now()));
    if (!saved) return res.status(400).json({ error: '설정 값이 올바르지 않습니다 — 시트에 없는 줄 · 계좌이거나, 변동 지출 · 같은 줄 출금 · 입금 · 날짜(1~31) 밖입니다.', kind: 'not-editable' });
    res.json(await buildCashView());
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 다음 한 달 미리 보기(v2.71.1) — 읽기만(시트 쓰기 0 · 기록 0 · 꺼져 있어도 「켜면 이렇게」) · 계산은 `cashPreview.ts`(실제 예약과 같은 함수) */
assetRouter.get('/api/asset/cash/preview', async (_req, res) => {
  try {
    res.json(await buildCashPreview());
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 은행 묶음 고치기(v2.71.1) — `{ row: { name, bank } }` · `{ rename: { from, to } }` · 앱에만 저장(시트는 그대로) · 성공하면 화면 응답 전체 */
assetRouter.put('/api/asset/cash/banks', async (req, res) => {
  try {
    const now = await cashSheetNow();
    const saved = writeCashBankFix(req.body, now.lines.map((l) => l.key.name));
    if (!saved) return res.status(400).json({ error: '은행 묶음 값이 올바르지 않습니다 — 시트에 없는 계좌 · 은행이거나 이름이 비었거나 20자를 넘습니다.', kind: 'not-editable' });
    res.json(await buildCashView());
  } catch (e) {
    sendSheetError(res, e, '읽기');
  }
});

/** 반영 기록 되돌리기(v2.71.0) — `{ id }` · 「반영」 줄만 · 지금 숫자 기준 반대로 한 요청(`undoCashMove` 한 곳). 성공하면 화면 응답 전체 */
assetRouter.post('/api/asset/cash/undo', async (req, res) => {
  try {
    // 시트 30초 캐시는 쓰기 한 곳(`writeCashMove`)이 비운다(v2.72.1)
    await undoCashMove(req.body?.id);
    res.json(await buildCashView());
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/**
 * 직접 입출금(v2.72.0) — `{ kind: transfer | deposit | withdraw, from, to, amount, memo?, requestId }` · 시트 쓰기 스위치만 봄(「현금 자동 반영」 설정은 안 봄) · 잠금은 맨 앞 자산 문지기.
 * 쓰기 · 기록은 `cashManual.ts` → `applyCashMove`(현금 자동 반영과 같은 길) · 같은 요청 번호는 한 번만 쓰고 같은 기록을 돌려준다 · 응답 = 기록 + 쓴 뒤 금액.
 */
assetRouter.post('/api/asset/cash/manual', async (req, res) => {
  try {
    res.json(await applyManualCash(req.body));
  } catch (e) {
    sendSheetError(res, e, '쓰기');
  }
});

/** 이유 종류 → HTTP — 이 서버 설정(연결 정보 · 열쇠 · 스위치)은 503, 요청이 틀림은 400, 수식 칸 · 날짜 없음 · 이미 구매 완료 · 누를 차례 없음 · 시트 가격(도는 중 · 바꿀 줄 없음 · 백업 없음) · 매수 · 매도(시트 바뀜 · 모두 매도의 다른 칸이 가리킴 · 마지막 줄)는 409, 구글 쪽은 502 */
const STATUS: Partial<Record<AssetSheetErrorKind, number>> = { 'not-configured': 503, 'key-file': 503, disabled: 503, 'not-editable': 400, 'formula-cell': 409, 'no-date': 409, 'already-done': 409, 'not-yet': 409, busy: 409, 'no-rows': 409, 'no-backup': 409, 'sheet-changed': 409, 'row-referenced': 409, 'last-row': 409 };

/** 실패 응답 — 쉬운 말 + 이유 종류. ⚠️ 로그에는 이유 종류만(시트 값 · 응답 본문 · 경로를 찍지 않는다) */
function sendSheetError(res: Response, e: unknown, action: string): void {
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
