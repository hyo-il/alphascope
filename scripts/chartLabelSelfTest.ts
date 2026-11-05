/**
 * 차트 이동평균 이름 · 현재가로 마지막 봉 고치기 점검 — `npm run chart:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * DB · 서버를 쓰지 않는 순수 함수 시험이지만 시험 스크립트 규칙대로 사본 DB 막기를 맨 앞에 둔다.
 * - 이동평균 이름(`barUnitOf` + `maLabel`): 5분 · 15분봉 → 「5봉선 · 20봉선 · 60봉선」 · 일 「5일선」 · 주 「5주선」 · 월 「5개월선」.
 *   메인 차트(`ChartInfoBar`) · 기업 비교(`CompareChart`) · 실시간 순위 미리보기(`RankingPreview`)가 같은 두 함수를 쓴다.
 * - 현재가로 마지막 봉(`liveCandle`): 바꾸기 전 메인 차트 규칙(v2.60.6 `CandleChart.tsx`)의 결과
 *   `scripts/fixtures/liveCandle_v2.60.6.json` 과 같은 입력 → 같은 값(20% 넘게 다르면 무시 포함).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MA_LINES, barUnitOf, maLabel } from '../src/types/chart';
import { liveCandle } from '../src/utils/liveCandle';
import type { Candle } from '../src/types/toss';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── 이동평균 이름 ─────────────────────────────────────────────
const MIN = 60_000;
const DAY = 86_400_000;
/** 시작 시각부터 간격마다 봉 n 개 — 분봉은 장 사이 밤 · 주말 틈을 섞는다(가운데 값은 그대로 봉 간격) */
function series(stepMs: number, n: number, gapEvery = 0, gapMs = 0): { timestamp: number }[] {
  const out: { timestamp: number }[] = [];
  let t = Date.parse('2026-11-02T00:30:00Z');
  for (let i = 0; i < n; i++) {
    out.push({ timestamp: t });
    t += stepMs + (gapEvery && (i + 1) % gapEvery === 0 ? gapMs : 0);
  }
  return out;
}
/** 일봉 — 평일만(주말 틈) */
function weekdays(n: number): { timestamp: number }[] {
  const out: { timestamp: number }[] = [];
  let t = Date.parse('2026-06-01T00:00:00Z'); // 월요일
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) out.push({ timestamp: t });
    t += DAY;
  }
  return out;
}

const labels = (candles: { timestamp: number }[]) =>
  MA_LINES.filter((m) => m.key !== 'ma120').map((m) => maLabel(m, barUnitOf(candles))).join(' · ');

const cases: [string, { timestamp: number }[], string][] = [
  ['5분봉(장 사이 밤 틈 포함)', series(5 * MIN, 200, 78, 17.5 * 60 * MIN), '5봉선 · 20봉선 · 60봉선'],
  ['15분봉(장 사이 밤 틈 포함)', series(15 * MIN, 200, 26, 17.5 * 60 * MIN), '5봉선 · 20봉선 · 60봉선'],
  ['1분봉', series(MIN, 100), '5봉선 · 20봉선 · 60봉선'],
  ['일봉(주말 틈)', weekdays(126), '5일선 · 20일선 · 60일선'],
  ['주봉', series(7 * DAY, 104), '5주선 · 20주선 · 60주선'],
  ['월봉', series(30 * DAY, 60), '5개월선 · 20개월선 · 60개월선'],
  ['봉 2개(모름 → 일)', series(5 * MIN, 2), '5일선 · 20일선 · 60일선'],
];
for (const [name, candles, want] of cases) {
  const got = labels(candles);
  check(`이동평균 이름 — ${name}`, got === want, `${got}`);
}
check('120 이동평균도 분봉이면 봉선(메인 차트 정보 바)', maLabel(MA_LINES.find((m) => m.key === 'ma120')!, 'bar') === '120봉선');
check('일 이름은 원래 이름 그대로', MA_LINES.every((m) => maLabel(m, 'day') === m.label));

// ── 현재가로 마지막 봉 — 바꾸기 전 메인 차트 결과와 같다 ─────────────────
const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/liveCandle_v2.60.6.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  name: string;
  last: Candle | null;
  price: number | string | null;
  result: { time: number; open: number; high: number; low: number; close: number } | null;
}[];
for (const item of fixture) {
  const price = typeof item.price === 'string' ? Number(item.price) : item.price;
  const next = liveCandle(item.last ?? undefined, price);
  const got = next ? { time: next.timestamp, open: next.open, high: next.high, low: next.low, close: next.close } : null;
  check(`현재가로 마지막 봉 — ${item.name}`, JSON.stringify(got) === JSON.stringify(item.result), JSON.stringify(got));
}
check('정답 파일 칸 수', fixture.length === 14, String(fixture.length));

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
