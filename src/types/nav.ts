/**
 * 사이드 메뉴 구조 (대메뉴 → 소메뉴 2단).
 *
 * 평면 메뉴는 항목이 여덟 개를 넘기면서 "어디에 뭐가 있는지" 를 아이콘으로만 기억해야 했다.
 * 대메뉴로 묶으면 새 화면을 넣을 자리가 분명해진다. 대메뉴 이름은 **하는 일**을 말한다.
 *
 * ⚠️ 메뉴 정의는 여기 한 곳이다. `SideNav` 가 그리고 `appStore` 가 현재 위치를 들고 있는데,
 * 목록을 두 곳에 두면 한쪽에만 항목이 추가된다.
 */

/**
 * 대메뉴 (퀀트 다시 만들기 5단계, 사용자 결정 A-1): 홈(고른 화면) · 탐색 · 차트·비교(종목 탐색 · 차트 · 기업 비교) · 증시 일정 · 퀀트 · 실험실 · 계좌 · (맨 아래) 설정.
 * 수동 분석·이 종목 Gemini 분석은 차트 아래 「AI 분석」 탭, 기록·성적표는 「퀀트 > 검증 기록」.
 * ⚠️ page id 는 바꾸지 않는다 — 주소(#/pageId)·저장값·`needsSymbol` 이 page id 로 찾는다. 없앤 주소는 `hooks/useHashRoute.ts` 의 `LEGACY_ROUTES` 가 새 자리로 보낸다.
 */
export type NavGroupId = 'home' | 'explore' | 'chart' | 'calendar' | 'quant' | 'lab' | 'account' | 'settings';

export type NavPageId =
  | 'home'
  | 'chart'
  | 'compare'
  | 'calendar'
  | 'rules'
  | 'heatmap'
  | 'ranking'
  | 'surge'
  | 'ushalts'
  | 'swing'
  | 'backtest'
  | 'records'
  | 'portfolio'
  | 'settings-account'
  | 'settings-app'
  | 'settings-changelog';

export interface NavPage {
  id: NavPageId;
  label: string;
  /** 종목을 골라야 의미가 있는 화면 — 미선택 상태에서 빈 화면을 보여 주지 않는다 */
  needsSymbol?: boolean;
  /**
   * 상단 종목 헤더(검색 + 종목명·시세·★)를 감출 화면.
   *
   * 계좌는 자체 헤더(계좌 유형 탭)가 있어 종목 헤더가 겹치고, 설정은 종목을 쓰지 않는다.
   * 급등·스윙은 **각 화면 안의 검색**(스윙 「종목 검색」 탭·급등 「종목 검색 평가」 탭)으로 종목을 고르고,
   * 화면 내용이 전역 종목을 받지 않아 상단 헤더는 전역 종목만 바꿀 뿐이었다 → 숨긴다(2026-09-29).
   * 비교는 남긴다. ⚠️ 헤더만 감춘다 — 차트는 화면 밖에 그대로 마운트된다(App 의 chartVisible 과 무관).
   */
  hidesSymbolHeader?: boolean;
}

export type NavIconKey = 'home' | 'explore' | 'chart' | 'calendar' | 'quant' | 'lab' | 'account' | 'settings';

