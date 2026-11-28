/**
 * 디자인 기준표의 크기 값 — 한 곳. 글자 크기·색은 `index.css` 의 `@theme`, **높이·폭**은 여기다.
 * **조작 부품 높이는 이 이름 하나**(`CONTROL_H`) — 버튼 · 묶음 버튼 · 입력칸 · 드롭박스 · 아이콘 버튼이 모두 여기서 높이를 받는다
 * (다른 파일에 높이 숫자를 따로 적지 않는다 — 같은 줄에 섞여도 높이가 갈리지 않게):
 *   `md` 32px 기본 · `sm` 28px **도구 줄**(= 아이콘 버튼 md · 버튼 sm · 묶음 버튼 sm · 입력칸 sm) · `xs` 24px **표 안**(= 아이콘 버튼 sm).
 * ⚠️ Tailwind 는 소스의 글자 그대로를 찾아 클래스를 만든다 — 클래스 이름 자체(`h-7` 등)는 여기 통째로 적고, 다른 정의는 이 값을 가져다 쓴다.
 */
export const CONTROL_H = { md: 'h-8', sm: 'h-7', xs: 'h-6' } as const;
/**
 * 손가락 화면(v2.74.0 · 테마 6절 · `touch:` = `pointer: coarse` · 폭과 상관없음) — 보이는 크기는 그대로, **누르는 칸**만 키운다.
 * - `TOUCH_MIN` 44 — 누르는 칸 최소(px). 공용 단추 · 묶음 단추 · 아이콘 단추 · 탭 · 체크 · [ⓘ] 은 `TOUCH_HIT`(`index.css` `touch-hit` — 보이지 않는 바깥 칸).
 * - `TOUCH_HIT_GAP` — 아이콘 단추끼리 바로 붙어 있으면 사이를 넓힌다(누르는 칸이 서로 겹치지 않게).
 * - `TOUCH_FIELD` — 입력 칸 · 드롭박스는 높이 44 · 글 16(사파리는 16 보다 작은 입력 글을 누르면 화면을 확대한다 — 입력 칸 글만 글자 4단계 예외).
 * - 목록 줄(`LIST_ROW`) · 표 줄(`LIST_TABLE_ROW`)은 44 — 각 이름에 함께 적었다. 표 머리 줄은 그대로.
 */
export const TOUCH_MIN = 44;
export const TOUCH_HIT = 'touch-hit';
export const TOUCH_HIT_GAP = 'touch-hit-gap';
export const TOUCH_FIELD_H = 'touch:h-11';
export const TOUCH_FIELD_TEXT = 'touch:text-sm';
export const TOUCH_FIELD = `${TOUCH_FIELD_H} ${TOUCH_FIELD_TEXT}`;
/** 버튼 · 입력칸 · 드롭박스 · 묶음 버튼의 크기(2가지) — `xs` 는 아이콘 버튼 sm 전용 */
export type ControlSize = 'md' | 'sm';

/** 묶음 버튼(Segmented) 안 칸 높이 — 바깥 틀 p-0.5(2px) 안이라 한 단계 아래(md 틀 32 → 칸 28 · sm 틀 28 → 칸 24) */
export const SEGMENT_H = { md: CONTROL_H.sm, sm: CONTROL_H.xs } as const;

/**
 * 폼 줄(`FormRow`)의 이름 칸·값 칸 폭 — **같은 묶음은 같은 폭**이라 입력칸의 왼쪽·오른쪽 끝이 맞는다(사용자: "끝부분이 맞아떨어져야 깔끔").
 * 묶음마다 하나를 고른다(그 묶음에서 가장 긴 값이 들어가는 폭).
 */
export const FORM_LABEL_W = { sm: 'w-32', md: 'w-44', lg: 'w-56' } as const;
/** 값 칸 폭 — 묶음에서 가장 넓은 입력칸(또는 드롭박스)이 들어가는 폭. 칸은 이 안에서 **오른쪽 끝에 붙는다** */
export const FORM_VALUE_W = { sm: 'w-28', md: 'w-40', lg: 'w-56' } as const;

