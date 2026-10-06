import { ChevronDown, ChevronUp } from 'lucide-react';
import Button from './Button';
import { ICON_SM } from './icon';

/**
 * 접기 버튼 (v2.39.0 · v2.40.0 용어집) — 앱의 **모든 접기는 이 버튼 하나**다(`<summary>` 를 쓰지 않는다).
 * 글자는 용어집을 따른다: 숫자를 고치는 칸 = 「고급 설정」, 설정이 아닌 칸 = 「○○ 보기」, 펼치면 「접기」.
 * 예전에는 작은 회색 글자(`<summary>`·글자 버튼)라 있는 줄도 몰랐다. 펼침 상태는 기억하지 않는다(쓰는 곳이 상태를 들고 있다).
 * `controls` = 펼쳐지는 영역의 id (`aria-controls`).
 */
export default function DisclosureButton({
  open,
  onToggle,
  label,
  openLabel = '접기',
  controls,
  className = '',
}: {
  open: boolean;
  onToggle: () => void;
  /** 접혀 있을 때 글자 — 예) 「고급 설정」 · 「최근 판단 보기」 */
  label: string;
  /** 펼쳤을 때 글자 */
  openLabel?: string;
  controls: string;
  className?: string;
}) {
  return (
    <Button size="sm" variant="secondary" onClick={onToggle} aria-expanded={open} aria-controls={controls} className={className}>
      {open ? openLabel : label}
      {open ? <ChevronUp {...ICON_SM} /> : <ChevronDown {...ICON_SM} />}
    </Button>
  );
}
