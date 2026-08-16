import type { Fundamentals, PeerSummary } from '../src/types/company';
import { getDb } from './db';

/**
 * 기업 재무 데이터 (yfinance) — Python 서비스 호출 + SQLite 캐시.
 *
 * 재무 데이터는 분기마다 바뀌므로 하루 한 번이면 충분하다. yfinance 호출이
 * 종목당 1~3초 걸려서 캐시가 체감 차이를 만든다.
 */

const PYTHON_URL =
  process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** 섹터별 대표 종목 — yfinance 에는 동종업계 목록 API 가 없어서 직접 둔다. */
const SECTOR_PEERS: Record<string, string[]> = {
  Technology: ['AAPL', 'MSFT', 'NVDA', 'AVGO', 'ORCL', 'CRM', 'AMD'],
  'Communication Services': ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS'],
  'Consumer Cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX'],
  'Consumer Defensive': ['WMT', 'COST', 'PG', 'KO', 'PEP'],
  Healthcare: ['LLY', 'UNH', 'JNJ', 'ABBV', 'MRK', 'PFE'],
  'Financial Services': ['BRK-B', 'JPM', 'V', 'MA', 'BAC', 'GS'],
  Energy: ['XOM', 'CVX', 'COP', 'SLB'],
  Industrials: ['GE', 'CAT', 'RTX', 'BA', 'UNP'],
  'Basic Materials': ['LIN', 'SHW', 'FCX', 'NEM'],
  Utilities: ['NEE', 'DUK', 'SO', 'AEP'],
  'Real Estate': ['PLD', 'AMT', 'EQIX', 'SPG'],
};

async function callPython<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(path, PYTHON_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let res: Response;
  try {
    // yfinance 는 외부 네트워크를 타므로 지표 계산보다 넉넉히 기다린다.
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new Error(
      `기업 데이터 서비스에 연결하지 못했습니다 (${PYTHON_URL}). ` +
        `\`npm run dev\` 로 함께 띄우세요. 원인: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok || payload.error) throw new Error(payload.error ?? `요청 실패 (${res.status})`);
  return payload;
}

function readCache(symbol: string): Fundamentals | null {
  const row = getDb()
    .prepare('SELECT data, updated_at FROM company_data WHERE symbol = ?')
    .get(symbol) as { data: string; updated_at: string } | undefined;

  if (!row) return null;
  if (Date.now() - Date.parse(row.updated_at) > CACHE_TTL_MS) return null;

  try {
    return JSON.parse(row.data) as Fundamentals;
  } catch {
    return null;
  }
}

function writeCache(symbol: string, data: Fundamentals): void {
  getDb()
    .prepare(
      `INSERT INTO company_data (symbol, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(symbol, JSON.stringify(data), new Date().toISOString());
}

export async function getFundamentals(symbol: string, refresh = false): Promise<Fundamentals> {
  if (!refresh) {
    const cached = readCache(symbol);
    if (cached) return cached;
  }

  const data = await callPython<Fundamentals>('/fundamentals', { symbol });
  writeCache(symbol, data);
  return data;
}

/** 같은 섹터의 대표 종목들과 비교한다. 자기 자신은 항상 포함한다. */
export async function getPeers(symbol: string, sector?: string): Promise<PeerSummary[]> {
  const resolvedSector = sector ?? (await getFundamentals(symbol)).profile.sector ?? '';
  const peers = SECTOR_PEERS[resolvedSector] ?? [];

  const symbols = [symbol, ...peers.filter((peer) => peer !== symbol)].slice(0, 8);
  const payload = await callPython<{ peers: PeerSummary[] }>('/peers', {
    symbols: symbols.join(','),
  });
  return payload.peers;
}
