/**
 * Playwright 시험의 시간 제한 — 브라우저 단계(페이지 열기 · 기다리기 · 버튼 찾기 · 띄우기 · 닫기)가 멈추면 9분(`check:all` 시험 제한)을 기다리지 않고 바로 실패로 끝낸다.
 *
 * Playwright 의 `page.evaluate` · `isDisabled` · `browser.close` 는 자기 시간 제한이 없어 그대로 멈출 수 있다 — 호출마다 값을 주는 대신, 진행이 없는 시간을 재는 감시 하나를 둔다.
 * - `step(이름, 일)`: 단계 이름을 적고 시계를 다시 잰다. `mark(이름)`: 시험 한 줄이 끝났을 때 — 시계만 다시 잰다.
 * - 멈추면 「FAIL  실패: 시간 초과(<단계 이름>)」 + 종료 코드 1. 브라우저는 `process.exit` 때 Playwright 가 끈다(닫기 요청은 멈춘 단계와 얽혀 쓰지 않는다 · 남은 프로세스 0).
 * - 60초 안에 끝나도록 감시는 조금 일찍(55초) 울린다.
 */
const STEP_LIMIT_MS = 55_000;

export function createBrowserStepGuard() {
  let name = '준비';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const rearm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.log(`FAIL  실패: 시간 초과(${name})`);
      process.exit(1);
    }, STEP_LIMIT_MS);
  };
  rearm();

  return {
    async step<T>(stepName: string, run: () => Promise<T>): Promise<T> {
      name = stepName;
      rearm();
      const result = await run();
      rearm();
      return result;
    },
    /** 시험 한 줄이 끝남 — 다음 단계가 멈추면 이 줄 다음이라고 알린다 */
    mark(lastCheck: string) {
      name = `「${lastCheck}」 다음 단계`;
      rearm();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}
