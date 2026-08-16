import 'dotenv/config';
import { getAccessToken } from '../src/services/toss/auth';
import { fetchCandles, fetchOrderbook, fetchPrice } from '../src/services/toss/market';
import { getCandles } from '../server/candleService';

/**
 * Step 1 검증 스크립트: `npm run smoke`
 * 토큰 발급 → AAPL 캔들/현재가/호가 조회 → SQLite 캐시 경유 조회까지 확인한다.
 */
const SYMBOL = process.argv[2]?.toUpperCase() ?? 'AAPL';

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  process.stdout.write(`▶ ${label} ... `);
  try {
    const result = await fn();
    console.log('OK');
    return result;
  } catch (e) {
    console.log('실패');
    console.error('  ', e instanceof Error ? e.message : e);
    return null;
  }
}

async function main() {
  console.log(`\nAlphaScope Step 1 스모크 테스트 — ${SYMBOL}\n`);

  const token = await step('OAuth 토큰 발급', () => getAccessToken());
  if (!token) {
    console.error('\n토큰 발급이 실패해 이후 단계를 건너뜁니다. .env 의 토스 API 키를 확인하세요.\n');
    process.exit(1);
  }
  // 토큰 값은 로그에 남기지 않는다 (길이만 확인).
  console.log(`   토큰 발급됨 (${token.length}자)`);

  const daily = await step('일봉 캔들 조회 (GET /api/v1/candles)', () =>
    fetchCandles(SYMBOL, '1d', 30),
  );
  if (daily?.length) {
    console.log(`   ${daily.length}개, 최근:`, daily.at(-1));
  }

  const price = await step('현재가 조회 (GET /api/v1/prices)', () => fetchPrice(SYMBOL));
  if (price) console.log('  ', price);

  const orderbook = await step('호가 조회 (GET /api/v1/orderbook)', () => fetchOrderbook(SYMBOL));
  if (orderbook) {
    console.log(`   asks ${orderbook.asks.length} / bids ${orderbook.bids.length}`);
  }

  const cached = await step('SQLite 캐시 경유 조회', () => getCandles(SYMBOL, '1d', 30));
  if (cached) console.log(`   ${cached.length}개 (캐시 저장 후 재조회)`);

  console.log('\n완료.\n');
}

void main();
