/**
 * 떠 있는 한국 시간 시계의 자리 · 고정 상태 — 서버 `app_settings` 'ui.clock' 에 저장한다(`server/clockSetting.ts`).
 * 서버 입력 검사와 화면이 **같은 함수**(`parseClockSetting`)를 쓴다.
 *
 * - 자리는 **가장 가까운 화면 모서리에서 떨어진 거리**(px)로 둔다 — 창 크기가 달라도(1280 · 1920 · 윈도우) 그 모서리 기준으로 다시 놓는다.
 * - 값이 없으면 `DEFAULT_CLOCK`(고정 풀림 · 기본 자리).
 */
export const CLOCK_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ClockCorner = (typeof CLOCK_CORNERS)[number];

export interface ClockSetting {
  pinned: boolean;
  corner: ClockCorner;
  /** 모서리에서 가로 거리(px, 0 이상 정수) */
  dx: number;
  /** 모서리에서 세로 거리(px, 0 이상 정수) */
  dy: number;
}

/** 거리 상한 — 아주 큰 화면(5K)보다 넉넉히. 더 큰 값은 틀린 값으로 막는다 */
export const CLOCK_MAX_OFFSET = 8000;

/**
 * 기본 자리 — **오른쪽 위, 시황 줄의 빈 곳**(「접기」 · 「시황 펼치기」 버튼 왼쪽).
 * 오른쪽 아래는 가리는 것이 있다: 화면 맨 끝은 관심 패널의 「종목 추가」 칸 · 「계좌」 탭의 총 평가 · 총 손익 줄,
 * 패널 왼쪽은 차트 화면 빠른주문의 「시장가 매수 · 매도」 버튼(1440×900 · 1280×1080).
 * 시황 줄은 펼쳐도(제목 줄) 접어도(지수 4개는 왼쪽 650px 안) 이 자리가 비어 있다.
 */
export const DEFAULT_CLOCK: ClockSetting = { pinned: false, corner: 'top-right', dx: 136, dy: 0 };

const isOffset = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= CLOCK_MAX_OFFSET;

/** 받은 값 검사 — 맞으면 그 네 칸만 담은 새 값, 틀리면 null(서버는 400) */
export function parseClockSetting(v: unknown): ClockSetting | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const { pinned, corner, dx, dy } = v as Record<string, unknown>;
  if (typeof pinned !== 'boolean' || !CLOCK_CORNERS.includes(corner as ClockCorner) || !isOffset(dx) || !isOffset(dy)) return null;
  return { pinned, corner: corner as ClockCorner, dx, dy };
}
