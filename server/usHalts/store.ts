/**
 * 미국 거래정지 저장 — 표 `us_halts`(db/schema.sql). 한 정지 = 한 줄, 키 = 종목 + 정지 날짜 + 정지 시각(원문 문자열).
 *
 * - 같은 키가 다시 오면 **바뀐 원문 칸만** 갱신한다(지우지 않는다 — 빈칸으로 돌아와도 채워진 값을 지우지 않는다).
 * - 정지 날짜가 30일보다 오래된 항목은 저장하지 않는다(RSS 에는 2019 년 정지까지 남아 있다). 저장한 줄도 30일이 지나면 지운다(하루 한 번).
 */
import { getDb } from '../db';
import { marketDayTime } from '../marketHours';
import { marketDate } from '../../src/utils/marketDate';
import { MARKET_REF } from '../../src/utils/market';
import { haltDayCount, isHaltOngoing, isLuldCode, isoDayOfRaw, msOfRawTime } from '../../src/utils/usHalts';
import type { HaltDirectionEstimate, UsHaltRow, UsOngoingHaltRow } from '../../src/types/usHalts';
import type { RawHaltItem } from './feed';

export const KEEP_DAYS = 30;

/** 미국 날짜(ET, YYYY-MM-DD) */
export const usDayOf = (ms: number): string => marketDate(ms, MARKET_REF.US.symbol);

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** 이 날짜보다 앞선 정지는 저장하지 않고 지운다 — 오늘(미국) − 30일 */
export const keepFromDay = (now: number): string => addDays(usDayOf(now), -KEEP_DAYS);

/** 원문 날짜 + 시각(ET) → epoch ms. 모양이 다르면 null */
export function etMsOf(rawDate: string, rawTime: string): number | null {
  const day = isoDayOfRaw(rawDate);
  const offset = msOfRawTime(rawTime);
  if (!day || offset == null) return null;
  return marketDayTime('US', day, offset);
}

const KST = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface DbRow {
  id: number;
  raw_issue_symbol: string;
  raw_halt_date: string;
  raw_halt_time: string;
  raw_issue_name: string;
  raw_market: string;
  raw_reason_code: string;
  raw_pause_threshold_price: string;
  raw_resumption_date: string;
  raw_resumption_quote_time: string;
  raw_resumption_trade_time: string;
  halt_day: string;
  halt_at_ms: number;
  first_seen_at: string;
  first_seen_kst: string;
  resume_seen_at: string | null;
  direction_est: HaltDirectionEstimate;
  direction_est_json: string | null;
  last_listed_at: string | null;
}

/** 원문 칸 → 표 칸 (갱신할 수 있는 칸만 — 키 셋은 빠진다) */
const UPDATABLE: [keyof RawHaltItem, keyof DbRow][] = [
  ['IssueName', 'raw_issue_name'],
  ['Market', 'raw_market'],
  ['ReasonCode', 'raw_reason_code'],
  ['PauseThresholdPrice', 'raw_pause_threshold_price'],
  ['ResumptionDate', 'raw_resumption_date'],
  ['ResumptionQuoteTime', 'raw_resumption_quote_time'],
  ['ResumptionTradeTime', 'raw_resumption_trade_time'],
];

export interface IngestResult {
  inserted: number;
  updated: number;
  /** 30일보다 오래돼 저장하지 않은 항목 */
  skippedOld: number;
  /** 날짜 · 시각 모양이 달라 저장하지 않은 항목 */
  skippedBad: number;
}

