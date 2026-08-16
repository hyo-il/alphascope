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

/** 환율 조회 (기본: USD → KRW) */
export async function fetchExchangeRate(
  baseCurrency = 'USD',
  quoteCurrency = 'KRW',
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
