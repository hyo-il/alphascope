import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, RefreshCw } from 'lucide-react';
import { Badge, Button, ICON, Input, PageHeader, Panel, SectionTitle } from '../ui';
import { LIST_TABLE_ROW, PANEL_PAD, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { SkeletonTable, SkeletonText } from '../common/SkeletonLoader';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { formatDateTime } from '../../utils/dateFormat';
import type { AssetHolding, AssetSection, AssetSheetData, AssetSheetFailure, AssetStatus } from '../../types/asset';

/**
 * 계좌 > 자산 관리 (v2.61.0 · 1단계) — 자산 비밀번호로 잠그고, 구글 시트에서 읽은 값을 확인하는 화면.
 *
 * - 잠김: 비밀번호 칸 + 「잠금 풀기」. 틀림 · 막힘(남은 N분) 문구. 비밀번호가 없으면 서버 명령 안내(화면에서 정하는 길은 없다).
 * - 풀림(1단계 임시 화면 — 3단계에서 차트 화면으로 바뀐다): 「시트에서 읽은 값」 확인 표 · 「읽은 시각」 · 「다시 읽기」 · 「잠그기」.
 * - 풀린 상태는 서버가 로그인 세션마다 메모리에 둔다(`server/asset/lock.ts`) — 화면은 상태를 묻기만 한다.
 * - 시트는 이 화면을 열 때 · 「다시 읽기」 때만 읽는다(서버 30초 캐시 · 반복 읽기 없음).
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다.
 */

/** 화면 상태 — 받기 전(null)과 실패를 값으로 나눈다(받기 전에 「잠김」 을 그리지 않는다) */
type StatusState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; status: AssetStatus };
type SheetState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: AssetSheetData };

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

  const unlocked = state.kind === 'ok' && state.status.unlocked;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="자산 관리"
        right={
          unlocked ? (
            <Button size="md" icon={Lock} onClick={() => void lock()}>
              잠그기
            </Button>
          ) : undefined
        }
      />
      <div className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] ${PANEL_PAD}`}>
        {state.kind === 'loading' && <SkeletonText lines={3} />}
        {state.kind === 'error' && <ErrorLine message={state.message} onRetry={() => void loadStatus()} />}
        {state.kind === 'ok' && !state.status.passwordSet && <NoPassword />}
        {state.kind === 'ok' && state.status.passwordSet && !state.status.unlocked && (
          <UnlockForm sheetConfigured={state.status.sheetConfigured} onUnlocked={() => void loadStatus()} />
        )}
        {state.kind === 'ok' && state.status.unlocked && <SheetValues onLocked={() => void loadStatus()} />}
      </div>
    </div>
  );
}

/** 실패 한 줄 + [다시 시도] — 빈 화면으로 바꾸지 않는다 */
function ErrorLine({ message, onRetry, busy = false }: { message: string; onRetry?: () => void; busy?: boolean }) {
  return (
    <p role="alert" className="flex items-center gap-3 rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger">
      <span className="min-w-0 keep-all">{message}</span>
      {onRetry && (
        <Button size="sm" busy={busy} onClick={onRetry} className="ml-auto">
          다시 시도
        </Button>
      )}
    </p>
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

function UnlockForm({ sheetConfigured, onUnlocked }: { sheetConfigured: boolean; onUnlocked: () => void }) {
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

function SheetValues({ onLocked }: { onLocked: () => void }) {
  const [sheet, setSheet] = useState<SheetState>({ kind: 'loading' });
  /** 다시 읽는 중 — 내용은 그대로 두고 버튼만 돈다 */
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);

  const load = useCallback(
    async (again: boolean) => {
      if (again) setReloading(true);
      else setSheet({ kind: 'loading' });
      setReloadError(null);
      try {
        const res = await fetch('/api/asset/sheet');
        const body = await readJson<AssetSheetData & Partial<AssetSheetFailure>>(res);
        // 서버가 다시 켜지는 등으로 잠겼다 — 잠금 화면으로
        if (res.status === 403 && body.code === 'asset-locked') return onLocked();
        if (!res.ok) throw new Error(body.error ?? `시트를 읽지 못했습니다 (${res.status})`);
        setSheet({ kind: 'ok', data: body });
      } catch (e) {
        const message = e instanceof Error ? e.message : '시트를 읽지 못했습니다.';
        // 이미 그린 값이 있으면 지우지 않고 실패 줄만 — 처음이면 실패 + 다시 시도
        setSheet((prev) => (again && prev.kind === 'ok' ? prev : { kind: 'error', message }));
        if (again) setReloadError(message);
      } finally {
        setReloading(false);
      }
    },
    [onLocked],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="space-y-4">
      <SectionTitle
        aside={sheet.kind === 'ok' ? `읽은 시각 ${formatDateTime(sheet.data.readAt)}` : undefined}
        info="이 화면을 열 때와 「다시 읽기」 를 누를 때만 시트를 읽습니다(30초 안에 다시 누르면 같은 결과). 시트에 쓰지 않습니다."
        right={
          // 처음 읽기가 실패하면 아래 오류 줄의 [다시 시도] 하나만 둔다(같은 일을 하는 버튼 두 개가 되지 않게)
          sheet.kind !== 'error' && (
          <Button size="sm" icon={RefreshCw} busy={reloading} disabled={sheet.kind === 'loading'} onClick={() => void load(sheet.kind === 'ok')}>
            다시 읽기
          </Button>
          )
        }
      >
        시트에서 읽은 값
      </SectionTitle>

      {/* 다시 읽기 실패 — 값은 그대로 두고 실패 줄만(다시 하려면 위 [다시 읽기]) */}
      {reloadError && <ErrorLine message={reloadError} />}
      {sheet.kind === 'loading' && <SkeletonTable rows={6} columns={5} />}
      {sheet.kind === 'error' && <ErrorLine message={sheet.message} onRetry={() => void load(false)} />}
      {sheet.kind === 'ok' && (
        <>
          <Summary data={sheet.data} />
          <HoldingsTable sections={sheet.data.sections} />
        </>
      )}
    </div>
  );
}

/** 값 한 칸 — 이름(13px 회색) 위 · 숫자 아래 */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="shrink-0">
      <div className="text-caption text-text-muted">{label}</div>
      <div className="whitespace-nowrap text-sm font-semibold text-text-primary tabular-nums">{value}</div>
    </div>
  );
}

/** 백분율 — 정수면 소수 없이, 아니면 한 자리 */
const pct = (v: number | null) => (v == null ? '—' : formatNumber(v, Number.isInteger(v) ? 0 : 1, '%'));

/** 현금 · 연금 · 월급 · 환율 한 줄, 목표 비율 한 줄 — 칸은 내용 폭(금액이 길어져도 겹치지 않고 다음 줄로) */
function Summary({ data }: { data: AssetSheetData }) {
  const t = data.targetRatio;
  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Field label="현금 합계" value={formatPrice(data.cashTotal, 'KRW')} />
        <Field label="퇴직 연금" value={formatPrice(data.retirement, 'KRW')} />
        <Field label="월급" value={formatPrice(data.salary, 'KRW')} />
        <Field label="구매 평균 환율(원/$)" value={data.avgFxRate == null ? '—' : `₩${formatNumber(data.avgFxRate, 2)}`} />
      </div>
      {/* 목표 비율 두 묶음 — 자산 배분(합 100%)과 투자 안의 코어 · 위성(합 100%)을 나눠 보인다(한 줄이면 합이 200% 로 읽힌다) */}
      <div className="flex flex-wrap gap-x-12 gap-y-3">
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 자산 배분</div>
          <div className="flex gap-x-8">
            <Field label="현금" value={pct(t.cash)} />
            <Field label="금" value={pct(t.gold)} />
            <Field label="채권" value={pct(t.bond)} />
            <Field label="투자" value={pct(t.invest)} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-caption text-text-secondary">목표 비율 — 투자 안의 코어 · 위성</div>
          <div className="flex gap-x-8">
            <Field label="코어" value={pct(t.core)} />
            <Field label="위성" value={pct(t.satellite)} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

/** 칸 안 소수 자릿수 — 같은 열은 같은 자릿수(가장 긴 것 · 최대 4자리) */
function decimalsOf(values: (number | null)[]): number {
  let d = 0;
  for (const v of values) {
    if (v == null || Number.isInteger(v)) continue;
    const frac = String(v).split('.')[1] ?? '';
    d = Math.max(d, Math.min(4, frac.length));
  }
  return d;
}

/** 평균 매입가 — 원래 통화 그대로. 달러는 시트 값(소수 4자리까지)을 줄이지 않는다 */
function avgText(h: AssetHolding, usdDigits: number): string {
  if (h.avgPrice == null) return '—';
  if (h.currency === 'KRW') return formatPrice(h.avgPrice, 'KRW');
  return `$${formatNumber(h.avgPrice, Math.max(2, usdDigits))}`;
}

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right`;
const TEXT = `${TABLE_NUM_COL} ${TABLE_NUM_GAP}`;

