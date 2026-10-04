/**
 * 3년 백테스트 — `npm run research:rule [--force]` (v2.37.0).
 *
 * 웹 「실험실 > 백테스트」 의 [시험 실행] 과 **같은 함수**(`server/autoTrading/researchRunner.ts` 의 `runAndSave`)를 부른다.
 * 결과는 `backtest_reports` 에 쌓이고(웹에서도 보인다) md + json 파일을 진단과 같은 폴더에 쓴다.
 * 측정: 시간 · 토스 캔들 호출 수(이 프로세스의 fetch 를 센다) · 지표 엔진 호출 수 · 메모리 최대치.
 * ⚠️ 지표 엔진이 떠 있어야 한다. 주문을 내지 않는다.
 */
import 'dotenv/config';
import { runAndSave, sameDayReportId } from '../server/autoTrading/researchRunner';

let tossCandleCalls = 0;
let engineCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/candles')) tossCandleCalls++;
  if (url.includes('/indicators')) engineCalls++;
  return realFetch(input, init);
}) as typeof fetch;

const force = process.argv.includes('--force');
const existing = force ? null : sameDayReportId();
if (existing != null) {
  console.log(`오늘 같은 조건의 결과가 이미 있습니다(id ${existing}). 다시 계산하려면 --force`);
  process.exit(0);
}
let last = '';
const t0 = Date.now();
const { id, report, files } = await runAndSave((done, total, current) => {
  const line = `${done}/${total} ${current}`;
  if (line !== last) process.stdout.write(`\r${line}          `);
  last = line;
});
console.log('');
console.log(`저장 id ${id} · ${files.md}`);
console.log(`시간 ${((Date.now() - t0) / 1000).toFixed(1)}초 · 토스 캔들 호출 ${tossCandleCalls}회 · 지표 엔진 호출 ${engineCalls}회 · 메모리 최대 ${report.measure.rssMaxMb}MB`);
for (const m of report.methods) console.log(`- ${m.title}: ${m.verdict}`);
process.exit(0);
