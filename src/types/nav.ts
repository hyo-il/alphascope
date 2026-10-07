/**
 * 사이드 메뉴 구조 (대메뉴 → 소메뉴 2단).
 *
 * 평면 메뉴는 항목이 여덟 개를 넘기면서 "어디에 뭐가 있는지" 를 아이콘으로만 기억해야 했다.
 * 대메뉴로 묶으면 새 화면을 넣을 자리가 분명해진다. 대메뉴 이름은 **하는 일**을 말한다(v2.26.0).
 *
 * ⚠️ 메뉴 정의는 여기 한 곳이다. `SideNav` 가 그리고 `appStore` 가 현재 위치를 들고 있는데,
 * 목록을 두 곳에 두면 한쪽에만 항목이 추가된다.
 */

/**
 * 대메뉴 (v2.26.0 다시 묶음 — 2026-10-02 사용자 결정): 탐색 · 차트·비교 · 증시 일정 · 투자 분석 · 실험실 · 계좌 · (맨 아래) 설정.
 * ⚠️ page id 는 바꾸지 않았다 — 주소(#/pageId)·저장값·`needsSymbol` 이 page id 로 찾는다. 대메뉴만 다시 묶었다.
 */
export type NavGroupId = 'explore' | 'chart' | 'calendar' | 'analysis' | 'lab' | 'account' | 'settings';

export type NavPageId =
  | 'chart'
  | 'compare'
  | 'calendar'
  | 'heatmap'
  | 'ranking'
  | 'analysis'
  | 'surge'
  | 'swing'
  | 'diagnose'
  | 'backtest'
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
  /**
   * 라벨 뒤에 붙는 작은 배지 — 지금은 `테스트` 하나다.
   *
   * ⚠️ 라벨 문자열에 "(테스트)" 를 적어 넣지 않는다. 라벨은 화면 제목·검색 등 다른 곳에서도
   * 쓰이고, 나중에 배지를 떼려면 문자열을 다시 찾아 고쳐야 한다.
   */
  badge?: string;
}

export type NavIconKey = 'explore' | 'chart' | 'calendar' | 'analysis' | 'lab' | 'account' | 'settings';

