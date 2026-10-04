import { ICON_SM } from '../ui/icon';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * 탭 맨 위의 **접을 수 있는 쉬운 설명** (v2.35.0, 매수 판단 도우미).
 * 처음엔 펼쳐 두고, 접은 상태는 탭별로 이 기기에 기억한다(`alphascope.swingHelp.{id}` — 기기 설정이라 localStorage).
 */
export default function HelpBox({
  id,
  title,
  children,
  storageKey,
}: {
  id: string;
  title: string;
  children: ReactNode;
  /** 다른 화면이 쓸 때의 기억 키 (v2.37.0 백테스트 = `alphascope.backtestHelp`). 없으면 `alphascope.swingHelp.{id}` */
  storageKey?: string;
}) {
  const key = storageKey ?? `alphascope.swingHelp.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key, next ? 'open' : 'closed');
    } catch {
      /* 저장하지 못해도 화면은 동작한다 */
    }
  };
  return (
    <section className="rounded-xl bg-bg-secondary/60">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-text-secondary hover:text-text-primary"
      >
        <span className="w-3 shrink-0">{open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}</span>
        {title}
      </button>
      {open && <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">{children}</div>}
    </section>
  );
}

/** 「지금 살 만한가」·「목표 수익 가능성」 공통 맨 아래 한 줄 — 지우지 않는다 */
export function NotProvenLine() {
  return (
    <p className="text-[13px] text-text-muted">
      둘 다 '돈을 번다' 고 확인된 기능은 아닙니다. 성적은 「실험실 &gt; 진단 리포트」 에서 봅니다.
    </p>
  );
}
