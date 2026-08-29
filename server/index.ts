import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Timeframe } from '../src/types/toss';
import { fetchOrderbook, fetchPrice } from '../src/services/toss/market';
import { fetchExchangeRate, fetchPortfolio } from '../src/services/toss/account';
import { getFundamentals, getPeers } from './companyService';
import { getCandles, getCandlesBefore } from './candleService';
import { summarizeSymbols } from './summaryService';
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
import { runAnalysis } from './gemini/analyze';
import { applySignal } from './gemini/autoTrade';
import { DEFAULT_MODEL, GeminiError, isGeminiEnabled } from './gemini/client';
import { accuracyReport } from './gemini/accuracy';
import {
  deleteAllAnalyses as deleteAllGeminiAnalyses,
  deleteAnalysis as deleteGeminiAnalysis,
  getAnalysis as getGeminiAnalysis,
  listAnalyses as listGeminiAnalyses,
} from './gemini/store';
import {
  tradeOptionsOf,
  getSettings as getGeminiSettings,
  getStatus as getGeminiStatus,
  runOnce as runGeminiOnce,
  saveSettings as saveGeminiSettings,
  startScheduler as startGeminiScheduler,
} from './gemini/scheduler';
import { computeIndicators, IndicatorEngineError, indicatorEngineHealthy } from './indicatorService';
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
  resetAccount,
  settlePendingOrders,
  valuePositions,
  getAccount as getPaperAccount,
} from './paperTradingService';
import { computePerformance, listSnapshots } from './paperPerformanceService';
import { backfillSnapshots, startSnapshotScheduler } from './paperSnapshotScheduler';

/**
 * AlphaScope API 서버.
 * 토스 API 키는 이 프로세스에만 존재하고, 브라우저는 /api/* 만 호출한다.
 */
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // 차트 캡처 이미지 대비

const VALID_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1d'];

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

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    mock: isMockMode(),
    indicatorEngine: await indicatorEngineHealthy(),
    time: new Date().toISOString(),
  });
});

app.get('/api/candles', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  const timeframe = String(req.query.timeframe ?? '1d') as Timeframe;
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 300)));

  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
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
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  const timeframe = String(req.query.timeframe ?? '1d') as Timeframe;
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 300)));

  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
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
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
  try {
    const price = isMockMode() ? mockPrice(symbol) : await withDailyChange(symbol);
    res.json({ price, mock: isMockMode() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/orderbook', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
  try {
    const orderbook = isMockMode() ? mockOrderbook(symbol) : await fetchOrderbook(symbol);
    res.json({ orderbook, mock: isMockMode() });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/company', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  const refresh = req.query.refresh === 'true';
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });

  try {
    res.json({ fundamentals: await getFundamentals(symbol, refresh) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/peers', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });

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
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
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
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 30);

  if (!symbols.length) return res.json({ quotes: [] });

  try {
    res.json({ quotes: await fetchQuotes(symbols) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/summary', async (req, res) => {
  const symbols = String(req.query.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
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
    deleteAccount(accountIdOf(req));
    res.json({ ok: true });
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
  res.status(503).json({ error: 'GEMINI_API_KEY 가 설정되지 않았습니다.', geminiDisabled: true });
  return false;
}

app.get('/api/gemini/status', (_req, res) => {
  try {
    res.json({
      enabled: isGeminiEnabled(),
      model: DEFAULT_MODEL,
      settings: isGeminiEnabled() ? getGeminiSettings() : null,
      status: isGeminiEnabled() ? getGeminiStatus() : null,
    });
  } catch (e) {
    fail(res, e);
  }
});

app.put('/api/gemini/settings', (req, res) => {
  if (!requireGemini(res)) return;
  try {
    res.json(saveGeminiSettings(req.body ?? {}));
  } catch (e) {
    fail(res, e);
  }
});

/** 한 종목 즉시 분석 (사용자가 버튼으로 실행) */
app.post('/api/gemini/analyze', async (req, res) => {
  if (!requireGemini(res)) return;
  const symbol = String(req.body?.symbol ?? '').trim();
  if (!symbol) return res.status(400).json({ error: 'symbol 이 필요합니다.' });

  try {
    const settingsForRun = getGeminiSettings();
    const analysis = await runAnalysis({
      symbol,
      trigger: 'manual',
      chartImage: req.body?.chartImage ?? null,
      horizon: req.body?.horizon ?? settingsForRun.horizon,
    });

    // 수동 실행에서도 자동매매가 켜져 있으면 같은 규칙으로 주문한다.
    const settings = settingsForRun;
    if (req.body?.autoTrade !== false && settings.autoTrade && settings.paperAccountId) {
      const result = await applySignal(analysis, tradeOptionsOf(settings));
      analysis.paperOrderId = result.orderId;
      analysis.tradeNote = result.note;
    }
    res.json(analysis);
  } catch (e) {
    if (e instanceof GeminiError) {
      return res.status(e.rateLimited ? 429 : 502).json({ error: e.message });
    }
    fail(res, e);
  }
});

/** 설정된 종목 전체를 지금 한 바퀴 */
app.post('/api/gemini/run', async (_req, res) => {
  if (!requireGemini(res)) return;
  try {
    res.json(await runGeminiOnce('manual'));
  } catch (e) {
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
app.get('/api/ai/accuracy', (_req, res) => {
  try {
    res.json(accuracyReport());
  } catch (e) {
    fail(res, e);
  }
});

const port = Number(process.env.API_PORT ?? 4000);
getDb(); // 시작 시 스키마 생성

app.listen(port, () => {
  console.log(`[alphascope] API 서버 http://localhost:${port}`);

  // 종목 카탈로그는 하루 한 번이면 충분하다. 기동을 막지 않도록 뒤에서 채운다.
  if (!isMockMode()) {
    void refreshCatalog()
      .then((count) => console.log(`[alphascope] 종목 카탈로그 ${count.toLocaleString()}건 준비됨`))
      .catch((e) => console.error('[alphascope] 종목 카탈로그 준비 실패:', e));
  }

  // 앱이 꺼져 있던 구간의 모의투자 스냅샷을 채우고, 이후 하루 한 번 기록한다.
  void backfillSnapshots().then(() => startSnapshotScheduler());

  // Gemini 자동 분석 — 키가 없으면 아무 일도 하지 않는다.
  startGeminiScheduler();
  if (isGeminiEnabled()) console.log(`[alphascope] Gemini 자동 분석 준비됨 (${DEFAULT_MODEL})`);
});
