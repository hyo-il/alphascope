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
  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="mb-1 text-base font-semibold">📋 업데이트 내역</h2>
      <p className="mb-4 text-[11px] text-text-muted">
        최신 버전이 맨 위입니다. 사용하면서 달라지는 것만 적었습니다.
      </p>

      {/* 설정 화면의 다른 절과 같은 폭으로 둔다 — 긴 줄이 화면 끝까지 늘어나면 읽기 어렵다 */}
      <div className="max-w-2xl">
        {CHANGELOG.map((entry, index) => (
          <section
            key={entry.version}
            /* 마지막 항목 아래에는 선을 긋지 않는다 (끝이 잘린 것처럼 보인다) */
            className={index === CHANGELOG.length - 1 ? 'py-4' : 'border-b border-border py-4'}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-text-primary">{entry.version}</span>
              {/* 가장 최신 항목에만 — 무엇이 새로 들어왔는지 한눈에 */}
              {index === 0 && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                  NEW
                </span>
              )}
              <time className="ml-auto text-[11px] text-text-muted">{entry.date}</time>
            </div>

            <p className="mt-1.5 text-xs font-medium text-text-primary">{entry.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
              {entry.description}
            </p>

            <ul className="mt-2 space-y-1">
              {entry.changes.map((change) => (
                <li
                  key={change}
                  className="flex gap-1.5 text-[11px] leading-relaxed text-text-secondary"
                >
                  <span aria-hidden className="shrink-0 text-text-muted">
                    •
                  </span>
                  <span className="min-w-0">{change}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
