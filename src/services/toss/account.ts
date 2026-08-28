import type { ExchangeRate, Holding, Portfolio, TossAccount } from '../../types/toss';
import { tossGet } from './httpClient';

/**
 * 계좌 · 보유주식 · 환율. 스키마는 실제 응답으로 확인했다.
 *
 * ⚠️ `x-tossinvest-account` 헤더에는 **계좌번호(accountNo)가 아니라 accountSeq** 를 넣는다.
 *    accountNo 를 넣으면 400 account-not-found 가 돌아온다.
 * - 금액·수량은 모두 문자열로 온다
 * - 수익률(`rate`)은 소수다 (-0.578 = -57.8%)
 */

type Raw = Record<string, unknown>;

function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

interface AccountsResponse {
  result?: Raw[];
}

export async function fetchAccounts(): Promise<TossAccount[]> {
  const payload = await tossGet<AccountsResponse>('/api/v1/accounts', {}, 'ACCOUNT');
  return (payload.result ?? []).map((row) => ({
    accountNo: str(row.accountNo),
    accountSeq: num(row.accountSeq),
    accountType: str(row.accountType),
  }));
}

let cachedAccountSeq: number | null = null;

/** 기본 계좌의 accountSeq. 한 번 조회하면 프로세스 내에서 재사용한다 (ACCOUNT 한도는 1/s). */
async function getDefaultAccountSeq(): Promise<number> {
  if (cachedAccountSeq !== null) return cachedAccountSeq;

  const accounts = await fetchAccounts();
  if (!accounts.length) throw new Error('조회 가능한 계좌가 없습니다.');

  cachedAccountSeq = accounts[0].accountSeq;
  return cachedAccountSeq;
}

interface HoldingsResponse {
  result?: {
    totalPurchaseAmount?: { krw?: string; usd?: string };
    marketValue?: { amount?: { krw?: string; usd?: string } };
    profitLoss?: { amount?: { krw?: string; usd?: string }; rate?: string };
    dailyProfitLoss?: { amount?: { krw?: string; usd?: string }; rate?: string };
    items?: Raw[];
  };
}

/** 보유 주식 + 계좌 전체 요약 */
export async function fetchPortfolio(): Promise<Portfolio> {
  const accountSeq = await getDefaultAccountSeq();
  const payload = await tossGet<HoldingsResponse>('/api/v1/holdings', {}, 'ASSET', {
    'x-tossinvest-account': String(accountSeq),
  });

  const result = payload.result ?? {};

  const holdings: Holding[] = (result.items ?? []).map((row) => {
    const marketValue = (row.marketValue ?? {}) as Raw;
    const profitLoss = (row.profitLoss ?? {}) as Raw;
    const daily = (row.dailyProfitLoss ?? {}) as Raw;

    return {
      symbol: str(row.symbol),
      name: str(row.name),
      currency: str(row.currency) || 'USD',
      quantity: num(row.quantity),
      averagePrice: num(row.averagePurchasePrice),
      currentPrice: num(row.lastPrice),
      purchaseAmount: num(marketValue.purchaseAmount),
      evaluationAmount: num(marketValue.amount),
      profitLoss: num(profitLoss.amount),
      // 응답은 소수로 오므로 퍼센트로 바꾼다.
      profitLossRate: num(profitLoss.rate) * 100,
      dailyProfitLoss: num(daily.amount),
      dailyProfitLossRate: num(daily.rate) * 100,
    };
  });

  return {
    holdings,
    summary: {
      purchaseAmountUsd: num(result.totalPurchaseAmount?.usd),
      evaluationAmountUsd: num(result.marketValue?.amount?.usd),
      profitLossUsd: num(result.profitLoss?.amount?.usd),
      profitLossRate: num(result.profitLoss?.rate) * 100,
      dailyProfitLossUsd: num(result.dailyProfitLoss?.amount?.usd),
      dailyProfitLossRate: num(result.dailyProfitLoss?.rate) * 100,
    },
  };
}

interface ExchangeRateResponse {
  result?: Raw | Raw[];
}

/**
 * 환율 캐시.
 *
 * ⚠️ 이게 없으면 초당 여러 번 토스를 때린다. `valuePositions()` 가 평가할 때마다
 * 환율을 부르는데, 모의투자 화면(1초 폴링)과 빠른주문 패널(2초)이 동시에 돌면
 * 초당 3회에 근접한다 — MARKET_INFO 한도가 정확히 3/s 라서 다른 호출까지 밀린다.
 *
 * 환율은 초 단위로 의미 있게 움직이지 않으므로 60초면 충분하다.
 * 진행 중인 요청도 공유해서, 캐시가 빈 상태에서 동시에 들어온 호출이
 * 각자 API 를 때리지 않게 한다.
 */
const RATE_TTL_MS = 60_000;
const rateCache = new Map<string, { value: ExchangeRate; at: number }>();
const ratePending = new Map<string, Promise<ExchangeRate>>();

/** 환율 조회 (기본: USD → KRW) — 60초 캐시 */
export async function fetchExchangeRate(
  baseCurrency = 'USD',
  quoteCurrency = 'KRW',
): Promise<ExchangeRate> {
  const key = `${baseCurrency}/${quoteCurrency}`;

  const cached = rateCache.get(key);
  if (cached && Date.now() - cached.at < RATE_TTL_MS) return cached.value;

  const inflight = ratePending.get(key);
  if (inflight) return inflight;

  const request = fetchExchangeRateUncached(baseCurrency, quoteCurrency)
    .then((value) => {
      // 값을 못 읽은 응답(NaN)은 캐시하지 않는다 — 60초 동안 계속 틀린 값을 준다.
      if (Number.isFinite(value.rate)) rateCache.set(key, { value, at: Date.now() });
      return value;
    })
    .finally(() => ratePending.delete(key));

  ratePending.set(key, request);
  return request;
}

async function fetchExchangeRateUncached(
  baseCurrency: string,
  quoteCurrency: string,
): Promise<ExchangeRate> {
  const payload = await tossGet<ExchangeRateResponse>(
    '/api/v1/exchange-rate',
    { baseCurrency, quoteCurrency },
    'MARKET_INFO',
  );

  const row = ((Array.isArray(payload.result) ? payload.result[0] : payload.result) ?? {}) as Raw;
  const rate = [row.rate, row.exchangeRate, row.basePrice, row.price]
    .map(num)
    .find((value) => Number.isFinite(value));

  return {
    baseCurrency,
    quoteCurrency,
    rate: rate ?? NaN,
    fetchedAt: Date.now(),
  };
}
