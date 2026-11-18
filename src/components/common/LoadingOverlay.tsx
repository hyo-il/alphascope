import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import Button from '../ui/Button';
import { BLOCKING_SHOW_MS, BLOCKING_SLOW_MS } from '../ui/tokens';

/**
 * 화면을 막는 로딩 — 앱에 **하나**(v2.72.2 · 공통 화면 부품 7-2). 화면 코드에서 덮개를 직접 만들지 않는다(`design:lint` 「직접 덮개」).
 *
 * - **언제**: 기다리는 동안 다른 조작을 하면 결과가 꼬이는 일만 — 저장 · 삭제 · 전체 다시 읽기 · 되돌릴 수 없는 일.
 *   나머지 기다림(읽기)은 막지 않고 표시만(`InlineSpinner` · 스켈레톤 · `LoadingSpinner`).
 * - **두 꼴**: `scope="area"`(기본 · 그 칸만 — `children` 을 감싼다) · `scope="app"`(앱 전체 — 앱 전체 데이터를 바꿀 때만 · 앱 루트를 막는다).
 *   창(`ui/Dialog`) 안 저장은 창에 `busy` 를 주면 창이 같은 덮개(`LoadingCover` — 감싸지 않고 판의 마지막 자식으로 붙어 형제를 막음)로 창 전체(제목 줄 × 까지)를 막는다.
 * - **때**: `busy` 가 켜진 순간 덮인 곳에 `inert`(Tab · Enter · 마우스가 닿지 않음 — 두 번 누름 방지) + 투명 덮개.
 *   로딩 표시(도는 원 · 글)는 `BLOCKING_SHOW_MS`(0.3초) 뒤 — 빨리 끝나면 깜빡이지 않는다.
 *   `BLOCKING_SLOW_MS`(10초)를 넘으면 「오래 걸리고 있어요」, 멈출 수 있는 일(부르는 쪽이 `onCancel` 을 줄 때)이면 [취소].
 * - **초점**: 덮인 곳에 초점이 있었으면 덮개(로딩 표시)로 옮긴다 · 풀리면 원래 요소가 쓸 수 있으면 그리로 돌려준다. Esc 로 풀리지 않는다.
 * - **끝**: `busy` 를 끄면 푼다. 실패 이유 한 줄은 부르는 쪽의 지금 오류 안내 그대로(이 부품은 글을 정하지 않는다).
 * - 모양은 AlphaScope 로딩 그대로(옅은 바탕 · 도는 원 · 글).
 */
type Phase = 'off' | 'blocking' | 'shown' | 'slow';

function useBlockPhase(busy: boolean): Phase {
  const [phase, setPhase] = useState<Phase>(busy ? 'blocking' : 'off');
  useLayoutEffect(() => {
    if (!busy) {
      setPhase('off');
      return;
    }
    setPhase('blocking');
    const show = window.setTimeout(() => setPhase('shown'), BLOCKING_SHOW_MS);
    const slow = window.setTimeout(() => setPhase('slow'), BLOCKING_SLOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(slow);
    };
  }, [busy]);
  return busy ? (phase === 'off' ? 'blocking' : phase) : 'off';
}

