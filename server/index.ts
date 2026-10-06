import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Timeframe } from '../src/types/toss';
import { fetchOrderbook, fetchPrice } from '../src/services/toss/market';
import { getAccessToken } from '../src/services/toss/auth';
import { fetchExchangeRate, fetchPortfolio } from '../src/services/toss/account';
import { getFundamentals, getPeers } from './companyService';
import { getCandles, getCandlesBefore } from './candleService';
import { summarizeSymbols } from './summaryService';
import { getRangeStats } from './rangeStatsService';
import { fetchQuotes } from './quoteService';
import { catalogSize, findNames, findStock, refreshCatalog, searchStocks } from './stockCatalog';
import {
  deleteAllAnalyses as deleteAllClaudeAnalyses,
  deleteAnalysis,
  getDb,
  loadAnalyses,
  loadCandles,
  saveAnalysis,
} from './db';
import { isMockMode, mockOrderbook, mockPrice } from './mockData';
import {
  RevisionConflictError,
  UserDataError,
  getWatchlist,
  saveWatchlist,
} from './userData';
import {
  clearSessionCookie,
  countSessions,
  createSession,
  deleteAllSessions,
  deleteSession,
  isPasswordSet,
  purgeExpiredSessions,
  readSessionCookie,
  setSessionCookie,
  touchSession,
  verifyPassword,
} from './auth';
import {
  authGuard,
  isOwnOrigin,
  loginBlockedMinutes,
  recordLoginFailure,
  recordLoginSuccess,
} from './authGuard';
// 버전의 단일 출처. package.json 은 0.1.0 그대로라 쓸 수 없다.
import { CHANGELOG } from '../src/data/changelog';
import { runAnalysis } from './gemini/analyze';
import { DEFAULT_MODEL, GeminiError, geminiDisabledReason, isGeminiEnabled } from './gemini/client';
import { accuracyReport } from './gemini/accuracy';
import { DiagnoseBusyError, getDiagnoseProgress, startDiagnose } from './diagnose/runner';
import { BacktestBusyError, getBacktestProgress, startCustomBacktest } from './autoTrading/researchRunner';
import { deleteBacktest, getBacktest, listBacktests, saveExplain } from './autoTrading/researchStore';
import { namesAndSectors, researchTargets } from './autoTrading/ruleResearch';
import { AdviceInputError, adviseBacktest, explainBacktest } from './gemini/backtestAi';
import { parseBacktestInput } from '../src/utils/backtestInput';
import { BACKTEST_SECTORS } from '../src/types/backtest';
import { EngineDownError } from './diagnose/report';
import {
  deleteReport as deleteDiagnoseReport,
  getReport as getDiagnoseReport,
  listReports as listDiagnoseReports,
} from './diagnose/store';
import {
  analysesToday as analysesTodayCount,
  deleteAllAnalyses as deleteAllGeminiAnalyses,
  deleteAnalysis as deleteGeminiAnalysis,
  getAnalysis as getGeminiAnalysis,
  listAnalyses as listGeminiAnalyses,
} from './gemini/store';
import { DEFAULT_HORIZON } from '../src/services/analysis/horizons';
import { getInvestorFlow } from './investorTrading';
import {
  deleteTargetAnalysis,
  getTargetProgress,
  listTargetAnalyses,
  startTargetAnalysis,
  TargetBusyError,
  targetDisabledReason,
  TargetInputError,
  targetStats,
  validateTargetRequest,
} from './gemini/targetAnalysis';
import { isKrSymbol } from '../src/utils/market';
import {
  getScheduledStatus,
  runScheduledNow,
  saveScheduledSymbols,
  ScheduledError,
  scheduledTick,
} from './gemini/scheduled';
// 계좌별 자동매매 — 주문을 내는 유일한 경로다 (Step 12)
import {
  getStrategy,
  listStrategies,
  saveStrategy,
  deleteStrategy,
} from './autoTrading/store';
import { watchlistSymbols } from './analysis/targetHit';
import {
  SERVER_OFF_REASON,
  getStrategyStatus,
  isAutoTradingEnabled,
  runAccount,
  startAutoTradingScheduler,
} from './autoTrading/scheduler';
import { computeIndicators, IndicatorEngineError, indicatorEngineHealthy } from './indicatorService';
import {
  evaluateOne,
  getProgress as getSurgeProgress,
  refreshOutcomes,
  startDetection,
} from './surgeScanner';
import { evaluateSwing } from './swingAnalyzer';
import {
  ProfileValidationError,
  coerceParams,
  validateSwingParams,
  getActiveSwingParams,
  getProfileState,
  saveProfileState,
} from './strategyProfile';
import {
  insertRecommendation,
  latestRun,
  recordedRecently,
  listRecommendations,
  refreshSwingOutcomes,
} from './swingStore';
import {
  getSettings as getSurgeSettings,
  latestDetections,
  deleteDetections,
  listDetections,
  rankingUpdatedAt,
  saveSettings as saveSurgeSettings,
} from './surgeStore';
import {
  cancelOrder,
  createAccount,
  createOrder,
  deleteAccount,
  getAccountDetail,
  listAccounts,
  listOrders,
  listTrades,
  PaperTradingError,
  PaperNotFoundError,
  resetAccount,
  settlePendingOrders,
  valuePositions,
  getAccount as getPaperAccount,
} from './paperTradingService';
import { computePerformance, listSnapshots } from './paperPerformanceService';
import { backfillSnapshots, startSnapshotScheduler } from './paperSnapshotScheduler';
import { startUniverseSnapshotScheduler } from './universe';
import { getEarningsDate, startEarningsScheduler } from './earningsCalendar';
import { startMarketCalendarScheduler } from './marketCalendar';
import { calendarEvents } from './calendarService';
import { previewProfile } from './swingPreview';
import { getSwingGoal, saveSwingGoal, SwingGoalError } from './swingGoal';
import { HEATMAP_TOPS, heatmap } from './heatmap';
import { liveRanking } from './liveRanking';
import { marketDate } from '../src/utils/marketDate';
import { analyzeNews, getNews } from './news';

/**
 * AlphaScope API 서버.
 * 토스 API 키는 이 프로세스에만 존재하고, 브라우저는 /api/* 만 호출한다.
 */
const app = express();

/*
 * ⚠️ CORS 를 `*` 로 열지 않는다.
 *
 * 로그인이 생겼지만(v2.12.0) 방어를 한 겹만 두지 않는다 — 쿠키가 실린 요청이
 * 아무 사이트에서나 날아오지 않게 오리진도 그대로 좁혀 둔다.
 * 브라우저는 평소 Vite 프록시(같은 오리진)를 지나므로 CORS 헤더 자체가 필요 없고,
 * 열어 두면 사용자가 방문한 **아무 웹사이트나** localhost:4000 으로 주문을 낼 수 있다.
 * 기본은 오리진 없는 요청(프록시·curl)과 로컬 개발 서버만 허용하고,
 * 추가 오리진이 필요하면 `.env` 의 `ALLOWED_ORIGINS` 에 쉼표로 적는다.
 */
/*
 * ⚠️ 오리진 판단은 **`authGuard.isOwnOrigin` 한 곳**이다 — CORS 와 CSRF 가 갈라지면 안 된다.
 * `cors` 의 **요청별 옵션 델리게이트**를 쓴다(`cors((req, cb) => ...)`). origin 콜백만으로는
 * 요청 객체를 받지 못해 프록시 헤더(`X-Forwarded-Host`)를 볼 수 없다.
 *
 * ⚠️ 허용되지 않은 오리진에 **오류를 던지지 않는다.** 던지면 Express 기본 핸들러가
 * **500 + 스택 트레이스**를 돌려주고 거기에 서버의 절대 경로가 실린다(검증 중 확인).
 * CORS 헤더만 빼면 브라우저가 응답을 읽지 못하고, 상태를 바꾸는 요청은
 * `authGuard` 의 CSRF 검사가 **403** 으로 끊는다.
 */
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    // origin 이 없는 요청 = 같은 오리진(Vite 프록시) 또는 브라우저가 아닌 클라이언트
    const allowed = !origin || isOwnOrigin(req as express.Request, origin);
    callback(null, { origin: allowed, credentials: true });
  }),
);