/** 목록 줄 — 높이 약 36px + 줄 사이 4px (사용자: "아이템 사이 약간의 간격이 있어야 구분") · 손가락 화면은 44(테마 6절) */
/** 손가락 화면 목록 줄 44 — 마우스 높이를 따로 정하지 않은 열리는 목록(검색 결과 등)의 줄에도 단다 */
export const TOUCH_LIST_ROW = 'touch:min-h-11';
export const LIST_ROW = `min-h-9 ${TOUCH_LIST_ROW}`;
export const LIST_GAP = 'space-y-1';
/**
 * 목록 **표** 의 줄 높이 — 40px. 표 줄(`tr`)에는 min-height 가 먹지 않아 `LIST_ROW` 대신 이것을 쓴다.
 * 매매 규칙 목록(버튼 28px 줄)과 종목 목록 표(계좌 ② · 백테스트 ①)가 같은 높이가 된다.
 */
export const LIST_TABLE_ROW = 'h-10 touch:h-11';
/**
 * `LIST_TABLE_ROW` 의 높이(CSS 값) — 줄 N개 높이를 계산할 때(거래정지 「며칠째 정지 중」 5줄 칸). 마우스 40px · 손가락 화면 44px
 * (`index.css` 의 `--list-table-row-h` — 같은 값 · 조건은 `touch` 변형 한 곳).
 */
export const LIST_TABLE_ROW_H = 'var(--list-table-row-h)';
/** 고정(sticky) 머리줄 높이 — 몸통 높이를 줄 수로 정하는 표에서 머리줄도 높이를 고정한다(13px 글자 + 위아래 8px 와 같은 36px) */
export const TABLE_HEAD_ROW = 'h-9';
export const TABLE_HEAD_ROW_PX = 36;

/**
 * 실시간 순위 미리보기의 **캔들 + 거래량 칸** 최소 높이 — 200px(머리 · 범례 · 아래 안내 제외).
 * 평소에는 미리보기가 본문 칸의 40% 이고, 화면이 낮아 이 칸이 200px 보다 작아질 때만 미리보기가 커지고 목록이 그만큼 준다.
 */
export const PREVIEW_CHART_MIN_H = 'min-h-[200px]';

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
 * 폰 · 패드의 옆으로 미는 표(`ui/ScrollTable` · v2.75.0)에서 이름 칸(`TABLE_NAME_COL` — 글이 있는 `w-full` 머리 칸) 최소 폭(px).
 * 표가 좁아지면 이름 칸이 먼저 줄어 코드만 보였다(「0006…」) — 넘치는 긴 이름은 지금처럼 말줄임 + 잘렸을 때만 툴팁. 1280 이상은 쓰지 않는다.
 */
export const TABLE_NAME_MIN_PX = 140;
/**
 * 폰 · 패드의 미는 표에서 **이름 칸이 `TABLE_NAME_COL` 이 아닌 표**(실제 계좌 보유 등)의 이름 칸(td) — 한 줄 · 최대 160 · 넘치면 말줄임.
 * 좁은 상자에서 이름이 두 줄로 꺾이던 것을 막는다(160 = 폰 상자 폭 절반 안 — 고정 칸이 풀리지 않게). 1280 이상은 아무것도 하지 않는다.
 */
export const TABLE_NAME_CELL_TOUCH = 'phone:max-w-40 phone:truncate pad:max-w-40 pad:truncate';
/** 폰 · 패드의 미는 표에서 한 줄로 둘 칸(`TABLE_NUM_COL` 을 쓰지 않는 숫자 칸 — 「−」 뒤에서 금액이 꺾이지 않게 · 짧은 글 칸 — 「적용된 곳」) — 넘치면 상자 안에서 밂. 1280 이상은 아무것도 하지 않는다 */
export const TABLE_ONE_LINE_TOUCH = 'phone:whitespace-nowrap pad:whitespace-nowrap';
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
/** 자산 관리 계좌 카드의 자산 분류 글자 칸(v2.65.3 — 고르기 없이 글자만) — 가장 긴 글자 「미지정」 이 잘리지 않는 폭 · 이을 수 없는 줄의 「—」 도 같은 폭 */
export const ASSET_CLASS_W = 'w-16';
export const FIELD_W = { short: 'w-16', long: 'w-32', select: 'w-auto', /** 값 칸을 채움 — 드롭박스 · 검색칸과 섞인 폼에서 왼쪽 끝을 맞출 때 */ fill: 'w-full' } as const;
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
 * 주 단추 바탕(테마 9-1 R1 — 모든 화면 · 모든 크기에서 하나) — 진한 파랑 + 흰 글. `Button` 의 `primary` 와,
 * 크기가 공용 단추와 달라 직접 그리는 주 단추(종목 검색 [조회])가 함께 쓴다. 밝은 파랑 `bg-accent` 는 단추 바탕에 쓰지 않는다(`design:lint`).
 */