export interface NavGroup {
  id: NavGroupId;
  /** 아이콘 이름 — `layout/navIcons.ts` 가 lucide 아이콘으로 바꾼다 (v2.36.0, 예전에는 이모지. 이 파일은 서버도 컴파일해 React 를 들이지 않는다) */
  icon: NavIconKey;
  label: string;
  /**
   * 접힌 메뉴(52px) 전용 짧은 이름 — 「차트·비교」「증시 일정」「투자 분석」 은 12px 로 52px 에 들어가지 않는다.
   * 펼친 메뉴·제목·툴팁에는 `label` 을 쓴다.
   */
  shortLabel: string;
  /** 소메뉴가 하나뿐이면 펼친 메뉴에 소메뉴 줄·화살표를, 접힌 메뉴에 플라이아웃을 그리지 않는다 — 대메뉴를 누르면 바로 그 화면이다 */
  pages: NavPage[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'explore',
    icon: 'explore',
    label: '탐색',
    shortLabel: '탐색',
    pages: [
      // 첫 소메뉴 = 대메뉴를 누르면 가는 곳 — 종목 지도가 먼저다 (v2.33.0 사용자 결정). page id·주소는 그대로
      // 시총 상위 100 + 관심 종목의 등락 지도 (v2.18.0). 종목은 지도에서 눌러 고른다 — 상단 헤더를 숨긴다
      { id: 'heatmap', label: '종목 지도', hidesSymbolHeader: true },
      // 토스 실시간 순위 + 마우스를 올리면 차트 미리보기 (v2.20.0). 위치는 이 줄만 옮기면 된다 — 화면은 page id 로만 찾는다
      { id: 'ranking', label: '실시간 순위', hidesSymbolHeader: true },
    ],
  },
  {
    // 앱을 처음 열었을 때·로고(홈)의 위치가 이 대메뉴의 차트다 — id 'chart' 를 바꾸지 않는다
    id: 'chart',
    icon: 'chart',
    label: '차트·비교',
    shortLabel: '차트',
    pages: [
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
    // 실적·FOMC·옵션 만기·휴장 (v2.17.0). 종목은 달력 안에서 눌러 고른다 — 상단 헤더를 숨긴다. 소메뉴 하나 → 바로 이동
    pages: [{ id: 'calendar', label: '일정', hidesSymbolHeader: true }],
  },
  {
    id: 'analysis',
    icon: 'analysis',
    label: '투자 분석',
    shortLabel: '분석',
    pages: [
      { id: 'analysis', label: 'AI 분석', needsSymbol: true },
      // v2.35.0 이름 「스윙 추천」 → 「매수 판단 도우미」(사용자 결정). page id 'swing' 은 그대로(주소·저장값)
      { id: 'swing', label: '매수 판단 도우미', hidesSymbolHeader: true },
    ],
  },
  {
    id: 'lab',
    icon: 'lab',
    label: '실험실',
    shortLabel: '실험실',
    pages: [
      /*
        ⚠️ **급등 탐지는 검증 전 테스트 기능이다** (2026-09-25 사용자 결정).
        실제로 써 보니 탐지된 종목이 이미 급등한 뒤였는데, 구조상 당연하다 —
        종목 풀이 토스 **상승률·거래량 상위 랭킹**이고 판정은 **일봉**의 과거 급등 간격
        평균이다. 장중 실시간 탐지가 아니다.
        주기성 예측이 우연보다 나은지 검증되기 전까지 **실험실 + 테스트 배지**로 둔다(v2.26.0 에 실험실로 옮겼다).
        기능은 지우지 않는다 — 검증 결과를 보고 사용자가 유지·격하·제거를 정한다.
      */
      /*
        3년 백테스트 (v2.37.0) — 규칙형 3가지 방법을 미국 시총 상위 100(7분야)에 3년(1년씩 3구간)으로 시험한다. 조건은 고정(사전 등록).
        주소 #/backtest, 탭 없음(PAGE_TABS 에 넣지 않는다). 종목과 무관한 화면이라 상단 종목 헤더를 감춘다.
      */
      { id: 'backtest', label: '백테스트', badge: '테스트', hidesSymbolHeader: true },
      { id: 'surge', label: '급등 탐지', badge: '테스트', hidesSymbolHeader: true },
      /*
        `npm run diagnose` 와 같은 함수를 웹에서 돌리고 결과를 본다 (v2.14.0). 이름 그대로, 위치만 실험실로(v2.26.0).
        종목과 무관한 화면이라 상단 종목 헤더를 감춘다.
      */
      { id: 'diagnose', label: '진단 리포트', badge: '테스트', hidesSymbolHeader: true },
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

// ── 화면 안 탭 (v2.28.0) ─────────────────────────────────────────────────────
/**
 * 주소에 넣는 화면 안 탭 — **이 표 한 곳**이 탭 목록이다. 화면(`AIAnalysisView`·`SwingDashboard`·`SurgeDashboard`·
 * `PortfolioView`)과 주소 해석(`hooks/useHashRoute.ts`)·스토어(`appStore.setPage`)가 모두 여기서 읽는다.
 * 두 곳에 목록을 두면 새 탭이 한쪽에만 생겨 주소와 화면이 어긋난다.
 *
 * - `id` = 코드의 탭 값(`nav.sub` 에 그대로 들어간다), `path` = 주소 조각(`#/{page}/{path}`). 대개 같고,
 *   AI 분석의 `results` 만 5차 주소(`#/analysis/records`)를 지키려고 `records` 다.
 * - **첫 줄이 기본 탭**이다 — 탭 없이 들어오면(`#/swing`) 첫 탭으로 연다.
 * - ⚠️ 넣지 않는 것: 계좌 상세 안의 탭·차트 하단 탭·관심 목록 패널 탭·「AI 분석 기록」 필터 — 화면이 아니라 패널이라
 *   주소가 바뀌면 뒤로 가기만 길어진다.
 */
export const PAGE_TABS = {
  analysis: [
    { id: 'manual', path: 'manual' },
    { id: 'results', path: 'records' },
    { id: 'accuracy', path: 'accuracy' },
  ],
  // v2.35.0: 지금 살 만한가(list) · 목표 수익 가능성(target — 다시 넣었다) · 종목 검색 · 지난 기록(history). 주소 조각은 예전 그대로
  swing: [
    { id: 'list', path: 'list' },
    { id: 'target', path: 'target' },
    { id: 'search', path: 'search' },
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
