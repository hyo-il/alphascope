import { useEffect, useState } from 'react';
import { subscribeSyncChoice, type SyncChoice } from '../../hooks/useWatchlist';

/**
 * 첫 실행에서 **서버 목록과 이 브라우저 목록이 둘 다 있고 다를 때** 무엇을 쓸지 묻는다.
 *
 * ⚠️ 자동으로 한쪽을 버리지 않는다 — 버리면 담아 둔 종목이 조용히 사라진다.
 * 버리는 선택은 사람이 누른 경우만이다. 그래서 일반 확인창(예/아니오)이 아니라
 * **세 갈래** 전용 팝업이다.
 *
 * 브라우저마다 한 번만 뜬다 (`alphascope.watchlistSynced`).
 */
export default function WatchlistSyncModal() {
  const [choice, setChoice] = useState<SyncChoice | null>(null);

  useEffect(() => subscribeSyncChoice(setChoice), []);

  if (!choice) return null;

  const count = (side: SyncChoice['local']) => ({
    folders: side.folders.filter((f) => f.id !== 'default').length,
    symbols: side.folders.reduce((n, f) => n + f.symbols.length, 0),
    recent: side.recent.length,
  });
  const local = count(choice.local);
  const server = count(choice.server);

  const Side = ({ title, c }: { title: string; c: ReturnType<typeof count> }) => (
    <div className="flex-1 rounded-lg border border-border bg-bg-tertiary/40 p-3">
      <p className="text-xs font-medium text-text-primary">{title}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-text-secondary">
        관심 종목 <b className="tabular-nums text-text-primary">{c.symbols}</b>개 · 그룹{' '}
        <b className="tabular-nums text-text-primary">{c.folders}</b>개
        <br />
        최근 조회 <b className="tabular-nums text-text-primary">{c.recent}</b>개
      </p>
    </div>
  );

  const Action = ({
    label,
    hint,
    onClick,
    primary,
  }: {
    label: string;
    hint: string;
    onClick: () => void;
    primary?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        primary
          ? 'border-accent bg-accent/10 hover:bg-accent/20'
          : 'border-border hover:border-accent hover:bg-bg-tertiary'
      }`}
    >
      <span className={`block text-xs font-medium ${primary ? 'text-accent' : 'text-text-primary'}`}>
        {label}
      </span>
      <span className="mt-0.5 block text-[11px] text-text-muted">{hint}</span>
    </button>
  );

  return (
    // 배경을 눌러 닫지 않는다 — 고르지 않고 넘어가면 어느 목록을 쓸지 정해지지 않는다.
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-[min(520px,90vw)] rounded-xl border border-border bg-bg-secondary p-5 shadow-2xl">
        <h2 className="text-base font-semibold text-text-primary">관심 목록이 서로 다릅니다</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
          서버에 저장된 목록과 이 브라우저의 목록이 다릅니다. 어느 쪽을 쓸지 골라 주세요.
          <br />
          <span className="text-text-muted">이 확인은 브라우저마다 한 번만 묻습니다.</span>
        </p>

        <div className="mt-3 flex gap-2">
          <Side title="서버 목록" c={server} />
          <Side title="이 브라우저 목록" c={local} />
        </div>

        <div className="mt-4 space-y-2">
          <Action
            primary
            label="합치기 (권장)"
            hint="양쪽 종목을 모두 남깁니다. 같은 그룹은 하나로 합칩니다."
            onClick={() => choice.resolve('merge')}
          />
          <Action
            label="서버 목록 쓰기"
            hint="이 브라우저에만 있던 종목은 사라집니다."
            onClick={() => choice.resolve('server')}
          />
          <Action
            label="이 브라우저 목록으로 덮어쓰기"
            hint="서버에만 있던 종목은 사라집니다."
            onClick={() => choice.resolve('local')}
          />
        </div>
      </div>
    </div>
  );
}
