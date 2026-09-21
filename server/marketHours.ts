/**
 * 미국 정규장(09:30~16:00 ET) 판정.
 *
 * 공휴일까지 보지는 않는다 — 휴장일에 한 번 더 도는 비용은 작고,
 * 캘린더를 잘못 판단해 **장중에 쉬는 쪽이 더 나쁘다.**
 *
 * ⚠️ 이 판정은 자동 분석(`gemini/scheduler.ts`)과 계좌별 자동매매
 * (`autoTrading/scheduler.ts`)가 함께 쓴다. 두 곳에 각자 두면 한쪽만 고쳐진다.
 */
export function isUsMarketOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
