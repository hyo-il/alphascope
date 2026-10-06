import { X } from 'lucide-react';
import { ICON_SM } from './icon';

/**
 * 「목록에서 삭제」 × 버튼 (v2.40.0 공통 동작 규칙) — **데이터는 남고 목록에서만 빠지는** 삭제.
 * 늘 보이고(hover 전용 금지), 확인 창을 띄우지 않는다. 툴팁에 무엇이 남는지 적는다(`keeps`, 예: "관심 목록은 그대로").
 * 되돌릴 수 없는 삭제(저장한 것)는 이 버튼이 아니라 휴지통(`common/TrashIcon`) + `modal.confirm` 이다.
 */
export default function ListRemoveButton({
  onClick,
  name,
  keeps,
  label = '목록에서 삭제',
  className = '',
}: {
  onClick: () => void;
  /** 화면 읽기용 — 무엇을 빼는지(종목 이름 등) */
  name?: string;
  /** 툴팁 뒤에 붙는 "무엇이 남는지" */
  keeps?: string;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={name ? `${name} ${label}` : label}
      title={keeps ? `${label} — ${keeps}` : label}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary ${className}`}
    >
      <X {...ICON_SM} />
    </button>
  );
}
