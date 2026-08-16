import 'dotenv/config';
import { getAccessToken } from '../src/services/toss/auth';

/**
 * 토스 API 원본 응답을 그대로 찍어 보는 도구.
 *
 *   npm run probe                          # 기본 엔드포인트 3종
 *   npm run probe -- /api/v1/holdings      # 임의 경로 (쿼리는 key=value 로 이어서)
 *   npm run probe -- /api/v1/candles symbol=AAPL interval=1m count=3
 *
 * 응답 필드명이 바뀌었거나 새 엔드포인트를 붙일 때 스키마를 확인하는 용도다.
 */

const BASE = process.env.TOSS_BASE_URL ?? 'https://openapi.tossinvest.com';

async function probe(path: string, params: Record<string, string>) {
  const token = await getAccessToken();
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();

  console.log(`\n=== ${path} ${JSON.stringify(params)} → ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2).slice(0, 1500));
  } catch {
    console.log(text.slice(0, 1000));
  }
}

async function main() {
  const [path, ...rest] = process.argv.slice(2);

  if (path) {
    const params = Object.fromEntries(
      rest.map((pair) => {
        const index = pair.indexOf('=');
        return [pair.slice(0, index), pair.slice(index + 1)];
      }),
    );
    await probe(path, params);
    return;
  }

  await probe('/api/v1/candles', { symbol: 'AAPL', interval: '1d', count: '3' });
  await probe('/api/v1/prices', { symbols: 'AAPL' });
  await probe('/api/v1/orderbook', { symbols: 'AAPL' });
}

void main();
