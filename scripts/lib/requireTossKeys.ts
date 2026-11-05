/**
 * 토스 실제 모드가 필요한 시험은 **모의 모드(토스 키 없음)면 맨 처음에 멈춘다** — `requireCopyDb` 바로 다음 import 로 둔다.
 *
 * - 모의 모드(`server/mockData.ts` `isMockMode()` — `.env` 가 없거나 토스 키가 비었거나 `your_`)에서는 일봉 · 시세가 만든 값이고
 *   `judgeOnClose` 의 일봉 확정 검사를 건너뛴다 → 실제 모드를 전제로 짠 시험이 거짓으로 실패한다(94차 — worktree 에 `.env` 가 없어
 *   `buyjudge:test` 19 · `cashflow:test` 7 가짜 실패).
 * - 키가 있어도 시험은 토스를 **조회만** 한다(주문 없음) · 많은 시험은 가짜 fetch · 캐시에 심은 봉을 쓴다.
 * - 순수 계산 시험(토스 · 모의 데이터 경로를 타지 않는 것)에는 넣지 않는다 — 넣은 곳 / 뺀 곳은 `docs/rules/workflow.md` 「시험 스크립트 DB 안전장치」.
 */
import 'dotenv/config';
import { isMockMode } from '../../server/mockData';

export const TOSS_KEYS_MESSAGE = '토스 키가 없습니다(.env 없음 · 모의 모드) — worktree 에 .env 를 복사하세요(커밋 금지 · 끝나면 worktree 와 함께 지움).';

if (isMockMode()) {
  console.error(TOSS_KEYS_MESSAGE);
  process.exit(1);
}
