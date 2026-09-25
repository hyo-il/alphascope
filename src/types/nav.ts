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
  /**
   * 상단 종목 헤더(검색 + 종목명·시세·★)를 감출 화면.
   *
   * 종목과 **아무 상관이 없는** 화면에만 준다 — 계좌는 자체 헤더(계좌 유형 탭)가 있어
   * 종목 헤더가 겹치고, 설정은 종목을 쓰지 않는다. 급등·스윙·비교는 오히려 거기서 종목을
   * 고르므로 해당하지 않는다.
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
      { id: 'swing', label: '스윙 추천' },
      /*
        ⚠️ **급등 탐지는 검증 전 테스트 기능이다** (2026-09-25 사용자 결정).
        실제로 써 보니 탐지된 종목이 이미 급등한 뒤였는데, 구조상 당연하다 —
        종목 풀이 토스 **상승률·거래량 상위 랭킹**이고 판정은 **일봉**의 과거 급등 간격
        평균이다. 장중 실시간 탐지가 아니다.
        주기성 예측이 우연보다 나은지 검증되기 전까지 **맨 아래 + 테스트 배지**로 둔다.
        기능은 지우지 않는다 — 검증 결과를 보고 사용자가 유지·격하·제거를 정한다.
      */
      { id: 'surge', label: '급등 탐지', badge: '테스트' },
    ],
  },
  {
    id: 'account',
    icon: '💼',
    label: '계좌',
    // 모의투자는 별도 메뉴가 아니라 포트폴리오의 **계좌 선택**으로 들어갔다.
    pages: [{ id: 'portfolio', label: '계좌 관리', hidesSymbolHeader: true }],
  },
  {
    id: 'settings',
    icon: '⚙️',
    label: '설정',
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
