/**
 * 대형주 유니버스 — `npm run universe:update` 와 서버의 **월별 스냅샷**(v2.15.0)이 같은 함수를 쓴다.
 *
 * 미국 시가총액 상위 100 + 국내 시가총액 상위 100 을 `server/data/universe.json` 에 저장한다.
 * `npm run research:target` 과 다음 화면 작업이 이 파일을 쓴다 — **파일로 고정**해 두어야
 * 같은 연구를 다시 돌렸을 때 같은 종목으로 재현된다.
 *
 * 출처: yfinance 스크리너(시가총액 내림차순, `python/universe.py`).
 * 거르기(여기서 한다):
 *   - ETF·ETN 등 주식이 아닌 것 (quoteType ≠ EQUITY)
 *   - SPAC (이름으로 판별)
 *   - 국내 우선주 (종목코드 끝자리가 0 이 아니거나 이름이 '우'·'우B' 로 끝남)
 *   - 같은 회사의 중복 클래스 (GOOG/GOOGL → 관심 목록에 있는 쪽, 없으면 거래량 많은 쪽)
 *   - 토스 카탈로그에 없는 심볼 (토스 캔들을 받을 수 없다)
 *
 * ⚠️ 생존 편향: "오늘의 시총 상위" 로 과거를 시험하면 그사이 망하거나 밀려난 회사는 빠진다.
 * 없앨 수 없으니 연구 리포트에 한계로 적는다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getDb } from './db';
import { findStock } from './stockCatalog';
import { isKrSymbol } from '../src/utils/market';
import { marketDate } from '../src/utils/marketDate';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UNIVERSE_PATH = path.join(root, 'server/data/universe.json');
const TAKE = 100;

/** 연구 대상 관심 종목 (오라클 기준, 2026-09-29 지시서) — 중복 클래스를 고를 때 이쪽을 우선한다 */
const PREFERRED = new Set(['AAPL', 'GOOGL', 'NVDA', 'TSM', 'AVGO', 'MU', 'BE', 'ETN', 'VRT', 'GEV', 'NEE']);

interface Raw {
  symbol: string;
  name: string | null;
  shortName: string | null;
  quoteType: string | null;
  exchange: string | null;
  marketCap: number | null;
  avgVolume: number | null;
}

export interface UniverseEntry {
  symbol: string;
  name: string;
  marketCap: number | null;
}

export interface Universe {
  asOf: string;
  source: string;
  us: UniverseEntry[];
  kr: UniverseEntry[];
  excluded: { symbol: string; name: string | null; reason: string }[];
}

const SPAC = /\bacquisition\b|\bSPAC\b|blank check|스팩/i;

/** 같은 회사 판별용 이름 — 클래스·법인 형태 표기를 걷어 낸다 */
const companyKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(class|series)\s+[a-z]\b/g, '')
    .replace(/\b(inc|corp|corporation|co|ltd|plc|n\.v|s\.a|holdings?|group|company)\b\.?/g, '')
    .replace(/[^a-z0-9가-힣]/g, '');

