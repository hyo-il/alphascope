import { Fragment, useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button, FormRow, ICON_SM, Panel, Segmented, Select } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NUM_GAP } from '../ui/tokens';
import { Skeleton } from '../common/SkeletonLoader';
import { modal } from '../../store/uiStore';
import { formatAssetWon } from '../../utils/assetFormat';
import {
  ASSET_CASH_KIND_LABEL,
  ASSET_CASH_REASON_LABEL,
  ASSET_CASH_STATUS_LABEL,
  type AssetCashFlowSetting,
  type AssetCashFlowView,
  type AssetCashKey,
  type AssetCashMoveRecord,
  type AssetCashRowOption,
  type AssetCashSettingsPatch,
  type AssetCashShift,
  type AssetCashTarget,
  type AssetCashView,
} from '../../types/asset';

/**
 * 「자산 관리 설정」 → 「현금 자동 반영」(v2.71.0) — 시트 「현금」 탭 은행 계좌 줄 금액을 앱이 바꾸는 설정 · 기록.
 * - 열 때 `GET /api/asset/cash`(받기 전 뼈대 · 실패 = 이유 + [다시 시도]). 고칠 때마다 바로 저장(`PUT /api/asset/cash/settings` — 그 칸만 막고 구역 이름 옆 로딩) ·
 *   성공하면 서버가 돌려준 화면 전체(다음 반영 날이 바뀐다) · 실패하면 그 구역에 이유 한 줄(값은 서버 값 그대로).
 * - 구역: 켬/끔(켜기 전 확인 창 — 시트 잔액을 먼저 맞추라는 안내) · 예수금 줄 짝(계좌마다) · 월급(들어오는 줄 · 날짜 · 휴일) ·
 *   고정 흐름(「월 고정지출」 줄마다 날짜 · 출금 줄 · 입금 줄(밖으로) — 변동 지출은 회색 「반영 안 함」 · 같은 사유는 「#n」 · 다시 확인 필요는 빨간 글) ·
 *   반영 기록(최근 50 · 최신 위 · 「반영」 줄만 [되돌리기] — 확인 창 · 처리 중 로딩).
 * - 잠금: 서버가 403 `asset-locked` 면 `onLocked`(잠금 화면으로). 이 창은 풀린 동안에만 열린다.
 * ⚠️ 금액 · 계좌 이름을 콘솔 · 로컬 저장소에 남기지 않는다.
 */

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'done'; view: AssetCashView };
type BlockId = 'enabled' | 'pairs' | 'salary' | 'flows' | 'moves';

const SHIFT_OPTIONS: { value: AssetCashShift; label: string }[] = [
  { value: 'prev', label: '앞 영업일' },
  { value: 'next', label: '다음 영업일' },
];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const OUT = 'out';

