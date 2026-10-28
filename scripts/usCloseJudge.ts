/**
 * 미국 마감 30분 뒤(16:30 ET) 값과 최종값으로 매수 판단 견주기 — `npm run -s ussample:judge` (오라클 안에서 한 번. `deploy/README.md` 「점검 도구」).
 *
 * `~/alphascope-samples/us-close.jsonl`(`ussample:run` 이 쌓은 것 · `USSAMPLE_OUT` 으로 바꿀 수 있다)의 16:30 표본과 최종 표본으로
 * 같은 규칙 · 같은 함수(`judgeOnClose`)로 두 번 판단해 action · code · 점수가 바뀌는지 센다. 판단 방법은 `lib/usCloseJudge.ts`.
 * - **읽기만 한다**: 앱 DB 는 읽기 전용 연결로 규칙 · 계좌 설정만(`getDb()` 를 쓰지 않는다). 캔들 캐시 · 판단 기록 · 다시 계산 표에 쓰지 않는다. 주문 없음.
 * - 토스: 종목마다 일봉을 한 번(`fetchCandles` — 캐시를 거치지 않는다) + 시장 기준(SPY) 한 번. 토큰은 `ussample:run` 과 같은 토큰 파일.
 * - 지표 엔진(INDICATORS_PORT)이 떠 있어야 한다.
 */
import 'dotenv/config';
import Database from 'better-sqlite3';
import { dbFilePath } from '../server/db';
import { isMockMode } from '../server/mockData';
import { indicatorEngineHealthy } from '../server/indicatorService';
import { fetchCandles } from '../src/services/toss/market';
import { readLines, SAMPLE_FILE } from './lib/usClose';
import { useTokenFile } from './lib/tossTokenFile';
import { JUDGE_CANDLE_LIMIT, judgeSamples, loadJudgeRules, renderJudgeReport } from './lib/usCloseJudge';

async function main(): Promise<number> {
  const file = process.env.USSAMPLE_OUT ?? SAMPLE_FILE;
  const lines = readLines(file);
  if (!lines.length) {
    console.log(`기록이 없습니다: ${file}`);
    return 1;
  }
  if (isMockMode()) {
    console.log('토스 키가 없어 판단하지 않습니다(모의 데이터 모드) — .env 의 TOSS_CLIENT_ID · TOSS_CLIENT_SECRET 을 확인하세요.');
    return 1;
  }
  if (!(await indicatorEngineHealthy())) {
    console.log(`지표 엔진(포트 ${process.env.INDICATORS_PORT ?? 5001})이 꺼져 있습니다 — 오라클: pm2 restart alphascope-indicators · 맥: npm run dev:py 를 먼저 켜세요.`);
    return 1;
  }
  const db = new Database(dbFilePath(), { readonly: true, fileMustExist: true });
  let rules;
  try {
    rules = loadJudgeRules(db);
  } finally {
    db.close();
  }
  useTokenFile(file);
  const result = await judgeSamples({ lines, rules, fetchDaily: (s) => fetchCandles(s, '1d', JUDGE_CANDLE_LIMIT) });
  console.log(renderJudgeReport(result));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('판단 견주기 실패:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