function build(raws: Raw[], market: 'us' | 'kr', excluded: Universe['excluded']): UniverseEntry[] {
  const kept: (UniverseEntry & { key: string; volume: number })[] = [];

  for (const r of raws) {
    const drop = (reason: string) => excluded.push({ symbol: r.symbol, name: r.name, reason });
    if (!r.symbol) continue;
    if (r.quoteType !== 'EQUITY') { drop(`주식 아님(${r.quoteType})`); continue; }
    if (SPAC.test(`${r.name ?? ''} ${r.shortName ?? ''}`)) { drop('SPAC'); continue; }

    let symbol: string;
    if (market === 'kr') {
      symbol = r.symbol.replace(/\.(KS|KQ)$/, '');
      if (!isKrSymbol(symbol)) { drop('국내 코드 형식 아님'); continue; }
      // 보통주 코드는 끝자리가 0 이다 (005930 보통주 / 005935·02826K 우선주, 0126Z0 은 보통주)
      if (!symbol.endsWith('0')) { drop('우선주(코드)'); continue; }
    } else {
      symbol = r.symbol.replace(/-/g, '.'); // yfinance BRK-B → 토스 BRK.B
    }

    const stock = findStock(symbol);
    if (!stock) { drop('토스 카탈로그에 없음'); continue; }
    if (market === 'kr' && !['KOSPI', 'KOSDAQ'].includes(stock.market ?? '')) { drop(`국내 시장 아님(${stock.market})`); continue; }
    if (market === 'us' && !['NASDAQ', 'NYSE', 'AMEX'].includes(stock.market ?? '')) { drop(`미국 시장 아님(${stock.market})`); continue; }
    if (market === 'kr' && /우[A-Z]?$|\(\d?P|Pfd/i.test(`${stock.name}`)) { drop('우선주(이름)'); continue; }
    if (/ETF|ETN/.test(stock.name ?? '')) { drop('ETF/ETN(이름)'); continue; }

    const key = companyKey(r.name ?? stock.name ?? symbol) || symbol;
    const entry = { symbol, name: stock.name ?? r.name ?? symbol, marketCap: r.marketCap, key, volume: r.avgVolume ?? 0 };
    const twin = kept.findIndex((k) => k.key === key);
    if (twin >= 0) {
      const other = kept[twin];
      const preferNew =
        PREFERRED.has(symbol) || (!PREFERRED.has(other.symbol) && entry.volume > other.volume);
      if (preferNew) {
        excluded.push({ symbol: other.symbol, name: other.name, reason: `중복 클래스(${symbol} 유지)` });
        kept[twin] = { ...entry, marketCap: other.marketCap ?? entry.marketCap };
      } else {
        drop(`중복 클래스(${other.symbol} 유지)`);
      }
      continue;
    }
    kept.push(entry);
    if (kept.length >= TAKE) break;
  }

  return kept.slice(0, TAKE).map(({ symbol, name, marketCap }) => ({ symbol, name, marketCap }));
}

/**
 * yfinance 로 새로 받아 `universe.json`(최신본)을 덮어쓰고 그 달 스냅샷도 남긴다.
 * ⚠️ 비동기다 — 서버 안에서 돌 때 20초 남짓 걸리는 Python 호출이 다른 요청을 막지 않게.
 */
export async function updateUniverse(): Promise<Universe> {
  const python = path.join(root, 'python/.venv/bin/python');
  const { stdout: out } = await run(python, [path.join(root, 'python/universe.py')], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const raw = JSON.parse(out) as { us: Raw[]; kr: Raw[]; yfinance: string };
  const excluded: Universe['excluded'] = [];
  const universe: Universe = {
    asOf: new Date().toISOString(),
    source: `yfinance ${raw.yfinance} 스크리너(시가총액 내림차순) — 미국 NMS·NYQ·NGM·NCM·ASE / 국내 KSC·KOE, 토스 카탈로그 확인`,
    us: build(raw.us, 'us', excluded),
    kr: build(raw.kr, 'kr', excluded),
    excluded,
  };
  fs.mkdirSync(path.dirname(UNIVERSE_PATH), { recursive: true });
  fs.writeFileSync(UNIVERSE_PATH, `${JSON.stringify(universe, null, 2)}\n`, 'utf8');
  saveSnapshot(universe);
  return universe;
}

export function readUniverse(): Universe {
  return JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8')) as Universe;
}

// ── 월별 스냅샷 (v2.15.0) ────────────────────────────────────────────────────
//
// 목적: 1년 뒤 "그 시점의 시총 상위" 로 과거를 시험해 **생존 편향을 줄이기** 위해서다.
// 오늘의 상위 100 으로 과거를 보면 그사이 밀려난 회사가 빠져 결과가 좋아 보인다.
// `universe.json` 은 최신본 하나, DB `universe_snapshots` 는 달마다 한 행씩 쌓인다.

/** 스냅샷의 달 — 사용자가 한국에 있으므로 KST 기준 (YYYY-MM) */
export const snapshotMonth = (ms: number) => marketDate(ms, '005930').slice(0, 7);

/** 그 달 행이 이미 있으면 아무것도 하지 않는다 (PRIMARY KEY + INSERT OR IGNORE — 중복 저장 없음) */
export function saveSnapshot(universe: Universe): boolean {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO universe_snapshots (month, as_of, source, us_json, kr_json) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(snapshotMonth(Date.parse(universe.asOf)), universe.asOf, universe.source, JSON.stringify(universe.us), JSON.stringify(universe.kr));
  return info.changes > 0;
}

export function hasSnapshot(month: string): boolean {
  return !!getDb().prepare(`SELECT 1 FROM universe_snapshots WHERE month = ?`).get(month);
}

/**
 * 이번 달 스냅샷이 없으면 받는다. 반환: 'exists' | 'seeded' | 'fetched'.
 * 1) 먼저 `universe.json` 이 이번 달 것이면 그대로 넣는다 — 같은 기준일이면 다시 받지 않는다.
 * 2) 아니면 `updateUniverse()` 로 새로 받는다(파일도 갱신된다).
 * `fetcher` 는 시험용으로 바꿔 끼울 수 있다(네트워크 없이 달 넘김을 확인).
 */
export async function ensureMonthlySnapshot(
  now = Date.now(),
  fetcher: () => Promise<Universe> = updateUniverse,
): Promise<'exists' | 'seeded' | 'fetched'> {
  const month = snapshotMonth(now);
  if (hasSnapshot(month)) return 'exists';
  try {
    const current = readUniverse();
    if (snapshotMonth(Date.parse(current.asOf)) === month) {
      saveSnapshot(current);
      return 'seeded';
    }
  } catch {
    /* 파일이 없으면 새로 받는다 */
  }
  const fresh = await fetcher();
  saveSnapshot(fresh); // updateUniverse 가 이미 넣었으면 무시된다
  return 'fetched';
}

const DAY_MS = 86_400_000;
let running = false;

/**
 * 서버가 떠 있는 동안 **하루 한 번** 확인한다. 오라클은 계속 떠 있으므로 달마다 자동으로 쌓인다.
 * 실패하면 로그만 남기고 다음 날 다시 시도한다. 한 번에 하나만 돈다.
 */
export function startUniverseSnapshotScheduler(): void {
  // 테스트 서버 스위치 (v2.41.0) — false 면 유니버스 파일 쓰기·월별 스냅샷 받기를 하지 않는다(읽기는 그대로).
  // 복사본 DB 로 띄운 테스트 서버가 저장소의 server/data/universe.json 을 덮어쓰던 일을 막는다. `npm run universe:update` 는 사람이 직접 부르는 것이라 그대로 동작한다.
  if (process.env.UNIVERSE_UPDATE_ENABLED === 'false') {
    console.log('[universe] 유니버스 갱신 꺼짐 (UNIVERSE_UPDATE_ENABLED=false) — 파일·스냅샷을 쓰지 않습니다');
    return;
  }
  const tick = () => {
    if (running) return;
    running = true;
    ensureMonthlySnapshot()
      .then((result) => {
        if (result !== 'exists') console.log(`[universe] ${snapshotMonth(Date.now())} 스냅샷 저장 (${result})`);
      })
      .catch((e) => console.warn('[universe] 월별 스냅샷 실패 — 내일 다시 시도:', e instanceof Error ? e.message : e))
      .finally(() => {
        running = false;
      });
  };
  // 기동 직후는 카탈로그 준비와 겹친다 — 조금 늦게 시작한다
  setTimeout(tick, 60_000);
  setInterval(tick, DAY_MS);
}