export const PRIMARY_BUTTON_COLOR = 'bg-accent-button text-white hover:bg-accent-button-hover active:bg-accent-button-hover';
/**
 * 매수 · 매도 색 — 「매수 = 초록(bullish) · 매도 = 빨강(bearish)」(미국 증권 기준 · 테마 9-1 R3) 정의는 여기 한 곳.
 * 빠른주문 지정가 · 시장가 · `Button` 의 `buy` · `sell` · 급등 카드 「모의 매수」 가 함께 쓴다. 색 바탕 위 글은 `bg-primary`(흰 글은 대비 4.5 미달).
 * 꺼진 버튼은 각 버튼의 `disabled:opacity-40` 으로만 옅어진다. 딱지(거래 내역 등)는 `ORDER_BUY_BADGE` · `ORDER_SELL_BADGE` + 글자 「매수」 「매도」.
 */
export const ORDER_BUY_COLOR = 'bg-bullish text-bg-primary hover:brightness-110';
export const ORDER_SELL_COLOR = 'bg-bearish text-bg-primary hover:brightness-110';
/** 매수 · 매도 딱지 · 글 색(옅은 바탕 + 글) — 글자 「매수」 「매도」 를 늘 함께 쓴다 */
export const ORDER_BUY_BADGE = 'bg-bullish/15 text-bullish';
export const ORDER_SELL_BADGE = 'bg-bearish/15 text-bearish';
export const ORDER_BUY_TEXT = 'text-bullish';
export const ORDER_SELL_TEXT = 'text-bearish';

/**
 * 종목 지도 분야 이름 줄 (사용자 지적 4). 이름 글자 줄(16px) 위아래 여백. 칸 배치(squarified)는 이 높이를 뺀 영역으로 계산된다.
 * 여백이 없으면 「기술」·「금융」 글자가 위 분야 경계와 아래 첫 칸에 붙는다.
 */
export const HEATMAP_SECTOR_PAD_Y = 4;
/**
 * 폰 종목 지도 높이(v2.74.0 · 사용자 결정 5) = (보이는 높이 − 위쪽 막대 52 − 시황 띠 40 − 위 안전 여백) × 0.6 · 최소 320.
 * 업종 칸은 지도 아래(본문과 함께 밀어 봄).
 */
export const HEATMAP_PHONE_MAP_H = 'h-[max(320px,calc((100dvh-92px-env(safe-area-inset-top))*0.6))]';
export const HEATMAP_SECTOR_LINE = 16;

/**
 * 카드 격자 (계좌 모아보기 — 쓰는 곳은 `gap-3` 과 함께). **한 줄 최대 2장**, 2장이 안 들어가면(카드 최소 18rem × 2 + 간격) 1장(사용자 결정).
 * 칸 최소 폭 = max(18rem, 절반) 이라 넓어도 2칸을 넘지 않는다. auto-fill 이라 계좌가 1개여도 빈 칸을 남겨 **절반 폭**이다
 * (auto-fit 은 빈 칸을 접어 카드 한 장이 가로를 다 차지한다). 카드 높이는 내용이고 같은 줄은 같은 높이(격자 기본 stretch).
 */
export const CARD_GRID = 'grid-cols-[repeat(auto-fill,minmax(max(18rem,calc((100%_-_0.75rem)/2)),1fr))]';

/**
 * 툴팁 (v2.69.0 — `ui/Tooltip` · `ui/InfoTip` 이 함께 쓴다 · 사용자 결정 2026-11-10). 시간 · 크기 · 상자 모양은 여기 한 곳.
 * - 마우스를 올리고 `TOOLTIP_OPEN_MS` 뒤 열림 · 대상과 상자 둘 다에서 벗어나고 `TOOLTIP_CLOSE_MS` 뒤 닫힘.
 * - 자리: 대상 바로 아래 `TOOLTIP_GAP` · 화면 끝에서 `TOOLTIP_EDGE` 안쪽 · 폭은 글 길이만큼(최대 `TOOLTIP_MAX_W` · 화면 폭 − 2 × `TOOLTIP_EDGE`).
 * - 상자: 떠 있는 바탕(`bg-elevated`) · 1px 테두리 · 둥글기 8px · 그림자 · 글자 14px(`text-xs`) · 줄 높이 1.625 · 안쪽 여백 가로 10px · 세로 6px · 줄바꿈 지킴.
 */
