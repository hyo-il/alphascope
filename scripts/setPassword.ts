/**
 * 주인 계정 비밀번호 설정 — `npm run auth:set-password`
 *
 * 이 앱에는 회원가입도, 비밀번호 찾기 화면도 없다. 비밀번호를 정하고 바꾸는 길은 **여기 하나**다.
 * 비밀번호를 잊었으면 서버에 들어와 이 명령을 다시 돌리면 된다.
 *
 * ⚠️ **평문은 어디에도 남기지 않는다** — 화면에 찍지 않고(에코 끔), 로그·DB 에도 남기지 않는다.
 * ⚠️ 명령줄 인자로 받지 않는다. 셸 히스토리에 그대로 남기 때문이다.
 * ⚠️ 저장하면 **기존 로그인 세션이 모두 끊긴다** (바꾸는 이유가 대개 유출 의심이라서).
 */

import 'dotenv/config';
import readline from 'node:readline';
import { setPassword } from '../server/auth';
import { getDb } from '../server/db';

/** 앱 규칙이다 — 어떤 표준을 따른 값이 아니라, 혼자 쓰는 도구에 맞춰 정한 최소선이다. */
const MIN_LENGTH = 12;

/**
 * 입력을 화면에 찍지 않고 받는다 (터미널 에코 끔).
 *
 * ⚠️ readline 인터페이스는 **하나만** 만들어 두 질문에 함께 쓴다. 질문마다 새로 만들고
 * 닫으면 두 번째 질문에서 stdin 이 이미 끝나 있어 응답이 오지 않는다 (실제로 그랬다).
 * ⚠️ `rl.question` 대신 **`line` 이벤트**로 받는다. 입력이 파이프로 들어오면 끝나는 순간
 * `close` 가 먼저 나면서 question 콜백이 영영 불리지 않아, 아무것도 저장하지 않고
 * 조용히 종료됐다(검증 중 발견). `close` 도 함께 처리해 대기 중인 질문을 끝낸다.
 */
function createHiddenPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const internals = rl as unknown as { _writeToOutput?: (s: string) => void };
  let showPrompt = '';

  // 입력 글자는 화면에 찍지 않고, 질문만 한 번 찍는다.
  internals._writeToOutput = () => {
    if (showPrompt) {
      process.stdout.write(showPrompt);
      showPrompt = '';
    }
  };

  const pending: ((value: string | null) => void)[] = [];
  const buffered: string[] = [];

  rl.on('line', (line) => {
    process.stdout.write('\n');
    const next = pending.shift();
    if (next) next(line);
    else buffered.push(line);
  });
  rl.on('close', () => {
    // 입력이 끊겼다(Ctrl-D·파이프 종료) — 기다리는 질문을 null 로 끝낸다.
    while (pending.length) pending.shift()!(null);
  });

  const ask = (question: string) =>
    new Promise<string | null>((resolve) => {
      const ready = buffered.shift();
      if (ready !== undefined) {
        resolve(ready);
        return;
      }
      showPrompt = question;
      process.stdout.write(question);
      showPrompt = '';
      pending.push(resolve);
    });

  return { ask, close: () => rl.close() };
}

async function main() {
  // DB 를 먼저 연다 — 스키마(app_settings·auth_sessions)가 없으면 여기서 만들어진다.
  getDb();

  console.log('AlphaScope 주인 계정 비밀번호를 정합니다.');
  console.log(`(최소 ${MIN_LENGTH}자 · 입력은 화면에 보이지 않습니다)\n`);

  const prompt = createHiddenPrompt();
  const first = await prompt.ask('새 비밀번호: ');
  const second = await prompt.ask('한 번 더 입력: ');
  prompt.close();

  if (first === null || second === null) {
    console.error('❌ 입력이 끝나지 않았습니다. 다시 실행해 주세요.');
    process.exit(1);
  }
  if (first.length < MIN_LENGTH) {
    console.error(`❌ 너무 짧습니다 — 최소 ${MIN_LENGTH}자여야 합니다.`);
    process.exit(1);
  }
  if (first !== second) {
    console.error('❌ 두 입력이 다릅니다. 다시 실행해 주세요.');
    process.exit(1);
  }

  await setPassword(first);
  console.log('\n✅ 비밀번호를 저장했습니다.');
  console.log('   기존 로그인 세션은 모두 끊겼습니다 — 브라우저에서 다시 로그인하세요.');
  process.exit(0);
}

void main().catch((e) => {
  // ⚠️ 오류 메시지에 입력값이 섞이지 않게 메시지만 찍는다.
  console.error('\n❌ 저장하지 못했습니다:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
