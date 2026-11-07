import { Fragment, useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Lock, RefreshCw, Settings } from 'lucide-react';
import { Button, ICON_SM, PageHeader, Panel, Segmented, SectionTitle } from '../ui';
import { LIST_TABLE_ROW, PANEL_PAD, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { Skeleton, SkeletonTable } from '../common/SkeletonLoader';
import { usePolling } from '../../hooks/usePolling';
import { changeColor, formatNumber, formatPrice, formatSigned, formatSignedMoney } from '../../utils/formatters';
import { formatDateTime } from '../../utils/dateFormat';
import type { AssetClass, AssetHistoryPoint, AssetHistoryRange, AssetSettings, AssetSheetData, AssetSheetFailure, AssetSummary, AssetTargetRatio } from '../../types/asset';
import AssetDonut from './AssetDonut';
import { groupDot } from './assetColors';
import AssetHistoryChart from './AssetHistoryChart';
import AssetSheetValues from './AssetSheetValues';
import AssetSettingsDialog from './AssetSettingsDialog';
import AssetRebalanceView from './AssetRebalanceView';

/**
 * 계좌 > 자산 관리 — 풀린 화면(v2.62.0 · 자산 관리 3단계 · v2.62.2 탭 · v2.63.0 비율 조정).
 * 머리: 제목 줄 오른쪽 「연금 포함」(이 기기에 기억) · 읽은 시각 · 「설정」 · 「다시 읽기」 · 「잠그기」 — 세 탭 공통.
 *    「설정」 = 창 하나(연금으로 볼 계좌 · 위성으로 선택한 종목 · 자산 분류 색 · 목표 비율 · 괜찮음 범위 — `AssetSettingsDialog`)
 * 제목 아래 탭 「총 자산 | 자산 현황 | 비율 조정」 — 처음 = 총 자산 · 마지막 탭을 이 기기에 기억(`alphascope.asset.tab` · 읽기 실패 · 모르는 값이면 총 자산).
 * 주소에는 넣지 않는다(소메뉴 안 탭).
 * - 비율 조정: 보기만(`AssetRebalanceView` — summary 의 `rebalance` 그대로) · [목표 비율 바꾸기] = 설정 창을 목표 비율 칸으로 연다.
 * - 총 자산: 숫자 카드 셋(총 자산 · 어제보다 · 평가 손익) · 총 자산 선 차트(하루 기록 · 1개월 · 3개월 · 1년 · 전체) ·
 *   구성 원형 차트 / 분류별 표(주식 아래 코어 · 위성 · 미지정은 흐리게) — 분류 색은 설정의 「자산 분류 색」
 * - 자산 현황: 요약 + 계좌 카드(자산 분류 고르기 — 시트에 바로 씀). 이 탭을 처음 열 때 시트를 읽는다.
 * 받기: 처음 = 스켈레톤 · 다시 읽기 · 연금 포함 바꾸기 = 내용을 두고 작은 스피너 · 10초 가격 갱신(`usePolling` — 숨은 탭에서 쉼)은 표시 없음.
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다(로컬 저장소에는 「연금 포함」 켬/끔만).
 */

const PENSION_KEY = 'alphascope.asset.includePension';
const TAB_KEY = 'alphascope.asset.tab';
type AssetTab = 'total' | 'status' | 'rebalance';
const TABS: { id: AssetTab; label: string }[] = [
  { id: 'total', label: '총 자산' },
  { id: 'status', label: '자산 현황' },
  { id: 'rebalance', label: '비율 조정' },
];

/** 마지막에 본 탭 — 읽지 못하거나 모르는 값이면 총 자산 */
function readTab(): AssetTab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    return v === 'status' || v === 'rebalance' ? v : 'total';
  } catch {
    return 'total';
  }
}
function saveTab(tab: AssetTab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* 기억하지 못해도 화면은 그대로 */
  }
}
const POLL_MS = 10_000;

