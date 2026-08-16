import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Timeframe } from '../src/types/toss';
import { fetchOrderbook, fetchPrice } from '../src/services/toss/market';
import { getCandles } from './candleService';
import { getDb } from './db';
import { isMockMode, mockOrderbook, mockPrice } from './mockData';
import { computeIndicators, IndicatorEngineError, indicatorEngineHealthy } from './indicatorService';

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
    const candles = await getCandles(symbol, timeframe, limit);
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
    const price = isMockMode() ? mockPrice(symbol) : await fetchPrice(symbol);
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

const port = Number(process.env.API_PORT ?? 4000);
getDb(); // 시작 시 스키마 생성
app.listen(port, () => {
  console.log(`[alphascope] API 서버 http://localhost:${port}`);
});
