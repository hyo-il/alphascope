import { ChevronDown, ChevronUp } from 'lucide-react';
import Button from './Button';
import { ICON_SM } from './icon';

/**
 * 「자세히」 펼치기 버튼 (v2.39.0) — 숫자 설정을 접어 둔 곳은 **이 버튼 하나**로 연다(눈에 띄는 같은 모양).
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
  /** 접혀 있을 때 글자 — 예) 「자세히 — 숫자 직접 고치기」 */
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
