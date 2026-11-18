import { Fragment, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { Button, DisclosureButton, ICON_SM, Input, Panel, Segmented, Select } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NUM_GAP } from '../ui/tokens';
import { Skeleton } from '../common/SkeletonLoader';
import { modal } from '../../store/uiStore';
import { formatAssetWon } from '../../utils/assetFormat';
import AssetCashAccountPicker, { type PickerExtra } from './AssetCashAccountPicker';
import {
  ASSET_CASH_FROM_SALARY,
  ASSET_CASH_PREVIEW_WHY_LABEL,
  ASSET_CASH_REASON_TEXT,
  ASSET_CASH_STATUS_LABEL,
  assetCashDefaultTo,
  assetCashKindLabel,
  isAssetCashManualKind,
  cashBankGroups,
  cashBankLabelOf,
  cashBankName,
  type AssetCashBankGroup,
  type AssetCashBankPatch,
  type AssetCashFlowEdit,
  type AssetCashFlowViewV2,
  type AssetCashKey,
  type AssetCashMoveRecordAll,
  type AssetCashPreviewItem,
  type AssetCashRowOption,
  type AssetCashSettingsPatchV2,
  type AssetCashShift,
  type AssetCashViewV2,
  type AssetCashViewV3,
} from '../../types/asset';

/**
 * 「자산 관리 설정」 → 「현금 자동 반영」(v2.71.0 · v2.71.1 쉽게) — 시트 「현금」 탭 은행 계좌 금액을 앱이 바꾸는 설정 · 미리 보기 · 기록.
 * - 열 때 `GET /api/asset/cash`(받기 전 뼈대 · 실패 = 이유 + [다시 시도]). 고칠 때마다 바로 저장(`PUT /api/asset/cash/settings` · 은행 묶음은 `PUT /api/asset/cash/banks` —
 *   그 칸만 막고 구역 이름 옆 로딩) · 성공하면 서버가 돌려준 화면 전체(다음 반영 날 · 미리 보기가 바뀐다) · 실패하면 그 구역에 이유 한 줄(값은 서버 값 그대로).
 * - 구역(위 → 아래): 켬/끔(켜기 전 확인 창) · **월급 카드**(「월 고정지출」 「현재 월 급여」 → 받는 계좌 · 날짜 · 휴일) ·
 *   **고정 흐름**(월급 카드 아래로 퍼지는 모양 — 왼쪽 이어지는 선 · 「모두 같은 날」 · 분류 묶음 · 줄마다 「[빠지는 계좌] → [들어가는 계좌] ₩ [날]일」 ·
 *   빠지는 계좌 기본 = 월급 받는 계좌(따라감 — 바꾸면 「바꿈」) · 월세 · 고정 지출의 들어가는 계좌 기본 = 쓴 돈(밖으로) · ₩0 · 변동 지출은 회색 「반영 안 함」) ·
 *   **다음 한 달 미리 보기**(서버 `cashPreview.ts` — 실제 예약과 같은 함수) · **예수금 계좌 짝** · **은행 묶음 고치기**(접힘) · **반영 기록**(「반영」 줄만 [되돌리기]).
 * - 계좌 고르기는 공용 부품 `AssetCashAccountPicker` 하나(은행별 묶음 — `cashBankGroups`, 서버와 같은 함수).
 * - 화면 말은 「빠지는 계좌 · 들어가는 계좌 · 쓴 돈(밖으로) · 고정 흐름 · 미리 보기 · 은행 묶음」(용어집).
 * - 잠금: 서버가 403 `asset-locked` 면 `onLocked`(잠금 화면으로). 이 창은 풀린 동안에만 열린다.
 * ⚠️ 금액 · 계좌 이름을 콘솔 · 로컬 저장소에 남기지 않는다.
 */

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'done'; view: AssetCashViewV3 };
type BlockId = 'enabled' | 'pairs' | 'salary' | 'flows' | 'banks' | 'moves';

const SHIFT_OPTIONS: { value: AssetCashShift; label: string }[] = [
  { value: 'prev', label: '앞 영업일' },
  { value: 'next', label: '다음 영업일' },
];
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const OUT = 'out';
const NONE = '';
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

