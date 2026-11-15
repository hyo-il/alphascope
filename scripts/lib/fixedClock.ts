/**
 * 시험 고정 시계 — 매매 시험(`autotrade:test` · `buyjudge:test`)이 **언제 돌려도 같은 결과**가 되게 「지금」 을 장 밖의 고요한 때로 정한다.
 *
 * 왜: 시험은 토스 실제 일봉을 받은 그 시각(`fetched_at`)과 「지금」 으로 끝난 봉을 가린다(`judgeOnClose`). 일봉이 끝나는 시각
 * (국내 20:00 KST · 미국 16:00 ET — `dailyCloseOffsetMs`) 뒤 **10분**(`CONFIRM_MARGIN_MS`) 안에 받은 봉은 「끝나지 않음」 이라
 * 그 10분 동안 돌린 시험은 005930(국내) · 미국 종목이 `bar_unconfirmed` 로 실패한다(2026-11-11 저녁 실패 — `docs/rules/workflow.md` 「시험 시계」).
 *
 * 고요한 때(`fixedNow`): 실제 지금에서 **같거나 뒤의 가장 가까운** 다음 두 때 가운데 하나.
 * - 한국 06:30~07:30 — 미국 일봉 마감(16:00 ET = 한국 05:00 서머타임 · 06:00 표준) + 10분 뒤 · 국내 NXT 장 전(08:00) — 시험이 30분 돌아도 장 밖
 * - 한국 20:15 — 국내 일봉 마감(NXT 20:00) + 10분 뒤 · 미국 장 09:30 ET(한국 22:30 서머타임 · 23:30 표준) 전
 * 두 때 모두 두 시장이 닫혀 있고, 어느 시장도 「마감 뒤 10분」 안이 아니다. 뒤로 미룬 만큼(최대 약 12시간 45분)은 시험이 「조금 뒤의 지금」 에서 돈다 —
 * 그 사이 토스가 줄 새 봉은 없으므로(장 밖) 받은 일봉은 그대로이고, 받은 시각만 마감 뒤가 된다.
 *
 * 환경 변수(둘 다 시험을 다시 재 볼 때만 — 평소엔 없음):
 * - `TEST_REAL_NOW=<ISO>` — 「실제 지금」 을 그 시각으로 흉내 낸다(고요한 때 고르기는 그대로) — 「꼭 지킬 동작 1」 시험이 쓴다.
 * - `TEST_NOW=<ISO>` — 고요한 때를 고르지 않고 **그 시각 그대로** 쓴다 — 원인을 잴 때(예: 한국 20:01 → 실패 재현).
 *
 * 매매 코드는 건드리지 않는다 — 시험 프로세스의 전역 `Date`(`Date.now()` · 인자 없는 `new Date()`)만 바꾼다. 시계는 출발 시각에서 실제로 흐른 만큼 간다
 * (타이머 · 시간 제한은 실제 시간 그대로).
 * ⚠️ `requireCopyDb` · `requireTossKeys` 바로 다음 import(서버 모듈보다 앞)여야 한다.
 */

import { fixedNow } from './quietTime';

const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);

function readEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const ms = RealDate.parse(raw);
  if (!Number.isFinite(ms)) {
    console.error(`${name} 시각을 읽지 못했습니다: ${raw}`);
    process.exit(1);
  }
  return ms;
}

const exact = readEnv('TEST_NOW');
const pretendReal = readEnv('TEST_REAL_NOW');
const START_REAL = realNow();
/** 시험이 실제로 쓰는 출발 시각 */
export const TEST_START = exact ?? fixedNow(pretendReal ?? START_REAL);
const fakeNow = () => TEST_START + (realNow() - START_REAL);

class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(fakeNow());
    else super(...(args as [string | number | Date]));
  }
  static now(): number {
    return fakeNow();
  }
}
globalThis.Date = FixedDate as DateConstructor;

const how = exact != null ? 'TEST_NOW 그대로' : pretendReal != null ? `TEST_REAL_NOW ${new RealDate(pretendReal).toISOString()} → 고요한 때` : '실제 지금 → 고요한 때';
console.log(`시험 시계: ${new RealDate(TEST_START).toISOString()} (${how})`);
