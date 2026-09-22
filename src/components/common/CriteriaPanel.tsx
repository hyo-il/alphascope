import { useState } from 'react';
import type { CriteriaSpec } from '../../data/criteria';

/**
 * "이 화면은 무슨 기준으로 판정하는가" 를 펼쳐 보여 주는 패널.
 *
 * 점수와 등급만 보이고 기준이 어디에도 없으면, 사용자는 결과를 받아들이거나 무시하거나
 * 둘 중 하나밖에 못 한다 — 기준을 알아야 "내 성향과 다르다" 는 판단이 선다.
 * ⚠️ 여기서 판정하지 않는다. 표시 전용이고 내용은 `data/criteria.ts` 한 곳이다.
 */
export default function CriteriaPanel({
  spec,
  defaultOpen = false,
}: {
  spec: CriteriaSpec;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-md border border-border bg-bg-tertiary/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-xs font-medium text-text-secondary">📐 {spec.title}</span>
        <span className="ml-auto text-[11px] text-text-muted">{open ? '접기 ▾' : '펼치기 ▸'}</span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          <p className="text-[11px] text-text-secondary">{spec.grades}</p>

          <ul className="space-y-1">
            {spec.scoring.map((item) => (
              <li key={item.label} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="w-20 shrink-0 text-text-secondary">{item.label}</span>
                <span className="w-12 shrink-0 tabular-nums text-text-primary">{item.value}</span>
                <span className="min-w-0 flex-1 text-text-muted">{item.detail}</span>
              </li>
            ))}
          </ul>

          <ul className="space-y-1 border-t border-border/60 pt-2">
            {spec.gates.map((gate) => (
              <li key={gate} className="text-[11px] leading-relaxed text-text-muted">
                · {gate}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