export interface NavGroup {
  id: NavGroupId;
  /** 아이콘 이름 — `layout/navIcons.ts` 가 lucide 아이콘으로 바꾼다 (이 파일은 서버도 컴파일해 React 를 들이지 않는다) */
  icon: NavIconKey;
  label: string;
  /**
   * 접힌 메뉴(52px) 전용 짧은 이름 — 「차트·비교」「증시 일정」 은 12px 로 52px 에 들어가지 않는다.
   * 펼친 메뉴·제목·툴팁에는 `label` 을 쓴다.
   */
  shortLabel: string;
  /**
   * 대메뉴 이름 옆 작은 배지 — 지금은 실험실의 `테스트` 하나.
   * ⚠️ 라벨 문자열에 "(테스트)" 를 적어 넣지 않는다 — 뗄 때 문자열을 다시 찾아야 한다. 접힌 메뉴에서는 배지 대신 툴팁 「실험실 (테스트)」.
   */
  badge?: string;
  /**
   * 소메뉴가 하나뿐이어도 소메뉴 줄(펼친 메뉴)·플라이아웃(접힌 메뉴)을 보인다 (사용자 결정: 실험실만).
   * 이 표시가 있으면 보고 있을 때 이름을 눌러 접을 수도 있다(소메뉴 2개 이상인 대메뉴와 같다).
   */
  showSinglePage?: boolean;
  /**
   * 대메뉴를 누르면 가는 소메뉴 — 없으면 첫 소메뉴. 「차트·비교」 는 맨 위가 종목 탐색이어도 누르면 차트로 간다(사용자 결정).
   */
  landingPage?: NavPageId;
  /**
   * 소메뉴 없이 **설정에서 고른 홈 화면**으로 가는 대메뉴(「홈」 하나). 누르면 로고와 같은 `goHome()` 을 부른다.
   * 고른 화면은 제 대메뉴에 속하므로 이 대메뉴는 강조되지 않는다 — 메뉴 강조는 그 화면이 속한 대메뉴다.
   */
  home?: boolean;
  /** 소메뉴가 하나뿐이면 펼친 메뉴에 소메뉴 줄·화살표를, 접힌 메뉴에 플라이아웃을 그리지 않는다 — 대메뉴를 누르면 바로 그 화면이다 */
  pages: NavPage[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    /*
      홈 (사용자 결정) — 맨 위, 소메뉴 없음. 누르면 **설정에서 고른 홈 화면**(`HOME_PAGES`)으로 간다 — 로고 · 처음 열기와 같은 `goHome()`.
      ⚠️ 보던 종목은 지우지 않는다(차트 언마운트 금지 원칙).
    */
    id: 'home',
    icon: 'home',
    label: '홈',
    shortLabel: '홈',
    home: true,
    pages: [],
  },
  {
    id: 'explore',
    icon: 'explore',
    label: '탐색',
    shortLabel: '탐색',
    pages: [
      // 첫 소메뉴 = 대메뉴를 누르면 가는 곳 — 종목 지도가 먼저다 (사용자 결정). page id·주소는 그대로
      // 시총 상위 100 + 관심 종목의 등락 지도. 종목은 지도에서 눌러 고른다 — 상단 헤더를 숨긴다
      { id: 'heatmap', label: '종목 지도', hidesSymbolHeader: true },
      // 토스 실시간 순위 + 마우스를 올리면 차트 미리보기. 위치는 이 줄만 옮기면 된다 — 화면은 page id 로만 찾는다
      { id: 'ranking', label: '실시간 순위', hidesSymbolHeader: true },
    ],
  },
  {
    // id 'chart' 를 바꾸지 않는다(주소 #/chart). 처음 화면·로고는 홈(고른 화면)이다
    id: 'chart',
    icon: 'chart',
    label: '차트·비교',
    shortLabel: '차트',
    // 맨 위 소메뉴가 종목 탐색이어도 대메뉴를 누르면 차트로 간다(사용자 결정)
    landingPage: 'chart',
    pages: [
      /*
        종목 탐색(StockExplorer — 검색 · 인기 · 관심 · 보유 · 최근). ⚠️ page id 'home' 은 그대로다(주소 #/home · 저장값).
        상단 종목 헤더는 둔다 — 헤더 검색으로 종목을 고르면 차트로 간다.
      */
      { id: 'home', label: '종목 탐색' },
      // 기업정보는 별도 메뉴가 아니라 차트 하단 탭에 있다 (같은 종목을 보며 읽는 자리다).
      { id: 'chart', label: '차트' },
      { id: 'compare', label: '기업 비교' },
    ],
  },
  {
    id: 'calendar',
    icon: 'calendar',
    label: '증시 일정',
    shortLabel: '일정',
    // 실적·FOMC·옵션 만기·휴장. 종목은 달력 안에서 눌러 고른다 — 상단 헤더를 숨긴다. 소메뉴 하나 → 바로 이동
    pages: [{ id: 'calendar', label: '일정', hidesSymbolHeader: true }],
  },
  {
    /*
      퀀트 (퀀트 다시 만들기 5단계 완료, 사용자 결정 A-1). 규칙 → 판단 → 시험 → 검증 순서.
      소메뉴가 넷이라 보고 있는 대메뉴를 접을 수 있다. 넷 다 종목과 무관한 화면이라 상단 종목 헤더를 감춘다.
    */
    id: 'quant',
    icon: 'quant',
    label: '퀀트',
    shortLabel: '퀀트',
    pages: [
      { id: 'rules', label: '매매 규칙', hidesSymbolHeader: true },
      // 「매수 판단」(A-3). page id 'swing' 은 그대로(주소·저장값)
      { id: 'swing', label: '매수 판단', hidesSymbolHeader: true },
      // 고른 종목을 고른 매매 규칙(방법 1~3개)으로 1~3년 시험한다. 주소 #/backtest, 탭 없음
      { id: 'backtest', label: '백테스트', hidesSymbolHeader: true },
      // 검증 기록 (A-4) — 목표 수익 가능성 · AI 검증 · AI 분석 · 진단 리포트 탭 넷
      { id: 'records', label: '검증 기록', hidesSymbolHeader: true },
    ],
  },
  {
    id: 'lab',
    icon: 'lab',
    label: '실험실',
    shortLabel: '실험실',
    badge: '테스트',
    // 소메뉴(급등 탐지 · 거래정지)를 보인다 — 실험실에 무엇이 있는지 펼쳐서 알 수 있게(소메뉴가 하나여도 — showSinglePage)
    showSinglePage: true,
    pages: [
      /*
        ⚠️ **급등 탐지는 검증 전 테스트 기능이다** (2026-09-25 사용자 결정).
        실제로 써 보니 탐지된 종목이 이미 급등한 뒤였는데, 구조상 당연하다 —
        종목 풀이 토스 **상승률·거래량 상위 랭킹**이고 판정은 **일봉**의 과거 급등 간격
        평균이다. 장중 실시간 탐지가 아니다.
        주기성 예측이 우연보다 나은지 검증되기 전까지 **실험실 + 테스트 배지**로 둔다.
        기능은 지우지 않는다 — 검증 결과를 보고 사용자가 유지·격하·제거를 정한다.
        대메뉴를 누르면 첫 소메뉴인 급등 탐지로 간다.
      */
      { id: 'surge', label: '급등 탐지', hidesSymbolHeader: true },
      /*
        거래정지 (v2.55.0) — 오늘(미국 날짜) 멈춘 미국 종목 · 사유 · 한국 시간 정지 · 예상 재개 · 방향(추정).
        서버가 Nasdaq Trader 거래정지 RSS 를 1분마다 받아 쌓은 것을 읽는다(`server/usHalts/`). 매매 판단과 닿지 않는다.
      */
      { id: 'ushalts', label: '거래정지', hidesSymbolHeader: true },
    ],
  },
  {
    id: 'account',
    icon: 'account',
    label: '계좌',
    shortLabel: '계좌',
    // 모의투자는 별도 메뉴가 아니라 포트폴리오의 **계좌 선택**으로 들어갔다. 소메뉴 하나 → 바로 이동
    pages: [{ id: 'portfolio', label: '계좌 관리', hidesSymbolHeader: true }],
  },
  {
    id: 'settings',
    icon: 'settings',
    label: '설정',
    shortLabel: '설정',
    pages: [
      { id: 'settings-account', label: '계좌 설정', hidesSymbolHeader: true },
      { id: 'settings-app', label: '앱 기능 설정', hidesSymbolHeader: true },
      // 손대는 설정이 아니라 읽는 화면이라 맨 뒤에 둔다.
      { id: 'settings-changelog', label: '업데이트 내역', hidesSymbolHeader: true },
    ],
  },
];

