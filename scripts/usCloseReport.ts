/**
 * 미국 마감 직후 값 결과 보기 — `npm run ussample:report` (`--all` = 종목·날짜마다 모든 시각).
 * `~/alphascope-samples/us-close.jsonl`(`ussample:run` 이 쌓은 것)을 읽어 각 시각 값을 그날 마지막(20:40 ET 무렵) 값과 비교한다.
 * 읽기만 한다 — 앱 DB 도 토스도 부르지 않는다.
 */
import { readLines, renderReport, SAMPLE_FILE } from './lib/usClose';

const file = process.env.USSAMPLE_OUT ?? SAMPLE_FILE;
const lines = readLines(file);
if (!lines.length) {
  console.log(`기록이 없습니다: ${file}`);
} else {
  console.log(renderReport(lines, { all: process.argv.includes('--all') }));
}
