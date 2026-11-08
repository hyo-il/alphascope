import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { Button, ICON, Input, PageHeader, Panel } from '../ui';
import { PANEL_PAD } from '../ui/tokens';
import { SkeletonText } from '../common/SkeletonLoader';
import type { AssetStatus } from '../../types/asset';
import AssetDashboard, { ErrorLine } from './AssetDashboard';

/**
 * 계좌 > 자산 관리 (v2.61.0 잠금 · v2.62.0 총 자산 화면) — 자산 비밀번호로 잠근다.
 *
 * - 잠김: 비밀번호 칸 + 「잠금 풀기」. 틀림 · 막힘(남은 N분) 문구. 비밀번호가 없으면 서버 명령 안내(화면에서 정하는 길은 없다).
 * - 풀림: `AssetDashboard`(탭 「총 자산」 = 카드 · 선 차트 · 원형 차트 · 분류별 표 / 「자산 현황」 = 요약 · 계좌 카드 · 「설정」 창).
 * - 풀린 상태는 서버가 로그인 세션마다 메모리에 둔다(`server/asset/lock.ts`) — 화면은 상태를 묻기만 한다.
 * - 잠금 시간(v2.65.4): 대시보드의 화면 타이머가 지나면(`onIdle`) 서버를 기다리지 않고 잠금 화면 · 서버가 쓰지 않아 잠갔으면(`idleLocked`) 같은 잠금 화면.
 *   잠금 화면 위에 한 줄 「○분 동안 쓰지 않아 잠갔어요」(시간은 설정 값). 다른 메뉴에 갔다가 와도 서버 시각 기준(`status.remainingMs`).
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다.
 */

/** 화면 상태 — 받기 전(null)과 실패를 값으로 나눈다(받기 전에 「잠김」 을 그리지 않는다) */
type StatusState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; status: AssetStatus };

async function readJson<T>(res: Response): Promise<T & { error?: string; code?: string; minutes?: number }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; minutes?: number };
}

export default function AssetView() {
  const [state, setState] = useState<StatusState>({ kind: 'loading' });

  const loadStatus = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/asset/status');
      const body = await readJson<AssetStatus>(res);
      if (!res.ok) throw new Error(body.error ?? `요청 실패 (${res.status})`);
      setState({ kind: 'ok', status: body });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : '자산 상태를 받지 못했습니다.' });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const lock = async () => {
    await fetch('/api/asset/lock', { method: 'POST' }).catch(() => undefined);
    void loadStatus();
  };

  /** 화면 타이머가 지남 — 서버 응답을 기다리지 않고 잠금 화면(안내 한 줄) */
  const idle = useCallback((minutes: number) => {
    setState((s) => (s.kind === 'ok' && s.status.unlocked ? { kind: 'ok', status: { ...s.status, unlocked: false, lockMinutes: minutes, remainingMs: null, idleLocked: true } } : s));
  }, []);
  const locked = useCallback(() => void loadStatus(), [loadStatus]);

  // 풀림 — 머리 줄(연금 포함 · 읽은 시각 · 다시 읽기 · 잠그기)까지 대시보드가 그린다
  if (state.kind === 'ok' && state.status.unlocked) {
    return <AssetDashboard onLock={() => void lock()} onLocked={locked} onIdle={idle} lockMinutes={state.status.lockMinutes} remainingMs={state.status.remainingMs} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="자산 관리" />
      <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] ${PANEL_PAD}`}>
        {state.kind === 'loading' && <SkeletonText lines={3} />}
        {state.kind === 'error' && <ErrorLine message={state.message} onRetry={() => void loadStatus()} />}
        {state.kind === 'ok' && !state.status.passwordSet && <NoPassword />}
        {state.kind === 'ok' && state.status.passwordSet && !state.status.unlocked && (
          <UnlockForm
            sheetConfigured={state.status.sheetConfigured}
            idleNote={state.status.idleLocked && state.status.lockMinutes > 0 ? `${state.status.lockMinutes}분 동안 쓰지 않아 잠갔어요` : null}
            onUnlocked={() => void loadStatus()}
          />
        )}
      </div>
    </div>
  );
}

function NoPassword() {
  return (
    <Panel className="max-w-xl">
      <p className="text-xs leading-relaxed text-text-secondary keep-all">
        자산 비밀번호가 아직 없습니다. 서버에서 <code className="rounded bg-bg-tertiary px-1">npm run asset:set-password</code> 로 정해 주세요.
      </p>
    </Panel>
  );
}

function UnlockForm({ sheetConfigured, idleNote, onUnlocked }: { sheetConfigured: boolean; idleNote: string | null; onUnlocked: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/asset/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      const body = await readJson<{ ok?: boolean }>(res);
      if (res.ok) {
        setPassword('');
        onUnlocked();
        return;
      }
      if (body.code === 'asset-blocked') setError(`여러 번 틀려 잠시 막혔습니다 — ${body.minutes ?? 15}분 뒤 다시 시도하세요.`);
      else if (body.code === 'asset-wrong') setError('비밀번호가 맞지 않습니다.');
      else setError(body.error ?? `잠금을 풀지 못했습니다 (${res.status})`);
    } catch {
      setError('서버에 연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-sm">
      {idleNote && (
        <p role="status" className="mb-2 text-xs text-text-secondary keep-all" data-asset-idle-note>
          {idleNote}
        </p>
      )}
      <Panel>
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Lock {...ICON} className="text-text-muted" />
          잠겨 있습니다
        </div>
        <label htmlFor="as-asset-password" className="mb-1.5 block text-xs text-text-secondary">
          자산 비밀번호
        </label>
        <Input
          id="as-asset-password"
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          className="w-full"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs leading-relaxed text-danger keep-all">
            {error}
          </p>
        )}
        <Button busy={busy} variant="primary" size="md" type="submit" icon={LockOpen} disabled={busy || !password} className="mt-4 w-full">
          잠금 풀기
        </Button>
        {!sheetConfigured && <p className="mt-3 text-caption leading-relaxed text-text-muted keep-all">
            시트 연결 정보가 없습니다(<code className="rounded bg-bg-tertiary px-1">.env</code>).
          </p>}
      </Panel>
    </form>
  );
}