const keyId = (k: AssetCashKey) => `${k.name}\u0000${k.nth}`;
const sameKey = (a: AssetCashKey | null | undefined, b: AssetCashKey | null | undefined) => a != null && b != null && a.name === b.name && a.nth === b.nth;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export default function AssetCashSettings({ onLocked }: { onLocked: () => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<BlockId, string | null>>>({});

  const fetchView = useCallback(async () => {
    setLoad((l) => (l.state === 'done' ? l : { state: 'loading' }));
    try {
      const res = await fetch('/api/asset/cash');
      const body = await readJson(res);
      if (body.code === 'asset-locked') return onLocked();
      if (!res.ok) return setLoad({ state: 'error', message: typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})` });
      setLoad({ state: 'done', view: body as unknown as AssetCashView });
    } catch {
      setLoad({ state: 'error', message: '서버에 연결하지 못했습니다.' });
    }
  }, [onLocked]);

  useEffect(() => {
    void fetchView();
  }, [fetchView]);

  /** 저장 · 되돌리기 — 성공이면 새 화면 · 실패면 그 구역에 이유 */
  const send = async (block: BlockId, busyId: string, url: string, method: 'PUT' | 'POST', payload: unknown): Promise<boolean> => {
    if (busy) return false;
    setBusy(busyId);
    setErrors((e) => ({ ...e, [block]: null }));
    try {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await readJson(res);
      if (body.code === 'asset-locked') {
        onLocked();
        return false;
      }
      if (!res.ok) {
        setErrors((e) => ({ ...e, [block]: typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})` }));
        return false;
      }
      setLoad({ state: 'done', view: body as unknown as AssetCashView });
      return true;
    } catch {
      setErrors((e) => ({ ...e, [block]: '서버에 연결하지 못했습니다.' }));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = (block: BlockId, busyId: string, patch: AssetCashSettingsPatch) => send(block, busyId, '/api/asset/cash/settings', 'PUT', patch);

  if (load.state === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="asset-cash-settings-loading">
        <Skeleton className="h-8 w-64 rounded-md" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="space-y-2" data-testid="asset-cash-settings-error">
        <p role="alert" className="text-xs text-danger keep-all">
          {load.message}
        </p>
        <Button size="sm" onClick={() => void fetchView()}>
          다시 시도
        </Button>
      </div>
    );
  }

  const v = load.view;
  const s = v.settings;
  const rowLabel = (k: AssetCashKey | null): string => {
    if (!k) return '—';
    return v.rows.find((r) => sameKey(r.key, k))?.label ?? (k.nth > 1 ? `${k.name} #${k.nth}` : k.name);
  };

  const enable = (on: boolean) => {
    if (!on) return void save('enabled', 'enabled', { enabled: false });
    modal.confirm({
      title: '현금 자동 반영 켜기',
      message: '예수금 · 은행 잔액을 시트 「현금」 탭에서 먼저 맞춰 주세요. 켠 오늘부터 정해진 날에 앱이 그 줄 금액을 바꿉니다(오늘보다 앞선 날짜는 채우지 않습니다).',
      confirmText: '켜기',
      onConfirm: () => void save('enabled', 'enabled', { enabled: true }),
    });
  };

  const flowPatch = (f: AssetCashFlowView, change: Partial<AssetCashFlowSetting>): AssetCashFlowSetting => {
    const base: AssetCashFlowSetting = f.setting ?? { item: f.item!.key, day: null, from: null, to: null };
    return { ...base, ...change };
  };

  const undo = (m: AssetCashMoveRecord) =>
    modal.confirm({
      title: '되돌리기',
      message: `「${m.label}」 ${formatAssetWon(m.amount)} 반영을 되돌립니다. 지금 시트 숫자에서 ${[m.from ? `「${rowLabel(m.from)}」 에 다시 더하고` : null, m.to ? `「${rowLabel(m.to)}」 에서 뺍니다` : null].filter(Boolean).join(' ').replace(/더하고$/, '더합니다')}.`,
      confirmText: '되돌리기',
      onConfirm: () => void send('moves', `undo-${m.id}`, '/api/asset/cash/undo', 'POST', { id: m.id }),
    });

  return (
    <div className="space-y-6" data-testid="asset-cash-settings">
      <Block heading="켜기 · 끄기" busy={busy === 'enabled'} error={errors.enabled ?? null}>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<'off' | 'on'>
            size="sm"
            label="현금 자동 반영"
            options={[
              { value: 'off', label: '끔', disabled: busy === 'enabled' },
              { value: 'on', label: '켬', disabled: busy === 'enabled' || !v.writeEnabled },
            ]}
            value={s.enabled ? 'on' : 'off'}
            onChange={(x) => enable(x === 'on')}
          />
          <span className="text-caption text-text-muted keep-all" data-testid="asset-cash-enabled-note">
            {s.enabled ? `${s.enabledDay ?? v.today}부터 반영합니다.` : '예수금 · 은행 잔액을 시트에서 먼저 맞춰 주세요.'}
          </span>
        </div>
        {!v.writeEnabled && <p className="text-caption text-text-muted keep-all">이 서버에서는 시트 쓰기가 꺼져 있어 반영하지 않습니다.</p>}
      </Block>

      <Block heading="예수금 줄 짝" desc="매수 · 매도를 적을 때 이 줄 금액도 함께 바뀝니다(매수는 줄고 매도는 늘어납니다)." busy={busy?.startsWith('pair-') ?? false} error={errors.pairs ?? null}>
        <Panel pad="none" className="pb-1">
          <table className="w-full table-fixed text-left text-xs" data-testid="asset-cash-pairs">
            <thead className="text-caption text-text-muted">
              <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                <th className="pl-4 font-normal">계좌</th>
                <th className="w-72 pr-4 font-normal">예수금 줄</th>
              </tr>
            </thead>
            <tbody>
              {v.sections.map((sec) => {
                const pair = s.depositPairs[sec.key] ?? null;
                return (
                  <tr key={sec.key} className={`border-t border-border/30 ${LIST_TABLE_ROW}`}>
                    <td className="max-w-0 pl-4">
                      <span className="block truncate text-text-primary" data-tip-clip={sec.name}>
                        {sec.name}
                      </span>
                    </td>
                    <td className="pr-4">
                      <RowSelect
                        rows={v.rows}
                        label={`${sec.key} 예수금 줄`}
                        value={pair}
                        disabled={busy != null}
                        onPick={(k) => void save('pairs', `pair-${sec.key}`, { depositPair: { section: sec.key, key: k === OUT ? null : k } })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </Block>

      <Block heading="월급" desc="「월 고정지출」 탭 「현재 월 급여」 를 그날 들어오는 줄에 더합니다." busy={busy === 'salary'} error={errors.salary ?? null}>
        <div className="space-y-2" data-testid="asset-cash-salary">
          <FormRow label="들어오는 줄" labelW="sm" valueW="lg" error={v.salary.problem ? '시트에서 줄을 찾지 못했어요 — 다시 골라 주세요' : undefined}>
            <RowSelect rows={v.rows} label="월급 들어오는 줄" value={s.salary.to} disabled={busy != null} onPick={(k) => void save('salary', 'salary', { salary: { to: k === OUT ? null : k } })} />
          </FormRow>
          <FormRow
            label="날짜"
            labelW="sm"
            valueW="lg"
            hint={
              <span className="flex items-center gap-2">
                <span className="text-caption text-text-muted">휴일이면</span>
                <Segmented<AssetCashShift>
                  size="sm"
                  label="월급 휴일이면"
                  options={SHIFT_OPTIONS.map((o) => ({ ...o, disabled: busy != null }))}
                  value={s.salary.shift}
                  onChange={(x) => void save('salary', 'salary', { salary: { shift: x } })}
                />
              </span>
            }
          >
            <Select size="sm" className="w-full" aria-label="월급 날짜" value={s.salary.day} disabled={busy != null} onChange={(e) => void save('salary', 'salary', { salary: { day: Number(e.target.value) } })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  매달 {d}일
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label="금액 · 다음 반영 날" labelW="sm" valueW="lg">
            <span className="flex w-full items-baseline gap-3 text-xs text-text-primary tabular-nums" data-testid="asset-cash-salary-next">
              <span>{v.salary.amount != null ? formatAssetWon(v.salary.amount) : '—'}</span>
              <span className="text-text-muted">{v.salary.nextDay ?? (s.enabled ? '—' : '꺼짐')}</span>
            </span>
          </FormRow>
        </div>
      </Block>

      <Block heading="고정 흐름" desc="「월 고정지출」 의 저축 및 투자 · 월세 · 고정 지출 줄을 매달 그날 옮깁니다. 날짜 · 출금 줄 · 입금 줄을 모두 정한 줄만 반영합니다." busy={busy?.startsWith('flow') ?? false} error={errors.flows ?? null}>
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-caption text-text-muted">휴일이면</span>
            <Segmented<AssetCashShift>
              size="sm"
              label="고정 흐름 휴일이면"
              options={SHIFT_OPTIONS.map((o) => ({ ...o, disabled: busy != null }))}
              value={s.flowShift}
              onChange={(x) => void save('flows', 'flow-shift', { flowShift: x })}
            />
          </div>
          {v.fixedError && (
            <p role="alert" className="text-xs text-danger keep-all" data-testid="asset-cash-fixed-error">
              「월 고정지출」 을 읽지 못했어요 — {v.fixedError}
            </p>
          )}
          <Panel pad="none" className="pb-1">
            <table className="w-full table-fixed text-left text-xs" data-testid="asset-cash-flows">
              <colgroup>
                <col />
                <col className="w-28" />
                <col className="w-20" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-28" />
              </colgroup>
              <thead className="text-caption text-text-muted">
                <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                  <th className="pl-4 font-normal">분류 · 사유</th>
                  <th className={`${TABLE_NUM_GAP} text-right font-normal`}>비용</th>
                  <th className="pl-3 font-normal">날짜</th>
                  <th className="pl-2 font-normal">출금 줄</th>
                  <th className="pl-2 font-normal">입금 줄</th>
                  <th className="pr-4 pl-3 text-right font-normal">다음 반영 날</th>
                </tr>
              </thead>
              <tbody>
                {v.flows.length === 0 && (
                  <tr className={LIST_TABLE_ROW}>
                    <td colSpan={6} className="px-4 text-text-muted">
                      {v.fixedError ? '「월 고정지출」 을 읽으면 줄이 보입니다.' : '「월 고정지출」 표에 줄이 없습니다.'}
                    </td>
                  </tr>
                )}
                {v.flows.map((f, i) => {
                  const catOf = (x: AssetCashFlowView) => (x.item ? x.item.key.category : '시트에서 찾지 못한 줄');
                  const cat = catOf(f);
                  const prevCat = i > 0 ? catOf(v.flows[i - 1]) : undefined;
                  const reflect = f.item?.reflect ?? true;
                  const zero = f.item != null && (f.item.amount == null || f.item.amount === 0);
                  const id = `flow-${i}`;
                  const label = f.item?.label ?? (f.setting ? (f.setting.item.nth > 1 ? `${f.setting.item.reason} #${f.setting.item.nth}` : f.setting.item.reason) : '');
                  const problem = f.problem ? ASSET_CASH_REASON_LABEL[f.problem] : null;
                  return (
                    <Fragment key={`${cat}-${label}-${i}`}>
                      {/* 분류 = 시트의 합쳐진 칸처럼 묶음 머리 한 줄(설정 표는 고르기 칸이 많아 사유 칸 폭을 남긴다) */}
                      {cat !== prevCat && (
                        <tr className={`border-t border-border/30 ${TABLE_HEAD_ROW}`} data-testid="asset-cash-flow-category">
                          <td colSpan={6} className="pl-4 text-caption font-medium text-text-secondary">
                            {cat}
                          </td>
                        </tr>
                      )}
                    <tr className={`border-t border-border/30 ${LIST_TABLE_ROW} ${reflect ? 'text-text-primary' : 'text-text-muted'}`} data-testid="asset-cash-flow-row" data-flow-reflect={reflect ? 'yes' : 'no'}>
                      <td className="max-w-0 pl-6">
                        <span className={`block truncate ${problem ? 'text-danger' : ''}`} data-tip-clip={problem ? `${label} — ${problem}` : label}>
                          {label}
                        </span>
                        {problem && <span className="block truncate text-caption text-danger">{problem}</span>}
                      </td>
                      <td className={`${TABLE_NUM_GAP} text-right tabular-nums`}>{f.item?.amount != null ? formatAssetWon(f.item.amount) : '—'}</td>
                      {reflect ? (
                        <>
                          <td className="pl-3">
                            <Select
                              size="sm"
                              className="w-full"
                              aria-label={`${label} 날짜`}
                              value={f.setting?.day ?? ''}
                              disabled={busy != null || !f.item}
                              onChange={(e) => void save('flows', id, { flow: flowPatch(f, { day: e.target.value === '' ? null : Number(e.target.value) }) })}
                            >
                              <option value="">—</option>
                              {DAYS.map((d) => (
                                <option key={d} value={d}>
                                  {d}일
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="pl-2">
                            <RowSelect rows={v.rows} label={`${label} 출금 줄`} value={f.setting?.from ?? null} disabled={busy != null || !f.item} onPick={(k) => void save('flows', id, { flow: flowPatch(f, { from: k === OUT ? null : k }) })} />
                          </td>
                          <td className="pl-2">
                            <RowSelect rows={v.rows} label={`${label} 입금 줄`} allowOut value={f.setting?.to ?? null} disabled={busy != null || !f.item} onPick={(k) => void save('flows', id, { flow: flowPatch(f, { to: k }) })} />
                          </td>
                          <td className="pr-4 pl-3 text-right tabular-nums">
                            {!f.item && f.setting ? (
                              <Button size="sm" variant="danger-text" disabled={busy != null} onClick={() => void save('flows', id, { flow: { item: f.setting!.item, day: null, from: null, to: null } })}>
                                설정 지우기
                              </Button>
                            ) : zero ? (
                              <span className="text-text-muted" data-tip="비용이 ₩0 · 빈칸이라 반영하지 않습니다">
                                반영 안 함
                              </span>
                            ) : (
                              <span className={f.nextDay ? '' : 'text-text-muted'}>{f.nextDay ?? '—'}</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="pl-3 text-text-muted">—</td>
                          <td className="pl-2 text-text-muted">—</td>
                          <td className="pl-2 text-text-muted">—</td>
                          <td className="pr-4 pl-3 text-right text-text-muted">반영 안 함</td>
                        </>
                      )}
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      </Block>

      <Block heading="반영 기록" desc="최근 50개 · 최신이 위입니다. 「반영」 줄은 되돌릴 수 있습니다(지금 시트 숫자에서 반대로)." busy={busy?.startsWith('undo-') ?? false} error={errors.moves ?? null}>
        <Panel pad="none" className="pb-1">
          <table className="w-full table-fixed text-left text-xs" data-testid="asset-cash-moves">
            <colgroup>
              <col className="w-28" />
              <col className="w-40" />
              <col />
              <col className="w-28" />
              <col className="w-32" />
              <col className="w-24" />
            </colgroup>
            <thead className="text-caption text-text-muted">
              <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                <th className="pl-4 font-normal">날짜</th>
                <th className="font-normal">무엇</th>
                <th className="font-normal">출금 → 입금</th>
                <th className={`${TABLE_NUM_GAP} text-right font-normal`}>금액</th>
                <th className="pl-4 font-normal">상태</th>
                <th className="pr-4" aria-label="되돌리기" />
              </tr>
            </thead>
            <tbody>
              {v.moves.length === 0 && (
                <tr className={LIST_TABLE_ROW}>
                  <td colSpan={6} className="px-4 text-text-muted">
                    아직 반영한 기록이 없습니다.
                  </td>
                </tr>
              )}
              {v.moves.map((m) => {
                const what = `${ASSET_CASH_KIND_LABEL[m.kind]}${m.kind === 'salary' ? '' : ` · ${m.label}`}`;
                const path = `${m.from ? rowLabel(m.from) : '밖'} → ${m.to ? rowLabel(m.to) : '밖'}`;
                const status = ASSET_CASH_STATUS_LABEL[m.status];
                const reason = m.reason ? ASSET_CASH_REASON_LABEL[m.reason] : null;
                const tone = m.status === 'check' ? 'text-danger' : m.status === 'applied' ? 'text-text-primary' : 'text-text-muted';
                return (
                  <tr key={m.id} className={`border-t border-border/30 ${LIST_TABLE_ROW}`} data-testid="asset-cash-move-row" data-move-status={m.status}>
                    <td className="pl-4 tabular-nums text-text-secondary">{m.day}</td>
                    <td className="max-w-0 pr-3">
                      <span className="block truncate text-text-primary" data-tip-clip={what}>
                        {what}
                      </span>
                    </td>
                    <td className="max-w-0">
                      <span className="block truncate text-text-secondary" data-tip-clip={path}>
                        {path}
                      </span>
                    </td>
                    <td className={`${TABLE_NUM_GAP} text-right tabular-nums ${m.status === 'skipped' ? 'text-text-muted' : 'text-text-primary'}`}>{m.amount > 0 ? formatAssetWon(m.amount) : '—'}</td>
                    <td className="max-w-0 pl-4">
                      <span className={`block truncate ${tone}`}>{status}</span>
                      {reason && (
                        <span className={`block truncate text-caption ${m.status === 'check' ? 'text-danger' : 'text-text-muted'}`} data-tip-clip={reason}>
                          {reason}
                        </span>
                      )}
                    </td>
                    <td className="pr-4 text-right">
                      {m.status === 'applied' && (
                        <Button size="sm" variant="ghost" busy={busy === `undo-${m.id}`} disabled={busy != null || !s.enabled || !v.writeEnabled} onClick={() => undo(m)}>
                          되돌리기
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </Block>
    </div>
  );
}

/** 구역 하나(속성 이름은 heading — 툴팁 시험이 세는 속성 이름을 피함) — 제목 + 저장 중 로딩 + 설명 + 내용 + 이유 한 줄 */
function Block({ heading, desc, busy, error, children }: { heading: string; desc?: string; busy: boolean; error: string | null; children: React.ReactNode }) {
  return (
    <section className="space-y-2" data-testid={`asset-cash-block-${heading}`}>
      <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
        {heading}
        <span className="inline-flex w-4 justify-center">{busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
      </h4>
      {desc && <p className="text-caption text-text-muted keep-all">{desc}</p>}
      {children}
      {error && (
        <p role="alert" className="text-xs text-danger keep-all">
          {error}
        </p>
      )}
    </section>
  );
}

/** 「현금」 줄 고르기 — 저장한 줄이 시트에서 사라졌으면 「찾지 못함」 칸을 하나 더(빨간 글) */
function RowSelect({
  rows,
  value,
  onPick,
  label,
  allowOut,
  disabled,
}: {
  rows: AssetCashRowOption[];
  value: AssetCashKey | 'out' | null;
  onPick: (k: AssetCashTarget | null) => void;
  label: string;
  allowOut?: boolean;
  disabled?: boolean;
}) {
  const lost = value && value !== OUT && !rows.some((r) => sameKey(r.key, value)) ? value : null;
  const current = value == null ? '' : value === OUT ? OUT : keyId(value);
  return (
    <Select
      size="sm"
      className={`w-full min-w-0 truncate ${lost ? 'text-danger' : ''}`}
      aria-label={label}
      data-tip={current === '' ? undefined : current === OUT ? '밖으로(출금만)' : (rows.find((r) => keyId(r.key) === current)?.label ?? (lost ? `${lost.name} — 찾지 못함` : undefined))}
      value={current}
      disabled={disabled}
      onChange={(e) => {
        const id = e.target.value;
        if (id === '') return onPick(null);
        if (id === OUT) return onPick(OUT);
        const r = rows.find((x) => keyId(x.key) === id);
        if (r) onPick(r.key);
      }}
    >
      <option value="">{allowOut ? '정하지 않음' : '없음'}</option>
      {allowOut && <option value={OUT}>밖으로(출금만)</option>}
      {lost && <option value={keyId(lost)}>{`${lost.nth > 1 ? `${lost.name} #${lost.nth}` : lost.name} — 찾지 못함`}</option>}
      {rows.map((r) => (
        <option key={keyId(r.key)} value={keyId(r.key)}>
          {r.label}
        </option>
      ))}
    </Select>
  );
}