function readPension(): boolean {
  try {
    return localStorage.getItem(PENSION_KEY) === '1';
  } catch {
    return false;
  }
}
function savePension(on: boolean) {
  try {
    localStorage.setItem(PENSION_KEY, on ? '1' : '0');
  } catch {
    /* 기억하지 못해도 화면은 그대로 */
  }
}

type Fail = { error: string; locked?: boolean };
type SummaryResult = { ok: true; summary: AssetSummary } | { ok: false; fail: Fail };

/** 응답 → 결과(잠김 · 실패 · 성공) */
function toResult(payload: Record<string, unknown>): SummaryResult {
  if (typeof payload.pollError === 'string') return { ok: false, fail: { error: '서버에 연결하지 못했습니다.' } };
  if (payload.code === 'asset-locked') return { ok: false, fail: { error: '자산 관리가 잠겨 있습니다.', locked: true } };
  if (typeof payload.error === 'string') return { ok: false, fail: { error: payload.error } };
  return { ok: true, summary: payload as unknown as AssetSummary };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({ error: `요청 실패 (${res.status})` }))) as Record<string, unknown>;
}

/** 실패 한 줄 + [다시 시도] — 빈 화면으로 바꾸지 않는다 */
export function ErrorLine({ message, onRetry, busy = false }: { message: string; onRetry?: () => void; busy?: boolean }) {
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

const ratioText = (r: number | null | undefined, digits = 1) => (r == null ? '—' : formatNumber(r * 100, digits, '%'));

export default function AssetDashboard({ onLock, onLocked }: { onLock: () => void; onLocked: () => void }) {
  const [pension, setPension] = useState(readPension);
  const url = `/api/asset/summary?pension=${pension ? 1 : 0}`;
  const polled = usePolling<SummaryResult>(url, toResult, POLL_MS);
  /** 마지막으로 그린 결과(연금 포함을 바꿔 다시 받는 동안에도 내용을 둔다) */
  const [latest, setLatest] = useState<{ pension: boolean; result: SummaryResult } | null>(null);
  const [reloading, setReloading] = useState(false);
  const [tab, setTab] = useState<AssetTab>(readTab);
  const open = tab === 'status';
  /** 설정 창 — null 이면 닫힘 · 'targetRatio' 면 목표 비율 칸으로 연다 */
  const [settingsOpen, setSettingsOpen] = useState<null | 'top' | 'targetRatio'>(null);
  const [sheet, setSheet] = useState<{ data: AssetSheetData } | { error: string } | null>(null);

  useEffect(() => {
    if (!polled) return;
    // 10초 갱신 실패(네트워크 등)는 그린 값을 지우지 않는다(표시 없음 — 다음 갱신에 다시) · 잠김 · 처음 · 연금 바꿈은 그대로 담는다
    setLatest((prev) => (polled.ok || polled.fail.locked || !prev || !prev.result.ok || prev.pension !== pension ? { pension, result: polled } : prev));
    // pension 은 url 과 함께 바뀐다 — polled 가 새로 올 때만 담는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polled]);

  useEffect(() => {
    if (latest && !latest.result.ok && latest.result.fail.locked) onLocked();
  }, [latest, onLocked]);

  const loadSheet = useCallback(async () => {
    try {
      const res = await fetch('/api/asset/sheet');
      const body = await readJson(res);
      if (body.code === 'asset-locked') return onLocked();
      setSheet(res.ok ? { data: body as unknown as AssetSheetData } : { error: (body as unknown as AssetSheetFailure).error ?? '시트를 읽지 못했습니다.' });
    } catch {
      setSheet({ error: '서버에 연결하지 못했습니다.' });
    }
  }, [onLocked]);

  /** 「다시 읽기」 · 쓰기 뒤 — 내용을 두고 버튼만 돈다 */
  const reload = useCallback(async () => {
    setReloading(true);
    try {
      const res = await fetch(url);
      setLatest({ pension, result: toResult(await readJson(res)) });
    } catch {
      setLatest((prev) => prev ?? { pension, result: { ok: false, fail: { error: '서버에 연결하지 못했습니다.' } } });
    }
    if (open) await loadSheet();
    setReloading(false);
  }, [url, pension, open, loadSheet]);

  useEffect(() => {
    if (open && sheet == null) void loadSheet();
  }, [open, sheet, loadSheet]);

  const togglePension = (on: boolean) => {
    setPension(on);
    savePension(on);
  };

  const pickClass = async (row: number, value: AssetClass | ''): Promise<string | null> => {
    try {
      const res = await fetch('/api/asset/class', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ row, assetClass: value }) });
      const body = await readJson(res);
      if (body.code === 'asset-locked') {
        onLocked();
        return '자산 관리가 잠겼습니다.';
      }
      if (!res.ok) return typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})`;
      setSheet({ data: body as unknown as AssetSheetData });
      void reload();
      return null;
    } catch {
      return '서버에 연결하지 못했습니다.';
    }
  };

  const saveSettings = async (patch: Partial<AssetSettings>): Promise<string | null> => {
    try {
      const res = await fetch('/api/asset/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
      const body = await readJson(res);
      if (!res.ok) return typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})`;
      await reload();
      return null;
    } catch {
      return '서버에 연결하지 못했습니다.';
    }
  };

  /** 목표 비율 저장(시트에 씀) — 성공이면 시트에서 다시 읽은 값, 그 뒤 비율 조정을 다시 받는다 */
  const saveTarget = async (ratio: Record<keyof AssetTargetRatio, number>): Promise<{ ok: true; ratio: AssetTargetRatio } | { ok: false; error: string }> => {
    try {
      const res = await fetch('/api/asset/target-ratio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ratio) });
      const body = await readJson(res);
      if (body.code === 'asset-locked') {
        onLocked();
        return { ok: false, error: '자산 관리가 잠겼습니다.' };
      }
      if (!res.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})` };
      const data = body as unknown as AssetSheetData;
      if (sheet && 'data' in sheet) setSheet({ data });
      await reload();
      return { ok: true, ratio: data.targetRatio };
    } catch {
      return { ok: false, error: '서버에 연결하지 못했습니다.' };
    }
  };

  const result = latest?.result ?? null;
  const summary = result?.ok ? result.summary : null;
  /** 지금 고른 「연금 포함」 과 그린 값이 다르면(다시 받는 중) 작은 스피너 */
  const switching = latest != null && latest.pension !== pension;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="자산 관리"
        right={
          <>
            <label className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-primary">
              <input type="checkbox" checked={pension} onChange={(e) => togglePension(e.target.checked)} />
              연금 포함
              <span className="inline-flex w-4 justify-center">{switching && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="다시 계산하는 중" />}</span>
            </label>
            {summary && <span className="whitespace-nowrap text-caption text-text-muted tabular-nums">읽은 시각 {formatDateTime(summary.readAt)}</span>}
            <Button size="md" icon={Settings} disabled={summary == null} onClick={() => setSettingsOpen('top')} data-asset-settings>
              설정
            </Button>
            <Button size="md" icon={RefreshCw} busy={reloading} disabled={latest == null} onClick={() => void reload()}>
              다시 읽기
            </Button>
            <Button size="md" icon={Lock} onClick={onLock}>
              잠그기
            </Button>
          </>
        }
        tabs={TABS}
        value={tab}
        onChange={(t) => {
          setTab(t);
          saveTab(t);
        }}
        tabsLabel="자산 관리 보기"
      />
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto [scrollbar-gutter:stable] ${PANEL_PAD}`}>
        {/* 총 자산 탭 — 처음 받기는 스켈레톤(받기 전에 0 · 빈 값을 그리지 않는다) */}
        {tab === 'total' && latest == null && <DashboardSkeleton />}
        {(tab === 'total' || tab === 'rebalance') && result && !result.ok && !result.fail.locked && <ErrorLine message={result.fail.error} busy={reloading} onRetry={() => void reload()} />}
        {tab === 'total' && summary && (
          <>
            <Cards summary={summary} />
            <HistoryPanel pension={pension} />
            <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3">
              <Panel className="flex items-center justify-center">
                <AssetDonut groups={summary.totals.groups} total={summary.totals.total} colors={summary.settings.classColors} />
              </Panel>
              <GroupTable summary={summary} />
            </div>
          </>
        )}
        {/* 비율 조정 탭 — 보기만(처음 받기는 스켈레톤) */}
        {tab === 'rebalance' && latest == null && <RebalanceSkeleton />}
        {tab === 'rebalance' && summary && <AssetRebalanceView summary={summary} onEditTarget={() => setSettingsOpen('targetRatio')} />}
        {/* 자산 현황 탭 — 요약 · 계좌 카드 · 자산 분류 고르기 */}
        {tab === 'status' && (
          <div id="as-asset-status" className="space-y-3">
            {sheet == null && <SkeletonTable rows={6} columns={6} />}
            {sheet && 'error' in sheet && <ErrorLine message={sheet.error} onRetry={() => void loadSheet()} />}
            {sheet && 'data' in sheet && <AssetSheetValues data={sheet.data} accounts={summary?.accounts ?? []} onPickClass={pickClass} />}
          </div>
        )}
      </div>
      {settingsOpen && summary && (
        <AssetSettingsDialog
          summary={summary}
          onSave={saveSettings}
          onSaveTarget={saveTarget}
          focus={settingsOpen === 'targetRatio' ? 'targetRatio' : undefined}
          onClose={() => setSettingsOpen(null)}
        />
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[5.5rem] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

function RebalanceSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-16 rounded-xl" />
      <SkeletonTable rows={4} columns={8} />
      <SkeletonTable rows={2} columns={8} />
    </div>
  );
}

/** 숫자 카드 — 이름(13px) · 핵심 숫자(16px 600) · 보조 한 줄 */
function Card({ label, value, valueClass = 'text-text-primary', sub }: { label: string; value: string; valueClass?: string; sub: React.ReactNode }) {
  return (
    <Panel className="min-w-0">
      <div className="text-caption text-text-muted">{label}</div>
      <div className={`mt-1 whitespace-nowrap text-sm font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-1 truncate text-caption text-text-muted">{sub}</div>
    </Panel>
  );
}

function Cards({ summary }: { summary: AssetSummary }) {
  const { totals, vsLast, profit } = summary;
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card
        label="총 자산"
        value={formatPrice(totals.total, 'KRW')}
        sub={
          totals.missing > 0 ? (
            <span className="text-warning" title={summary.missingNames.join(', ')}>
              가격 못 받음 {totals.missing}줄 — 총 자산에서 빠짐
            </span>
          ) : (
            summary.includePension ? '연금 포함' : '연금 뺌'
          )
        }
      />
      <Card
        label="어제보다"
        value={vsLast ? formatSignedMoney(vsLast.amount, 'KRW') : '기록 없음'}
        valueClass={vsLast ? changeColor(vsLast.amount) : 'text-text-muted'}
        sub={vsLast ? `${formatSigned(vsLast.ratio == null ? null : vsLast.ratio * 100, 2, '%')} · ${vsLast.day} 하루 기록 대비` : '하루 기록이 쌓이면 보입니다'}
      />
      <Card
        label="평가 손익"
        value={profit ? formatSignedMoney(profit.amount, 'KRW') : '—'}
        valueClass={profit ? changeColor(profit.amount) : 'text-text-muted'}
        sub={profit ? `${formatSigned(profit.ratio == null ? null : profit.ratio * 100, 2, '%')} · 평균 매입가 대비(현금 제외)` : '매입가를 아는 종목이 없습니다'}
      />
    </div>
  );
}

const RANGES: { value: AssetHistoryRange; label: string }[] = [
  { value: '1m', label: '1개월' },
  { value: '3m', label: '3개월' },
  { value: '1y', label: '1년' },
  { value: 'all', label: '전체' },
];

/** 총 자산 선 차트 — 기간 · 연금 포함이 바뀔 때만 받는다(하루 한 번 쌓이는 값이라 폴링하지 않는다) */
function HistoryPanel({ pension }: { pension: boolean }) {
  const [range, setRange] = useState<AssetHistoryRange>('1m');
  const [state, setState] = useState<{ points: AssetHistoryPoint[] } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/asset/history?range=${range}&pension=${pension ? 1 : 0}`);
      const body = (await readJson(res)) as { points?: AssetHistoryPoint[]; error?: string };
      setState(res.ok && body.points ? { points: body.points } : { error: body.error ?? '하루 기록을 받지 못했습니다.' });
    } catch {
      setState({ error: '서버에 연결하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  }, [range, pension]);

  useEffect(() => {
    void load();
  }, [load]);

  const points = state && 'points' in state ? state.points : null;
  return (
    <Panel className="flex h-64 flex-col gap-2">
      <SectionTitle
        aside={busy && state != null ? <LoaderCircle {...ICON_SM} className="animate-spin" aria-label="받는 중" /> : undefined}
        info="미국 애프터마켓이 끝난 뒤(두 시장이 모두 닫힌 때) 하루 한 번 총 자산을 기록합니다. 서버가 꺼져 있던 날은 비어 있습니다."
        right={<Segmented size="sm" label="기간" options={RANGES} value={range} onChange={setRange} />}
      >
        총 자산 추이
      </SectionTitle>
      <div className="relative min-h-0 flex-1">
        {state == null && <Skeleton className="h-full rounded-lg" />}
        {state && 'error' in state && <ErrorLine message={state.error} busy={busy} onRetry={() => void load()} />}
        {points && points.length === 0 && (
          <p className="flex h-full items-center justify-center text-xs text-text-muted keep-all">아직 하루 기록이 없습니다 — 미국 애프터마켓이 끝난 뒤 하루 한 번 쌓입니다.</p>
        )}
        {points && points.length > 0 && (
          <>
            <AssetHistoryChart points={points} />
            {points.length === 1 && (
              <p className="pointer-events-none absolute left-2 top-1 z-10 text-caption text-text-muted">하루 기록이 쌓이면 선이 그려집니다</p>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;

/** 분류별 표 — 분류 · 금액 · 비율(총 자산 대비) · 주식 아래 들여 쓴 코어 · 위성(비율은 주식 금액 대비) */
function GroupTable({ summary }: { summary: AssetSummary }) {
  const { totals } = summary;
  const stock = totals.groups.find((g) => g.key === 'stock')?.amount ?? 0;
  const inStock = (v: number) => (stock > 0 ? v / stock : null);
  return (
    <Panel pad="none" className="pb-1">
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className={`${TABLE_NAME_COL} pl-4 font-normal`}>분류</th>
            <th className={`${NUM} font-normal`}>금액</th>
            <th className={`${NUM} pr-4 font-normal`}>비율</th>
          </tr>
        </thead>
        <tbody>
          {totals.groups.map((g) => {
            const none = g.key === 'none';
            return (
              <Fragment key={g.key}>
                <tr className={`border-t border-border/30 ${LIST_TABLE_ROW} ${none ? 'text-text-muted' : 'text-text-primary'}`} data-group={g.key}>
                  <td className="pl-4">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${groupDot(g.key, summary.settings.classColors)}`} aria-hidden />
                      <span className="shrink-0">{g.label}</span>
                      {none && g.amount > 0 && <span className="truncate text-caption">자산 현황에서 자산 분류를 골라 주세요</span>}
                    </span>
                  </td>
                  <td className={NUM}>{formatPrice(g.amount, 'KRW')}</td>
                  <td className={`${NUM} pr-4`}>{ratioText(g.ratio)}</td>
                </tr>
                {g.key === 'stock' &&
                  ([
                    ['코어', totals.core],
                    ['위성', totals.satellite],
                  ] as const).map(([label, v]) => (
                    <tr key={label} className={`${LIST_TABLE_ROW} text-text-secondary`} data-group={`stock-${label}`}>
                      <td className="pl-10">{label}</td>
                      <td className={NUM}>{formatPrice(v, 'KRW')}</td>
                      <td className={`${NUM} pr-4`}>{ratioText(inStock(v))}</td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
