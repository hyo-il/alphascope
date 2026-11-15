/**
 * 시험 고정 시계 점검 — `npm run testclock:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다 · 토스 0).
 *
 * `lib/fixedClock`(매매 시험의 「지금」 을 두 시장 장 밖의 고요한 때로)을 확인한다 — 135차 「꼭 지킬 동작 1」 의 기계 검사 몫:
 * 1. 고르기: 한국 시각 5분마다(서머타임이 바뀌는 2026-03 · 2026-11 · 2027-03 주 포함 · 주말 포함) 고른 「지금」 이
 *    실제 지금보다 같거나 뒤 · 13시간 안 · 그 뒤 30분 동안 **두 시장 모두 장 밖(평일이라 보고)** · 어느 시장도 「일봉 마감 뒤 10분」 안이 아님
 * 2. 한국 07:00 · 13:00 · 19:30 · 23:30 · 토요일 · 서머타임 주 → 고른 시각(표)
 * 3. 시계 바꾸기: `TEST_REAL_NOW` · `TEST_NOW` 로 띄운 자식 프로세스의 `Date.now()` · `new Date()` · 인자 있는 `new Date(x)` 는 그대로 · 읽지 못하는 값은 멈춤
 * 4. 매매 시험 두 개(`autotrade:test` · `buyjudge:test`)는 `requireTossKeys` 바로 다음 줄에 이 import 가 있다
 * 실제 토스 데이터로 두 시험을 여러 시각에 돌려 견주는 것은 `npm run testclock:matrix`(오래 걸려 기계 검사에 넣지 않음).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fixedNow } from './lib/quietTime';
import { isMarketOpen, marketDayTime, setClosedLookupForTest } from '../server/marketHours';
import { CONFIRM_MARGIN_MS } from '../server/db';
import { dailyCloseOffsetMs } from '../src/utils/marketBar';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const H = 3_600_000;
const M = 60_000;
const RUN_MS = 30 * M; // 시험 한 번이 도는 넉넉한 시간
const kstIso = (ms: number) => new Date(ms + 9 * H).toISOString().slice(0, 16).replace('T', ' ');
const ymd = (ms: number, tzShiftH: number) => new Date(ms + tzShiftH * H).toISOString().slice(0, 10);

// 휴장일은 없다고 본다(평일은 모두 열림) — 가장 엄한 조건
setClosedLookupForTest(() => false);

/** 그 시각이 어느 시장의 「일봉 마감 ~ 마감 + 10분」 안인가 */
function inConfirmGap(t: number): string | null {
  for (const [market, sym] of [['KR', '005930'], ['US', 'AAPL']] as const) {
    for (const shift of [-24 * H, 0, 24 * H]) {
      const day = ymd(t + shift, market === 'KR' ? 9 : -5);
      const close = marketDayTime(market, day, dailyCloseOffsetMs(sym));
      if (t >= close && t < close + CONFIRM_MARGIN_MS) return `${market} ${day}`;
    }
  }
  return null;
}

// ── 1. 고르기 — 5분마다 ──
console.log('1) 고르기 — 한국 시각 5분마다(서머타임 주 · 주말 포함)');
const ranges: [string, string][] = [
  ['2026-03-02T00:00:00+09:00', '2026-03-16T00:00:00+09:00'], // 미국 서머타임 시작 03-08
  ['2026-10-26T00:00:00+09:00', '2026-11-16T00:00:00+09:00'], // 미국 서머타임 끝 11-01
  ['2027-03-08T00:00:00+09:00', '2027-03-22T00:00:00+09:00'], // 미국 서머타임 시작 03-14
];
let tried = 0;
let badCount = 0;
const bad: string[] = [];
for (const [from, to] of ranges) {
  for (let real = Date.parse(from); real < Date.parse(to); real += 5 * M) {
    tried++;
    const f = fixedNow(real);
    let why = '';
    if (f < real) why = '앞으로 감';
    else if (f - real > 13 * H) why = `${((f - real) / H).toFixed(1)}시간 뒤`;
    else {
      for (let t = f; t <= f + RUN_MS && !why; t += 5 * M) {
        if (isMarketOpen('KR', new Date(t))) why = `국내 장중 ${kstIso(t)}`;
        else if (isMarketOpen('US', new Date(t))) why = `미국 장중 ${kstIso(t)}`;
        else {
          const gap = inConfirmGap(t);
          if (gap) why = `${gap} 마감 뒤 10분 안 ${kstIso(t)}`;
        }
      }
    }
    if (!why) continue;
    badCount++;
    if (bad.length < 5) bad.push(`${kstIso(real)} → ${kstIso(f)}: ${why}`);
  }
}
check(`고른 시각 ${tried}개 모두 장 밖 · 마감 뒤 10분 밖 · 30분 동안 그대로 · 13시간 안`, badCount === 0, `${badCount}개 ${bad.join(' | ')}`);

