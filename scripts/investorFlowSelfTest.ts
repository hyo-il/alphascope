/**
 * 투자자 동향 서버 캐시 점검 — `npm run investorflow:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 토스를 부르지 않는다(받는 함수를 바꿔 끼움). 확인하는 것:
 * - 캐시 기간(`flowExpiry`): KST 09:00~21:00 은 1분 · 그 밖은 다음 09:00 — 경계 시각마다.
 * - 같은 종목 동시 요청은 토스 1번 · 1분 안 다시 요청 0번 · 1분 뒤 1번 · 국내 아닌 종목 0번.
 * - 화면의 다시 받기 주기(`FLOW_REFRESH_MS`) = 서버 장중 캐시(`SHORT_TTL_MS`).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { FlowUnsupportedError, SHORT_TTL_MS, flowExpiry, getInvestorFlow } from '../server/investorTrading';
import { FLOW_REFRESH_MS } from '../src/hooks/useInvestorFlow';
import type { FlowRecord } from '../src/utils/investorFlow';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const show = (ms: number) => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ') + ' KST';

// ── 1. 캐시 기간 ─────────────────────────────────────────────
check('장중 캐시 = 1분', SHORT_TTL_MS === 60_000, `${SHORT_TTL_MS}ms`);
check('화면 다시 받기 주기 = 서버 장중 캐시', FLOW_REFRESH_MS === SHORT_TTL_MS, `${FLOW_REFRESH_MS} / ${SHORT_TTL_MS}`);
for (const [at, want] of [
  ['2026-11-05T09:00:00', '2026-11-05T09:01:00'], // 09:00 정각 — 장중
  ['2026-11-05T08:59:59', '2026-11-05T09:00:00'], // 09:00 직전 — 그날 09:00 까지
  ['2026-11-05T13:30:20', '2026-11-05T13:31:20'],
  ['2026-11-05T20:59:59', '2026-11-05T21:00:59'], // 21:00 직전 — 아직 1분
  ['2026-11-05T21:00:00', '2026-11-06T09:00:00'], // 21:00 정각 — 다음 날 09:00
  ['2026-11-05T23:59:59', '2026-11-06T09:00:00'],
  ['2026-11-06T00:00:00', '2026-11-06T09:00:00'], // 자정 넘어 — 그날 09:00
] as const) {
  const got = flowExpiry(kst(at));
  check(`캐시 기간 ${at.slice(11)} KST`, got === kst(want), `${show(got)} (기대 ${want.replace('T', ' ')})`);
}

// ── 2. 토스 요청 수 ──────────────────────────────────────────
let calls = 0;
const record: FlowRecord = {
  date: '2026-11-05',
  updatedAt: '2026-11-05T13:30:00+09:00',
  provisional: true,
  foreigner: { buy: 10, sell: 5, net: 5 },
  institution: null,
  individual: null,
  otherCorporation: null,
  foreignerHolding: null,
} as FlowRecord;
const fake = async () => {
  calls++;
  await new Promise((r) => setTimeout(r, 30));
  return [record];
};

const t0 = kst('2026-11-05T13:30:00');
const together = await Promise.all([getInvestorFlow('005930', t0, fake), getInvestorFlow('005930', t0, fake), getInvestorFlow('005930', t0, fake)]);
check('같은 종목 동시 요청 3번 → 토스 1번', calls === 1, `${calls}번`);
check('동시 요청이 같은 값을 받음', together.every((f) => f === together[0]) && together[0].updatedAt === record.updatedAt);
await getInvestorFlow('005930', t0 + 59_999, fake);
check('1분 안 다시 요청 → 토스 0번 더', calls === 1, `${calls}번`);
await getInvestorFlow('005930', t0 + 60_000, fake);
check('1분 뒤 다시 요청 → 토스 1번 더', calls === 2, `${calls}번`);
let unsupported = false;
try {
  await getInvestorFlow('AAPL', t0, fake);
} catch (e) {
  unsupported = e instanceof FlowUnsupportedError;
}
check('국내 아닌 종목 → 토스 0번 · 지원 안 함 오류', unsupported && calls === 2, `${calls}번`);
// 장 밖(21:00 뒤) 받은 값은 다음 09:00 까지
const night = kst('2026-11-05T21:10:00');
await getInvestorFlow('000660', night, fake);
await getInvestorFlow('000660', kst('2026-11-06T08:59:59'), fake);
check('장 밖 받은 값은 다음 09:00 전까지 다시 받지 않음', calls === 3, `${calls}번`);
await getInvestorFlow('000660', kst('2026-11-06T09:00:00'), fake);
check('다음 09:00 에 다시 받음', calls === 4, `${calls}번`);

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