const keyId = (k: AssetCashKey) => `${k.name}\u0000${k.nth}`;
const rowId = (r: AssetCashRowOption) => keyId(r.key);
const sameKey = (a: AssetCashKey | null | undefined, b: AssetCashKey | null | undefined) => a != null && b != null && a.name === b.name && a.nth === b.nth;
/** 2026-11-25 → 11-25(수) */
const dayText = (d: string) => `${d.slice(5)}(${WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export default function AssetCashSettings({ onLocked, onBusy }: { onLocked: () => void; /** 저장 중 — 설정 창이 막는 로딩에 쓴다(공통 7-2 · 칸마다 바로 저장이라 닫을 때 물을 것은 없다) */ onBusy?: (busy: boolean) => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  // 그리기 바로 뒤에 창으로 — 누르자마자 Esc 를 눌러도 창이 저장 중인 것을 안다
  useLayoutEffect(() => onBusy?.(busy != null), [busy, onBusy]);
  const [errors, setErrors] = useState<Partial<Record<BlockId, string | null>>>({});
  const [allDay, setAllDay] = useState(26);
  const [banksOpen, setBanksOpen] = useState(false);

  const fetchView = useCallback(async () => {
    setLoad((l) => (l.state === 'done' ? l : { state: 'loading' }));
    try {
      const res = await fetch('/api/asset/cash');
      const body = await readJson(res);
      if (body.code === 'asset-locked') return onLocked();
      if (!res.ok) return setLoad({ state: 'error', message: typeof body.error === 'string' ? body.error : `요청 실패 (${res.status})` });
      setLoad({ state: 'done', view: body as unknown as AssetCashViewV3 });
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
      setLoad({ state: 'done', view: body as unknown as AssetCashViewV3 });
      return true;
    } catch {
      setErrors((e) => ({ ...e, [block]: '서버에 연결하지 못했습니다.' }));
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = (block: BlockId, busyId: string, patch: AssetCashSettingsPatchV2) => send(block, busyId, '/api/asset/cash/settings', 'PUT', patch);
  const saveBank = (busyId: string, patch: AssetCashBankPatch) => send('banks', busyId, '/api/asset/cash/banks', 'PUT', patch);

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
  const names = v.rows.map((r) => r.key.name);
  const groups = cashBankGroups(v.rows, (r) => r.key.name, v.bankFix);
  /** 은행까지 붙인 이름(시트에 없으면 저장한 이름 그대로) */
  const full = (k: AssetCashKey | null): string => (k ? (cashBankLabelOf(k, names, v.bankFix) ?? (k.nth > 1 ? `${k.name} #${k.nth}` : k.name)) : '—');
  const lostOf = (k: AssetCashKey | null) => (k && !v.rows.some((r) => sameKey(r.key, k)) ? full(k) : null);
  const valueOf = (k: AssetCashKey | null) => (k ? keyId(k) : NONE);
  const keyOf = (id: string): AssetCashKey | null => v.rows.find((r) => rowId(r) === id)?.key ?? null;
  const salaryName = s.salary.to ? full(s.salary.to) : null;

  const enable = (on: boolean) => {
    if (!on) return void save('enabled', 'enabled', { enabled: false });
    modal.confirm({
      title: '현금 자동 반영 켜기',
      message: '예수금 · 은행 잔액을 시트 「현금」 탭에서 먼저 맞춰 주세요. 켠 오늘부터 정해진 날에 앱이 그 계좌 금액을 바꿉니다(오늘보다 앞선 날짜는 채우지 않습니다). 아래 「다음 한 달 미리 보기」 로 먼저 확인해 주세요.',
      confirmText: '켜기',
      onConfirm: () => void save('enabled', 'enabled', { enabled: true }),
    });
  };

  /** 고정 흐름 한 줄 지금 값(설정이 없으면 기본값 — 빠지는 계좌 = 따라감 · 들어가는 계좌 = 분류 기본) */
  const flowNow = (f: AssetCashFlowViewV2): AssetCashFlowEdit => {
    const item = f.item?.key ?? f.setting!.item;
    if (!f.setting) return { item, day: null, from: ASSET_CASH_FROM_SALARY, to: assetCashDefaultTo(item.category) };
    return { item, day: f.setting.day, from: f.fromSalary ? ASSET_CASH_FROM_SALARY : f.setting.from, to: f.setting.to };
  };
  const saveFlow = (f: AssetCashFlowViewV2, id: string, change: Partial<AssetCashFlowEdit>) => void save('flows', id, { flowEdit: { ...flowNow(f), ...change } });

  // 직접 입출금(v2.72.0) — 입금은 「밖에서 →」 · 출금은 「→ 밖으로」
  const pathOf = (m: AssetCashMoveRecordAll) => {
    const from = m.from ? full(m.from) : m.kind === 'salary' ? '월급' : m.kind === 'sell' ? '매도' : m.kind === 'deposit' ? '밖에서' : '—';
    const to = m.to ? full(m.to) : m.kind === 'buy' ? '매수' : m.kind === 'withdraw' ? '밖으로' : '쓴 돈(밖으로)';
    return `${from} → ${to}`;
  };
  /** 「무엇」 — 종류 + 사유 · 종목 · 메모(월급 · 메모 없는 직접 입출금은 종류만) */
  const whatOf = (m: AssetCashMoveRecordAll) => `${assetCashKindLabel(m.kind)}${m.kind === 'salary' || !m.label ? '' : ` · ${m.label}`}`;
  const undo = (m: AssetCashMoveRecordAll) =>
    modal.confirm({
      title: '되돌리기',
      message: `「${whatOf(m)}」 ${formatAssetWon(m.amount)} 반영을 되돌립니다. 지금 시트 숫자에서 ${[m.from ? `「${full(m.from)}」 에 다시 더하고` : null, m.to ? `「${full(m.to)}」 에서 뺍니다` : null].filter(Boolean).join(' ').replace(/더하고$/, '더합니다')}.`,
      confirmText: '되돌리기',
      onConfirm: () => void send('moves', `undo-${m.id}`, '/api/asset/cash/undo', 'POST', { id: m.id }),
    });

  const reflectCount = v.flows.filter((f) => f.item?.reflect && f.item.amount != null && f.item.amount > 0).length;

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
            {s.enabled ? `${s.enabledDay ?? v.today}부터 반영합니다.` : '예수금 · 은행 잔액을 시트에서 먼저 맞추고, 아래 미리 보기를 확인한 뒤 켜 주세요.'}
          </span>
        </div>
        {!v.writeEnabled && <p className="text-caption text-text-muted keep-all">이 서버에서는 시트 쓰기가 꺼져 있어 반영하지 않습니다.</p>}
      </Block>

      {/* 월급 카드(맨 위 · 시트처럼) → 그 아래로 퍼지는 고정 흐름 */}
      <section className="space-y-0" aria-label="월급과 고정 흐름">
        <Panel className="space-y-2 border border-border/60" data-testid="asset-cash-salary">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
              월급
              <span className="inline-flex w-4 justify-center">{busy === 'salary' && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
            </h4>
            <span className="text-sm font-semibold text-text-primary tabular-nums" data-testid="asset-cash-salary-amount">
              {v.salary.amount != null ? formatAssetWon(v.salary.amount) : '—'}
            </span>
            <span className="text-caption text-text-muted keep-all" data-testid="asset-cash-salary-source">
              「월 고정지출」 탭 「현재 월 급여」 에서 읽음
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-text-primary">
            <ArrowRight {...ICON_SM} className="shrink-0 text-text-muted" aria-label="들어가는 계좌" />
            <AssetCashAccountPicker
              label="월급 받는 계좌"
              className="w-48"
              value={valueOf(s.salary.to)}
              groups={groups}
              idOf={rowId}
              extras={[{ value: NONE, label: '정하지 않음' }]}
              lost={lostOf(s.salary.to)}
              disabled={busy != null}
              onPick={(id) => void save('salary', 'salary', { salary: { to: id === NONE ? null : keyOf(id) } })}
            />
            <span className="text-text-muted">·</span>
            <span className="text-text-secondary">매달</span>
            <Select size="sm" className="w-20" aria-label="월급 날짜" value={s.salary.day} disabled={busy != null} onChange={(e) => void save('salary', 'salary', { salary: { day: Number(e.target.value) } })}>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </Select>
            <span className="text-text-secondary">· 휴일이면</span>
            <Segmented<AssetCashShift>
              size="sm"
              label="월급 휴일이면"
              options={SHIFT_OPTIONS.map((o) => ({ ...o, disabled: busy != null }))}
              value={s.salary.shift}
              onChange={(x) => void save('salary', 'salary', { salary: { shift: x } })}
            />
            <span className="ml-auto text-caption text-text-muted tabular-nums" data-testid="asset-cash-salary-next">
              {v.salary.nextDay ? `다음 ${dayText(v.salary.nextDay)}` : s.enabled ? '—' : '꺼짐'}
            </span>
          </div>
          {v.salary.problem && <p className="text-caption text-danger keep-all">시트에서 받는 계좌를 찾지 못했어요 — 다시 골라 주세요.</p>}
          {errors.salary && (
            <p role="alert" className="text-xs text-danger keep-all">
              {errors.salary}
            </p>
          )}
        </Panel>

        {/* 퍼지는 모양 — 월급 카드 왼쪽에서 이어지는 선 */}
        <div className="ml-4 border-l-2 border-border/60 pt-3 pl-4" data-testid="asset-cash-flows">
          <Block
            heading="고정 흐름"
            desc={`월급 받는 계좌${salaryName ? `(${salaryName})` : ''}에서 매달 각 계좌로 나가는 돈입니다(「월 고정지출」 의 저축 및 투자 · 월세 · 고정 지출). 날짜 · 빠지는 계좌 · 들어가는 계좌를 모두 정한 것만 반영합니다.`}
            busy={busy?.startsWith('flow') ?? false}
            error={errors.flows ?? null}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs" data-testid="asset-cash-flow-all">
              <span className="text-text-secondary">모두 같은 날</span>
              <Select size="sm" className="w-20" aria-label="모두 같은 날" value={allDay} disabled={busy != null} onChange={(e) => setAllDay(Number(e.target.value))}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}일
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" busy={busy === 'flow-all'} disabled={(busy != null && busy !== 'flow-all') || reflectCount === 0 || !!v.fixedError} onClick={() => void save('flows', 'flow-all', { flowDayAll: allDay })}>
                모두 적용
              </Button>
              <span className="ml-3 text-text-secondary">휴일이면</span>
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
            {v.flows.length === 0 && <p className="text-caption text-text-muted">{v.fixedError ? '「월 고정지출」 을 읽으면 고정 흐름이 보입니다.' : '「월 고정지출」 표가 비어 있습니다.'}</p>}
            <div className="space-y-1">
              {v.flows.map((f, i) => {
                const catOf = (x: AssetCashFlowViewV2) => (x.item ? x.item.key.category : '「월 고정지출」 에서 찾지 못함');
                const cat = catOf(f);
                const prevCat = i > 0 ? catOf(v.flows[i - 1]) : undefined;
                return (
                  <Fragment key={`${cat}-${i}`}>
                    {cat !== prevCat && (
                      <div className="pt-2 text-caption font-medium text-text-secondary" data-testid="asset-cash-flow-category">
                        {cat}
                      </div>
                    )}
                    <FlowRow
                      f={f}
                      now={flowNow(f)}
                      groups={groups}
                      salaryName={salaryName}
                      salaryTo={s.salary.to}
                      lostOf={lostOf}
                      keyOf={keyOf}
                      busy={busy}
                      onSave={(change) => saveFlow(f, `flow-${i}`, change)}
                      onClear={() => void save('flows', `flow-${i}`, { flowEdit: { item: f.setting!.item, day: null, from: null, to: null } })}
                    />
                  </Fragment>
                );
              })}
            </div>
          </Block>
        </div>
      </section>

      <Block
        heading="다음 한 달 미리 보기"
        desc={`${dayText(v.preview.from)} ~ ${dayText(v.preview.until)} — ${v.preview.enabled ? '이렇게 반영됩니다.' : '지금은 꺼져 있어요. 켜면 이렇게 반영됩니다.'} 실제 반영과 같은 계산입니다(시트는 바꾸지 않습니다).`}
        busy={false}
        error={null}
      >
        <PreviewTable items={v.preview.items} />
      </Block>

      <Block heading="예수금 계좌 짝" desc="매수 · 매도를 적을 때 이 계좌 금액도 함께 바뀝니다(매수하면 빠지고 매도하면 들어갑니다)." busy={busy?.startsWith('pair-') ?? false} error={errors.pairs ?? null}>
        <Panel pad="none" className="py-1">
          <ul data-testid="asset-cash-pairs">
            {v.sections.map((sec, i) => {
              const pair = s.depositPairs[sec.key] ?? null;
              return (
                <li key={sec.key} className={`flex items-center gap-2 px-4 text-xs ${LIST_TABLE_ROW} ${i > 0 ? 'border-t border-border/30' : ''}`} data-testid="asset-cash-pair-row">
                  <span className="w-56 min-w-0 shrink-0 truncate text-text-primary" data-tip-clip={sec.name}>
                    {sec.name}
                  </span>
                  <ArrowRight {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
                  <AssetCashAccountPicker
                    label={`${sec.key} 예수금 계좌`}
                    className="w-72"
                    value={valueOf(pair)}
                    groups={groups}
                    idOf={rowId}
                    extras={[{ value: NONE, label: '없음(예수금은 바꾸지 않음)', shown: '없음' }]}
                    lost={lostOf(pair)}
                    disabled={busy != null}
                    onPick={(id) => void save('pairs', `pair-${sec.key}`, { depositPair: { section: sec.key, key: id === NONE ? null : keyOf(id) } })}
                  />
                </li>
              );
            })}
          </ul>
        </Panel>
      </Block>

      <Block heading="은행 묶음" desc="「현금」 탭 계좌 이름의 괄호 앞 글자가 은행, 괄호 안이 상품입니다(괄호가 없으면 입출금). 시트에 계좌를 넣으면 새 은행이 저절로 생깁니다." busy={busy?.startsWith('bank') ?? false} error={errors.banks ?? null}>
        <DisclosureButton open={banksOpen} onToggle={() => setBanksOpen((o) => !o)} label="은행 묶음 고치기" controls="as-asset-bankfix" />
        {banksOpen && <BankFix id="as-asset-bankfix" names={names} fix={v.bankFix} groups={groups} busy={busy} onSave={saveBank} />}
      </Block>

      <Block heading="반영 기록" desc="최근 50개 · 최신이 위입니다. 「반영」 은 되돌릴 수 있습니다(지금 시트 숫자에서 반대로)." busy={busy?.startsWith('undo-') ?? false} error={errors.moves ?? null}>
        <Panel pad="none" className="pb-1">
          <table className="w-full table-fixed text-left text-xs" data-testid="asset-cash-moves">
            <colgroup>
              <col className="w-28" />
              <col className="w-40" />
              <col />
              <col className="w-28" />
              <col className="w-40" />
              <col className="w-20" />
            </colgroup>
            <thead className="text-caption text-text-muted">
              <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                <th className="pl-4 font-normal">날짜</th>
                <th className="font-normal">무엇</th>
                <th className="font-normal">어디서 → 어디로</th>
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
                const what = whatOf(m);
                const path = pathOf(m);
                const status = ASSET_CASH_STATUS_LABEL[m.status];
                const reason = m.reason ? ASSET_CASH_REASON_TEXT[m.reason] : null;
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
                        <Button size="sm" variant="ghost" busy={busy === `undo-${m.id}`} disabled={busy != null || (!s.enabled && !isAssetCashManualKind(m.kind)) || !v.writeEnabled} onClick={() => undo(m)}>
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

/** 고정 흐름 한 칸 — 사유(작은 글) 위 · 「[빠지는 계좌] → [들어가는 계좌]  ₩  [날]일」 한 줄 */
function FlowRow({
  f,
  now,
  groups,
  salaryName,
  salaryTo,
  lostOf,
  keyOf,
  busy,
  onSave,
  onClear,
}: {
  f: AssetCashFlowViewV2;
  now: AssetCashFlowEdit;
  groups: AssetCashBankGroup<AssetCashRowOption>[];
  salaryName: string | null;
  salaryTo: AssetCashKey | null;
  lostOf: (k: AssetCashKey | null) => string | null;
  keyOf: (id: string) => AssetCashKey | null;
  busy: string | null;
  onSave: (change: Partial<AssetCashFlowEdit>) => void;
  onClear: () => void;
}) {
  const label = f.item?.label ?? (f.setting ? (f.setting.item.nth > 1 ? `${f.setting.item.reason} #${f.setting.item.nth}` : f.setting.item.reason) : '');
  const amount = f.item?.amount ?? null;
  const problem = f.problem ? ASSET_CASH_REASON_TEXT[f.problem] : null;
  const reflect = f.item?.reflect ?? true;
  const zero = f.item != null && !(amount != null && amount > 0);
  const changed = f.setting != null && !f.fromSalary && f.setting.from != null;
  const fromKey = now.from === ASSET_CASH_FROM_SALARY ? salaryTo : now.from;
  const same = fromKey != null && now.to != null && now.to !== OUT && sameKey(fromKey, now.to);
  const off = busy != null || !f.item;

  const head = (
    <div className="flex min-w-0 items-center gap-2 text-caption">
      <span className={`min-w-0 truncate ${problem ? 'text-danger' : reflect && !zero ? 'text-text-secondary' : 'text-text-muted'}`} data-tip-clip={label}>
        {label}
      </span>
      {changed && (
        <span className="shrink-0 font-semibold text-text-primary" data-testid="asset-cash-flow-changed" data-tip="빠지는 계좌를 월급 받는 계좌에서 바꿨어요">
          바꿈
        </span>
      )}
      {problem && <span className="shrink-0 text-danger">{problem}</span>}
      {same && <span className="shrink-0 text-warning">빠지는 계좌와 들어가는 계좌가 같아 반영하지 않아요</span>}
      <span className="ml-auto shrink-0 text-text-muted tabular-nums">{f.nextDay ? `다음 ${dayText(f.nextDay)}` : ''}</span>
    </div>
  );

  if (!f.item) {
    return (
      <div className="rounded-lg bg-bg-tertiary/30 px-3 py-1.5" data-testid="asset-cash-flow-row" data-flow-reflect="missing">
        {head}
        <div className="flex justify-end">
          <Button size="sm" variant="danger-text" disabled={busy != null} onClick={onClear}>
            설정 지우기
          </Button>
        </div>
      </div>
    );
  }
  if (!reflect || zero) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-text-muted" data-testid="asset-cash-flow-row" data-flow-reflect={reflect ? 'zero' : 'no'}>
        <span className="min-w-0 flex-1 truncate" data-tip-clip={label}>
          {label}
        </span>
        {/* 금액 끝 = 다른 줄 금액 칸 끝 · 「반영 안 함」 = 날짜 칸 자리 */}
        <span className="w-28 shrink-0 text-right tabular-nums">{amount != null ? formatAssetWon(amount) : '₩0'}</span>
        <span className="w-20 shrink-0 pl-2">반영 안 함</span>
      </div>
    );
  }
  const fromValue = now.from === ASSET_CASH_FROM_SALARY ? ASSET_CASH_FROM_SALARY : now.from ? keyId(now.from) : NONE;
  const toValue = now.to === OUT ? OUT : now.to ? keyId(now.to) : NONE;
  const fromExtras: PickerExtra[] = [
    { value: ASSET_CASH_FROM_SALARY, label: `월급 받는 계좌${salaryName ? ` (${salaryName})` : ''}`, shown: salaryName ?? '월급 받는 계좌' },
    { value: NONE, label: '정하지 않음' },
  ];
  const toExtras: PickerExtra[] = [
    { value: OUT, label: '쓴 돈(밖으로)' },
    { value: NONE, label: '정하지 않음' },
  ];
  return (
    <div className="rounded-lg px-3 py-1.5 hover:bg-bg-tertiary/30" data-testid="asset-cash-flow-row" data-flow-reflect="yes">
      {head}
      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-text-primary">
        <AssetCashAccountPicker
          label={`${label} 빠지는 계좌`}
          className={`w-48 ${changed ? 'font-semibold' : ''}`}
          value={fromValue}
          groups={groups}
          idOf={rowId}
          extras={fromExtras}
          lost={now.from && now.from !== ASSET_CASH_FROM_SALARY ? lostOf(now.from) : null}
          disabled={off}
          onPick={(x) => onSave({ from: x === ASSET_CASH_FROM_SALARY ? ASSET_CASH_FROM_SALARY : x === NONE ? null : keyOf(x) })}
        />
        <ArrowRight {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
        <AssetCashAccountPicker
          label={`${label} 들어가는 계좌`}
          className="w-52"
          value={toValue}
          groups={groups}
          idOf={rowId}
          extras={toExtras}
          lost={now.to && now.to !== OUT ? lostOf(now.to) : null}
          disabled={off}
          onPick={(x) => onSave({ to: x === OUT ? OUT : x === NONE ? null : keyOf(x) })}
        />
        <span className="ml-auto w-28 shrink-0 text-right tabular-nums">{amount != null ? formatAssetWon(amount) : '—'}</span>
        <Select
          size="sm"
          className="w-20 shrink-0"
          aria-label={`${label} 날짜`}
          value={now.day ?? ''}
          disabled={off}
          onChange={(e) => onSave({ day: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">—</option>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {d}일
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

/** 다음 한 달 미리 보기 표 — 날짜순 · 상태 색 · 반영 안 함은 날짜 없이 아래 */
function PreviewTable({ items }: { items: AssetCashPreviewItem[] }) {
  const any = items.some((i) => i.status !== 'not');
  return (
    <Panel pad="none" className="pb-1">
      {!any && (
        <p className="px-4 pt-2 text-xs text-text-secondary keep-all" data-testid="asset-cash-preview-empty">
          반영할 것이 없어요 — 날짜 · 계좌를 정해 주세요.
        </p>
      )}
      <table className="w-full table-fixed text-left text-xs" data-testid="asset-cash-preview">
        <colgroup>
          <col className="w-24" />
          <col className="w-32" />
          <col />
          <col className="w-28" />
          <col className="w-44" />
        </colgroup>
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className="pl-4 font-normal">날짜</th>
            <th className="font-normal">무엇</th>
            <th className="font-normal">어디서 → 어디로</th>
            <th className={`${TABLE_NUM_GAP} text-right font-normal`}>금액</th>
            <th className="pr-4 pl-4 font-normal">상태</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const path = it.day == null ? '—' : it.kind === 'salary' ? `월급 → ${it.to ?? '—'}` : `${it.from ?? '—'} → ${it.out ? '쓴 돈(밖으로)' : (it.to ?? '—')}`;
            const status = it.status === 'planned' ? '반영 예정' : it.status === 'recorded' ? `이미 기록 있음 · ${ASSET_CASH_STATUS_LABEL[it.record ?? 'applied']}` : '반영 안 함';
            const why = it.why ? ASSET_CASH_PREVIEW_WHY_LABEL[it.why] : null;
            const tone = it.status === 'planned' ? 'text-text-primary' : it.status === 'recorded' ? 'text-text-secondary' : 'text-text-muted';
            const statusTone = it.status === 'planned' ? 'text-accent' : it.why === 'missing-row' || it.why === 'missing-item' ? 'text-danger' : tone;
            return (
              <tr key={`${it.day}-${it.label}-${i}`} className={`border-t border-border/30 ${LIST_TABLE_ROW} ${tone}`} data-testid="asset-cash-preview-row" data-preview-status={it.status}>
                <td className="pl-4 tabular-nums">{it.day ? dayText(it.day) : '—'}</td>
                <td className="max-w-0 pr-3">
                  <span className="block truncate" data-tip-clip={it.label}>
                    {it.label}
                  </span>
                </td>
                <td className="max-w-0">
                  <span className="block truncate" data-tip-clip={path}>
                    {path}
                  </span>
                </td>
                <td className={`${TABLE_NUM_GAP} text-right tabular-nums`}>{it.amount != null ? formatAssetWon(it.amount) : '—'}</td>
                <td className="max-w-0 pr-4 pl-4">
                  <span className={`block truncate ${statusTone}`}>{status}</span>
                  {/* 까닭은 줄여 쓰지 않는다(말줄임이면 켜기 전에 왜 안 되는지 안 보임) — 칸 안에서 줄바꿈 */}
                  {why && <span className="block text-caption keep-all">{why}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/** 은행 묶음 고치기 — 계좌마다 은행 · 은행 이름 바꾸기(앱에만 저장 · 칸을 떠나거나 Enter 에 저장 · 비우면 처음대로) */
function BankFix({
  id,
  names,
  fix,
  groups,
  busy,
  onSave,
}: {
  id: string;
  names: string[];
  fix: AssetCashViewV2['bankFix'];
  groups: AssetCashBankGroup<AssetCashRowOption>[];
  busy: string | null;
  onSave: (busyId: string, patch: AssetCashBankPatch) => Promise<boolean>;
}) {
  const raws = [...new Set(names.map((n) => cashBankName(n).raw))];
  const rows = [...new Set(names.map((n) => n.trim().replace(/\s+/g, ' ')))];
  const bankOf = (name: string) => groups.find((g) => g.items.some((it) => it.row.key.name === name))?.bank ?? cashBankName(name, fix).bank;
  return (
    <div id={id} className="space-y-3" data-testid="asset-cash-banks">
      <p className="text-caption text-text-muted keep-all">여기서 고친 것은 앱에만 저장합니다(시트는 그대로). 칸을 비우면 처음대로 돌아갑니다.</p>
      <Panel pad="none" className="py-1">
        <div className="px-4 pt-1 text-caption text-text-secondary">은행 이름 바꾸기</div>
        <ul>
          {raws.map((raw) => (
            <li key={raw} className={`flex items-center gap-2 px-4 text-xs ${LIST_TABLE_ROW}`}>
              <span className="w-56 min-w-0 shrink-0 truncate text-text-primary" data-tip-clip={raw}>
                {raw}
              </span>
              <ArrowRight {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
              <NameInput label={`${raw} 은행 이름`} value={fix.renames[raw] ?? raw} disabled={busy != null} onCommit={(t) => void onSave(`bank-rename-${raw}`, { rename: { from: raw, to: t === '' || t === raw ? null : t } })} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel pad="none" className="py-1">
        <div className="px-4 pt-1 text-caption text-text-secondary">계좌를 다른 은행으로</div>
        <ul>
          {rows.map((name) => (
            <li key={name} className={`flex items-center gap-2 px-4 text-xs ${LIST_TABLE_ROW}`}>
              <span className="w-56 min-w-0 shrink-0 truncate text-text-primary" data-tip-clip={name}>
                {name}
              </span>
              <ArrowRight {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
              <NameInput label={`${name} 은행`} value={bankOf(name)} disabled={busy != null} onCommit={(t) => void onSave(`bank-row`, { row: { name, bank: t === '' ? null : t } })} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/** 이름 칸 — 칸을 떠나거나 Enter 에 바뀐 때만 알림 */
function NameInput({ label, value, disabled, onCommit }: { label: string; value: string; disabled: boolean; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const t = text.trim().replace(/\s+/g, ' ');
    if (t !== value) onCommit(t);
  };
  return (
    <Input
      size="sm"
      className="w-72 shrink-0 text-ellipsis"
      aria-label={label}
      value={text}
      maxLength={20}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
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