// ── 2. 지시서 시각 → 고른 시각 ──
console.log('\n2) 한국 07:00 · 13:00 · 19:30 · 23:30 · 토요일 · 서머타임 주');
const cases: [string, string, string][] = [
  ['평일 07:00', '2026-11-13T07:00:00+09:00', '2026-11-13 07:00'],
  ['평일 13:00', '2026-11-13T13:00:00+09:00', '2026-11-13 20:15'],
  ['평일 19:30', '2026-11-13T19:30:00+09:00', '2026-11-13 20:15'],
  ['평일 20:05(국내 마감 뒤 10분 안 — 실패하던 때)', '2026-11-13T20:05:00+09:00', '2026-11-13 20:15'],
  ['평일 23:30(미국 장중)', '2026-11-13T23:30:00+09:00', '2026-11-14 06:30'],
  ['토요일 06:05(미국 마감 뒤 10분 안 — 실패하던 때)', '2026-11-14T06:05:00+09:00', '2026-11-14 06:30'],
  ['토요일 12:00', '2026-11-14T12:00:00+09:00', '2026-11-14 20:15'],
  ['서머타임 끝난 주 월 05:30(미국 마감 16:00 EST = 06:00)', '2026-11-02T05:30:00+09:00', '2026-11-02 06:30'],
  ['서머타임 주 화 22:40(미국 장중 — 서머타임이면 22:30 개장)', '2027-03-16T22:40:00+09:00', '2027-03-17 06:30'],
];
for (const [label, real, want] of cases) {
  const got = kstIso(fixedNow(Date.parse(real)));
  check(`${label} → 한국 ${want}`, got === want, got);
}

// ── 3. 자식 프로세스에서 시계 바꾸기 ──
console.log('\n3) 시계 바꾸기(자식 프로세스)');
const probe = `import './scripts/lib/fixedClock';
const a = Date.now(); const b = new Date().getTime();
console.log('PROBE', JSON.stringify({ a, b, fixed: new Date(0).getTime(), parse: Date.parse('2020-01-01T00:00:00Z'), inst: new Date() instanceof Date }));`;
const runProbe = (env: Record<string, string>): { out: string; code: number } => {
  try {
    const out = execFileSync('npx', ['tsx', '--eval', probe], { env: { ...process.env, TEST_NOW: '', TEST_REAL_NOW: '', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
  }
};
const parsed = (out: string) => JSON.parse(out.split('\n').find((l) => l.startsWith('PROBE'))!.slice(6)) as { a: number; b: number; fixed: number; parse: number; inst: boolean };
{
  const r = runProbe({ TEST_REAL_NOW: '2026-11-13T19:30:00+09:00' });
  const p = parsed(r.out);
  const want = Date.parse('2026-11-13T20:15:00+09:00');
  check('TEST_REAL_NOW 19:30 → Date.now() 20:15(몇 초 안)', p.a >= want && p.a - want < 30_000, kstIso(p.a));
  check('인자 없는 new Date() 도 같은 시계', Math.abs(p.b - p.a) < 1_000);
  check('인자 있는 new Date(0) · Date.parse 는 그대로 · instanceof Date', p.fixed === 0 && p.parse === Date.UTC(2020, 0, 1) && p.inst);
  check('시작 줄에 고른 시각을 적는다', r.out.includes('시험 시계: 2026-11-13T11:15:00.000Z'), r.out.split('\n')[0]);
}
{
  const r = runProbe({ TEST_NOW: '2026-11-13T20:01:00+09:00' });
  const p = parsed(r.out);
  const want = Date.parse('2026-11-13T20:01:00+09:00');
  check('TEST_NOW 는 고르지 않고 그 시각 그대로(원인 재기)', p.a >= want && p.a - want < 30_000, kstIso(p.a));
}
{
  const r = runProbe({});
  const p = parsed(r.out);
  check('환경 변수 없음 → 실제 지금에서 고른 시각', Math.abs(p.a - fixedNow(Date.now())) < 30_000, `${kstIso(p.a)} · 실제 ${kstIso(Date.now())}`);
}
{
  const r = runProbe({ TEST_NOW: '어제 저녁' });
  check('읽지 못하는 시각 → 종료 코드 1 + 안내', r.code === 1 && r.out.includes('TEST_NOW 시각을 읽지 못했습니다'), `code ${r.code}`);
}

// ── 4. 매매 시험 두 개의 import 자리 ──
console.log('\n4) 매매 시험 두 개 — requireTossKeys 바로 다음 줄');
for (const file of ['autoTradingSelfTest.ts', 'buyJudgeSelfTest.ts']) {
  const lines = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.startsWith("import './lib/requireTossKeys'"));
  check(`${file}: requireTossKeys 바로 다음 줄이 fixedClock`, at >= 0 && Boolean(lines[at + 1]?.startsWith("import './lib/fixedClock'")));
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
