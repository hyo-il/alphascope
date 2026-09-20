/**
 * 사이드 메뉴 구조 (대메뉴 → 소메뉴 2단).
 *
 * 평면 메뉴는 항목이 여덟 개를 넘기면서 "어디에 뭐가 있는지" 를 아이콘으로만 기억해야 했다.
 * 대메뉴로 묶으면 한 번에 보이는 항목이 네 개로 줄고, 새 화면을 넣을 자리도 분명해진다.
 *
 * ⚠️ 메뉴 정의는 여기 한 곳이다. `SideNav` 가 그리고 `appStore` 가 현재 위치를 들고 있는데,
 * 목록을 두 곳에 두면 한쪽에만 항목이 추가된다.
 */

export type NavGroupId = 'chart' | 'analysis' | 'account' | 'settings';

export type NavPageId =
  | 'chart'
  | 'compare'
  | 'analysis'
  | 'surge'
  | 'swing'
  | 'portfolio'
  | 'settings-account'
  | 'settings-app'
  | 'settings-changelog';

export interface NavPage {
  id: NavPageId;
  label: string;
  /** 종목을 골라야 의미가 있는 화면 — 미선택 상태에서 빈 화면을 보여 주지 않는다 */
  needsSymbol?: boolean;
}

export interface NavGroup {
  id: NavGroupId;
  icon: string;
  label: string;
  pages: NavPage[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'chart',
    icon: '📊',
    label: '차트',
    pages: [
      // 기업정보는 별도 메뉴가 아니라 차트 하단 탭에 있다 (같은 종목을 보며 읽는 자리다).
      { id: 'chart', label: '차트' },
      { id: 'compare', label: '기업 비교' },
    ],
  },
  {
    id: 'analysis',
    icon: '🔍',
    label: '분석',
    pages: [
      { id: 'analysis', label: 'AI 분석', needsSymbol: true },
      { id: 'surge', label: '급등 탐지' },
      { id: 'swing', label: '스윙 추천' },
    ],
  },
  {
    id: 'account',
    icon: '💼',
    label: '계좌',
    // 모의투자는 별도 메뉴가 아니라 포트폴리오의 **계좌 선택**으로 들어갔다.
    pages: [{ id: 'portfolio', label: '계좌 관리' }],
  },
  {
    id: 'settings',
    icon: '⚙️',
    label: '설정',
    pages: [
      { id: 'settings-account', label: '계좌 설정' },
      { id: 'settings-app', label: '앱 기능 설정' },
      // 손대는 설정이 아니라 읽는 화면이라 맨 뒤에 둔다.
      { id: 'settings-changelog', label: '업데이트 내역' },
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
