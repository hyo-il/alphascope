/**
 * 미국 마감 직후 값 기록 — `npm run ussample:run` (오라클 cron 이 5분마다 부른다. 설치·지우기·결과 보기는 `deploy/README.md` 「점검 도구」).
 *
 * - 미국 거래일 15:55~20:40 ET 가 아니면 아무것도 하지 않고 끝난다(시간대 판단은 이 스크립트가 한다 — cron 은 5분마다 부르기만).
 *   `usCloseSampler.symbols.json` 의 startDate~endDate 밖이어도 끝난다.
 * - 받는 종목: fixed(SPY · QQQ) + 그날 장 마감 뒤 실적 발표 종목 + 모의투자 계좌가 들고 있는 미국 종목 + 다른 날 실적 종목(최대 20개).
 * - 종목마다 그날 일봉의 다섯 칸과 받은 시각을 `~/alphascope-samples/us-close.jsonl` 에 한 줄씩 덧붙인다. 실패는 error 를 적고 넘어간다.
 * - ⚠️ **앱 DB 에 쓰지 않는다** — 읽기 전용 연결로 휴장일 · 보유 종목만 읽는다(`getDb()` 는 열 때 표를 만들어서 쓰지 않는다). 캔들 캐시도 거치지 않는다
 *   (`fetchCandles` 는 토스만 부른다).
 * - 토큰: 기록 폴더의 토큰 파일(`lib/tossTokenFile.ts` — `ussample:judge` 와 같이 쓴다). 발급이 실패하면 남은 종목은 부르지 않고
 *   (발급을 다시 시도하지 않는다) 실패 줄만 적는다.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbFilePath } from '../server/db';
import { isMarketClosed } from '../server/marketCalendar';
import { isMockMode } from '../server/mockData';
import { TossAuthError } from '../src/services/toss/auth';
import { fetchCandles } from '../src/services/toss/market';
import { isKrSymbol } from '../src/utils/market';
import { marketDate } from '../src/utils/marketDate';
import type { Candle } from '../src/types/toss';
import { etParts, inWindow, loadConfig, MAX_SYMBOLS, SAMPLE_FILE, type SampleLine, type SamplerConfig } from './lib/usClose';
import { useTokenFile } from './lib/tossTokenFile';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = path.join(here, 'usCloseSampler.symbols.json');

type ReadDb = Pick<Database.Database, 'prepare'>;

export interface SamplerOptions {
  now: Date;
  config: SamplerConfig;
  /** 기록 파일(jsonl) */
  outFile: string;
  /** 앱 DB — 읽기 전용 연결 */
  db: ReadDb;
  /** 보유 종목 대신 쓸 목록 — 시험만 넘긴다(없으면 앱 DB 의 보유 미국 종목) */
  held?: string[];
  /** 그날 일봉 받기 — 시험은 가짜를 넘긴다 */
  fetchDaily?: (symbol: string) => Promise<Candle[]>;
}

export type SamplerResult =
  | { status: 'outside' | 'before-start' | 'ended' | 'holiday'; day: string; et: string }
  | { status: 'recorded'; day: string; et: string; symbols: string[]; ok: number; failed: number; dropped: string[] };

/** 모의투자 계좌가 들고 있는 미국 종목 */
export function heldUsSymbols(db: ReadDb): string[] {
  const rows = db.prepare(`SELECT DISTINCT symbol FROM paper_positions WHERE quantity > 0 ORDER BY symbol`).all() as { symbol: string }[];
  return rows.map((r) => r.symbol).filter((s) => !isKrSymbol(s));
}

/** 받을 종목 — 고정 → 그날 실적 → 보유 → 다른 날 실적 순, 겹침 제거, 최대 20개(넘친 것은 dropped) */
export function pickSymbols(config: SamplerConfig, day: string, held: string[]): { symbols: string[]; dropped: string[] } {
  const ordered = [
    ...config.fixed,
    ...config.earnings.filter((e) => e.date === day).map((e) => e.symbol),
    ...held,
    ...config.earnings.filter((e) => e.date !== day).map((e) => e.symbol),
  ];
  const unique = [...new Set(ordered.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return { symbols: unique.slice(0, MAX_SYMBOLS), dropped: unique.slice(MAX_SYMBOLS) };
}

export async function runSampler(opts: SamplerOptions): Promise<SamplerResult> {
  const { day, minutes, hhmm } = etParts(opts.now);
  const base = { day, et: hhmm };
  if (!inWindow(minutes)) return { status: 'outside', ...base };
  if (day < opts.config.startDate) return { status: 'before-start', ...base };
  if (day > opts.config.endDate) return { status: 'ended', ...base };
  if (isMarketClosed('US', day, opts.db)) return { status: 'holiday', ...base };

  const { symbols, dropped } = pickSymbols(opts.config, day, opts.held ?? heldUsSymbols(opts.db));
  const fetchDaily = opts.fetchDaily ?? ((s: string) => fetchCandles(s, '1d', 3));
  const lines: SampleLine[] = [];
  let authFailed: string | null = null;
  for (const symbol of symbols) {
    const at = new Date().toISOString();
    if (authFailed) {
      lines.push({ day, et: hhmm, at, symbol, error: authFailed });
      continue;
    }
    try {
      const candles = await fetchDaily(symbol);
      const bar = candles.find((c) => marketDate(c.timestamp, symbol) === day);
      if (!bar) {
        const last = candles[candles.length - 1];
        lines.push({ day, et: hhmm, at, symbol, barDate: last ? marketDate(last.timestamp, symbol) : undefined, error: '그날 봉 없음' });
        continue;
      }
      lines.push({ day, et: hhmm, at, symbol, barDate: day, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);
      // 토큰 발급 실패면 남은 종목에서 발급을 또 시도하지 않는다(서버와 발급이 겹치는 것을 늘리지 않는다)
      if (e instanceof TossAuthError) authFailed = `토큰 발급 실패: ${message}`;
      lines.push({ day, et: hhmm, at, symbol, error: authFailed ?? message });
    }
  }
  if (lines.length) {
    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    fs.appendFileSync(opts.outFile, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  }
  const failed = lines.filter((l) => l.error).length;
  return { status: 'recorded', ...base, symbols, ok: lines.length - failed, failed, dropped };
}

async function main() {
  // 시험용 고정 시각(`USSAMPLE_NOW`) — 운영 cron 은 넘기지 않는다
  const now = process.env.USSAMPLE_NOW ? new Date(process.env.USSAMPLE_NOW) : new Date();
  const { minutes } = etParts(now);
  if (!inWindow(minutes)) return; // 하루 대부분은 여기서 조용히 끝난다(로그를 남기지 않는다)

  const config = loadConfig(process.env.USSAMPLE_CONFIG ?? CONFIG_FILE);
  const outFile = process.env.USSAMPLE_OUT ?? SAMPLE_FILE;
  const db = new Database(dbFilePath(), { readonly: true, fileMustExist: true });
  try {
    if (isMockMode()) {
      console.log(`${now.toISOString()} 토스 키가 없어 기록하지 않는다(모의 데이터 모드)`);
      return;
    }
    useTokenFile(outFile);
    const result = await runSampler({ now, config, outFile, db });
    if (result.status === 'recorded') {
      console.log(
        `${now.toISOString()} ${result.day} ${result.et} ET 기록 ${result.ok}/${result.symbols.length}` +
          (result.failed ? ` (실패 ${result.failed})` : '') +
          (result.dropped.length ? ` — 20개를 넘어 뺀 종목: ${result.dropped.join(',')}` : ''),
      );
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`${new Date().toISOString()} 기록 실패:`, e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
