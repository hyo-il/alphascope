import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import type { Timeframe } from '../src/types/toss';
import { fetchOrderbook, fetchPrice } from '../src/services/toss/market';
import { getCandles } from './candleService';
import { getDb } from './db';

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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
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
    res.json({ symbol, timeframe, candles });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/prices', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
  try {
    res.json({ price: await fetchPrice(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

app.get('/api/orderbook', async (req, res) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol 파라미터가 필요합니다.' });
  try {
    res.json({ orderbook: await fetchOrderbook(symbol) });
  } catch (e) {
    fail(res, e);
  }
});

const port = Number(process.env.API_PORT ?? 4000);
getDb(); // 시작 시 스키마 생성
app.listen(port, () => {
  console.log(`[alphascope] API 서버 http://localhost:${port}`);
});