/** 받은 항목을 쌓는다 — 한 트랜잭션 */
export function ingestHalts(items: RawHaltItem[], now: number): IngestResult {
  const db = getDb();
  const result: IngestResult = { inserted: 0, updated: 0, skippedOld: 0, skippedBad: 0 };
  const keepFrom = keepFromDay(now);
  const nowIso = new Date(now).toISOString();
  const find = db.prepare(`SELECT * FROM us_halts WHERE raw_issue_symbol = ? AND raw_halt_date = ? AND raw_halt_time = ?`);
  const insert = db.prepare(`
    INSERT INTO us_halts (raw_issue_symbol, raw_halt_date, raw_halt_time, raw_issue_name, raw_market, raw_reason_code,
      raw_pause_threshold_price, raw_resumption_date, raw_resumption_quote_time, raw_resumption_trade_time,
      halt_day, halt_at_ms, first_seen_at, first_seen_kst, resume_seen_at, direction_est, updated_at, last_listed_at)
    VALUES (@sym, @date, @time, @name, @market, @code, @pause, @rdate, @rquote, @rtrade,
      @day, @haltAt, @now, @nowKst, @resumeSeen, @dir, @now, @now)`);
  // 목록에서 본 시각 — 바뀐 칸이 없어도 받을 때마다 적는다(「목록에서 사라짐」 판단)
  const listed = db.prepare(`UPDATE us_halts SET last_listed_at = ? WHERE id = ?`);

  db.transaction(() => {
    for (const it of items) {
      const day = isoDayOfRaw(it.HaltDate);
      const haltAt = etMsOf(it.HaltDate, it.HaltTime);
      if (!day || haltAt == null) {
        result.skippedBad++;
        continue;
      }
      if (day < keepFrom) {
        result.skippedOld++;
        continue;
      }
      const prev = find.get(it.IssueSymbol, it.HaltDate, it.HaltTime) as DbRow | undefined;
      const tradeFilled = it.ResumptionTradeTime.trim() !== '';
      if (!prev) {
        insert.run({
          sym: it.IssueSymbol,
          date: it.HaltDate,
          time: it.HaltTime,
          name: it.IssueName,
          market: it.Market,
          code: it.ReasonCode,
          pause: it.PauseThresholdPrice,
          rdate: it.ResumptionDate,
          rquote: it.ResumptionQuoteTime,
          rtrade: it.ResumptionTradeTime,
          day,
          haltAt,
          now: nowIso,
          nowKst: KST.format(new Date(now)),
          // 처음 볼 때 이미 채워져 있으면(지난 정지) 처음 본 시각
          resumeSeen: tradeFilled ? nowIso : null,
          dir: isLuldCode(it.ReasonCode.trim()) ? 'pending' : 'none',
        });
        result.inserted++;
        continue;
      }
      listed.run(nowIso, prev.id);
      // 바뀐 칸만 — 빈칸으로 돌아온 칸은 채워 둔 값을 지우지 않는다
      const changes: Record<string, string> = {};
      for (const [field, column] of UPDATABLE) {
        const value = it[field];
        if (value !== prev[column] && value.trim() !== '') changes[column] = value;
      }
      const sets = Object.keys(changes).map((c) => `${c} = @${c}`);
      // 사유 코드가 LULD 아님 → LULD 로 바뀌면 방향을 추정하고, LULD → 아님이면 추정하지 않음으로
      if (changes.raw_reason_code) {
        const luld = isLuldCode(changes.raw_reason_code.trim());
        if (luld && prev.direction_est === 'none') sets.push(`direction_est = 'pending'`);
        if (!luld && prev.direction_est !== 'none') sets.push(`direction_est = 'none'`);
      }
      if (tradeFilled && !prev.resume_seen_at) sets.push(`resume_seen_at = @now`);
      if (!sets.length) continue;
      db.prepare(`UPDATE us_halts SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run({ ...changes, now: nowIso, id: prev.id });
      result.updated++;
    }
  })();
  return result;
}

/** 30일 지난 줄 지우기 — 지운 줄 수 */
export function purgeOldHalts(now: number): number {
  return getDb().prepare(`DELETE FROM us_halts WHERE halt_day < ?`).run(keepFromDay(now)).changes;
}

/** 방향 추정을 기다리는 줄(처음 본 LULD 정지) */
export function pendingDirection(): { id: number; symbol: string; haltAtMs: number; haltDay: string }[] {
  return getDb()
    .prepare(`SELECT id, raw_issue_symbol AS symbol, halt_at_ms AS haltAtMs, halt_day AS haltDay FROM us_halts WHERE direction_est = 'pending' ORDER BY halt_at_ms`)
    .all() as { id: number; symbol: string; haltAtMs: number; haltDay: string }[];
}

export function saveDirection(id: number, est: Exclude<HaltDirectionEstimate, 'pending' | 'none'>, detail: unknown): void {
  getDb()
    .prepare(`UPDATE us_halts SET direction_est = ?, direction_est_json = ?, updated_at = ? WHERE id = ?`)
    .run(est, JSON.stringify(detail), new Date().toISOString(), id);
}

/** 표 줄 → 화면 줄. 순번은 주어진 줄 안에서(종목 · 정지 날짜별, 정지 시각 순) */
function toHaltRows(rows: DbRow[]): UsHaltRow[] {
  const db = getDb();
  const catalogCount = (db.prepare(`SELECT COUNT(*) AS n FROM stock_catalog`).get() as { n: number }).n;
  const catalog = db.prepare(`SELECT name FROM stock_catalog WHERE symbol = ?`);
  const held = new Set(
    (db.prepare(`SELECT DISTINCT symbol FROM paper_positions WHERE quantity > 0`).all() as { symbol: string }[]).map((r) => r.symbol),
  );
  const nth = new Map<string, number>();
  return rows.map((r): UsHaltRow => {
    const symbol = r.raw_issue_symbol.trim();
    const n = (nth.get(`${symbol}|${r.halt_day}`) ?? 0) + 1;
    nth.set(`${symbol}|${r.halt_day}`, n);
    const cat = catalog.get(symbol) as { name: string } | undefined;
    return {
      id: r.id,
      rawIssueSymbol: r.raw_issue_symbol,
      rawIssueName: r.raw_issue_name,
      rawMarket: r.raw_market,
      rawReasonCode: r.raw_reason_code,
      rawHaltDate: r.raw_halt_date,
      rawHaltTime: r.raw_halt_time,
      rawResumptionDate: r.raw_resumption_date,
      rawResumptionQuoteTime: r.raw_resumption_quote_time,
      rawResumptionTradeTime: r.raw_resumption_trade_time,
      haltAtMs: r.halt_at_ms,
      // LULD(LUDP)의 ResumptionQuoteTime 은 처음부터 정지 시각과 같은 값이라 쓰지 않는다 — 재개는 Trade 칸
      resumeAtMs: r.raw_resumption_trade_time.trim() ? etMsOf(r.raw_resumption_date.trim() || r.raw_halt_date, r.raw_resumption_trade_time) : null,
      firstSeenAt: r.first_seen_at,
      resumeSeenAt: r.resume_seen_at,
      directionEst: r.direction_est,
      nthToday: n,
      // 카탈로그가 비어 있으면(처음 켠 서버) 모른다 — 누를 수 있게 둔다
      inToss: catalogCount === 0 || cat != null,
      catalogName: cat?.name ?? null,
      held: held.has(symbol),
    };
  });
}

/** 그날(미국 날짜) 정지 — 새 정지가 위. 순번 · 토스 목록 · 보유는 여기서 붙인다 */
export function listHaltsOfDay(day: string): UsHaltRow[] {
  const rows = getDb().prepare(`SELECT * FROM us_halts WHERE halt_day = ? ORDER BY halt_at_ms, id`).all(day) as DbRow[];
  return toHaltRows(rows).reverse();
}

/** 그날 안 풀린 정지 수 — 20:00 ET 뒤 이어 받기(`scheduler.fetchWindowOf`)가 쓴다. 「안 풀림」 은 `isHaltOngoing` 한 곳 */
export function countOngoingOfDay(day: string, now: number): number {
  return listHaltsOfDay(day).filter((h) => isHaltOngoing(h, now)).length;
}

/**
 * 「며칠째 정지 중」 — 정지 날짜가 오늘(미국)보다 앞이고 30일 안 + 안 풀림. 오래된 것부터.
 * `lastSuccessAt`(마지막으로 성공한 받기)보다 그 줄을 목록에서 본 때가 앞이면 목록에서 사라진 것 — 풀렸는지 모른다(`unlisted`).
 * 받은 적이 없으면(null) 판단하지 않는다(사라졌다고 하지 않는다).
 */
export function listOngoingBefore(today: string, now: number, lastSuccessAt: string | null): UsOngoingHaltRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM us_halts WHERE halt_day < ? AND halt_day >= ? ORDER BY halt_at_ms, id`)
    // 30일 안에 시작된 정지 = 30일째까지(정지한 날 = 1일째). 저장은 하루 더 남지만(`keepFromDay`) 화면 문구 「최근 30일 안」 과 숫자를 맞춘다
    .all(today, addDays(today, -(KEEP_DAYS - 1))) as DbRow[];
  const listedAt = new Map(rows.map((r) => [r.id, r.last_listed_at]));
  return toHaltRows(rows)
    .filter((h) => isHaltOngoing(h, now))
    .map((h) => {
      const seen = listedAt.get(h.id);
      return {
        ...h,
        nthToday: 0,
        daysHalted: haltDayCount(rows.find((r) => r.id === h.id)!.halt_day, today),
        unlisted: lastSuccessAt != null && (seen == null || seen < lastSuccessAt),
      };
    });
}