app.use(express.json({ limit: '10mb' })); // 차트 캡처 이미지 대비

/*
 * ⚠️ `trust proxy` 는 **루프백만** 믿는다. 오라클은 nginx 가 127.0.0.1 에서 보내므로
 * 그 한 단계만 신뢰하면 `req.ip`(무차별 대입 집계)와 `req.secure`(쿠키 Secure)가 맞는다.
 * `true` 로 열면 아무나 `X-Forwarded-For` 를 위조해 IP 별 잠금을 빠져나간다.
 */
app.set('trust proxy', 'loopback');

/*
 * ── 로그인 문지기 ───────────────────────────────────────────────────────────
 * **모든 /api 라우트보다 먼저** 선다. 아래에 라우트를 새로 추가해도 자동으로 보호된다.
 */
app.use(authGuard);

/** 로그인 — 실패는 무엇이 틀렸는지 구분해 알리지 않는다 */
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip ?? 'unknown';
  const blocked = loginBlockedMinutes(ip);
  if (blocked > 0) {
    return res.status(429).json({ error: `잠시 후 다시 시도하세요 — ${blocked}분` });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password || !(await verifyPassword(password))) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: '비밀번호가 맞지 않습니다.' });
  }

  recordLoginSuccess(ip);
  const token = createSession(req.headers['user-agent']);
  setSessionCookie(req, res, token);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  const token = readSessionCookie(req);
  if (token) deleteSession(token);
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.post('/api/auth/logout-all', (req, res) => {
  const removed = deleteAllSessions();
  clearSessionCookie(req, res);
  res.json({ ok: true, removed });
});

/** 앱이 시작할 때 가장 먼저 부른다 — 401 이면 로그인 화면만 그린다 */
app.get('/api/auth/me', (req, res) => {
  if (!isPasswordSet()) {
    return res.status(503).json({
      error: '서버에서 `npm run auth:set-password` 로 비밀번호를 먼저 정하세요.',
      authNotConfigured: true,
    });
  }
  const token = readSessionCookie(req);
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.', authRequired: true });
  // 이 경로는 문지기가 열어 두므로 세션 확인을 여기서 한다.
  if (!touchSession(token)) {
    return res.status(401).json({ error: '로그인이 필요합니다.', authRequired: true });
  }
  res.json({ loggedIn: true, sessions: countSessions() });
});

/** 1w·1M(v2.20.0)은 일봉을 시장 달력으로 묶는다 — 지표도 그 묶인 봉으로 계산한다(주봉 RSI = 주봉 14개) */
const VALID_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1d', '1w', '1M'];

/**
 * 토스 `symbol` 의 허용 문자 — 영문·숫자·점·하이픈만이다.
 *
 * ⚠️ 규칙을 라우트마다 따로 적지 않는다. 예전에는 `/api/swing/analyze` 에만 있어서,
 * 나머지 라우트는 "삼성전자" 같은 값을 그대로 외부 API 로 넘기고 **500** 을 돌려줬다 —
 * 잘못된 입력은 400 으로, 우리 쪽 장애는 500 으로 구분돼야 화면이 안내를 고를 수 있다.
 */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

/** 검증된 심볼 또는 null. 호출부는 null 이면 400 을 돌려준다. */
function parseSymbol(raw: unknown): string | null {
  const symbol = String(raw ?? '').trim().toUpperCase();
  return symbol && symbol.length <= 20 && SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

const BAD_SYMBOL = { error: '올바른 심볼이 아닙니다 (영문·숫자·. - 만 가능).' };

function fail(res: express.Response, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error('[api]', message);
  res.status(500).json({ error: message });
}

/**
 * 현재가에 전일 대비 변동을 채워 준다.
 *
 * 토스 /prices 응답에는 변동 정보가 없어서 직접 계산한다. 기준가는 SQLite 에 캐시된
 * 일봉에서 가져오므로, 1초 폴링마다 캔들 API 를 부르지 않는다.
 */
async function withDailyChange(symbol: string) {
  const price = await fetchPrice(symbol);
  // 오름차순이므로 [전일, 당일] 순이다. 캔들이 하나뿐이면 기준가가 없어 변동을 계산할 수 없다.
  const daily = loadCandles(symbol, '1d', 2);
  if (daily.length < 2 || !Number.isFinite(price.close)) return price;

  const previousClose = daily[0].close;
  if (!previousClose) return price;

  const change = price.close - previousClose;
  return {
    ...price,
    change,
    changeRate: (change / previousClose) * 100,
    volume: daily.at(-1)?.volume ?? 0,
  };
}

/**
 * 토스 API 에 실제로 닿는지 — 토큰 발급을 시도해 본다.
 * 키가 있다고 연결된 것은 아니다 (사무실 IP 차단 등). 진단 화면이 이걸 구분하지 못하면
 * 전부 막힌 상태에서도 "실시간 연결됨" 이라고 말한다.
 * 토큰은 auth.ts 가 캐시하므로 성공 시엔 네트워크를 타지 않는다. 실패는 30초 캐시한다.
 */
let tossProbe: { at: number; error: string | null } | null = null;
async function tossReachable(): Promise<{ ok: boolean; error: string | null }> {
  if (isMockMode()) return { ok: false, error: null };
  if (tossProbe && Date.now() - tossProbe.at < 30_000) {
    return { ok: tossProbe.error === null, error: tossProbe.error };
  }
  try {
    await getAccessToken();
    tossProbe = { at: Date.now(), error: null };
  } catch (e) {
    tossProbe = { at: Date.now(), error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: tossProbe.error === null, error: tossProbe.error };
}

/*
  서버가 **옛 코드로 떠 있는지**를 화면이 알 수 있게 한다.
  화면에서 수정이 안 보이거나 없던 라우트가 404·400 을 내면 십중팔구 서버 재시작 누락이다
  (실제로 옛 서버에 `/api/paper/accounts/overview` 가 없어 "계좌가 없어졌다" 로 신고됐다).
  화면은 자기 `CHANGELOG[0].version` 과 비교해 다르면 배너를 띄운다.
*/
const SERVER_STARTED_AT = new Date().toISOString();

app.get('/api/version', (_req, res) => {
  res.json({ version: CHANGELOG[0]?.version ?? 'unknown', startedAt: SERVER_STARTED_AT });
});

app.get('/api/health', async (_req, res) => {
  const [toss, indicatorEngine] = await Promise.all([
    tossReachable(),
    indicatorEngineHealthy(),
  ]);
  res.json({
    ok: true,
    mock: isMockMode(),
    toss: toss.ok,
    tossError: toss.error,
    indicatorEngine,
    time: new Date().toISOString(),
  });
});

/*
 * ── 사용자 데이터 (기기 간 공유) ─────────────────────────────────────────────
 * 관심 목록·최근 조회는 브라우저가 아니라 **서버**에 둔다 — 어느 기기로 접속해도 같아야 한다.
 * 기기별 화면 설정(패널 높이·접힘·마지막 폴더)은 그대로 localStorage 다.
 */
app.get('/api/user-data/watchlist', (_req, res) => {
  try {
    res.json(getWatchlist());
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/user-data/watchlist', (req, res) => {
  try {
    res.json(saveWatchlist(req.body ?? {}));
  } catch (e) {
    // 다른 기기가 먼저 바꿨다 — 현재 값을 함께 돌려줘 화면이 합칠 수 있게 한다.
    if (e instanceof RevisionConflictError) {
      return res.status(409).json({ error: e.message, current: e.current });
    }
    if (e instanceof UserDataError) {
      return res.status(400).json({ error: e.message });
    }
    return fail(res, e);
  }
});

app.get('/api/candles', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  const timeframe = String(req.query.timeframe ?? '1d') as Timeframe;
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 300)));

  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    return res.status(400).json({ error: `지원하지 않는 timeframe: ${timeframe}` });
  }

  try {
    // before 가 오면 그 시각 이전의 과거 구간만 돌려준다 (차트 무한 스크롤).
    const before = Number(req.query.before);
    const candles = Number.isFinite(before) && before > 0
      ? await getCandlesBefore(symbol, timeframe, before, limit)
      : await getCandles(symbol, timeframe, limit);

    res.json({ symbol, timeframe, candles, mock: isMockMode() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/indicators', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  const timeframe = String(req.query.timeframe ?? '1d') as Timeframe;
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 300)));

  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  if (!VALID_TIMEFRAMES.includes(timeframe)) {
    return res.status(400).json({ error: `지원하지 않는 timeframe: ${timeframe}` });
  }

  try {
    // 차트와 같은 캔들을 써야 지표가 화면과 어긋나지 않는다.
    const candles = await getCandles(symbol, timeframe, limit);
    res.json({ symbol, timeframe, indicators: await computeIndicators(candles) });
  } catch (e) {
    if (e instanceof IndicatorEngineError) {
      // 엔진 미기동은 앱 오류가 아니라 설정 문제이므로 구분해서 알린다.
      return res.status(503).json({ error: e.message, engineDown: true });
    }
    fail(res, e);
  }
});

