/**
 * 디자인 기준표의 크기 값 — 한 곳. 글자 크기·색은 `index.css` 의 `@theme`, **높이·폭**은 여기다.
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
/** 값 칸 폭 — 묶음에서 가장 넓은 입력칸(또는 드롭박스)이 들어가는 폭. 칸은 이 안에서 **오른쪽 끝에 붙는다** */
export const FORM_VALUE_W = { sm: 'w-28', md: 'w-40', lg: 'w-56' } as const;

/** 목록 줄 — 높이 약 36px + 줄 사이 4px (사용자: "아이템 사이 약간의 간격이 있어야 구분") */
export const LIST_ROW = 'min-h-9';
export const LIST_GAP = 'space-y-1';
/**
 * 목록 **표** 의 줄 높이 — 40px. 표 줄(`tr`)에는 min-height 가 먹지 않아 `LIST_ROW` 대신 이것을 쓴다.
 * 매매 규칙 목록(버튼 28px 줄)과 종목 목록 표(계좌 ② · 백테스트 ①)가 같은 높이가 된다.
 */
export const LIST_TABLE_ROW = 'h-10';

/**
 * 표 (기준표 「표」 규칙) — **화면은 꽉 채우되 숫자 칸은 내용 폭 + 고정 여백**, 남는 폭은 이름(종목) 칸이 가져간다.
 * 브라우저가 남는 폭을 모든 칸에 나눠 주면 넓은 화면(1920·2560)에서 숫자 칸 사이가 100~200px 씩 벌어졌다 — 비교가 안 된다.
 * - `TABLE_NAME_COL` — 이름 칸(th 하나에). 남는 폭을 다 가져간다. 긴 종목명만 말줄임 + 툴팁(숫자·티커는 자르지 않는다).
 * - `TABLE_NUM_COL` — 숫자 칸(th·td). 폭 = 내용 폭(줄바꿈 없음) — 숫자 칸의 폭 상한이 곧 「내용 + `TABLE_NUM_GAP`」 이다.
 * - `TABLE_NUM_GAP` — 숫자 칸 왼쪽 여백(옆 칸과 붙어 읽히지 않게).
 * - 이름 칸이 없는 표는 마지막 칸 뒤에 빈 칸(`TABLE_FILL`)을 둔다(열을 고르게 벌리지 않는다).
 */
export const TABLE_NAME_COL = 'w-full';
export const TABLE_NUM_COL = 'w-px whitespace-nowrap';
export const TABLE_NUM_GAP = 'pl-6';
/** 숫자 칸이 많은 표(매수 판단 — 칸 10개)의 숫자 칸 왼쪽 여백. 1280 에서 종목 칸에 이름·티커가 들어갈 자리를 남긴다 */
export const TABLE_NUM_GAP_TIGHT = 'pl-3';
export const TABLE_FILL = 'w-full';
/**
 * 글자가 섞인 비교 칸(백테스트 비교 표의 방법·들고 있기 칸 — 조건 한 줄·판 이유) — 넓은 창(1536px 이상)에서만 최소 폭 176px.
 * 폭을 고정하지 않는다 — 빈 칸(`TABLE_FILL`)이 남는 폭을 가져가므로 이 칸은 내용의 줄바꿈 단위(줄바꿈 금지 조각) 폭까지만 넓어진다.
 * 1280 에서는 최소 폭을 두지 않는다(줄바꿈해 들어간다 — 최소 폭을 두면 표가 35px 넘친다).
 * 넓은 창에서 최소 폭이 없으면 빈 칸에 밀려 「들고 있기」 가 한 단어씩 꺾인다.
 */
export const TABLE_TEXT_COL = '2xl:min-w-44';

