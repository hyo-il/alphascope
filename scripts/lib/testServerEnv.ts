/**
 * 시험 서버 스위치 — 사본 DB 로 띄운 시험 서버(`server/index.ts`)가 모의 주문 · Gemini · 외부 받기(유니버스 · 거래정지 ·
 * 미국 매수 판단 다시 계산 · 오늘 시황 자동 오전판)를 하지 않게 모두 끈다.
 * HTTP 로 서버를 띄우는 시험은 모두 이것을 env 에 펼친다 — **스위치가 늘면 여기 한 곳에 더한다**(`CLAUDE.md` 2-2 테스트 서버).
 */
export const TEST_SERVER_SWITCHES = {
  AUTO_TRADING_ENABLED: 'false',
  GEMINI_ENABLED: 'false',
  UNIVERSE_UPDATE_ENABLED: 'false',
  US_HALTS_ENABLED: 'false',
  BUYJUDGE_RECHECK_ENABLED: 'false',
  MARKET_BRIEF_ENABLED: 'false',
} as const;
