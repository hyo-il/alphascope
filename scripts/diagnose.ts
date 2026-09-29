/**
 * 종합 진단 — `npm run diagnose [--quick] [--symbols AAPL,NVDA]`
 *
 * 본체는 `server/diagnose/report.ts` 의 `runDiagnose()` 다 — 웹의 「진단 리포트」 실행과 같은
 * 함수를 부른다(v2.14.0 에 분리). 여기서는 인자를 읽고 콘솔 요약만 찍는다.
 * 결과는 파일(맥 `docs/analysis/` · 오라클 `reports/`)과 DB(`diagnose_reports`)에 함께 남는다.
 */

import 'dotenv/config';
import { EngineDownError, runDiagnose } from '../server/diagnose/report';

const argv = process.argv.slice(2);
const optionOf = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const symbols = optionOf('--symbols')?.split(',');

runDiagnose({ quick: argv.includes('--quick'), symbols })
  .then(({ consoleLines }) => {
    console.log('');
    for (const line of consoleLines) console.log(line);
    process.exit(0);
  })
  .catch((e) => {
    if (e instanceof EngineDownError) {
      console.error('[진단] ⚠️ 지표 엔진(5001)이 응답하지 않습니다.');
      console.error('       이 상태로 돌리면 스윙 점수·급등 채점이 전부 0 으로 나와 **결과처럼 보입니다**.');
      console.error('       `npm run dev:py` 로 먼저 띄운 뒤 다시 실행하세요.');
    } else {
      console.error('[진단] 실패:', e instanceof Error ? e.message : String(e));
    }
    process.exit(1);
  });
