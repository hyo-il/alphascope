import { modal } from '../../store/uiStore';

/**
 * 최근 조회 「모두 삭제」 확인 — 관심 패널과 종목 탐색 홈이 **같은 함수**를 부른다 (v2.41.0).
 * 예전에는 패널만 묻고 탐색 홈은 바로 지웠다(같은 동작이 화면마다 달랐다).
 */
export function confirmClearRecent(count: number, onClear: () => void): void {
  if (!count) return;
  modal.confirm({
    title: '최근 조회 모두 삭제',
    message: `최근 조회한 ${count}종목을 모두 삭제합니다. 되돌릴 수 없습니다. (관심 목록은 그대로입니다)`,
    confirmText: '삭제',
    danger: true,
    onConfirm: onClear,
  });
}
