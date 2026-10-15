/**
 * 매수 판단 매일 기록 (v2.45.0, 사용자 결정 A-7) — 화면을 열지 않은 날도 쌓인다.
 *
 * - 5분마다 시장(US·KR)마다: 「지금 기록할 수 있는 가장 최근 시장 날짜」(`latestRecordDay` — 마감 + 여유 뒤, 휴장일 건너뜀)가
 *   마지막으로 기록한 날짜와 다르면 **그 날짜 하나만** 기록한다(`recordMarket`). 그 시장 종목만, 고른 규칙으로.
 * - ⚠️ **놓친 날을 소급하지 않는다** — 서버가 며칠 꺼져 있었어도 켜지면 가장 최근 날짜 하나만 채운다. 지나간 날을 지금 데이터로 다시 판단하면
 *   그날 몰랐던 정보가 섞일 수 있다(일봉 수정·지표 재계산). 그 사이 날짜는 비어 있다.
 * - 규칙이 없거나 그 시장 종목이 없어도 그 날짜는 「기록함」 으로 둔다(같은 날 다시 돌지 않게 — 화면 [다시 계산] 이 그날 줄을 채운다).
 * - 하루 한 번(KST 날짜) 보관 기간이 지난 「사도 됨」 아닌 줄을 지운다(`pruneOld`).
 * - 주문을 내지 않는다. 자동매매 스위치(`AUTO_TRADING_ENABLED`)와 무관하게 돈다 — 기록만 한다.
 */
import { latestRecordDay, recordMarket } from './judge';
import * as store from './store';
import type { CalendarMarket } from '../marketCalendar';

const TICK_MS = 5 * 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

const kstDay = (now: number) => new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);

/** 한 바퀴 — 점검(`npm run buyjudge:test`)이 시각을 넣어 부른다 */
export async function buyJudgeTick(now = Date.now()): Promise<{ recorded: Partial<Record<CalendarMarket, { day: string; written: number; skipped: string[] }>>; pruned: number | null }> {
  const out: Awaited<ReturnType<typeof buyJudgeTick>> = { recorded: {}, pruned: null };
  if (running) return out;
  running = true;
  try {
    const last = store.getLastRecorded();
    for (const market of ['US', 'KR'] as const) {
      const day = latestRecordDay(market, now);
      if (last[market] && last[market]! >= day) continue;
      const r = await recordMarket(market, day, now);
      store.setLastRecorded(market, day);
      out.recorded[market] = { day, ...r };
      if (r.written || r.skipped.length) {
        console.log(`[buyJudge] ${market} ${day} 판단 기록 ${r.written}종목${r.skipped.length ? ` · 기준 봉이 없어 건너뜀 ${r.skipped.join(',')}` : ''}`);
      }
    }
    const today = kstDay(now);
    if (store.getLastCleanup() !== today) {
      out.pruned = store.pruneOld(store.getRetention(), today);
      store.setLastCleanup(today);
      if (out.pruned) console.log(`[buyJudge] 보관 기간(${store.getRetention()})이 지난 판단 기록 ${out.pruned}줄 지움(「사도 됨」 은 남김)`);
    }
  } catch (e) {
    console.warn('[buyJudge] 매일 기록 실패:', e instanceof Error ? e.message : e);
  } finally {
    running = false;
  }
  return out;
}

export function startBuyJudgeScheduler(): void {
  if (timer) return;
  void buyJudgeTick();
  timer = setInterval(() => void buyJudgeTick(), TICK_MS);
}
