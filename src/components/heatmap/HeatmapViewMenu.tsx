import { useEffect, useRef, useState } from 'react';

/**
 * 종목 지도 [보기 ▾] (v2.27.0) — 상위 N(시장 보기만)과 분야(섹터) 체크.
 *
 * - 분야를 끄면 지도에서 빠진다(다시 배치). 섹터 강세 순위에서는 지우지 않고 흐리게만 둔다 — 그 처리는 부모가 한다.
 * - 마지막 하나는 끌 수 없다("분야를 하나 이상 골라 주세요"). [전체 해제] 도 가장 큰 분야 하나는 남긴다.
 * - 바깥 클릭·Esc 로 닫는다(`IndicatorDropdown` 과 같은 방식).
 */

export const TOP_CHOICES = [30, 50, 100] as const;
export type TopChoice = (typeof TOP_CHOICES)[number];

const NEED_ONE = '분야를 하나 이상 골라 주세요';

interface Props {
  /** null 이면 상위 N 고르기를 감춘다(관심 종목 보기) */
  top: TopChoice | null;
  onTopChange: (top: TopChoice) => void;
  /** 지금 데이터의 분야와 종목 수 — 종목 수 많은 순 */
  sectors: { name: string; count: number }[];
  off: Set<string>;
  onOffChange: (off: Set<string>) => void;
  /** 관심 종목 탭의 칸 크기 (v2.29.0) — null 이면 감춘다(시장 상위 탭) */
  watchSize?: 'cap' | 'sqrt' | null;
  onWatchSizeChange?: (size: 'cap' | 'sqrt') => void;
}

export default function HeatmapViewMenu({ top, onTopChange, sectors, off, onOffChange, watchSize = null, onWatchSizeChange }: Props) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setNotice(null);
  }, [open]);

  const onCount = sectors.filter((s) => !off.has(s.name)).length;
  const sectorText = onCount >= sectors.length ? '전체 분야' : `분야 ${onCount}개`;
  const label =
    top !== null
      ? `보기: 상위 ${top} · ${sectorText}`
      : `보기: ${sectorText}${watchSize === 'sqrt' ? ' · 크기 차이 줄임' : ''}`;

  const toggle = (name: string) => {
    const next = new Set(off);
    if (next.has(name)) next.delete(name);
    else {
      if (onCount <= 1) {
        setNotice(NEED_ONE);
        return;
      }
      next.add(name);
    }
    setNotice(null);
    onOffChange(next);
  };

  const selectAll = () => {
    // 지금 목록에 없는 분야의 기억은 남긴다(다른 시장·N 에서 끈 분야)
    const next = new Set(off);
    for (const s of sectors) next.delete(s.name);
    setNotice(null);
    onOffChange(next);
  };

  const clearAll = () => {
    if (!sectors.length) return;
    const keep = sectors[0].name;
    const next = new Set(off);
    for (const s of sectors) if (s.name !== keep) next.add(s.name);
    next.delete(keep);
    setNotice(`${NEED_ONE} — 「${keep}」 하나는 남겼습니다.`);
    onOffChange(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`rounded border px-2.5 py-0.5 text-[14px] transition-colors ${
          open || onCount < sectors.length || (top !== null && top !== 50) || watchSize === 'sqrt'
            ? 'border-accent/60 text-text-primary'
            : 'border-border text-text-secondary'
        }`}
      >
        {label} ▾
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="지도 보기 설정"
          className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-border bg-bg-secondary p-2.5 text-[14px] shadow-xl"
        >
          {top !== null && (
            <fieldset className="mb-2.5">
              <legend className="mb-1 font-medium text-text-primary">종목 수 (시총 순)</legend>
              <div className="flex gap-1">
                {TOP_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onTopChange(n)}
                    aria-pressed={top === n}
                    className={`flex-1 rounded border px-2 py-0.5 transition-colors ${
                      top === n ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
                    }`}
                  >
                    상위 {n}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          {watchSize !== null && (
            <fieldset className="mb-2.5">
              <legend className="mb-1 font-medium text-text-primary">칸 크기</legend>
              <div className="flex gap-1">
                {(
                  [
                    ['cap', '시가총액 그대로'],
                    ['sqrt', '크기 차이 줄이기'],
                  ] as const
                ).map(([id, text]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onWatchSizeChange?.(id)}
                    aria-pressed={watchSize === id}
                    className={`flex-1 rounded border px-2 py-0.5 transition-colors ${
                      watchSize === id ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
                    }`}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-text-muted">크기 차이 줄이기 = 시가총액의 제곱근. 섹터 순위 계산은 실제 시총 그대로입니다.</p>
            </fieldset>
          )}
          <div className="mb-1 flex items-center gap-1">
            <span className="mr-auto font-medium text-text-primary">분야</span>
            <button type="button" onClick={selectAll} className="rounded px-1.5 py-0.5 text-accent hover:bg-bg-tertiary">
              전체 선택
            </button>
            <button type="button" onClick={clearAll} className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-bg-tertiary">
              전체 해제
            </button>
          </div>
          {sectors.length === 0 ? (
            <p className="text-text-muted">지도를 불러온 뒤 고를 수 있습니다.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto [scrollbar-gutter:stable]">
              {sectors.map((s) => (
                <li key={s.name}>
                  <label className="inline-flex w-fit items-center gap-1.5 py-0.5">
                    <input type="checkbox" checked={!off.has(s.name)} onChange={() => toggle(s.name)} />
                    <span className={off.has(s.name) ? 'text-text-muted' : 'text-text-primary'}>{s.name}</span>
                    <span className="tabular-nums text-text-muted">{s.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {notice && (
            <p role="alert" className="mt-1.5 text-warning">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
