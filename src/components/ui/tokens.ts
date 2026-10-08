/**
 * 디자인 기준표의 크기 값 — 한 곳 (v2.42.0). 글자 크기·색은 `index.css` 의 `@theme`, **높이·폭**은 여기다.
 * 버튼·묶음 버튼·입력칸·드롭박스가 같은 높이를 쓴다: 기본 `md` 32px · 좁은 곳(표 안 등) `sm` 28px.
 * ⚠️ Tailwind 는 소스의 글자 그대로를 찾아 클래스를 만든다 — 값을 문자열을 조합해 만들지 말고 아래처럼 통째로 적는다.
 */
export const CONTROL_H = { md: 'h-8', sm: 'h-7' } as const;
export type ControlSize = keyof typeof CONTROL_H;

/** 묶음 버튼(Segmented) 안 칸 높이 — 바깥 틀 p-0.5(2px) 안에서 위 높이에 맞춘다 */
export const SEGMENT_H = { md: 'h-7', sm: 'h-6' } as const;

/**
 * 폼 줄(`FormRow`)의 이름 칸·값 칸 폭 — **같은 묶음은 같은 폭**이라 입력칸의 왼쪽·오른쪽 끝이 맞는다(사용자: "끝부분이 맞아떨어져야 깔끔").
 * 묶음마다 하나를 고른다(그 묶음에서 가장 긴 값이 들어가는 폭).
 */
export const FORM_LABEL_W = { sm: 'w-32', md: 'w-44', lg: 'w-56' } as const;
export const FORM_VALUE_W = { sm: 'w-28', md: 'w-40', lg: 'w-56' } as const;

/** 목록 줄 — 높이 약 36px + 줄 사이 4px (사용자: "아이템 사이 약간의 간격이 있어야 구분") */
export const LIST_ROW = 'min-h-9';
export const LIST_GAP = 'space-y-1';

/**
 * 표 (v2.42.1 — 기준표 「표」 규칙) — **화면은 꽉 채우되 숫자 칸은 내용 폭 + 고정 여백**, 남는 폭은 이름(종목) 칸이 가져간다.
 * 예전 표는 브라우저가 남는 폭을 모든 칸에 나눠 줘 넓은 화면(1920·2560)에서 숫자 칸 사이가 100~200px 씩 벌어졌다 — 비교가 안 된다.
 * - `TABLE_NAME_COL` — 이름 칸(th 하나에). 남는 폭을 다 가져간다. 긴 종목명만 말줄임 + 툴팁(숫자·티커는 자르지 않는다).
 * - `TABLE_NUM_COL` — 숫자 칸(th·td). 폭 = 내용 폭(줄바꿈 없음) — 숫자 칸의 폭 상한이 곧 「내용 + `TABLE_NUM_GAP`」 이다.
 * - `TABLE_NUM_GAP` — 숫자 칸 왼쪽 여백(옆 칸과 붙어 읽히지 않게).
 * - 이름 칸이 없는 표는 마지막 칸 뒤에 빈 칸(`TABLE_FILL`)을 둔다(열을 고르게 벌리지 않는다).
 */
export const TABLE_NAME_COL = 'w-full';
export const TABLE_NUM_COL = 'w-px whitespace-nowrap';
export const TABLE_NUM_GAP = 'pl-6';
export const TABLE_FILL = 'w-full';
/**
 * 글자가 섞인 비교 칸(백테스트 비교 표의 방법·들고 있기 칸 — 조건 한 줄·판 이유) — 넓은 창(1536px 이상)에서만 최소 폭 176px.
 * 폭을 고정하지 않는다 — 빈 칸(`TABLE_FILL`)이 남는 폭을 가져가므로 이 칸은 내용의 줄바꿈 단위(줄바꿈 금지 조각) 폭까지만 넓어진다.
 * 1280 에서는 최소 폭을 두지 않는다(예전처럼 줄바꿈해 들어간다 — 최소 폭을 두면 표가 35px 넘쳤다).
 * 넓은 창에서 최소 폭이 없으면 빈 칸에 밀려 「들고 있기」 가 한 단어씩 꺾였다.
 */
