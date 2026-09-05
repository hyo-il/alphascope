/** 관심 목록 폴더 (localStorage 저장 구조) */
export interface WatchFolder {
  id: string;
  name: string;
  /** 접힘 상태 — 접힌 폴더의 종목은 폴링하지 않는다 */
  collapsed: boolean;
  symbols: string[];
}

/** 어느 폴더에도 넣지 않은 종목이 모이는 곳. 삭제할 수 없고 항상 맨 아래다. */
export const DEFAULT_FOLDER_ID = 'default';
export const DEFAULT_FOLDER_NAME = '미분류';