/**
 * 손가락(v2.74.0 · 사용자 결정 2026-11-25): 누를 때 하는 일이 없는 대상([ⓘ] · 점선 글자 · 맨 글)은 **누르면** 열림 ·
 * 하는 일이 있는 단추 · 줄은 `TOOLTIP_LONG_PRESS_MS` **길게 누르면** 열림(손을 떼도 그 동작은 일어나지 않음) · 누른 채 `TOOLTIP_TOUCH_MOVE_PX` 넘게 움직이면 취소.
 */
export const TOOLTIP_LONG_PRESS_MS = 500;
export const TOOLTIP_TOUCH_MOVE_PX = 10;
export const TOOLTIP_OPEN_MS = 300;
export const TOOLTIP_CLOSE_MS = 200;
export const TOOLTIP_MAX_W = 320;
export const TOOLTIP_GAP = 4;
export const TOOLTIP_EDGE = 8;
export const TOOLTIP_BOX = 'fixed z-[120] w-max rounded-lg border border-border bg-bg-elevated px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-line text-text-primary shadow-lg';

/**
 * 아이콘 버튼(`ui/IconButton`) 크기 — **두 가지만**(사용자 결정 2026-11-10 · 다른 크기 금지 · `design:lint`).
 * `md` 도구 줄 = 28px 상자(`CONTROL_H.sm` — 버튼 sm · 묶음 버튼 sm 과 같은 줄 높이) · 16px 아이콘 / `sm` 표 안 = 24px 상자(`CONTROL_H.xs`) · 14px 아이콘.
 */
export const ICON_BUTTON_BOX = { md: `${CONTROL_H.sm} w-7`, sm: `${CONTROL_H.xs} w-6` } as const; // 높이는 CONTROL_H(도구 줄 · 표 안) — 폭만 여기
export type IconButtonSize = keyof typeof ICON_BUTTON_BOX;

/**
 * 폰 창(아래에서 올라오는 판 · v2.74.0 · 테마 3-5 — `ui/Dialog`) — 최대 높이 = 보이는 높이 − 64(`100dvh` — 키보드가 올라오면 판도 준다).
 * 손잡이 · 머리를 `DIALOG_SWIPE_CLOSE_PX` 넘게 아래로 밀면 닫는다(그보다 짧으면 제자리).
 */
export const PHONE_DIALOG_MAX_H = 'max-h-[calc(100dvh-64px)]';
export const DIALOG_SWIPE_CLOSE_PX = 80;

/**
 * 폰 카드(v2.76.0 · 테마 4-1 — `ui/DataCard`) — 폰 모양에서 표 대신 그리는 카드 한 벌(계좌 보유 · 다음 차수 매수 판단 · 거래정지).
 * 바탕 bg-secondary · 둥근 12 · 안 여백 위아래 12 / 옆 16 · 줄 사이 8 · 숫자 고정 폭 · 카드 사이 8.
 * 카드 위 이름표 글은 `text-secondary`(테마 1-1 — `text-muted` 는 bg-secondary 위 4.22 라 쓰지 않음).
 */
export const DATA_CARD = 'rounded-xl bg-bg-secondary px-4 py-3 space-y-2 tabular-nums';
export const DATA_CARD_LIST = 'flex flex-col gap-2';
/** 펼치는 카드(v2.77.0 매수 판단)의 누르는 곳 — 줄 사이 8 그대로(바깥 카드가 바탕 · 여백을 맡음) */
export const DATA_CARD_PRESS = 'cursor-pointer space-y-2';
/** 카드 안 2 × 2 값 칸(v2.77.0 매수 판단 — 손절가 · 목표가 / 손익비 · 비중) — 칸 사이 가로 16 · 세로 6 */
export const DATA_CARD_GRID = 'grid grid-cols-2 gap-x-4 gap-y-1.5';
/** 창 안 카드(v2.84.0 · 새 규칙 창 조건) — 창 바탕이 bg-secondary 라 카드 바탕은 창 안 「고급 설정」 상자와 같은 어두운 바탕(숫자 칸 bg-tertiary 가 보이게 · 나머지는 `DATA_CARD` 와 같음) */
export const DATA_CARD_IN_DIALOG = 'rounded-xl bg-bg-primary/40 px-4 py-3 space-y-2 tabular-nums';