/** 덮개 — 처음엔 투명(막기만) · 0.3초 뒤 로딩 표시 · 10초 뒤 오래 걸림 안내 */
function Cover({ phase, label, onCancel, fixed, coverRef }: { phase: Phase; label: string; onCancel?: () => void; fixed: boolean; coverRef: RefObject<HTMLDivElement> }) {
  const shown = phase === 'shown' || phase === 'slow';
  return (
    <div
      ref={coverRef}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="blocking-loader"
      data-phase={phase}
      className={`${fixed ? 'fixed z-[105]' : 'absolute z-40'} inset-0 flex flex-col items-center justify-center gap-3 outline-none ${shown ? 'bg-bg-primary/70 backdrop-blur-[1px]' : ''}`}
    >
      {shown && (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
          <p className="text-sm text-text-secondary">{label}</p>
          {phase === 'slow' && (
            <div className="flex flex-col items-center gap-2" data-testid="blocking-slow">
              <p className="text-xs text-text-muted">오래 걸리고 있어요</p>
              {onCancel && (
                <Button size="sm" variant="ghost" onClick={onCancel}>
                  취소
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** 막는 동안 덮인 곳(`targets`)에 inert · 초점을 덮개로 · 풀리면 돌려줌 */
function useInert(busy: boolean, targets: () => HTMLElement[], coverRef: RefObject<HTMLDivElement>) {
  useLayoutEffect(() => {
    const els = busy ? targets() : [];
    if (!els.length) return;
    const before = document.activeElement as HTMLElement | null;
    const had = before != null && els.some((el) => el.contains(before));
    for (const el of els) el.inert = true;
    if (had) coverRef.current?.focus({ preventScroll: true });
    return () => {
      for (const el of els) el.inert = false;
      // 덮개에 있던 초점만 돌려준다(그 사이 사용자가 다른 곳으로 옮겼으면 그대로)
      const now = document.activeElement;
      const lost = now == null || now === document.body || now === coverRef.current;
      if (had && lost && before && before.isConnected && !(before as HTMLButtonElement).disabled) before.focus({ preventScroll: true });
    };
  }, [busy, targets, coverRef]);
}

export default function LoadingOverlay({
  busy,
  label = '처리 중…',
  onCancel,
  scope = 'area',
  className = '',
  children,
}: {
  /** 막는 중 — 누르는 순간(요청을 보내기 전에) 켠다 */
  busy: boolean;
  /** 0.3초 뒤 보이는 글 */
  label?: string;
  /** 멈출 수 있는 일이면 — 10초 뒤 [취소] 가 이 함수를 부른다 */
  onCancel?: () => void;
  /** `area` = 그 칸만(`children` 을 감쌈) · `app` = 앱 전체(앱 전체 데이터를 바꿀 때만) */
  scope?: 'area' | 'app';
  /** 그 칸 바깥 상자의 배치(`area`) — 덮개 자리라 `relative` 는 부품이 넣는다 */
  className?: string;
  children?: ReactNode;
}) {
  const phase = useBlockPhase(busy);
  const coverRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const appRoot = useRef(() => [document.getElementById('root')].filter((x): x is HTMLElement => x != null)).current;
  const areaRoot = useRef(() => (innerRef.current ? [innerRef.current] : [])).current;
  useInert(busy, scope === 'app' ? appRoot : areaRoot, coverRef);
  useEscGuard(busy, () => scope === 'app' || [innerRef.current, coverRef.current].some((el) => el?.contains(document.activeElement)));

  if (scope === 'app') {
    return phase === 'off' ? null : createPortal(<Cover phase={phase} label={label} onCancel={onCancel} fixed coverRef={coverRef} />, document.body);
  }
  return (
    <div className={`relative ${className}`} aria-busy={busy || undefined}>
      {/* display: contents — 감싸도 배치는 그대로(자식이 바깥 상자의 자식처럼 놓인다). inert 는 이 아래 전체 */}
      <div ref={innerRef} className="contents">
        {children}
      </div>
      {phase !== 'off' && <Cover phase={phase} label={label} onCancel={onCancel} fixed={false} coverRef={coverRef} />}
    </div>
  );
}

/** 덮개가 떠 있는 동안 Esc 가 아래(창 닫기 등)로 가지 않게 — 풀리지도 않는다 */
function useEscGuard(busy: boolean, inside: () => boolean) {
  const ref = useRef(inside);
  ref.current = inside;
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && ref.current()) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);
}

/**
 * 감싸지 않는 꼴 — 부모(`relative`) 안 마지막 자식으로 놓으면 **형제 요소 모두**를 막는다(창 판처럼 자식 순서 · 배치를 바꾸면 안 되는 곳 · `ui/Dialog`).
 * 때 · 표시 · 초점 · Esc 는 `LoadingOverlay` 와 같다.
 */
export function LoadingCover({ busy, label = '처리 중…', onCancel }: { busy: boolean; label?: string; onCancel?: () => void }) {
  const phase = useBlockPhase(busy);
  const coverRef = useRef<HTMLDivElement>(null);
  const siblings = useRef(() => {
    const cover = coverRef.current;
    const parent = cover?.parentElement;
    return parent ? [...parent.children].filter((c): c is HTMLElement => c !== cover && c instanceof HTMLElement) : [];
  }).current;
  useInert(busy, siblings, coverRef);
  useEscGuard(busy, () => coverRef.current?.parentElement?.contains(document.activeElement) ?? false);
  return phase === 'off' ? null : <Cover phase={phase} label={label} onCancel={onCancel} fixed={false} coverRef={coverRef} />;
}

/** 버튼·입력창 안에 넣는 작은 스피너 — 막지 않는 표시(7절) */
export function InlineSpinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent ${className}`}
    />
  );
}