/**
 * 패널 가로 여백 (기준표 「패널 가로 여백」). **한 영역 안에서 탭 줄 · 소탭 줄 · 내용의 왼쪽 끝이 같은 x** 다.
 * 탭 줄·소탭 줄·내용 상자가 모두 이 변수를 쓰고, `ui/Tabs` 는 첫 탭 글자가 상자 안쪽 끝에서 바로 시작한다(탭 버튼에 가로 여백 없음).
 * 영역마다 여백을 따로 주면 왼쪽 끝이 여러 군데로 갈린다.
 */
export const PANEL_X = 'px-4';
/** 패널 내용 상자 — 가로 `PANEL_X` + 세로 12px */
export const PANEL_PAD = 'px-4 py-3';

/**
 * 입력칸 폭 — 종류별 3가지 (기준표 「입력칸」, 사용자 결정 2026-10-13).
 * - `short` 짧은 숫자(%·개수·일·분 — 최대 4자리) — 숫자 4자리 + 안쪽 여백
 * - `long` 금액(원화 억 단위 · 달러 소수 — 쉼표 포함 약 12자)
 * - `select` 드롭박스 — 그 드롭박스의 **가장 긴 항목**에 맞춘다(브라우저가 정하는 자연 폭, 폭 클래스를 주지 않는다)
 * 값 칸을 꽉 채우면 짧은 숫자 칸도 불필요하게 커진다.
 */
export const FIELD_W = { short: 'w-16', long: 'w-32', select: 'w-auto' } as const;
export type FieldKind = keyof typeof FIELD_W;

/**
 * 단위 열 폭 — **단위는 칸 밖 오른쪽**, 같은 묶음은 단위 열 폭이 같다 → 단위가 없는 줄도 같은 자리를 비워 **설명 시작점이 한 줄**.
 * 묶음에서 가장 긴 단위가 들어가는 폭: `sm` 한 글자(%·주·분) · `md` 두 글자(종목) · `lg` 세 글자(거래일). 묶음은 `ui/NumberField` 의 `NumberUnitGroup`.
 * (단위를 칸 안에 두면 숫자와 단위 사이가 떠 보인다)
 */
export const UNIT_W = { sm: 'w-4', md: 'w-7', lg: 'w-10' } as const;

/**
 * 빠른주문 입력 줄 — 「이름 칸 | 입력칸 | 오른쪽 버튼 칸」 세 칸 폭을 수량 줄·가격 줄이 같이 써서 **입력칸의 왼쪽·오른쪽 끝이 맞는다**.
 * 줄마다 폭이 다르면 입력칸 시작점과 오른쪽 버튼 폭이 어긋난다.
 */
export const ORDER_LABEL_W = 'w-8';
export const ORDER_TRAIL_W = 'w-[4.5rem]';
/** 빠른주문 — 입력칸 아래 줄(프리셋 버튼)을 입력칸 왼쪽 끝에서 시작하게: `ORDER_LABEL_W`(2rem) + 간격(0.375rem) */
export const ORDER_INDENT = 'pl-[2.375rem]';

/**
 * 종목 지도 분야 이름 줄 (사용자 지적 4). 이름 글자 줄(16px) 위아래 여백. 칸 배치(squarified)는 이 높이를 뺀 영역으로 계산된다.
 * 여백이 없으면 「기술」·「금융」 글자가 위 분야 경계와 아래 첫 칸에 붙는다.
 */
export const HEATMAP_SECTOR_PAD_Y = 4;
export const HEATMAP_SECTOR_LINE = 16;

/**
 * 카드 격자 (계좌 모아보기). 카드 최소 폭 18rem 으로 **있는 카드가 가로를 나눠 채운다**(auto-fit).
 * 열 수를 고정(`xl:grid-cols-3`)하면 1280 에서 계좌 2개일 때 오른쪽 3분의 1이 빈다. 카드 높이는 내용이고 같은 줄은 같은 높이(격자 기본 stretch).
 */
export const CARD_GRID = 'grid-cols-[repeat(auto-fit,minmax(18rem,1fr))]';