/**
 * 손가락 화면 단추 줄 사이(v2.76.0 · 테마 6 「12 이상」) — 마우스 화면(1280 이상 포함)은 그대로.
 * - `TOUCH_WRAP_GAP` 줄바꿈되는 단추 줄의 위아래 16(= 44 − 28 — 28 단추의 누르는 칸 44 가 위아래 줄과 겹치지 않게).
 * - `TOUCH_INFO_GAP` [ⓘ] 옆 단추와의 사이 24(= [ⓘ] 14 의 바깥 칸 15 + 단추 바깥 칸 8 + 여유).
 * - `TOUCH_FIELD_INNER` 숫자 칸 안 입력(`NumberField`) — 틀 44 의 테두리(위아래 1) 안이라 42 → 테두리까지 덮어 44(보이는 모양 그대로 · 바탕 투명).
 */
export const TOUCH_WRAP_GAP = 'touch:gap-y-4';
export const TOUCH_INFO_GAP = 'touch:gap-x-6';
export const TOUCH_FIELD_INNER = 'touch:-my-px touch:h-[calc(100%+2px)]';

/**
 * 고르기 칩(v2.76.0 · `ui/Chip` — 하나를 고르는 작은 글자 단추: 초기 자금 · 거래 거르기 · 성과 기간 · 계좌 아래 탭).
 * 크기는 쓰던 모양 그대로(1280 이상 그대로) — xs 22 · sm · md 26 · tab(px 10). 손가락 화면 누르는 칸 44 는 `TOUCH_HIT`.
 */
export const CHIP_SIZE = { xs: 'px-2 py-0.5 text-caption', sm: 'px-2 py-1 text-caption', md: 'px-2 py-1 text-xs', tab: 'px-2.5 py-1 text-xs', /** 폰 차트 주기 칩 32(테마 5-2) */ lg: `${CONTROL_H.md} shrink-0 whitespace-nowrap px-3 text-xs` } as const;
/** 손가락 화면에서 위 탭 줄 바로 밑에 붙은 단추 줄의 위아래 안 여백(누르는 칸이 위 탭과 겹치지 않게) */
export const TOUCH_BAR_PAD = 'touch:py-3';
/** 손가락 화면 표 줄 44(v2.76.0) — 높이를 `LIST_TABLE_ROW` 로 정하지 않은 표에서 줄 안 단추(종목 이름)의 누르는 칸 44 가 위아래 줄끼리 겹치지 않게 · 마우스 화면 그대로 */
export const TOUCH_TABLE_ROW = 'touch:h-11';
/** 입력 칸 · 드롭박스 옆 아이콘 단추(v2.77.0 규칙 고르기 [조건 보기]) — 손가락 화면은 칸(`TOUCH_FIELD` 44)과 같은 높이 · 폭 44(같은 줄 높이) */
export const TOUCH_FIELD_SIDE = 'touch:h-11 touch:w-11';
/** 줄 단추 바로 옆 아이콘 단추(v2.77.0 종목 추가 창 「직접 추가」 줄 삭제) — 손가락 화면은 사이 12(아이콘 단추 바깥 칸 10 + 여유 — 누르는 칸 겹침 0) */
export const TOUCH_SIDE_GAP = 'touch:gap-x-3';
/**
 * 폰 차트 화면(v2.82.0 · 테마 5-2) — 위 → 아래: 위쪽 막대 → 가격 줄 → 주기 칩 줄 → 차트 → 아래 탭(위에 붙음) → 탭 내용.
 * 차트 높이 = (보이는 높이 − 위쪽 막대 − 가격 줄 − 칩 줄) × `PHONE_CHART_RATIO` · 최소 `PHONE_CHART_MIN_PX`(계산은 `chart/phoneChartLayout.ts` 한 곳).
 * 폰 가로(높이 < 500)는 칩 줄이 가격 줄 오른쪽 · 차트 = 남는 높이. 클래스 글자(`h-14` 등)와 px 값은 같은 값이다.
 */