/** 대메뉴를 누르면 가는 화면 — `landingPage`, 없으면 첫 소메뉴(소메뉴가 없는 「홈」 은 undefined) */
export function landingOf(group: NavGroup): NavPageId | undefined {
  return group.landingPage ?? group.pages[0]?.id;
}

// ── 홈 화면 (설정 > 앱 기능 설정 「홈 화면」) ─────────────────────────
/**
 * 홈으로 고를 수 있는 화면 — **이 목록 한 곳**을 서버(`server/homePage.ts` 입력 검사)와 설정 화면이 같이 쓴다.
 * 이름은 메뉴 이름(`pageMeta(id).label`)을 그대로 쓴다 — 설정의 고르기 이름과 메뉴 이름이 갈라지지 않게.
 * 홈 메뉴 · 로고 · 처음 열기(주소 없음 · 모르는 주소)가 고른 화면으로 간다. 계좌는 넣지 않는다(사용자 결정).
 */
export const HOME_PAGES = ['home', 'heatmap', 'ranking', 'chart'] as const satisfies readonly NavPageId[];
export type HomePageId = (typeof HOME_PAGES)[number];
/** 저장값이 없거나 목록 밖이면 종목 탐색 */
export const DEFAULT_HOME_PAGE: HomePageId = 'home';
export const isHomePage = (v: unknown): v is HomePageId => (HOME_PAGES as readonly unknown[]).includes(v);

