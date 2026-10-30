/**
 * 오늘 시황 소스 점검 — `npm run -s marketbrief:sources` (오라클: `cd ~/alphascope && npm run -s marketbrief:sources`).
 * 모든 뉴스 RSS · 후보 · 미2년물 후보를 **각 1번** 열어 표로 찍는다. 앱 DB 를 열지 않는다 · Gemini 0 · 토스 0(`server/marketBrief/sourceCheck.ts`).
 * 결과 표를 개발 대화에 붙이면 다음 차수에서 후보를 확정한다.
 */
import { checkSources, sourceTable } from '../server/marketBrief/sourceCheck';

const started = new Date();
console.log(`오늘 시황 소스 점검 · ${started.toISOString()} (각 1번)\n`);
console.log(sourceTable(await checkSources()));
