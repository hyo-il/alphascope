import { ICON_SM } from '../ui/icon';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

/**
 * 화면 맨 위의 **접을 수 있는 쉬운 설명** — 앱에 한 벌 (v2.35.0 매수 판단 도우미 → v2.41.0 공용: 지금 살 만한가 · 목표 수익 가능성 · 백테스트 · 진단 리포트).
 * ⚠️ **처음엔 닫혀 있다**(v2.41.0 사용자 결정). 제목이 질문 형태라 열어 볼 수 있다. 열고 닫은 것은 이 기기에 기억한다
 * (`storageKey` 또는 `alphascope.swingHelp.{id}` — 기기 설정이라 localStorage). 한 번도 누르지 않았으면 닫힘.
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
  /** 기억 키 (백테스트 = `alphascope.backtestHelp` · 진단 = `alphascope.diagnoseHelp`). 없으면 `alphascope.swingHelp.{id}` */
  storageKey?: string;
}) {
  const key = storageKey ?? `alphascope.swingHelp.${id}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === 'open';
    } catch {
      return false;
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
      {open && <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-caption leading-relaxed text-text-secondary">{children}</div>}
    </section>
  );
}
