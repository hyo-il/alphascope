import type { ReactNode } from 'react';

/**
 * 폰 「위 이름 · 아래 값」 줄(v2.84.0 · 테마 9-1 R10) — **쌓는 모양 한 곳**.
 * 이름 · 값 두 칸을 나란히 두기에 폭이 모자란 줄(폰)에서 이름(13 secondary)을 위 한 줄에, 값(14)을 아래에 둔다 — 글이 한 단어 폭으로 접히거나 겹치지 않게.
 * 값이 여럿이면 `StackValue`(왼쪽 작은 이름 | 오른쪽 값) 줄을 여러 개 넣는다. 쓰는 화면이 폰일 때만 고른다(1280 · 패드는 그 화면의 표 · 줄 그대로).
 */
export default function StackRow({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1 border-b border-border/30 py-2 text-xs tabular-nums" data-stack-row>
      <p className="text-caption text-text-secondary" data-stack-head>
        {head}
      </p>
      {children}
    </div>
  );
}

/** 쌓은 줄 안 값 한 줄 — 왼쪽 작은 이름(13 secondary) | 오른쪽 값(넘치면 그 칸 안에서 줄바꿈) */
export function StackValue({ name, children, muted = false }: { name: ReactNode; children: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3" data-stack-value>
      <span className="shrink-0 text-caption text-text-secondary">{name}</span>
      <span className={`min-w-0 text-right ${muted ? 'text-text-secondary' : ''}`.trim()}>{children}</span>
    </div>
  );
}