/**
 * 계좌 구간별 보유 — **표 하나**에 구간 머리 줄을 넣는다(구간마다 표를 따로 두면 열 위치가 구간마다 달라진다).
 * 합계 표(계좌를 합친 표)는 배지로 따로 표시한다.
 */
function HoldingsTable({ sections }: { sections: AssetSection[] }) {
  const all = sections.flatMap((s) => s.holdings);
  const qtyDigits = decimalsOf(all.map((h) => h.quantity));
  const usdDigits = decimalsOf(all.filter((h) => h.currency === 'USD').map((h) => h.avgPrice));
  return (
    <Panel pad="none" className="pb-1">
      {/* 평균 매입가는 줄마다 통화가 다르다(원화는 소수 없음 · 달러는 시트 원래 값 소수 4자리까지) — design:check 의 「같은 열 소수 자릿수」 는 이 표에서 재지 않는다(`data-rows-differ`). 수량 열은 위 `qtyDigits` 로 맞춘다 */}
      <table className="w-full text-left text-xs" data-rows-differ>
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className={`${TABLE_NAME_COL} py-2 pl-4 font-normal`}>종목</th>
            <th className={`${TEXT} py-2 font-normal`}>코드</th>
            <th className={`${TEXT} py-2 font-normal`}>시장</th>
            <th className={`${NUM} py-2 font-normal`}>수량</th>
            <th className={`${NUM} py-2 pr-4 font-normal`}>평균 매입가</th>
          </tr>
        </thead>
        {sections.map((s, i) => (
          <tbody key={`${i}-${s.name}`}>
            <tr className={LIST_TABLE_ROW}>
              <th colSpan={5} scope="colgroup" className="px-4 pt-3 pb-1 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{s.name || '이름 없는 구간'}</span>
                  {s.combined && <Badge title="계좌를 합친 표입니다 — 위 계좌 구간과 같은 종목이 겹칩니다.">합계 표</Badge>}
                  <span className="text-caption text-text-muted">{s.holdings.length}종목</span>
                </span>
              </th>
            </tr>
            {s.holdings.length === 0 && (
              <tr className={LIST_TABLE_ROW}>
                <td colSpan={5} className="px-4 text-text-muted">
                  이 구간에 보유 종목이 없습니다.
                </td>
              </tr>
            )}
            {s.holdings.map((h) => (
              <tr key={h.row} className={`border-t border-border/30 ${LIST_TABLE_ROW}`}>
                <td className="max-w-0 py-1.5 pl-4">
                  <span className="block truncate text-text-primary" title={h.name}>
                    {h.name}
                  </span>
                </td>
                <td className={`${TEXT} py-1.5 text-text-secondary`} title={h.code ?? '「티커」 탭과 이을 수식이 없습니다'}>
                  {h.symbol ?? '—'}
                  {h.exchange && <span className="ml-1 text-caption text-text-muted">{h.exchange}</span>}
                </td>
                <td className={`${TEXT} py-1.5 text-text-secondary`}>{h.market === 'US' ? '미국' : h.market === 'KR' ? '국내' : '—'}</td>
                <td className={`${NUM} py-1.5 tabular-nums text-text-primary`}>{h.quantity == null ? '—' : formatNumber(h.quantity, qtyDigits)}</td>
                <td className={`${NUM} py-1.5 pr-4 tabular-nums text-text-primary`}>{avgText(h, usdDigits)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </Panel>
  );
}
