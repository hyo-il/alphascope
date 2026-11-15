/**
 * 오늘 시황 「예상 방향」 채점 보고 글 — `npm run -s brief:score-report` 와 시험(`oraclereport:test`)이 같이 쓴다.
 *
 * - 입력은 **읽기 전용으로 연** 앱 DB(`market_brief_scores` · `market_briefs` · `market_holidays`) — 쓰기 0 · 외부 호출 0(토스 · 지표 엔진 · Gemini 부르지 않음).
 * - 채점 못 함 = 채점할 예상(장 시작 전에 만든 마지막 예상 — 서버 채점과 같은 `chooseCandidates`)이 있고 그 정규장 끝 + 1시간이 지났는데
 *   채점 줄이 없는 거래일. 브리핑은 30일만 남아(채점 줄은 1년) **최근 30일 안만** 셀 수 있다. 정규장 시각은 시장 달력(주말 · 휴장일)과
 *   고정 시각(국내 09:00~15:30 KST · 미국 09:30~16:00 ET)으로 — 서버의 토스 장 시간표(조기 마감 등)를 부르지 않으니 그날만 다를 수 있다.
 * - 보합 기준을 바꿨다면: 같은 기록의 실제 등락률로 실제 방향만 다시 정해 맞은 비율을 센다(예상은 ±0.3% 를 보고 만든 것 — 저장하지 않음).
 */
import type Database from 'better-sqlite3';
import { chooseCandidates, SETTLE_MARGIN_MS } from '../../server/marketBrief/outlookScore';
import { isMarketClosed } from '../../server/marketCalendar';
import { marketDayTime } from '../../server/marketHours';
import { BRIEF_FLAT_PCT } from '../../src/utils/marketBrief';
import { OUTLOOK_CONFIDENCES, OUTLOOK_DIRECTIONS, type BriefAi, type OutlookDirection, type OutlookTarget } from '../../src/types/marketBrief';

export const TARGETS: OutlookTarget[] = ['KOSPI', 'SP500'];
const TARGET_LABEL: Record<OutlookTarget, string> = { KOSPI: '코스피', SP500: 'S&P500' };
/** 다시 셀 보합 기준(%) — 맨 앞이 지금 값 */
export const FLAT_OPTIONS = [BRIEF_FLAT_PCT, 0.5, 0.7, 1.0];
/** 실제 등락률 크기 나눔(절댓값 %) — [아래, 위) · 마지막은 「1% 넘음」 */
const SIZE_BUCKETS: { label: string; test: (a: number) => boolean }[] = [
  { label: '0.3% 미만', test: (a) => a < 0.3 },
  { label: '0.3~0.5%', test: (a) => a >= 0.3 && a < 0.5 },
  { label: '0.5~1%', test: (a) => a >= 0.5 && a <= 1 },
  { label: '1% 넘음', test: (a) => a > 1 },
];

export interface ScoreRowRaw {
  target: OutlookTarget;
  trade_day: string;
  direction: OutlookDirection;
  confidence: string;
  actual_pct: number;
  actual_direction: OutlookDirection;
  hit: number;
}

const pct = (hits: number, total: number) => (total ? `${Math.round((hits / total) * 100)}%` : '—');
const ratio = (hits: number, total: number) => (total ? `${hits}/${total} (${pct(hits, total)})` : '—');
const inPeriod = (day: string, from?: string, to?: string) => (!from || day >= from) && (!to || day <= to);

/** 보합 기준 flat(%) 일 때 실제 방향 */
export function directionAt(actualPct: number, flat: number): OutlookDirection {
  if (Math.abs(actualPct) < flat) return '보합';
  return actualPct > 0 ? '상승' : '하락';
}

const H = 3_600_000;
/** 정규장 시작 · 끝 — 시장 달력(읽기 전용 DB) + 고정 시각. 휴장이면 null */
function offlineDeps(db: Database.Database) {
  const span = (market: 'KR' | 'US', day: string, which: 'start' | 'end'): number | null => {
    if (isMarketClosed(market, day, db)) return null;
    const hours = market === 'KR' ? (which === 'start' ? 9 : 15.5) : which === 'start' ? 9.5 : 16;
    return marketDayTime(market, day, hours * H);
  };
  return {
    start: async (market: 'KR' | 'US', day: string) => span(market, day, 'start'),
    end: async (market: 'KR' | 'US', day: string) => span(market, day, 'end'),
  };
}

