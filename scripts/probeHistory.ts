import 'dotenv/config';
import { tossGet } from '../src/services/toss/httpClient';

/**
 * 과거 데이터 보유 범위 조사 도구.
 *
 *   npm run probe:history                 # AAPL 일봉
 *   npm run probe:history -- 005930 1d    # 종목·주기 지정
 *
 * `before` 커서를 따라 끝까지 내려가며 몇 봉까지, 언제까지 받을 수 있는지 확인한다.
 */

const MAX_PAGES = 60; // 안전장치 — 200봉 × 60 = 12,000봉

interface Candle {
  timestamp: string;
  closePrice: string;
}

// tossGet 을 쓰면 토큰 자동 갱신·Rate Limit·재시도가 함께 처리된다.
async function page(symbol: string, interval: string, before?: string) {
  const payload = await tossGet<{ result?: { candles?: Candle[]; nextBefore?: string } }>(
    '/api/v1/candles',
    { symbol, interval, count: 200, before },
    'MARKET_DATA_CHART',
  );
  return {
    candles: payload.result?.candles ?? [],
    nextBefore: payload.result?.nextBefore,
  };
}

async function main() {
  const symbol = (process.argv[2] ?? 'AAPL').toUpperCase();
  const interval = process.argv[3] ?? '1d';

  console.log(`\n과거 데이터 범위 조사 — ${symbol} ${interval}\n`);

  let before: string | undefined;
  let total = 0;
  let newest: string | null = null;
  let oldest: string | null = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const result = await page(symbol, interval, before);
    pages += 1;

    if (!result.candles.length) {
      console.log(`${pages}페이지: 빈 응답 — 더 이상 데이터 없음`);
      break;
    }

    total += result.candles.length;
    newest ??= result.candles[0].timestamp;
    oldest = result.candles.at(-1)!.timestamp;

    if (pages % 5 === 0 || pages === 1) {
      console.log(
        `${String(pages).padStart(2)}페이지 · 누적 ${String(total).padStart(5)}봉 · 최과거 ${oldest.slice(0, 10)}`,
      );
    }

    if (!result.nextBefore) {
      console.log(`${pages}페이지: nextBefore 없음 — 마지막 페이지`);
      break;
    }
    before = result.nextBefore;
  }

  const years =
    newest && oldest
      ? ((Date.parse(newest) - Date.parse(oldest)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
      : '?';

  console.log(`
=== 결과 ===
최근 데이터   : ${newest?.slice(0, 10) ?? '—'}
최과거 데이터 : ${oldest?.slice(0, 10) ?? '—'}
총 개수       : ${total.toLocaleString()}봉 (${pages}페이지)
기간          : 약 ${years}년
`);
}

void main();
