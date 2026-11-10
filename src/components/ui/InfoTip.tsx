import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { ICON_SM } from './icon';
import { setInfoTipContent, tipController } from './Tooltip';

/**
 * 정보 아이콘 [ⓘ] + 설명 (디자인 규칙 6) — 제목 줄·바닥 줄에 늘 떠 있던 긴 설명(기준 시각·새로고침 주기·조작법)을 여기로 옮긴다.
 *
 * - 여닫는 때 · 「하나만」 · 상자 모양 · 자리는 **앱 툴팁(`ui/Tooltip`)과 같은 것**을 쓴다(v2.69.0) — 이 파일은 단추와 내용만 둔다.
 *   마우스를 올리고 0.3초 뒤 · 키보드 초점(Tab)이면 바로 열리고, 상자 위로 옮겨도 열린 채(긴 설명을 읽게). `aria-describedby` 로 내용을 읽힌다.
 * - ⚠️ **"지우지 않는다" 고정 안내 문구는 여기에 넣지 않는다**(화면에 글자로 남긴다 — docs/rules/design.md 「디자인 규칙」).
 * - `trigger` 를 주면 아이콘 대신 그 글자가 단추가 된다(점선 밑줄 — 좁은 칸에서 덧붙임을 숨기고 글자에 툴팁을 달 때. 지금: 거래정지 사유 칸).
 * - `open` 을 주면 밖에서도 연다(true) — 흐린(disabled) 입력칸은 마우스 · 초점을 받지 않아, 그 칸 위에 마우스가 오면 옆 아이콘의 툴팁을 연다(지금: 거래정지 정규장 밖 보기).
 */
export default function InfoTip({ children, label = '설명', trigger, open }: { children: ReactNode; label?: string; trigger?: ReactNode; open?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (ref.current) setInfoTipContent(ref.current, children);
  }, [children]);
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      setInfoTipContent(el, null);
      tipController.hide(el);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open === true) tipController.show(el);
    else if (open === false) tipController.hide(el);
  }, [open]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-infotip
      className={
        trigger
          ? 'cursor-help rounded text-left underline decoration-text-muted decoration-dotted underline-offset-4 transition-colors hover:text-text-primary hover:decoration-text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent'
          : 'inline-flex shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary focus-visible:text-text-primary'
      }
    >
      {trigger ?? <Info {...ICON_SM} />}
    </button>
  );
}
