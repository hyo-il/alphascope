import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ICON_SM } from '../ui/icon';
import { CHANGELOG } from '../../data/changelog';

/**
 * 설정 > 업데이트 내역.
 *
 * 어떤 패치가 적용됐는지 앱 안에서 확인하는 자리다. 데이터는 `src/data/changelog.ts` 에 있고,
 * 푸시할 때 맨 앞에 항목을 추가한다 (CLAUDE.md 「푸시 시 문서 정리」).
 *
 * ⚠️ 항목을 **카드로 쌓지 않는다.** 버전이 늘수록 테두리가 반복돼 화면이 무거워지고,
 * 정작 읽어야 할 변경 내용보다 상자가 먼저 눈에 들어온다. 구분선으로만 나눈다.
 */
export default function Changelog() {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (version: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-1 text-base font-semibold">업데이트 내역</h2>
      <p className="mb-4 text-[13px] text-text-muted">
        최신 버전이 맨 위입니다. 줄을 누르면 바뀐 내용이 펼쳐집니다.
      </p>

      {/* 설정 화면의 다른 절과 같은 폭으로 둔다 — 긴 줄이 화면 끝까지 늘어나면 읽기 어렵다 */}
      <div className="max-w-2xl">
        {CHANGELOG.map((entry, index) => {
          const isOpen = open.has(entry.version);
          const id = `changelog-${entry.version}`;
          return (
            <section
              key={entry.version}
              /* 마지막 항목 아래에는 선을 긋지 않는다 (끝이 잘린 것처럼 보인다) */
              className={index === CHANGELOG.length - 1 ? '' : 'border-b border-border'}
            >
              {/* 줄 전체가 버튼 — 버전 · 제목 · 날짜. 처음엔 모두 접혀 있고 펼침은 기억하지 않는다 (v2.41.0) */}
              <button
                type="button"
                onClick={() => toggle(entry.version)}
                aria-expanded={isOpen}
                aria-controls={id}
                className="flex w-full items-center gap-2 py-3 text-left transition-colors hover:bg-bg-tertiary/40"
              >
                {isOpen ? <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" /> : <ChevronRight {...ICON_SM} className="shrink-0 text-text-muted" />}
                <span className="shrink-0 text-sm font-semibold text-text-primary">{entry.version}</span>
                {/* 가장 최신 항목에만 — 무엇이 새로 들어왔는지 한눈에 */}
                {index === 0 && (
                  <span className="shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] font-semibold text-text-secondary">NEW</span>
                )}
                <span className="min-w-0 flex-1 text-xs text-text-primary">{entry.title}</span>
                <time className="shrink-0 text-[13px] text-text-muted">{entry.date}</time>
              </button>

              {isOpen && (
                <div id={id} className="pb-4 pl-6">
                  <p className="text-[13px] leading-relaxed text-text-secondary">{entry.description}</p>
                  <ul className="mt-2 space-y-1">
                    {entry.changes.map((change) => (
                      <li key={change} className="flex gap-1.5 text-[13px] leading-relaxed text-text-secondary">
                        <span aria-hidden className="shrink-0 text-text-muted">
                          •
                        </span>
                        <span className="min-w-0">{change}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 앱에 넣은 글꼴의 라이선스 고지 (v2.35.0) — 라이선스 원문은 빌드에 넣지 않았다(패키지 @fontsource-variable/noto-sans-kr 의 LICENSE) */}
      <p className="mt-6 max-w-2xl border-t border-border pt-3 text-[13px] text-text-muted">
        글꼴: Noto Sans KR (SIL Open Font License 1.1)
      </p>
    </div>
  );
}