export const TABLE_TEXT_COL = '2xl:min-w-44';

/**
 * 패널 가로 여백 (v2.42.2 — 기준표 「패널 가로 여백」). **한 영역 안에서 탭 줄 · 소탭 줄 · 내용의 왼쪽 끝이 같은 x** 다.
 * 탭 줄·소탭 줄·내용 상자가 모두 이 변수를 쓰고, `ui/Tabs` 는 첫 탭 글자가 상자 안쪽 끝에서 바로 시작한다(탭 버튼에 가로 여백 없음).
 * 예전에는 차트 아래 탭(px-1 + 탭 px-3) · 기업정보 소탭(px-1) · AI 분석 소탭(px-1 + px-2.5) · 내용(p-3) 이 모두 달라 왼쪽 끝이 세 군데로 갈렸다.
 */
export const PANEL_X = 'px-4';
/** 패널 내용 상자 — 가로 `PANEL_X` + 세로 12px */
export const PANEL_PAD = 'px-4 py-3';

/**
 * 숫자 입력칸의 단위 칸 폭 (v2.42.2 — 기준표 「숫자 입력」). 같은 묶음(창·구역)은 같은 폭 → 단위 글자 폭(「%」·「분」·「거래일」)이 달라도 **숫자 오른쪽 끝이 한 줄**.
 * 묶음에서 가장 긴 단위가 들어가는 폭을 고른다 — `sm` 한 글자(%·주) · `md` 두 글자(종목) · `lg` 세 글자(거래일). 단위가 없는 칸도 같은 자리를 비운다.
 * 묶음은 `ui/NumberField` 의 `NumberUnitGroup` 으로 감싸 정한다(감싸지 않은 칸은 예전처럼 단위 글자 폭).
 */
// 폭에 오른쪽 여백(8px)이 들어 있다 — 글자 자리 16 · 32 · 48px
export const UNIT_W = { sm: 'w-6', md: 'w-10', lg: 'w-14' } as const;

/**
 * 빠른주문 입력 줄 (v2.42.2) — 「이름 칸 | 입력칸 | 오른쪽 버튼 칸」 세 칸 폭을 수량 줄·가격 줄이 같이 써서 **입력칸의 왼쪽·오른쪽 끝이 맞는다**.
 * 예전에는 수량 줄은 이름 없이 바로 입력칸(왼쪽 800px), 가격 줄은 「가격」 뒤(822px)에서 시작했고 오른쪽 버튼 폭도 달랐다.
 */
export const ORDER_LABEL_W = 'w-8';
export const ORDER_TRAIL_W = 'w-[4.5rem]';
/** 빠른주문 — 입력칸 아래 줄(프리셋 버튼)을 입력칸 왼쪽 끝에서 시작하게: `ORDER_LABEL_W`(2rem) + 간격(0.375rem) */
export const ORDER_INDENT = 'pl-[2.375rem]';

/**
 * 종목 지도 분야 이름 줄 (v2.42.2 — 사용자 지적 4). 이름 글자 줄(16px) 위아래 여백. 칸 배치(squarified)는 이 높이를 뺀 영역으로 계산된다.
 * 예전에는 여백 0 이라 「기술」·「금융」 글자가 위 분야 경계와 아래 첫 칸에 붙어 있었다.
 */
export const HEATMAP_SECTOR_PAD_Y = 4;
export const HEATMAP_SECTOR_LINE = 16;

/**
 * 카드 격자 (v2.42.2 — 계좌 모아보기). 카드 최소 폭 18rem 으로 **있는 카드가 가로를 나눠 채운다**(auto-fit).
 * 예전 `xl:grid-cols-3` 은 1280 에서 계좌 2개면 오른쪽 3분의 1, 1920 에서도 빈 칸이 크게 남았다. 카드 높이는 내용이고 같은 줄은 같은 높이(격자 기본 stretch).
 */
export const CARD_GRID = 'grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]';
