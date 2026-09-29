/**
 * 대형주 유니버스 갱신 — `npm run universe:update` (매월 1회 권장)
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

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findStock } from '../server/stockCatalog';
import { isKrSymbol } from '../src/utils/marketDate';

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

export function updateUniverse(): Universe {
  const python = path.join(root, 'python/.venv/bin/python');
  const out = execFileSync(python, [path.join(root, 'python/universe.py')], {
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
  return universe;
}

// 직접 실행했을 때만 (연구 스크립트가 import 할 때는 돌지 않는다)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const u = updateUniverse();
  console.log(`[universe] 미국 ${u.us.length} · 국내 ${u.kr.length} · 제외 ${u.excluded.length}건 → ${UNIVERSE_PATH}`);
  console.log(`[universe] 미국 앞 10: ${u.us.slice(0, 10).map((e) => e.symbol).join(' ')}`);
  console.log(`[universe] 국내 앞 10: ${u.kr.slice(0, 10).map((e) => `${e.symbol}(${e.name})`).join(' ')}`);
  process.exit(0);
}