export const PHONE_PRICE_ROW_PX = 56;
export const PHONE_PRICE_ROW_H = 'h-14';
export const PHONE_CHIP_ROW_PX = 44;
export const PHONE_CHIP_ROW_H = 'h-11';
export const PHONE_CHART_RATIO = 0.55;
export const PHONE_CHART_MIN_PX = 240;
/** 폰 차트 아래 탭 줄(높이 44 · 글 16 · 위에 붙음) */
export const PHONE_TAB_ROW_H = 'h-11';
/** 폰 주기 칩(칩 32 · 손가락 누르는 칸 44 는 `ui/Chip` 의 `TOUCH_HIT`) — 칩 사이 12(테마 6 「12 이상」) */
export const PHONE_CHIP_GAP = 'gap-3';
/**
 * 패드 차트 화면(테마 5-3) — 차트(가격 칸 줄) 최소 360 · 아래 탭 내용 칸 최소(점검 53 — 펼친 탭이 약 180 으로 좁았다).
 * 모자라면 본문을 밀어 본다(차트 · 탭을 그 아래로 줄이지 않음).
 */
export const PAD_CHART_MIN_H = 'min-h-[360px]';
export const PAD_CHART_TABS_MIN_PX = 300;
/** 폰 캡처 창(아래 판 — 높이가 내용만큼)의 차트 칸 높이(v2.82.0 · 점검 54) */
export const PHONE_CAPTURE_CHART_H = 'h-[45dvh]';
/** 폰 표 최소 폭(v2.77.0 매수 판단 히스토리 펼친 표 — 고정 칸 합 608 + 종목 칸) — 고정 칸 합이 폰 폭보다 커 칸이 겹치던 표는 이 폭으로 두고 `ScrollTable` 이 상자 안에서 민다 */
export const PHONE_TABLE_MIN_W = 'phone:min-w-[760px]';
/**
 * 폰 증시 일정(v2.83.0 · 테마 9-2 「증시일정」) — 위 → 아래: 주 이동 줄 → 거르기 칩 줄(44 · 넘치면 `ScrollRow`) → 가로 7일 칸 → 그날 일정 카드.
 * 7일 칸 한 칸 = 요일 13 · 날짜 16 · 「N건」 13 secondary(폭 = 본문 ÷ 7 ≥ 44 · 높이 ≥ 44) · 고른 날 = `bg-bg-elevated` + 밑줄.
 */
export const PHONE_WEEK_GRID = 'grid grid-cols-7 gap-1 rounded-xl bg-bg-secondary p-1';
export const PHONE_WEEK_DAY = 'flex min-h-11 flex-col items-center gap-0.5 rounded-lg py-1.5 tabular-nums transition-colors';
export const PHONE_WEEK_DATE = 'text-sm';
/** 손가락 화면 날짜 고르기 판 폭(칸 44 × 7 + 사이 2 × 6 + 안 여백 24) — 마우스 화면은 지금 300 그대로 */
export const DATE_PICKER_W = 300;
export const DATE_PICKER_TOUCH_W = 344;
/**
 * 폰 자산 관리(v2.83.0 · 테마 9-2 「계좌-자산관리 · 자산-총자산」) — 요약 카드 한 줄에 하나(이름 13 · 값 18 · 변화 13) ·
 * 도넛 160 위 가운데 · 범례 아래 폭 전체.
 */
/** 폰 숫자 카드 값 18(`phone:` 이름 — 폰에서만 · 1280 이상은 지금 16 그대로) */
export const PHONE_SUMMARY_VALUE = 'phone:text-base';
export const PHONE_DONUT_PX = 160;
/** 붙은 단추 줄 사이(테마 6 「12 이상」 · 넘치면 줄바꿈) */
export const BUTTON_ROW_GAP = 'gap-3';
/**
 * 폰 「위 이름 · 아래 값」 줄(v2.83.0 · 테마 9-1 R10) — 이름 칸 + 고르기 · 입력 칸이 한 줄에 들어가지 않는 고정 높이 줄(`LIST_TABLE_ROW`)을 폰에서만 두 줄로 쌓는다.
 * 높이는 내용만큼(`!` — 손가락 화면 줄 높이 `touch:h-11` 보다 먼저) · 이름 칸 · 값 칸은 그 자리에서 `phone:w-full`.
 */
export const PHONE_STACK_ROW = 'phone:h-auto! phone:flex-wrap phone:gap-y-1 phone:py-2';
