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
