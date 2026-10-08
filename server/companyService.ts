import type { Fundamentals, PeerSummary } from '../src/types/company';
import { getDb } from './db';
import { readUniverse } from './universe';
import { PEER_MAX, PEER_PAIRS } from '../src/data/peerPairs';

/**
 * 기업 재무 데이터 (yfinance) — Python 서비스 호출 + SQLite 캐시.
 *
 * 재무 데이터는 분기마다 바뀌므로 하루 한 번이면 충분하다. yfinance 호출이
 * 종목당 1~3초 걸려서 캐시가 체감 차이를 만든다.
 */

const PYTHON_URL =
  process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;


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

/**
 * 네트워크를 타지 않고 캐시만 본다.
 *
 * 스윙 추천이 실적 발표일 경고에 쓴다 — 관심 종목 12개에 yfinance 를 새로 부르면
 * 종목당 1~3초라 분석이 30초를 넘긴다. 기업정보를 한 번이라도 본 종목에는 경고가 뜨고,
 * 아닌 종목은 조용히 넘어간다.
 */
export function cachedFundamentals(symbol: string): Fundamentals | null {
  return readCache(symbol);
}

/**
 * 진행 중인 yfinance 조회 공유 (v2.41.0) — 기업 비교에 처음 보는 종목을 넣으면 `/api/company` 와 `/api/summary` 가
 * 같은 종목을 동시에 물어 yfinance 를 두 번 불렀다(각 2~3초). 같은 종목이 조회 중이면 그 결과를 함께 기다린다.
 */
const inFlight = new Map<string, Promise<Fundamentals>>();

export async function getFundamentals(symbol: string, refresh = false): Promise<Fundamentals> {
  if (!refresh) {
    const cached = readCache(symbol);
    if (cached) return cached;
  }
  const running = inFlight.get(symbol);
  if (running) return running;

  const job = callPython<Fundamentals>('/fundamentals', { symbol })
    .then((data) => {
      writeCache(symbol, data);
      return data;
    })
    .finally(() => inFlight.delete(symbol));
  inFlight.set(symbol, job);
  return job;
}

/**
 * 동종업계 (v2.42.0) — 자기 자신 + 최대 `PEER_MAX`(5)개. 국내·미국 함께. 고르는 순서:
 *   ① 직접 정한 짝 표(`src/data/peerPairs.ts`) ② 유니버스(미국·국내 시총 상위) 중 **같은 세부 업종**, 시총이 가까운 순
 *   ③ 그래도 모자라면 유니버스 중 **같은 섹터**, 시총이 가까운 순. 모자라면 있는 만큼.
 * 세부 업종·섹터는 `stock_profiles`(실적일 하루 1회 갱신이 같은 yfinance info 로 채운다 — 여기서 새로 부르지 않는다).
 * 예전에는 섹터별 **미국 종목 고정 표**(SECTOR_PEERS)라 국내 종목에 미국 대형주만 나왔다.
 */
export async function getPeers(symbol: string, sector?: string): Promise<PeerSummary[]> {
  const me = symbol.toUpperCase();
  const fundamentals = await getFundamentals(me).catch(() => null);
  const mySector = sector ?? fundamentals?.profile.sector ?? null;
  const myIndustry = fundamentals?.profile.industry ?? null;
  const myCap = fundamentals?.profile.marketCap ?? null;

  const picked: { symbol: string; basis: PeerSummary['basis'] }[] = [];
  const add = (s: string, basis: PeerSummary['basis']) => {
    const up = s.toUpperCase();
    if (up === me || picked.length >= PEER_MAX || picked.some((p) => p.symbol === up)) return;
    picked.push({ symbol: up, basis });
  };
  for (const s of PEER_PAIRS[me] ?? []) add(s, 'pair');

  if (picked.length < PEER_MAX) {
    let universe: { symbol: string; marketCap: number | null }[] = [];
    try {
      const u = readUniverse();
      universe = [...u.us, ...u.kr].map((e) => ({ symbol: e.symbol.toUpperCase(), marketCap: e.marketCap }));
    } catch {
      /* 유니버스 파일이 없으면 짝 표만 */
    }
    const rows = universe.length
      ? (getDb()
          .prepare(`SELECT symbol, sector, industry, market_cap FROM stock_profiles WHERE symbol IN (${universe.map(() => '?').join(',')})`)
          .all(...universe.map((e) => e.symbol)) as { symbol: string; sector: string | null; industry: string | null; market_cap: number | null }[])
      : [];
    const info = new Map(rows.map((r) => [r.symbol, r]));
    /** 시총이 가까운 순(로그 거리) — 시총을 모르면 뒤로 */
    const near = (a: { symbol: string; marketCap: number | null }) => {
      const cap = a.marketCap ?? info.get(a.symbol)?.market_cap ?? null;
      return cap && myCap ? Math.abs(Math.log(cap) - Math.log(myCap)) : Number.POSITIVE_INFINITY;
    };
    const byNear = [...universe].sort((a, b) => near(a) - near(b));
    if (myIndustry) for (const e of byNear) if (info.get(e.symbol)?.industry === myIndustry) add(e.symbol, 'industry');
    if (mySector) for (const e of byNear) if (info.get(e.symbol)?.sector === mySector) add(e.symbol, 'sector');
  }

  const symbols = [me, ...picked.map((p) => p.symbol)];
  const payload = await callPython<{ peers: PeerSummary[] }>('/peers', { symbols: symbols.join(',') });
  const basisOf = new Map(picked.map((p) => [p.symbol, p.basis]));
  return payload.peers.map((p) => ({ ...p, basis: p.symbol.toUpperCase() === me ? 'self' : (basisOf.get(p.symbol.toUpperCase()) ?? 'sector') }));
}