app.get('/api/prices', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    const price = isMockMode() ? mockPrice(symbol) : await withDailyChange(symbol);
    res.json({ price, mock: isMockMode() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/orderbook', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    const orderbook = isMockMode() ? mockOrderbook(symbol) : await fetchOrderbook(symbol);
    res.json({ orderbook, mock: isMockMode() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/company', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  const refresh = req.query.refresh === 'true';
  if (!symbol) return res.status(400).json(BAD_SYMBOL);

  try {
    res.json({ fundamentals: await getFundamentals(symbol, refresh) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/peers', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);

  try {
    res.json({ peers: await getPeers(symbol, req.query.sector as string | undefined) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/holdings', async (_req, res) => {
  if (isMockMode()) {
    return res.json({ portfolio: { holdings: [], summary: null }, mock: true });
  }
  try {
    res.json({ portfolio: await fetchPortfolio(), mock: false });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/exchange-rate', async (req, res) => {
  const base = String(req.query.base ?? 'USD').toUpperCase();
  const quote = String(req.query.quote ?? 'KRW').toUpperCase();

  if (isMockMode()) {
    return res.json({
      rate: { baseCurrency: base, quoteCurrency: quote, rate: 1380, fetchedAt: Date.now() },
      mock: true,
    });
  }

  try {
    res.json({ rate: await fetchExchangeRate(base, quote), mock: false });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/stocks/info', (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    res.json({ stock: findStock(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/stocks/search', (req, res) => {
  const query = String(req.query.q ?? '');
  try {
    res.json({ results: searchStocks(query), catalogSize: catalogSize() });
  } catch (e) {
    fail(res, e);
  }
});

/** 심볼 → 종목명 (목록 화면이 이름을 함께 보여 주기 위해 쓴다) */
app.get('/api/stocks/names', (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);

  try {
    res.json({ names: findNames(symbols) });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/stocks/refresh', async (_req, res) => {
  try {
    res.json({ count: await refreshCatalog(true) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/market-overview', async (_req, res) => {
  const url = `${process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`}/market-overview`;

  // 지수와 환율은 서로 다른 소스라, 하나가 실패해도 나머지는 내려 준다.
  // 환율 스파크라인은 지수와 같은 yfinance 응답에 함께 실려 온다 (수정 2).
  const [overview, rate] = await Promise.all([
    fetch(url, { signal: AbortSignal.timeout(15_000) })
      .then((r) => r.json() as Promise<{ indices?: unknown[]; fxSparkline?: number[] }>)
      .catch(() => ({}) as { indices?: unknown[]; fxSparkline?: number[] }),
    (isMockMode()
      ? Promise.resolve({ baseCurrency: 'USD', quoteCurrency: 'KRW', rate: 1380, fetchedAt: Date.now() })
      : fetchExchangeRate()
    ).catch(() => null),
  ]);

  const sparkline = Array.isArray(overview.fxSparkline) ? overview.fxSparkline : [];

  res.json({
    indices: overview.indices ?? [],
    rate: rate ? { ...rate, sparkline } : null,
  });
});

app.get('/api/quotes', async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => parseSymbol(s))
    .filter((s): s is string => s !== null)
    .slice(0, 30);

  if (!symbols.length) return res.json({ quotes: [] });

  try {
    res.json({ quotes: await fetchQuotes(symbols) });
  } catch (e) {
    fail(res, e);
  }
});

/** 52주 고저 — 차트 정보 바가 "고점 대비 얼마나 빠졌나" 를 보여 주는 데 쓴다 */
app.get('/api/stats/52w', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);

  try {
    res.json({ stats: await getRangeStats(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/summary', async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => parseSymbol(s))
    .filter((s): s is string => s !== null)
    .slice(0, 12);

  if (!symbols.length) return res.status(400).json({ error: 'symbols 파라미터가 필요합니다.' });

  try {
    res.json({ summaries: await summarizeSymbols(symbols) });
  } catch (e) {
    fail(res, e);
  }
});

// ── 모의투자 (페이퍼 트레이딩) ────────────────────────────────────────────────
//
// ⚠️ 이 아래 라우트는 토스 **주문** API 를 호출하지 않는다. 시세만 실제 값을 읽고
// 주문·체결·잔고는 SQLite 안에서만 움직인다.

/** 사용자 입력 오류(잔고 부족 등)는 400 으로 구분해 돌려준다 — 서버 장애가 아니다. */
function failPaper(res: express.Response, e: unknown) {
  // 계좌가 없는 것은 입력 오류가 아니라 **없는 자원**이다 — 화면이 이 코드로 복구한다.
  if (e instanceof PaperNotFoundError) {
    return res.status(404).json({ error: e.message });
  }
  if (e instanceof PaperTradingError) {
    return res.status(400).json({ error: e.message });
  }
  return fail(res, e);
}

function accountIdOf(req: express.Request): number {
  const id = Number(req.query.accountId ?? req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new PaperTradingError('accountId 가 필요합니다.');
  return id;
}

app.get('/api/paper/accounts', (_req, res) => {
  try {
    res.json({ accounts: listAccounts() });
  } catch (e) {
    failPaper(res, e);
  }
});

app.post('/api/paper/accounts', (req, res) => {
  const { name, initialBalance, currency, commissionRate, slippageRate } = req.body ?? {};
  try {
    res.json({
      account: createAccount({
        name: String(name ?? ''),
        initialBalance: Number(initialBalance),
        currency: currency === 'USD' ? 'USD' : 'KRW',
        commissionRate: commissionRate != null ? Number(commissionRate) : undefined,
        slippageRate: slippageRate != null ? Number(slippageRate) : undefined,
      }),
    });
  } catch (e) {
    failPaper(res, e);
  }
});

/**
 * 계좌 상세.
 *
 * `settle=1` 이면 대기 중인 지정가 주문을 먼저 체결시킨다.
 * 예전에는 프론트가 `/positions` → `/accounts/:id` 순으로 두 번 불렀는데,
 * 두 라우트가 각각 valuePositions() 를 돌려 **토스 시세·환율을 초당 4회** 때렸다.
 * 한 번에 처리하면 절반으로 줄고, 체결과 평가가 같은 시점 값을 쓰게 된다.
 */
/**
 * 계좌 **모아보기** — 전 계좌의 평가금액·손익을 한 번에.
 *
 * ⚠️ 카드마다 `/accounts/:id` 를 따로 부르면 계좌 수 × 폴링 주기만큼 시세·환율 조회가 늘어난다
 * (N+1). 여기서 한 번에 모아 주고, 환율은 `toss/account.ts` 의 60초 캐시를 공유한다.
 * 대기 주문 체결(settle)은 하지 않는다 — 그건 상세 화면이 할 일이다.
 */
app.get('/api/paper/accounts/overview', async (_req, res) => {
  try {
    const items = await Promise.all(
      listAccounts().map(async (account) => {
        try {
          const detail = await getAccountDetail(account.id);
          return {
            account: detail.account,
            totalValue: detail.totalValue,
            stockValue: detail.stockValue,
            totalPnl: detail.totalPnl,
            totalReturn: detail.totalReturn,
            pendingOrders: detail.pendingOrders,
            positions: detail.positions.length,
            error: null as string | null,
          };
        } catch (e) {
          // 한 계좌가 실패해도 나머지는 보여 준다 — 전부 비면 "계좌가 없다" 로 읽힌다.
          return {
            account,
            totalValue: null,
            stockValue: null,
            totalPnl: null,
            totalReturn: null,
            pendingOrders: 0,
            positions: 0,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    res.json({ items });
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/paper/accounts/:id', async (req, res) => {
  try {
    const accountId = accountIdOf(req);
    const filled = req.query.settle ? await settlePendingOrders(accountId) : [];
    res.json({ ...(await getAccountDetail(accountId)), filled });
  } catch (e) {
    failPaper(res, e);
  }
});

app.delete('/api/paper/accounts/:id', (req, res) => {
  try {
    const id = accountIdOf(req);
    deleteAccount(id);
    // 계좌가 사라지면 그 계좌의 자동매매 설정·트레일링 고점도 함께 버린다.
    deleteStrategy(id);
    res.json({ ok: true });
  } catch (e) {
    failPaper(res, e);
  }
});

// ── 계좌별 자동매매 (1단계) ─────────────────────────────────
//
// ⚠️ 모의 계좌 전용이다. 실제 주문은 어떤 경로로도 나가지 않는다.
// 자동매매 설정은 여기 한 곳뿐이다 — 전역 설정·스케줄러는 v2.4.0 에서 제거했다.

/** 전 계좌의 자동매매 설정 (저장된 적 없는 계좌는 기본값) */
app.get('/api/auto-trading/strategies', (_req, res) => {
  try {
    res.json({ strategies: listStrategies() });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * 전 계좌의 자동매매 설정 + 실행 상태 — 계좌 모아보기 카드용.
 * 계좌마다 `/status/:id` 를 부르면 카드 수만큼 요청이 늘어난다.
 */
app.get('/api/auto-trading/overview', (_req, res) => {
  try {
    res.json({
      items: listStrategies().map((strategy) => ({
        strategy,
        status: getStrategyStatus(strategy.accountId),
      })),
    });
  } catch (e) {
    fail(res, e);
  }
});

/** 계좌 하나의 설정 + 실행 상태 */
app.get('/api/auto-trading/strategies/:id', (req, res) => {
  try {
    const id = accountIdOf(req);
    res.json({ strategy: getStrategy(id), status: getStrategyStatus(id) });
  } catch (e) {
    failPaper(res, e);
  }
});

/** 설정 저장 — 값 검증은 store.normalizeStrategy 가 한다 */
app.put('/api/auto-trading/strategies/:id', (req, res) => {
  try {
    const id = accountIdOf(req);
    getPaperAccount(id); // 없는 계좌면 여기서 400
    res.json({ strategy: saveStrategy(id, req.body ?? {}) });
  } catch (e) {
    failPaper(res, e);
  }
});

/** 실행 상태만 (화면이 주기적으로 물어보는 자리) */
app.get('/api/auto-trading/status/:id', (req, res) => {
  try {
    res.json({ status: getStrategyStatus(accountIdOf(req)) });
  } catch (e) {
    failPaper(res, e);
  }
});

/**
 * 지금 한 바퀴 돌린다 (사용자 버튼).
 * 수동 실행은 정규장·주기 판정을 건너뛴다 — 켜져 있지 않아도 돈다.
 */
app.post('/api/auto-trading/run/:id', async (req, res) => {
  try {
    const id = accountIdOf(req);
    getPaperAccount(id);
    // 테스트 서버는 수동 실행으로도 주문을 내지 않는다 (AUTO_TRADING_ENABLED=false)
    if (!isAutoTradingEnabled()) return res.status(409).json({ error: SERVER_OFF_REASON, serverOff: true });
    res.json({ result: await runAccount(id, true) });
  } catch (e) {
    failPaper(res, e);
  }
});

app.patch('/api/paper/accounts/:id/reset', (req, res) => {
  try {
    const initialBalance = req.body?.initialBalance;
    res.json({
      account: resetAccount(
        accountIdOf(req),
        initialBalance != null ? Number(initialBalance) : undefined,
      ),
    });
  } catch (e) {
    failPaper(res, e);
  }
});

app.post('/api/paper/orders', async (req, res) => {
  const { accountId, symbol, side, orderType, quantity, requestedPrice, reason } = req.body ?? {};
  try {
    const result = await createOrder({
      accountId: Number(accountId),
      symbol: String(symbol ?? ''),
      side: side === 'SELL' ? 'SELL' : 'BUY',
      orderType: orderType === 'LIMIT' ? 'LIMIT' : 'MARKET',
      quantity: Number(quantity),
      requestedPrice: requestedPrice != null ? Number(requestedPrice) : null,
      reason: reason != null ? String(reason) : null,
    });
    res.json(result);
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/paper/orders', (req, res) => {
  try {
    res.json({ orders: listOrders(accountIdOf(req)) });
  } catch (e) {
    failPaper(res, e);
  }
});

app.post('/api/paper/orders/:id/cancel', (req, res) => {
  try {
    res.json({ order: cancelOrder(Number(req.params.id)) });
  } catch (e) {
    failPaper(res, e);
  }
});

/**
 * 보유 종목 + 실시간 평가손익.
 * 대기 중인 지정가 주문도 여기서 함께 확인한다 — 프론트가 1초 폴링으로 부르는 경로라
 * 별도 스케줄러 없이 체결이 진행된다.
 */
app.get('/api/paper/positions', async (req, res) => {
  try {
    const accountId = accountIdOf(req);
    const filled = await settlePendingOrders(accountId);
    const account = getPaperAccount(accountId);
    const { positions, stockValue, fxRate } = await valuePositions(accountId, account.currency);
    res.json({ positions, stockValue, fxRate, filled });
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/paper/trades', (req, res) => {
  try {
    res.json({ trades: listTrades(accountIdOf(req)) });
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/paper/performance', async (req, res) => {
  try {
    res.json(await computePerformance(accountIdOf(req)));
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/paper/snapshots', (req, res) => {
  try {
    res.json({ snapshots: listSnapshots(accountIdOf(req)) });
  } catch (e) {
    failPaper(res, e);
  }
});

app.get('/api/analysis', (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
  try {
    res.json({ analyses: loadAnalyses(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/analysis', (req, res) => {
  const { symbol, timeframe, priceAtAnalysis, synthesis, verdict, confidence, mode, prompt } =
    req.body ?? {};

  if (!symbol || !synthesis) {
    return res.status(400).json({ error: 'symbol 과 분석 내용이 필요합니다.' });
  }

  try {
    const id = saveAnalysis({
      symbol: String(symbol).toUpperCase(),
      timeframe: String(timeframe ?? '1d'),
      analyzed_at: new Date().toISOString(),
      price_at_analysis: Number(priceAtAnalysis) || 0,
      synthesis: String(synthesis),
      verdict: String(verdict ?? 'neutral'),
      confidence: String(confidence ?? 'medium'),
      mode: mode ? String(mode) : null,
      prompt: prompt ? String(prompt) : null,
    });
    res.json({ id });
  } catch (e) {
    fail(res, e);
  }
});

app.delete('/api/analysis/:id', (req, res) => {
  try {
    deleteAnalysis(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// ── Gemini 자동 분석 ─────────────────────────────────────
// 키가 없으면 전부 503 으로 답하고, 프론트는 그걸 보고 기능을 숨긴다.
// 기존 기능(토스·Claude 수동 분석)에는 아무 영향이 없어야 한다.

function requireGemini(res: express.Response): boolean {
  if (isGeminiEnabled()) return true;
  res.status(503).json({ error: `${geminiDisabledReason()}.`, geminiDisabled: true });
  return false;
}

/**
 * Gemini 를 쓸 수 있는지 — **키 가용성만** 돌려준다.
 *
 * 예전에는 전역 자동 분석의 설정·실행 상태까지 함께 실려 있었다. 자동매매가 계좌별로
 * 일원화되면서(Step 12) 그 설정 자체가 없어졌다. 지금 이 값을 쓰는 곳은
 * "AI형을 고를 수 있는가"(계좌 자동매매 설정)와 "이 버튼을 켤 수 있는가"(차트 AI 탭)다.
 */
app.get('/api/gemini/status', (_req, res) => {
  try {
    // 꺼져 있으면 이유도 함께 준다 — 키 없음과 서버 스위치(GEMINI_ENABLED=false)는 대처가 다르다
    // analysesToday — 「AI 분석 기록」 상태 판의 "오늘 Gemini 사용" (무료 등급 사용량을 가늠한다, v2.23.0)
    res.json({
      enabled: isGeminiEnabled(),
      model: DEFAULT_MODEL,
      reason: geminiDisabledReason(),
      analysesToday: analysesTodayCount(),
    });
  } catch (e) {
    fail(res, e);
  }
});

// -- 목표 도달 가능성 분석 (v2.24.0) — 분석만, 주문 없음 ---------------------------------
// POST 는 검사 뒤 시작만 하고 진행률을 돌려준다(종목 순차, 429 면 남은 종목 중단). 채점은 GET 이 읽을 때 돈다.

app.post('/api/target-analysis', (req, res) => {
  const off = targetDisabledReason();
  if (off) return res.status(503).json({ error: off, geminiDisabled: true });
  try {
    const request = validateTargetRequest(req.body);
    void startTargetAnalysis(request).catch((e) => console.warn('[target] 실행 실패:', (e as Error).message));
    res.json({ progress: getTargetProgress() });
  } catch (e) {
    if (e instanceof TargetInputError) return res.status(400).json({ error: e.message });
    if (e instanceof TargetBusyError) return res.status(409).json({ error: e.message });
    fail(res, e);
  }
});

app.get('/api/target-analysis/progress', (_req, res) => {
  res.json({ progress: getTargetProgress() });
});

app.get('/api/target-analysis', async (req, res) => {
  const symbol = req.query.symbol ? parseSymbol(req.query.symbol) : undefined;
  if (req.query.symbol && !symbol) return res.status(400).json(BAD_SYMBOL);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100) || 100));
  try {
    const records = await listTargetAnalyses(symbol ?? undefined, limit);
    // 성적은 종목 필터와 무관하게 전체 기록으로 낸다(표본을 줄이지 않는다)
    const all = symbol ? await listTargetAnalyses(undefined, 500) : records;
    res.json({ records, stats: targetStats(all), progress: getTargetProgress() });
  } catch (e) {
    fail(res, e);
  }
});

app.delete('/api/target-analysis/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  try {
    if (!deleteTargetAnalysis(id)) return res.status(404).json({ error: '기록을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// -- 투자자 동향 (국내 종목만, v2.23.0) -----------------------------------------------
// 국내가 아니면 토스를 부르지 않고 { supported: false }. 캐시는 server/investorTrading.ts.
app.get('/api/investor-trading', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  if (!isKrSymbol(symbol)) {
    return res.json({ supported: false, reason: '투자자 동향은 국내 종목만 제공됩니다(토스 API 제공 범위)' });
  }
  try {
    res.json({ supported: true, flow: await getInvestorFlow(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

// -- 내가 지정한 종목 — 하루 1번 Gemini 분석 (v2.23.0) --------------------------------
// ⚠️ 분석만 한다. 주문 경로는 계좌 스케줄러 하나뿐이다.

app.get('/api/gemini/scheduled', (_req, res) => {
  try {
    res.json(getScheduledStatus());
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/gemini/scheduled', (req, res) => {
  try {
    saveScheduledSymbols(req.body?.symbols);
    res.json(getScheduledStatus());
  } catch (e) {
    if (e instanceof ScheduledError) return res.status(400).json({ error: e.message });
    fail(res, e);
  }
});

/** 「지금 한 번 실행」 — 시작만 하고 돌려준다. 정기 실행을 대신하지 않는다 */
app.post('/api/gemini/scheduled/run', (_req, res) => {
  try {
    runScheduledNow();
    res.json(getScheduledStatus());
  } catch (e) {
    if (e instanceof ScheduledError) return res.status(409).json({ error: e.message });
    fail(res, e);
  }
});

/** 한 종목 즉시 분석 (사용자가 버튼으로 실행) */
app.post('/api/gemini/analyze', async (req, res) => {
  if (!requireGemini(res)) return;
  const symbol = String(req.body?.symbol ?? '').trim();
  if (!symbol) return res.status(400).json({ error: 'symbol 이 필요합니다.' });

  try {
    /*
     * ⚠️ 분석만 한다 — 주문은 계좌별 스케줄러가 맡는다 (Step 12).
     * 기간을 주지 않으면 기본값을 쓴다. 예전에는 전역 자동 분석 설정에서 읽었는데
     * 그 설정이 없어졌다.
     */
    const analysis = await runAnalysis({
      symbol,
      trigger: 'manual',
      chartImage: req.body?.chartImage ?? null,
      horizon: req.body?.horizon ?? DEFAULT_HORIZON,
    });
    res.json(analysis);
  } catch (e) {
    if (e instanceof GeminiError) {
      return res.status(e.rateLimited ? 429 : 502).json({ error: e.message });
    }
    fail(res, e);
  }
});

app.get('/api/gemini/analyses', (req, res) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
    const limit = Math.min(500, Number(req.query.limit ?? 100) || 100);
    res.json(listGeminiAnalyses(symbol, limit));
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/gemini/analyses/:id', (req, res) => {
  try {
    const analysis = getGeminiAnalysis(Number(req.params.id));
    if (!analysis) return res.status(404).json({ error: '분석을 찾을 수 없습니다.' });
    res.json(analysis);
  } catch (e) {
    fail(res, e);
  }
});

app.delete('/api/gemini/analyses/:id', (req, res) => {
  try {
    deleteGeminiAnalysis(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * 분석 기록 일괄 삭제.
 *
 * source=all|claude|gemini, symbol 을 주면 그 종목만.
 * 두 테이블을 한 요청에서 지운다 — 프론트가 두 번 호출하면 한쪽만 지워진 채로
 * 실패할 수 있고, 그때 화면과 DB 가 어긋난다.
 */
app.delete('/api/analyses', (req, res) => {
  const source = String(req.query.source ?? 'all');
  const symbol = req.query.symbol ? String(req.query.symbol) : undefined;

  if (!['all', 'claude', 'gemini'].includes(source)) {
    return res.status(400).json({ error: 'source 는 all·claude·gemini 중 하나여야 합니다.' });
  }

  try {
    const claude = source === 'gemini' ? 0 : deleteAllClaudeAnalyses(symbol);
    const gemini = source === 'claude' ? 0 : deleteAllGeminiAnalyses(symbol);
    res.json({ claude, gemini, deleted: claude + gemini });
  } catch (e) {
    fail(res, e);
  }
});

/** Claude · Gemini 통합 정확도 */


// -- 스윙 투자 추천 (Step 10) -------------------------------------------------
//
// 관심 종목을 5가지 조건으로 채점하고 매수가·목표가·손절가·비중을 함께 낸다.
// 관심 목록은 브라우저(localStorage)에만 있으므로 화면이 종목을 실어 보낸다.
// 종목 수가 십여 개고 캔들·지표 모두 로컬 캐시를 타므로 동기 응답으로 충분하다
// (급등 탐지와 달리 yfinance 를 종목마다 새로 부르지 않는다).

// ── 판정 기준 프로파일 (Step 10 보강, v2.7.0) ───────────────
//
// 스윙 판정값 네 종류를 표준 / 공격 / 수비 중에서 골라 쓴다.
// ⚠️ 표준은 코드 상수(`STANDARD_SWING`)이고 저장하지 않는다 — 저장된 값이 표준을 덮으면
// "표준인데 예전과 다른 결과" 가 된다.

/**
 * 기준 편집 미리보기 (v2.17.0) — 이 판정값이었다면 지난 120일 관심 종목에서 추천이 몇 번, 그 뒤 10일 평균 수익은.
 * 저장과 같은 검증을 먼저 한다(검증을 통과하지 못하는 값은 미리보기도 하지 않는다). 처음 계산은 수십 초 걸릴 수 있다.
 */
app.post('/api/swing/profile-preview', async (req, res) => {
  const params = coerceParams(req.body?.params);
  const errors = validateSwingParams(params);
  if (errors.length) return res.status(400).json({ error: errors[0].message, fields: errors });
  // ⚠️ 재현은 날마다의 오류를 건너뛰므로, 엔진이 꺼져 있으면 "추천 0번" 이 결과처럼 보인다 — 먼저 확인한다
  if (!(await indicatorEngineHealthy())) {
    return res.status(503).json({ error: '지표 엔진이 꺼져 있어 미리보기를 계산하지 못했습니다.', engineDown: true });
  }
  try {
    res.json(await previewProfile(params));
  } catch (e) {
    fail(res, e);
  }
});

// 초보자 목표 수익률 (v2.29.0) — 「목표 도달 가능성 분석」 의 조건만. 스윙 판정값과 무관하다.
app.get('/api/swing/goal', (_req, res) => {
  try {
    res.json(getSwingGoal());
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/swing/goal', (req, res) => {
  try {
    res.json(saveSwingGoal(req.body ?? {}));
  } catch (e) {
    if (e instanceof SwingGoalError) return res.status(400).json({ error: e.message });
    fail(res, e);
  }
});

app.get('/api/strategy-profile', (_req, res) => {
  try {
    res.json(getProfileState());
  } catch (e) {
    fail(res, e);
  }
});

/** 활성 프로파일 전환 · 공격/수비 값 저장. 검증 실패는 400 + 어느 값이 왜 틀렸는지. */
app.put('/api/strategy-profile', (req, res) => {
  try {
    res.json(saveProfileState(req.body ?? {}));
  } catch (e) {
    if (e instanceof ProfileValidationError) {
      return res.status(400).json({ error: e.message, fields: e.fields });
    }
    fail(res, e);
  }
});

app.post('/api/swing/analyze', async (req, res) => {
  const symbols = [
    ...new Set(
      (Array.isArray(req.body?.symbols) ? (req.body.symbols as unknown[]) : [])
        .map((s) => parseSymbol(s))
        .filter((s): s is string => s !== null),
    ),
  ].slice(0, 50);

  if (!symbols.length) {
    return res.status(400).json({ error: '분석할 종목이 없습니다. 관심 목록에 종목을 담아 주세요.' });
  }

  const analyzedAt = new Date().toISOString();
  /*
   * ⚠️ 프로파일은 **요청 시작 때 한 번만** 읽는다. 종목마다 읽으면 분석 도중 사용자가
   * 기준을 바꿨을 때 한 결과 안에 두 기준이 섞여, 무엇으로 낸 추천인지 말할 수 없게 된다.
   */
  const profile = getActiveSwingParams();
  const recommendations = [];
  const failures: { symbol: string; error: string }[] = [];

  for (const symbol of symbols) {
    try {
      const recommendation = await evaluateSwing(symbol, profile);
      // 추천만 저장한다 — 부적합 종목까지 쌓으면 성과 표본이 추천의 정확도를 말하지 못한다.
      if (
        (recommendation.grade === 'STRONG' || recommendation.grade === 'BUY') &&
        !recordedRecently(symbol, profile.id)
      ) {
        insertRecommendation(analyzedAt, recommendation);
      }
      recommendations.push(recommendation);
    } catch (e) {
      // 한 종목이 실패해도 나머지는 살린다 (상장 직후·지표 엔진 일시 오류 등).
      failures.push({ symbol, error: e instanceof Error ? e.message : String(e) });
    }
  }

  res.json({ analyzedAt, profile: profile.id, recommendations, failures });
});

app.post('/api/swing/evaluate', async (req, res) => {
  const symbol = parseSymbol(req.body?.symbol ?? req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    res.json({ recommendation: await evaluateSwing(symbol, getActiveSwingParams()) });
  } catch (e) {
    fail(res, e);
  }
});

/** 저장된 마지막 추천 (화면을 다시 열었을 때 빈 화면을 보여 주지 않기 위한 것) */
app.get('/api/swing/recommendations', (_req, res) => {
  try {
    const { analyzedAt, rows } = latestRun();
    res.json({ analyzedAt, records: rows });
  } catch (e) {
    fail(res, e);
  }
});

/** 추천 이력 + 성과. 읽는 김에 채점도 갱신한다. */
app.get('/api/swing/history', async (_req, res) => {
  try {
    await refreshSwingOutcomes().catch(() => 0);
    res.json({ records: listRecommendations() });
  } catch (e) {
    fail(res, e);
  }
});

// -- 급등 탐지 (Step 9) ------------------------------------------------------
//
// 실제 매매는 하지 않는다. 주기적 급등 종목을 찾고, 종목별 급등 가능성을 점수로 낸다.

/**
 * 한 바퀴 실행 - 시작만 하고 바로 돌려준다.
 * 50종목 x yfinance 조회는 1분을 넘길 수 있어, 응답을 붙잡고 있으면 브라우저가 먼저 끊는다.
 * 화면은 /api/surge/progress 를 폴링한다.
 */
app.post('/api/surge/detect', (req, res) => {
  // 관심 목록은 브라우저(localStorage)에만 있으므로 화면이 함께 보낸다.
  const watchlist = Array.isArray(req.body?.watchlist)
    ? (req.body.watchlist as unknown[]).map((s) => String(s))
    : [];
  try {
    res.json({ progress: startDetection(watchlist) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/surge/progress', (_req, res) => {
  try {
    res.json({ progress: getSurgeProgress() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/surge/results', (_req, res) => {
  try {
    const { detectedAt, rows } = latestDetections();
    res.json({ detectedAt, results: rows, progress: getSurgeProgress() });
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/surge/evaluate', async (req, res) => {
  const symbol = parseSymbol(req.body?.symbol ?? req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    res.json({ evaluation: await evaluateOne(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

/** 이전 탐지 이력 + 성과. 읽는 김에 채점도 갱신한다 (별도 스케줄러를 두지 않는다). */
app.get('/api/surge/history', async (_req, res) => {
  try {
    await refreshOutcomes().catch(() => 0);
    res.json({ detections: listDetections() });
  } catch (e) {
    fail(res, e);
  }
});

/**
 * 탐지 이력 삭제 (v2.22.0) — `?detectedAt=` 이면 그 회차, 없으면 전체. `surge_detections` 만 지운다.
 * 탐지가 도는 중에는 막는다 — 지금 쓰고 있는 회차가 반쯤 지워진 채 남는다.
 */
app.delete('/api/surge/history', (req, res) => {
  try {
    if (getSurgeProgress().running) {
      return res.status(409).json({ error: '탐지가 실행 중입니다. 끝난 뒤에 지워 주세요.' });
    }
    const raw = req.query.detectedAt;
    if (raw !== undefined && (typeof raw !== 'string' || !raw.trim())) {
      return res.status(400).json({ error: 'detectedAt 이 올바르지 않습니다.' });
    }
    res.json({ deleted: deleteDetections(typeof raw === 'string' ? raw : undefined) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/surge/settings', (_req, res) => {
  try {
    // 랭킹 캐시 시각을 함께 준다 — "언제 기준 종목 풀인가" 를 화면이 알려 줘야 한다.
    res.json({ settings: getSurgeSettings(), rankingUpdatedAt: rankingUpdatedAt() });
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/surge/settings', (req, res) => {
  try {
    res.json({ settings: saveSurgeSettings(req.body ?? {}) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/ai/accuracy', (_req, res) => {
  try {
    res.json(accuracyReport());
  } catch (e) {
    fail(res, e);
  }
});

// -- 종목 뉴스 + AI 긍정/부정 (v2.18.0) ---------------------------------------------
// 목록은 30분 캐시. AI 판정은 버튼(POST)으로만 — 자동 호출하지 않는다. 입력은 제목·발행처·시각·링크만.

app.get('/api/news', async (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  try {
    res.json(await getNews(symbol));
  } catch (e) {
    fail(res, e);
  }
});

app.post('/api/news/analyze', async (req, res) => {
  const symbol = parseSymbol(req.body?.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  if (!requireGemini(res)) return;
  try {
    // 뉴스가 없는 것은 고장이 아니다(국내 종목은 대개 비어 있다) — 500 이 아니라 400 으로 돌려준다
    if (!(await getNews(symbol)).items.length) return res.status(400).json({ error: '판정할 뉴스가 없습니다.' });
    res.json(await analyzeNews(symbol));
  } catch (e) {
    fail(res, e);
  }
});

// -- 다음 실적 발표일 (v2.21.0) ------------------------------------------------
// 실시간 순위 미리보기의 한 줄. ⚠️ earnings_calendar(하루 1회 갱신)만 읽는다 — 마우스를 올릴 때마다 yfinance 를 부르지 않는다.
// 달력에 없거나 이미 지난 날짜면 date: null (화면이 "실적일 정보 없음").

app.get('/api/earnings/next', (req, res) => {
  const symbol = parseSymbol(req.query.symbol);
  if (!symbol) return res.status(400).json(BAD_SYMBOL);
  const e = getEarningsDate(symbol);
  const today = marketDate(Date.now(), symbol);
  const days = e ? Math.round((Date.parse(`${e.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000) : null;
  if (!e || days === null || days < 0) return res.json({ symbol, date: null, isEstimate: null, daysUntil: null });
  res.json({ symbol, date: e.date, isEstimate: e.isEstimate, daysUntil: days });
});

// -- 실시간 순위 (v2.20.0) ------------------------------------------------------
// 토스 /rankings duration=realtime, 30초 캐시(키 live|…) — 급등 탐지의 8시간 랭킹 캐시와 따로다. 보기 전용.

app.get('/api/rankings/live', async (req, res) => {
  const market = req.query.market === 'kr' ? 'kr' : 'us';
  const kind = (['amount', 'volume', 'gainers', 'losers'] as const).find((k) => k === req.query.kind);
  if (!kind) return res.status(400).json({ error: 'kind 는 amount · volume · gainers · losers 중 하나입니다.' });
  try {
    res.json(await liveRanking(market, kind));
  } catch (e) {
    fail(res, e);
  }
});

// -- 종목 지도 (v2.18.0) --------------------------------------------------------
// 유니버스(시장별 시총 상위 100 중 top N) 또는 관심 종목(view=watch). 크기 = 시총, 색 = 기간 수익률(1d 는 전 거래일 종가 대비). 1d 60초 · 그 밖 10분 캐시.
// 응답의 sectors[] 는 설명용 섹터 강세 순위 — 판정·자동매매에 쓰지 않는다.

app.get('/api/heatmap', async (req, res) => {
  const market = req.query.market === 'kr' ? 'kr' : 'us';
  const period = (['1d', '1w', '1m', '3m'] as const).find((p) => p === req.query.period) ?? '1d';
  if (req.query.period !== undefined && period !== req.query.period) {
    return res.status(400).json({ error: 'period 는 1d · 1w · 1m · 3m 중 하나입니다.' });
  }
  // v2.27.0 — view=market|watch, top=30|50|100(시장 보기만, 기본 50). 상위 100 캐시에서 잘라 내므로 토스 호출은 N 과 무관하다
  const view = req.query.view === undefined ? 'market' : (['market', 'watch'] as const).find((v) => v === req.query.view);
  if (!view) return res.status(400).json({ error: 'view 는 market · watch 중 하나입니다.' });
  const top = req.query.top === undefined ? 50 : HEATMAP_TOPS.find((n) => String(n) === req.query.top);
  if (!top) return res.status(400).json({ error: 'top 은 30 · 50 · 100 중 하나입니다.' });
  try {
    res.json(await heatmap(market, period, { view, top }));
  } catch (e) {
    fail(res, e);
  }
});

// -- 주요 일정 달력 (v2.17.0) --------------------------------------------------
// 실적(earnings_calendar) · FOMC(src/data/fomc.ts) · 옵션 만기(셋째 금요일) · 휴장일(market_holidays).

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

app.get('/api/calendar', (req, res) => {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  const scope = req.query.scope === 'universe' ? 'universe' : 'watchlist';
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to) || from > to) {
    return res.status(400).json({ error: 'from·to 는 YYYY-MM-DD 이고 from ≤ to 여야 합니다.' });
  }
  // 한 번에 1년까지 — 달력 한 화면(한 달)보다 넉넉하다
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) {
    return res.status(400).json({ error: '한 번에 1년까지 조회할 수 있습니다.' });
  }
  try {
    res.json(calendarEvents(from, to, scope));
  } catch (e) {
    fail(res, e);
  }
});

// -- 진단 리포트 (v2.14.0) ---------------------------------------------------
//
// `npm run diagnose` 와 같은 함수(`server/diagnose/report.ts`)를 백그라운드로 돌린다.
// 오라클에서 52초 걸려 시작만 하고 돌려준다 — 화면은 /progress 를 폴링한다.

app.post('/api/diagnose/run', (req, res) => {
  try {
    res.json({ progress: startDiagnose({ quick: req.body?.quick === true }) });
  } catch (e) {
    if (e instanceof DiagnoseBusyError) return res.status(409).json({ error: e.message });
    fail(res, e);
  }
});

app.get('/api/diagnose/progress', (_req, res) => {
  res.json({ progress: getDiagnoseProgress() });
});

/** 과거 리포트 목록 (요약만) — 최근 20개 */
app.get('/api/diagnose/reports', (_req, res) => {
  try {
    res.json({ reports: listDiagnoseReports() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/diagnose/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  try {
    const report = getDiagnoseReport(id);
    if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
    res.json(report);
  } catch (e) {
    fail(res, e);
  }
});

/** 리포트 한 건 삭제 — DB 행만. 서버의 파일 출력은 남는다 (v2.22.0) */
app.delete('/api/diagnose/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  try {
    if (!deleteDiagnoseReport(id)) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

// -- 백테스트 (v2.38.0, 「실험실 > 백테스트」 — 내가 고른 종목 · 내가 정한 조건) -----------------------
//
// 계산은 `autoTrading/ruleResearch.ts` 의 `runCustomBacktest`(v2.37.0 구간·재현·기준선·누설 검사 함수 그대로)를 백그라운드로.
// 주문을 내지 않는다. 같은 날 같은 입력이면 저장된 결과를 돌려준다(강제로 다시 계산은 ?force=1).
// v2.37.0 「미리 정한 시험」 은 화면에서 실행하지 않는다 — `npm run research:rule` 로만, 결과는 같은 표에 kind 'fixed' 로 쌓여 지난 기록에서 읽는다.

app.post('/api/backtest/run', async (req, res) => {
  const parsed = parseBacktestInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    res.json({ progress: await startCustomBacktest(parsed.input, force) });
  } catch (e) {
    if (e instanceof BacktestBusyError) return res.status(409).json({ error: e.message });
    if (e instanceof EngineDownError) return res.status(503).json({ error: '지표 엔진이 꺼져 있어 계산할 수 없습니다.', engineDown: true });
    fail(res, e);
  }
});

/** ① 종목 고르기의 묶음 — 시총 상위 100 중 7분야(순서 고정) + 내 관심 목록. 분야 밖 종목은 묶음에 넣지 않는다(검색으로는 추가할 수 있다) */
app.get('/api/backtest/universe', async (_req, res) => {
  try {
    const t = await researchTargets();
    const watch = watchlistSymbols();
    // 이름은 카탈로그의 한글 이름이 먼저(목록 안 검색이 한글·초성으로 찾는다), 없으면 유니버스 이름
    const info = namesAndSectors([...new Set([...watch, ...t.included.map((x) => x.symbol)])]);
    res.json({
      asOf: t.asOf,
      sectors: BACKTEST_SECTORS.map((sector) => ({
        sector,
        symbols: t.included.filter((x) => x.sector === sector).map((x) => ({ symbol: x.symbol, name: info.get(x.symbol)?.name ?? x.name })),
      })),
      watchlist: watch.map((symbol) => ({ symbol, name: info.get(symbol)?.name ?? null, sector: info.get(symbol)?.sector ?? null })),
    });
  } catch (e) {
    fail(res, e);
  }
});

/** 「AI에게 조건 물어보기」 — Gemini 1회. 시험 기간 앞 1년 숫자만 보낸다(`gemini/backtestAi.ts`) */
app.post('/api/backtest/advice', async (req, res) => {
  const reason = geminiDisabledReason();
  if (reason) return res.status(503).json({ error: reason, geminiDisabled: true });
  const parsed = parseBacktestInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  // 지금 고친 조건(몸의 `label`, 없으면 A)을 「지금 화면의 조건」 으로 보낸다 (v2.39.0)
  const { symbols, years, conditions } = parsed.input;
  const { label: _label, ...current } = conditions.find((c) => c.label === req.body?.label) ?? conditions[0];
  try {
    res.json({ advice: await adviseBacktest({ symbols, years, current }) });
  } catch (e) {
    if (e instanceof AdviceInputError) return res.status(400).json({ error: e.message });
    if (e instanceof GeminiError) return res.status(e.rateLimited ? 429 : 502).json({ error: e.message });
    fail(res, e);
  }
});

/** 「AI에게 결과 설명 듣기」 — Gemini 1회, 그 기록에 저장(다시 열 때는 부르지 않는다) */
app.post('/api/backtest/explain', async (req, res) => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  const found = getBacktest(id);
  if (!found) return res.status(404).json({ error: '결과를 찾을 수 없습니다.' });
  if (found.detail.kind !== 'custom') return res.status(400).json({ error: '미리 정한 시험 결과는 설명을 받지 않습니다.' });
  if (found.detail.explain) return res.json({ explain: found.detail.explain });
  const reason = geminiDisabledReason();
  if (reason) return res.status(503).json({ error: reason, geminiDisabled: true });
  try {
    const explain = await explainBacktest(found.detail);
    saveExplain(id, explain);
    res.json({ explain });
  } catch (e) {
    if (e instanceof GeminiError) return res.status(e.rateLimited ? 429 : 502).json({ error: e.message });
    fail(res, e);
  }
});

app.get('/api/backtest/progress', (_req, res) => {
  res.json({ progress: getBacktestProgress() });
});

app.get('/api/backtest/reports', (_req, res) => {
  try {
    res.json({ reports: listBacktests() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/backtest/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  try {
    const report = getBacktest(id);
    if (!report) return res.status(404).json({ error: '결과를 찾을 수 없습니다.' });
    res.json(report);
  } catch (e) {
    fail(res, e);
  }
});

app.delete('/api/backtest/reports/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 가 올바르지 않습니다.' });
  try {
    if (!deleteBacktest(id)) return res.status(404).json({ error: '결과를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (e) {
    fail(res, e);
  }
});

const port = Number(process.env.API_PORT ?? 4000);
getDb(); // 시작 시 스키마 생성

/*
 * ⚠️ 루프백에만 바인딩한다. 기본값(0.0.0.0)은 같은 공유기 아래의 다른 기기에서도
 * 이 API 에 닿는다 — 인증이 없으므로 카페 와이파이에서 모의투자 계좌가 그대로 열린다.
 * 다른 기기에서 열어야 하면 `.env` 의 `API_HOST` 로 명시한다.
 */
const host = process.env.API_HOST ?? '127.0.0.1';

/*
 * ⚠️ 마지막 그물 — **스택 트레이스를 응답에 싣지 않는다.**
 * Express 기본 핸들러는 개발 모드에서 스택을 그대로 내보내고, 거기에 서버의 절대 경로가
 * 드러난다. 로그에는 남기되 바깥으로는 짧은 문구만 보낸다.
 */
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api]', err instanceof Error ? err.message : String(err));
  if (res.headersSent) return;
  res.status(500).json({ error: '요청을 처리하지 못했습니다.' });
});

app.listen(port, host, () => {
  console.log(`[alphascope] API 서버 http://${host}:${port}`);

  /*
    로그인 상태를 기동 때 한 번 알린다 — 비밀번호를 정하지 않으면 앱 전체가 잠긴다.
    만료된 세션은 지금과 하루 1회 청소한다.
  */
  if (isPasswordSet()) {
    const purged = purgeExpiredSessions();
    console.log(
      `[alphascope] 로그인 사용 중 (세션 ${countSessions()}개${purged ? `, 만료 ${purged}개 정리` : ''})`,
    );
  } else {
    console.warn(
      '[alphascope] ⚠️ 비밀번호가 설정되지 않아 API 가 모두 잠겨 있습니다 — `npm run auth:set-password`',
    );
  }
  setInterval(() => void purgeExpiredSessions(), 86_400_000);

  // 종목 카탈로그는 하루 한 번이면 충분하다. 기동을 막지 않도록 뒤에서 채운다.
  if (!isMockMode()) {
    void refreshCatalog()
      .then((count) => console.log(`[alphascope] 종목 카탈로그 ${count.toLocaleString()}건 준비됨`))
      .catch((e) => console.error('[alphascope] 종목 카탈로그 준비 실패:', e));
  }

  // 시총 유니버스 월별 스냅샷 — 하루 한 번 확인해 이번 달 것이 없으면 받는다 (v2.15.0, 생존 편향 보정용)
  if (!isMockMode()) startUniverseSnapshotScheduler();

  // 실적 발표일 — 하루 1회 (v2.16.0). 스윙 실적 경고와 자동매매 실적 회피가 함께 쓴다
  if (!isMockMode()) startEarningsScheduler();

  // 휴장일 — 하루 1회 (v2.17.0). 실적 회피 거래일 계산·옵션 만기·일정 달력이 쓴다
  startMarketCalendarScheduler();

  // 앱이 꺼져 있던 구간의 모의투자 스냅샷을 채우고, 이후 하루 한 번 기록한다.
  // 지정 종목 Gemini 분석(하루 1번, 미국 마감+30분 뒤)도 같은 10분 확인에 얹는다 — 새 타이머 없음 (v2.23.0)
  void backfillSnapshots().then(() =>
    startSnapshotScheduler(() => {
      void scheduledTick().catch((e) => console.warn('[gemini] 지정 종목 분석 확인 실패:', (e as Error).message));
    }),
  );

  // Gemini 자동 분석 — 키가 없으면 아무 일도 하지 않는다.
  // 자동매매는 계좌별 스케줄러 하나가 맡는다 (Step 12 — 전역 경로는 v2.4.0 에서 제거).
  if (isAutoTradingEnabled()) {
    startAutoTradingScheduler();
    console.log('[alphascope] 계좌별 자동매매 스케줄러 준비됨 (모의 계좌 전용)');
  } else {
    console.log('[alphascope] ⚠️ 자동매매 스케줄러를 시작하지 않습니다 (AUTO_TRADING_ENABLED=false)');
  }
  if (isGeminiEnabled()) console.log(`[alphascope] Gemini 자동 분석 준비됨 (${DEFAULT_MODEL})`);
  else console.log(`[alphascope] Gemini 꺼짐 — ${geminiDisabledReason()}`);
});