/** 채점 못 한 거래일(대상별) — 최근 30일 브리핑 안 · 정규장 끝 + 1시간 지남 · 채점 줄 없음 */
export async function unscoredDays(db: Database.Database, scored: Set<string>, now: number, from?: string, to?: string): Promise<Record<OutlookTarget, string[]>> {
  const out: Record<OutlookTarget, string[]> = { KOSPI: [], SP500: [] };
  const hasBriefs = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_briefs'`).get();
  if (!hasBriefs) return out;
  const rows = db.prepare(`SELECT id, created_at, brief_json FROM market_briefs WHERE brief_json IS NOT NULL ORDER BY created_at, id`).all() as { id: number; created_at: string; brief_json: string }[];
  const briefs = rows.flatMap((r) => {
    try {
      const outlook = (JSON.parse(r.brief_json) as BriefAi).today_outlook ?? [];
      return outlook.length ? [{ id: r.id, createdAt: r.created_at, outlook }] : [];
    } catch {
      return [];
    }
  });
  const chosen = await chooseCandidates(briefs, offlineDeps(db));
  for (const c of chosen.values()) {
    if (now < c.end + SETTLE_MARGIN_MS || !inPeriod(c.day, from, to)) continue;
    if (!scored.has(`${c.outlook.target}|${c.day}`)) out[c.outlook.target].push(c.day);
  }
  for (const t of TARGETS) out[t].sort();
  return out;
}