/** 페이지가 속한 대메뉴 — 소메뉴로 바로 이동해도 그 대메뉴가 펼쳐져 있어야 한다 */
export function groupOf(page: NavPageId): NavGroupId {
  return NAV_GROUPS.find((group) => group.pages.some((p) => p.id === page))?.id ?? 'chart';
}

export function pageMeta(page: NavPageId): NavPage | undefined {
  for (const group of NAV_GROUPS) {
    const found = group.pages.find((p) => p.id === page);
    if (found) return found;
  }
  return undefined;
}

// ── 화면 안 탭 ─────────────────────────────────────────────────────
/**
 * 주소에 넣는 화면 안 탭 — **이 표 한 곳**이 탭 목록이다. 화면(`RecordsView`·`BuyJudgeView`·`SurgeDashboard`·
 * `PortfolioView`)과 주소 해석(`hooks/useHashRoute.ts`)·스토어(`appStore.setPage`)가 모두 여기서 읽는다.
 * 두 곳에 목록을 두면 새 탭이 한쪽에만 생겨 주소와 화면이 어긋난다.
 *
 * - `id` = 코드의 탭 값(`nav.sub` 에 그대로 들어간다), `path` = 주소 조각(`#/{page}/{path}`). 지금은 모두 같다.
 * - **첫 줄이 기본 탭**이다 — 탭 없이 들어오면(`#/swing`) 첫 탭으로 연다.
 * - ⚠️ 넣지 않는 것: 계좌 상세 안의 탭·차트 하단 탭·관심 목록 패널 탭·「AI 분석 기록」 필터 — 화면이 아니라 패널이라
 *   주소가 바뀌면 뒤로 가기만 길어진다.
 */
export const PAGE_TABS = {
  // 검증 기록 (A-4) — 목표 수익 가능성이 맨 앞(기본 탭). 옛 주소 #/analysis/* · #/diagnose 는 useHashRoute 의 LEGACY_ROUTES 가 여기로 보낸다
  records: [
    { id: 'target', path: 'target' },
    { id: 'aicheck', path: 'aicheck' },
    { id: 'analysis', path: 'analysis' },
    { id: 'diagnose', path: 'diagnose' },
  ],
  // 「매수 판단」 · 「히스토리」 둘. 옛 #/swing/target · #/swing/search 는 모르는 조각이라 첫 탭(#/swing/list)으로 간다
  swing: [
    { id: 'list', path: 'list' },
    { id: 'history', path: 'history' },
  ],
  surge: [
    { id: 'list', path: 'list' },
    { id: 'search', path: 'search' },
    { id: 'history', path: 'history' },
    { id: 'settings', path: 'settings' },
  ],
  portfolio: [
    { id: 'paper', path: 'paper' },
    { id: 'real', path: 'real' },
  ],
} as const satisfies Partial<Record<NavPageId, readonly { id: string; path: string }[]>>;

export type TabbedPageId = keyof typeof PAGE_TABS;
export type PageTab<P extends TabbedPageId> = (typeof PAGE_TABS)[P][number]['id'];

const tabsOf = (page: NavPageId): readonly { id: string; path: string }[] | undefined =>
  (PAGE_TABS as Partial<Record<NavPageId, readonly { id: string; path: string }[]>>)[page];

/** 그 화면의 탭 값으로 맞춘다 — 탭이 없는 화면은 null, 모르는 값·빈 값은 첫 탭 */
export function normalizeTab(page: NavPageId, sub: string | null | undefined): string | null {
  const tabs = tabsOf(page);
  if (!tabs) return null;
  return tabs.find((t) => t.id === sub)?.id ?? tabs[0].id;
}

/** 탭 값 → 주소 조각 */
export function tabPath(page: NavPageId, sub: string | null | undefined): string | null {
  const tabs = tabsOf(page);
  return tabs?.find((t) => t.id === sub)?.path ?? null;
}

/** 주소 조각 → 탭 값 (모르면 null — 호출부가 첫 탭으로 맞춘다) */
export function tabFromPath(page: NavPageId, path: string | undefined): string | null {
  const tabs = tabsOf(page);
  return (path && tabs?.find((t) => t.path === path)?.id) || null;
}
