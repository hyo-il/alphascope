/** 관심 목록 폴더 (localStorage 저장 구조) */
export interface WatchFolder {
  id: string;
  name: string;
  /** 접힘 상태 — 접힌 폴더의 종목은 폴링하지 않는다 */
  collapsed: boolean;
  symbols: string[];
}

/**
 * 어느 폴더에도 넣지 않은 종목이 모이는 곳.
 *
 * ⚠️ **화면에는 폴더로 보이지 않는다** (2026-09-23). 사용자에게 이것은 폴더가 아니라
 * "폴더에 없음" 이라는 **상태**다 — 패널에서는 머리줄 없이 맨 위에 바로 나열하고,
 * 관리 팝업에서는 그룹 목록에 나오지 않는다.
 *
 * ⚠️ **그래도 저장 형식은 그대로 둔다.** `normalize()`·`save()`·옛 키 이관이 모두 이
 * 구조에 기대고 있어서, 저장을 바꾸면 이관 코드가 하나 더 생기고 종목이 사라질 위험이
 * 있다(「미분류를 빼면 그 안의 종목이 사라진다」 사고 이력). 그래서 **화면만** 바꿨다.
 */
export const DEFAULT_FOLDER_ID = 'default';
/** 저장된 값의 이름. 화면에 그대로 내보내지 않는다 — 위 설명 참고. */
export const DEFAULT_FOLDER_NAME = '미분류';
/** 코드에서 뜻이 드러나게 쓰는 별칭 (저장된 id 값은 바꾸지 않는다) */
export const UNGROUPED_ID = DEFAULT_FOLDER_ID;
/** 화면에 쓰는 말 */
export const UNGROUPED_LABEL = '폴더 없는 종목';