/** 보고 글(한국어 · 표 · 100줄 안 · 맨 끝 「한 줄 결론」) */
export async function buildBriefScoreReport(db: Database.Database, o: { from?: string; to?: string; now?: number } = {}): Promise<string> {
  const has = (t: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t));
  if (!has('market_brief_scores')) return '오늘 시황 채점 표가 아직 없습니다(v2.60.0 서버를 켠 뒤 생긴다).\n\n한 줄 결론: 채점 기록 없음.';
  const all = db.prepare(`SELECT target, trade_day, direction, confidence, actual_pct, actual_direction, hit FROM market_brief_scores ORDER BY trade_day`).all() as ScoreRowRaw[];
  const rows = all.filter((r) => inPeriod(r.trade_day, o.from, o.to));
  const scored = new Set(all.map((r) => `${r.target}|${r.trade_day}`));
  const unscored = await unscoredDays(db, scored, o.now ?? Date.now(), o.from, o.to);
  const days = rows.map((r) => r.trade_day);
  const lines: string[] = [];
  lines.push('# 오늘 시황 「예상 방향」 채점 보고 (읽기 전용)');
  lines.push(`- 기간: ${o.from ?? days[0] ?? '—'} ~ ${o.to ?? days.at(-1) ?? '—'}${o.from || o.to ? '' : ' (기록 전체)'} · 지금 보합 기준 ±${BRIEF_FLAT_PCT}%`);
  lines.push('- ⚠️ 참고 통계 — 매수 판단 · 자동매매에 쓰지 않는다.');
  lines.push('');
  lines.push('## 1. 대상별');
  lines.push('| 대상 | 채점한 날 | 맞음 | 틀림 | 맞은 비율 | 채점 못 함(최근 30일) |');
  lines.push('|---|---|---|---|---|---|');
  for (const t of TARGETS) {
    const r = rows.filter((x) => x.target === t);
    const hits = r.filter((x) => x.hit).length;
    lines.push(`| ${TARGET_LABEL[t]} | ${r.length} | ${hits} | ${r.length - hits} | ${pct(hits, r.length)} | ${unscored[t].length}${unscored[t].length ? ` (${unscored[t].slice(-3).join(', ')}${unscored[t].length > 3 ? ' …' : ''})` : ''} |`);
  }
  lines.push('');
  lines.push('## 2. 예상 방향별 · 확신별 맞은 비율 (맞음/채점)');
  lines.push(`| 대상 | ${OUTLOOK_DIRECTIONS.map((d) => `예상 ${d}`).join(' | ')} | ${OUTLOOK_CONFIDENCES.map((c) => `확신 ${c}`).join(' | ')} |`);
  lines.push(`|---|${OUTLOOK_DIRECTIONS.map(() => '---').join('|')}|${OUTLOOK_CONFIDENCES.map(() => '---').join('|')}|`);
  for (const t of TARGETS) {
    const r = rows.filter((x) => x.target === t);
    const byDir = OUTLOOK_DIRECTIONS.map((d) => {
      const s = r.filter((x) => x.direction === d);
      return ratio(s.filter((x) => x.hit).length, s.length);
    });
    const byConf = OUTLOOK_CONFIDENCES.map((c) => {
      const s = r.filter((x) => x.confidence === c);
      return ratio(s.filter((x) => x.hit).length, s.length);
    });
    lines.push(`| ${TARGET_LABEL[t]} | ${byDir.join(' | ')} | ${byConf.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## 3. 실제 등락률 크기 (절댓값 · 날 수)');
  lines.push(`| 대상 | ${SIZE_BUCKETS.map((b) => b.label).join(' | ')} |`);
  lines.push(`|---|${SIZE_BUCKETS.map(() => '---').join('|')}|`);
  for (const t of TARGETS) {
    const r = rows.filter((x) => x.target === t);
    lines.push(`| ${TARGET_LABEL[t]} | ${SIZE_BUCKETS.map((b) => r.filter((x) => b.test(Math.abs(x.actual_pct))).length).join(' | ')} |`);
  }
  lines.push('');
  lines.push('## 4. 보합 기준을 바꿨다면 (같은 기록으로 다시 셈 · 저장 안 함)');
  lines.push(`| 대상 | ${FLAT_OPTIONS.map((f) => `±${f.toFixed(1)}%${f === BRIEF_FLAT_PCT ? '(지금)' : ''}`).join(' | ')} |`);
  lines.push(`|---|${FLAT_OPTIONS.map(() => '---').join('|')}|`);
  const recount: Record<OutlookTarget, { flat: number; hits: number; total: number; flatDays: number }[]> = { KOSPI: [], SP500: [] };
  for (const t of TARGETS) {
    const r = rows.filter((x) => x.target === t);
    recount[t] = FLAT_OPTIONS.map((flat) => ({
      flat,
      hits: r.filter((x) => directionAt(x.actual_pct, flat) === x.direction).length,
      total: r.length,
      flatDays: r.filter((x) => directionAt(x.actual_pct, flat) === '보합').length,
    }));
    lines.push(`| ${TARGET_LABEL[t]} | ${recount[t].map((c) => `${pct(c.hits, c.total)} (실제 보합 ${c.flatDays}일)`).join(' | ')} |`);
  }
  lines.push('- 예상은 ±0.3% 를 보고 만든 것이다 — 기준을 바꾸면 예상 자체도 달라질 수 있어, 이 표는 「실제 쪽 기준만 바꾼」 참고다.');
  lines.push('');
  const parts = TARGETS.map((t) => {
    const now = recount[t][0];
    if (!now.total) return `${TARGET_LABEL[t]} 채점 0일`;
    const alt = recount[t].slice(1).map((c) => `±${c.flat.toFixed(1)}% ${pct(c.hits, c.total)}`).join(' · ');
    return `${TARGET_LABEL[t]} ${now.total}일 중 ${now.hits}번 맞음(${pct(now.hits, now.total)} · ${alt})`;
  });
  lines.push(`한 줄 결론: ${parts.join(' / ')}${unscored.KOSPI.length + unscored.SP500.length ? ` · 채점 못 한 날 ${unscored.KOSPI.length + unscored.SP500.length}일` : ''}.`);
  return lines.join('\n');
}

/** `--from YYYY-MM-DD --to YYYY-MM-DD` (틀린 모양은 무시) */
export function periodArgs(argv: string[]): { from?: string; to?: string } {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    const v = i >= 0 ? argv[i + 1] : undefined;
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  return { from: arg('--from'), to: arg('--to') };
}
