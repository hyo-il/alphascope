import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Checkbox, ICON_SM, Segmented, Select, SideNavDialog } from '../ui';
import { LIST_ROW } from '../ui/tokens';
import {
  ASSET_COLOR_IDS,
  ASSET_COLOR_LABEL,
  COLORED_GROUP_KEYS,
  LOCK_MINUTES_CHOICES,
  REBALANCE_BAND_MAX,
  REBALANCE_BAND_MIN,
  type AssetClassColors,
  type AssetColorId,
  type AssetSettings,
  type AssetSummary,
  type AssetTargetRatio,
  type ColoredGroupKey,
} from '../../types/asset';
import SymbolTable from '../common/SymbolTable';
import { swatchBg } from './assetColors';
import AssetAccountTable from './AssetAccountTable';
import AssetTargetRatioForm from './AssetTargetRatioForm';
import AssetPriceSheetSection from './AssetPriceSheetSection';
import AssetCashSettings from './AssetCashSettings';

/**
 * 「자산 관리 설정」 창(v2.62.1 · v2.65.2 왼쪽 메뉴 — 공용 `SideNavDialog`) — 오른쪽 위 「설정」 버튼이 연다. 메뉴 여덟(이 순서):
 * 1. 목표 비율 — 정수 % 여섯 칸 · 두 합이 100 일 때만 [저장] · **시트에 쓴다**(`AssetTargetRatioForm`) + 비율 조정 범위(±1~20 %p 고르기 · 바로 저장 — 앱 DB).
 *    「비율 조정」 [목표 비율 바꾸기] 는 이 메뉴로 연다.
 * 2. 코어 · 위성 — 위성으로 선택한 종목: 매매 설정 대상 종목과 같은 부품(`common/SymbolTable`): 표(종목 · 코드 · 있는 계좌) + [종목 추가] + 줄마다 삭제.
 *    [종목 추가] 창 = 시트의 분류 「주식」 종목 중 아직 위성이 아닌 것만(`source` — 관심 목록 · 검색 없음). 표의 종목 = 위성 · 나머지 주식 = 코어.
 *    분류가 주식이 아니게 된 위성 종목은 흐리게 + 「분류가 주식이 아니라 계산에서 빠짐」(삭제할 수 있음).
 * 3. 연금 — 연금으로 볼 계좌: 표(계좌 이름 「( 날짜 )」 그대로) + [계좌 추가](창 = 시트 계좌 중 아직 없는 것) + 줄마다 삭제(`AssetAccountTable`)
 * 3-1. 이번 달 구매(v2.78.0) — 계좌마다 「매달 사는 계좌」 체크(처음 = 모두 켬 · 바로 저장 — 앱 DB `PUT /api/asset/purchase/monthly-accounts`). 끈 계좌는 구매일 팝업 · 「이번 달 구매」 목록에 나오지 않는다.
 *      아래 「살 종목 잇기」(v2.79.0) — 「적립식 투자」 탭의 줄 이름(0% 아닌 줄)마다 그 계좌 **보유 종목** 고르기(`Select` · 바로 저장 — 앱 DB `PUT /api/asset/purchase/plan-link` ·
 *      저장 중 그 칸 로딩 · 실패면 되돌리고 이유 한 줄). 이번 달 구매 구역의 「종목을 이어 주세요」 글 단추가 이 메뉴의 그 계좌 자리로 연다(`focus` · `focusSection`).
 * 4. 자산 분류 색 — 분류마다 팔레트 색 동그라미(원형 · 분류별 표가 같은 색)
 * 5. 시트 가격(v2.65.0) — 「티커」 가격 · 환율을 토스로 바꾸기 · 되돌리기(확인 창 · **시트에 쓴다** — `AssetPriceSheetSection`)
 * 6. 현금 자동 반영(v2.71.0 · v2.71.1 쉽게) — 「현금」 탭 은행 계좌 금액을 앱이 바꾸는 설정 · 반영 기록 · 되돌리기(`AssetCashSettings` — 열 때 따로 받는다)
 * 7. 잠금(v2.65.4) — 「쓰지 않으면 잠그는 시간」 [10분 | 30분 | 60분 | 끄기](`Segmented` · 바로 저장 — 앱 DB `asset.lockMinutes`)
 * 처음 열면 「목표 비율」 · 마지막에 본 메뉴는 이 기기에 기억(`alphascope.asset.settingsMenu` · 읽기 실패면 목표 비율).
 * 추가 · 삭제 · 색 바꿈 · 고르기마다 바로 저장(그 칸만 로딩 + 메뉴 이름 옆 로딩 · 저장 중에는 그 칸을 다시 바꾸지 않음) — 실패하면 원래 값으로 되돌리고 그 칸에 이유 한 줄.
 * 저장 뒤 화면을 다시 받아 원형 · 표에 반영.
 */

/** 메뉴 — 순서가 곧 화면 순서 */
const MENUS = ['target', 'core', 'pension', 'purchase', 'colors', 'price', 'cash', 'lock'] as const;
type Menu = (typeof MENUS)[number];
const MENU_KEY = 'alphascope.asset.settingsMenu';
function readMenu(): Menu {
  try {
    const v = localStorage.getItem(MENU_KEY);
    return (MENUS as readonly string[]).includes(v ?? '') ? (v as Menu) : 'target';
  } catch {
    return 'target';
  }
}
function saveMenu(m: Menu) {
  try {
    localStorage.setItem(MENU_KEY, m);
  } catch {
    /* 기억하지 못해도 창은 그대로 */
  }
}

type Field = keyof AssetSettings;

const GROUP_LABEL: Record<ColoredGroupKey, string> = { cash: '현금', bond: '채권', gold: '금', stock: '주식', retirement: '퇴직 연금' };

/** 잠금 시간 고르기 — 10분 | 30분 | 60분 | 끄기(0) */
const LOCK_OPTIONS = LOCK_MINUTES_CHOICES.map((m) => ({ value: m as number, label: m === 0 ? '끄기' : `${m}분` }));
const LOCK_OPTIONS_BUSY = LOCK_OPTIONS.map((o) => ({ ...o, disabled: true }));

/** 메뉴 안 구역 하나 — 제목이 메뉴 이름과 같으면 제목 · 설명은 메뉴 머리(오른쪽 위)가 보이고 여기서는 뺀다 */
function Block({ title, desc, busy, error, children }: { title?: string; desc?: string; busy: boolean; error: string | null; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      {title && (
        <h4 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
          {title}
          <span className="inline-flex w-4 justify-center">{busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
        </h4>
      )}
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

export default function AssetSettingsDialog({
  summary,
  onSave,
  onSaveTarget,
  onPriceSheet,
  onSaveMonthly,
  onLocked,
  onSavePlanLink,
  focus,
  focusSection,
  onClose,
}: {
  summary: AssetSummary;
  /** 고칠 칸만 저장 — 실패면 이유 문구 */
  onSave: (patch: Partial<AssetSettings>) => Promise<string | null>;
  /** 목표 비율 저장(시트에 씀) */
  onSaveTarget: (ratio: Record<keyof AssetTargetRatio, number>) => Promise<{ ok: true; ratio: AssetTargetRatio } | { ok: false; error: string }>;
  /** 시트 가격 바꾸기 · 되돌리기 — 실패면 이유 문구 */
  onPriceSheet: (kind: 'convert' | 'restore') => Promise<string | null>;
  /** 매달 사는 계좌 켬 · 끔(v2.78.0 — 계좌 하나) — 실패면 이유 문구 */
  onSaveMonthly: (section: string, monthly: boolean) => Promise<string | null>;
  /** 줄 이름 → 종목 잇기(v2.79.0 — 줄 하나 · null = 끊기) — 실패면 이유 문구 */
  onSavePlanLink: (section: string, name: string, symbol: string | null) => Promise<string | null>;
  /** 「현금 자동 반영」 요청이 잠김(403)을 받으면 */
  onLocked: () => void;
  /** 「비율 조정」 [목표 비율 바꾸기] 로 열면 목표 비율 칸으로 · 「종목을 이어 주세요」 로 열면 이번 달 구매 메뉴의 그 계좌(`focusSection`)로 */
  focus?: 'targetRatio' | 'purchase';
  focusSection?: string;
  onClose: () => void;
}) {
  // 바꾼 값을 바로 보이고(저장 중에도), 실패하면 원래 값으로 되돌린다
  const [shown, setShown] = useState<AssetSettings>(summary.settings);
  const [busy, setBusy] = useState<Partial<Record<Field, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [priceBusy, setPriceBusy] = useState(false);
  /** 목표 비율 폼(저장 단추가 따로) · 현금 자동 반영의 상태 — 창의 닫을 때 묻기 · 막는 로딩(공통 3-3 · 7-2) */
  const [targetState, setTargetState] = useState({ dirty: false, busy: false });
  const [cashBusy, setCashBusy] = useState(false);
  /** 매달 사는 계좌(v2.78.0) — 바꾼 값을 바로 보이고 실패하면 되돌린다 · 저장 중인 계좌 · 이유 한 줄 */
  const [monthly, setMonthly] = useState<Record<string, boolean>>(() => Object.fromEntries(summary.monthlyBuy.accounts.map((a) => [a.section, a.buysMonthly])));
  const [monthlyBusy, setMonthlyBusy] = useState<string | null>(null);
  const [monthlyError, setMonthlyError] = useState<string | null>(null);
  const saveMonthly = async (section: string, on: boolean) => {
    if (monthlyBusy != null) return;
    setMonthly((m) => ({ ...m, [section]: on }));
    setMonthlyBusy(section);
    setMonthlyError(null);
    const failed = await onSaveMonthly(section, on);
    setMonthlyBusy(null);
    if (failed) {
      setMonthly((m) => ({ ...m, [section]: !on }));
      setMonthlyError(`저장하지 못했습니다 — ${failed}`);
    }
  };

  /** 살 종목 잇기(v2.79.0) — 줄마다 지금 고른 종목(바로 보이고 실패면 되돌림) · 저장 중인 줄 · 이유 한 줄 */
  const linkKey = (section: string, name: string) => `${section}\u0000${name}`;
  const [links, setLinks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(summary.monthlyBuy.accounts.flatMap((a) => (a.plan?.links ?? []).map((l) => [linkKey(a.section, l.name), l.symbol]))),
  );
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const saveLink = async (section: string, name: string, symbol: string | null) => {
    if (linkBusy != null) return;
    const key = linkKey(section, name);
    const before = links[key] ?? null;
    setLinks((m) => ({ ...m, [key]: symbol }));
    setLinkBusy(key);
    setLinkError(null);
    const failed = await onSavePlanLink(section, name, symbol);
    setLinkBusy(null);
    if (failed) {
      setLinks((m) => ({ ...m, [key]: before }));
      setLinkError(`저장하지 못했습니다 — ${failed}`);
    }
  };
  const planAccounts = summary.monthlyBuy.accounts.filter((a) => a.plan != null);

  const save = async <K extends Field>(field: K, value: AssetSettings[K]) => {
    if (busy[field]) return; // 저장 중에 또 바꾸면 앞의 저장과 겹친다 — 끝난 뒤 다시
    const before = shown[field];
    setShown((s) => ({ ...s, [field]: value }));
    setBusy((b) => ({ ...b, [field]: true }));
    setErrors((e) => ({ ...e, [field]: null }));
    const failed = await onSave({ [field]: value } as Partial<AssetSettings>);
    setBusy((b) => ({ ...b, [field]: false }));
    if (failed) {
      setShown((s) => ({ ...s, [field]: before }));
      setErrors((e) => ({ ...e, [field]: `저장하지 못했습니다 — ${failed}` }));
    }
  };

  const accountName = (key: string) => summary.accounts.find((a) => a.key === key)?.name ?? key;
  const choiceOf = (symbol: string) => summary.stockChoices.find((c) => c.symbol === symbol);
  /** 위성 줄 안내 — 분류가 주식이 아니게 됨 · 시트에서 빠짐(둘 다 계산에서 빠진다) */
  const satelliteNote = (symbol: string) => {
    const c = choiceOf(symbol);
    if (!c) return '시트에 없어 계산에서 빠짐';
    return c.isStock ? null : '분류가 주식이 아니라 계산에서 빠짐';
  };

  const [menu, setMenu] = useState<Menu>(() => (focus === 'targetRatio' ? 'target' : focus === 'purchase' ? 'purchase' : readMenu()));
  useEffect(() => saveMenu(menu), [menu]);
  // 「종목을 이어 주세요」 로 열면 그 계좌 잇기 표로
  useEffect(() => {
    if (focus !== 'purchase' || !focusSection) return;
    const el = document.querySelector(`[data-plan-links="${CSS.escape(focusSection)}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, [focus, focusSection]);

  const pension = (
    <Block title="연금으로 볼 계좌" desc="「연금 포함」 을 끄면 표의 계좌와 퇴직 연금이 총 자산에서 빠집니다." busy={!!busy.pensionSections} error={errors.pensionSections ?? null}>
      <div data-setting="pension">
        <AssetAccountTable
          accounts={summary.accounts}
          selected={shown.pensionSections}
          onChange={(next) => void save('pensionSections', next)}
          dialogTitle="연금으로 볼 계좌 추가"
          emptyText="연금으로 볼 계좌가 없습니다 — 「연금 포함」 은 퇴직 연금만 더하고 뺍니다."
        />
      </div>
    </Block>
  );

  const satellite = (
    <Block title="위성으로 선택한 종목" desc="표의 종목 = 위성, 나머지 주식 = 코어. 같은 종목은 어느 계좌에 있든 같은 쪽입니다." busy={!!busy.satelliteSymbols} error={errors.satelliteSymbols ?? null}>
      <div data-setting="satellite">
        <SymbolTable
          selected={shown.satelliteSymbols}
          onChange={(next) => void save('satelliteSymbols', next)}
          dialogTitle="위성 종목 추가"
          emptyText="위성 종목이 없습니다. [종목 추가] 로 넣으세요 — 넣지 않은 주식은 모두 코어입니다."
          source={{
            title: '시트의 주식 종목',
            rows: summary.stockChoices
              .filter((c) => c.isStock && !shown.satelliteSymbols.includes(c.symbol))
              .map((c) => ({ symbol: c.symbol, name: c.name, note: c.sections.map(accountName).join(' · ') })),
            emptyText: '더 넣을 수 있는 주식 종목이 없습니다 — 「자산 현황」 에서 자산 분류를 「주식」 으로 고르면 여기에 보입니다.',
            nameOf: (s) => choiceOf(s)?.name ?? null,
          }}
          nameOf={(s) => choiceOf(s)?.name ?? null}
          rowNote={satelliteNote}
          columns={[
            { head: '코드', cell: (s) => s },
            { head: '있는 계좌', cell: (s) => <span className="text-caption">{(choiceOf(s)?.sections ?? []).map(accountName).join(' · ') || '—'}</span> },
          ]}
        />
      </div>
    </Block>
  );

  const colors = (
    <Block busy={!!busy.classColors} error={errors.classColors ?? null}>
      <div className="space-y-2" data-setting="colors">
        {COLORED_GROUP_KEYS.map((g) => (
          <ColorRow
            key={g}
            label={GROUP_LABEL[g]}
            value={shown.classColors[g]}
            disabled={!!busy.classColors}
            onPick={(id) => void save('classColors', { ...shown.classColors, [g]: id } as AssetClassColors)}
          />
        ))}
      </div>
    </Block>
  );

  const target = (
    <div className="space-y-6">
      <Block title="목표 비율" desc="정수 %. 두 합이 각각 100일 때 저장할 수 있고, 저장하면 시트에도 씁니다." busy={false} error={null}>
        <AssetTargetRatioForm initial={summary.targetRatio} writeEnabled={summary.writeEnabled} onSave={onSaveTarget} autoFocus={focus === 'targetRatio'} onState={setTargetState} />
      </Block>

      <Block title="비율 조정 범위" desc="「비율 조정」 에서 목표와의 차이가 이 범위 안이면 「괜찮음」 입니다." busy={!!busy.rebalanceBand} error={errors.rebalanceBand ?? null}>
        <div className="flex items-center gap-2" data-setting="band">
          <Select size="sm" className="w-24" aria-label="비율 조정 범위" value={shown.rebalanceBand} disabled={!!busy.rebalanceBand} onChange={(e) => void save('rebalanceBand', Number(e.target.value))}>
            {Array.from({ length: REBALANCE_BAND_MAX - REBALANCE_BAND_MIN + 1 }, (_, i) => REBALANCE_BAND_MIN + i).map((n) => (
              <option key={n} value={n}>
                ±{n}%p
              </option>
            ))}
          </Select>
        </div>
      </Block>
    </div>
  );

  const lock = (
    <Block title="쓰지 않으면 잠그는 시간" busy={!!busy.lockMinutes} error={errors.lockMinutes ?? null}>
      <div data-setting="lock">
        <Segmented<number>
          size="sm"
          label="쓰지 않으면 잠그는 시간"
          options={busy.lockMinutes ? LOCK_OPTIONS_BUSY : LOCK_OPTIONS}
          value={shown.lockMinutes}
          onChange={(m) => void save('lockMinutes', m)}
        />
      </div>
    </Block>
  );

  const purchase = (
    <div className="space-y-5">
    <Block busy={monthlyBusy != null} error={monthlyError}>
      <ul className="space-y-1" data-setting="purchase-monthly">
        {summary.monthlyBuy.accounts.map((a) => (
          <li key={a.section} className={`flex items-center gap-3 ${LIST_ROW}`} data-testid="purchase-monthly-row" data-section={a.section}>
            <span className="min-w-0 flex-1 truncate text-xs text-text-primary" data-tip={a.name} data-tip-clip>
              {a.name}
            </span>
            <label className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text-primary">
              <Checkbox checked={monthly[a.section] ?? true} disabled={monthlyBusy != null} onChange={(e) => void saveMonthly(a.section, e.target.checked)} data-testid="purchase-monthly-check" />
              매달 사는 계좌
              <span className="inline-flex w-4 justify-center">{monthlyBusy === a.section && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
            </label>
          </li>
        ))}
      </ul>
    </Block>
    <Block busy={linkBusy != null} error={linkError}>
      {/* 제목 · 설명은 직접 그린다(부품 `title` 속성을 늘리지 않음 — 툴팁 목록 문서 「바꾸지 않음」 97곳 그대로) */}
      <h4 className="text-xs font-semibold text-text-primary">살 종목 잇기</h4>
      <p className="text-caption text-text-muted keep-all">시트 「적립식 투자」 탭의 줄 이름을 그 계좌의 보유 종목과 한 번 이어 둡니다. 시트는 바꾸지 않습니다.</p>
      <div className="space-y-3" data-setting="purchase-links">
        {summary.monthlyBuy.planError && (
          <p className="text-xs text-warning keep-all" role="status" data-testid="plan-links-error">
            {summary.monthlyBuy.planError.message} — 잇기 표를 보이지 못했습니다.
          </p>
        )}
        {!summary.monthlyBuy.planError && planAccounts.length === 0 && (
          <p className="text-xs text-text-muted keep-all" data-testid="plan-links-empty">
            「적립식 투자」 탭에 계좌와 맞는 묶음이 없습니다.
          </p>
        )}
        {planAccounts.map((a) => {
          const plan = a.plan!;
          return (
            <section key={a.section} className="space-y-1" data-plan-links={a.section} data-testid="plan-links">
              <h5 className="truncate text-xs font-semibold text-text-secondary" data-tip={a.name} data-tip-clip>
                {a.name}
              </h5>
              {plan.links.length === 0 ? (
                <p className="text-xs text-text-muted keep-all">이을 줄이 없습니다(0% 줄은 빠집니다).</p>
              ) : (
                <ul className="space-y-1">
                  {plan.links.map((l) => {
                    const key = linkKey(a.section, l.name);
                    const value = links[key] ?? '';
                    return (
                      <li key={l.name} className={`flex items-center gap-3 ${LIST_ROW}`} data-testid="plan-link-row" data-name={l.name}>
                        <span className="min-w-0 flex-1 break-words text-xs text-text-primary keep-all">{l.name}</span>
                        <Select
                          size="sm"
                          className="w-48 shrink-0 phone:w-40"
                          aria-label={`${l.name} — 살 종목`}
                          value={value}
                          disabled={linkBusy != null}
                          onChange={(e) => void saveLink(a.section, l.name, e.target.value === '' ? null : e.target.value)}
                          data-testid="plan-link-select"
                        >
                          <option value="">이어 주세요</option>
                          {plan.choices.map((c) => (
                            <option key={c.symbol} value={c.symbol}>
                              {c.name} · {c.symbol}
                            </option>
                          ))}
                        </Select>
                        <span className="inline-flex w-4 shrink-0 justify-center">{linkBusy === key && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {plan.choices.length === 0 && <p className="text-caption text-text-muted keep-all">이 계좌에 코드가 있는 보유 종목이 없습니다 — 새 종목은 다음 차수에 다룹니다.</p>}
            </section>
          );
        })}
      </div>
    </Block>
    </div>
  );

  const price = (
    <Block busy={priceBusy} error={null}>
      <AssetPriceSheetSection status={summary.priceSheet} onAction={onPriceSheet} onBusy={setPriceBusy} />
    </Block>
  );

  return (
    <SideNavDialog
      title="자산 관리 설정"
      navLabel="자산 관리 설정 메뉴"
      value={menu}
      onChange={(id) => setMenu(id as Menu)}
      onClose={onClose}
      items={[
        { id: 'target', label: '목표 비율', desc: '자산 배분 · 주식 안 코어 · 위성의 목표와, 「비율 조정」 이 괜찮다고 보는 범위입니다.', busy: !!busy.rebalanceBand || targetState.busy, dirty: targetState.dirty, content: target },
        { id: 'core', label: '코어 · 위성', desc: '분류 「주식」 종목을 코어와 위성으로 나눕니다.', busy: !!busy.satelliteSymbols, content: satellite },
        { id: 'pension', label: '연금', desc: '「연금 포함」 을 켜고 끌 때 함께 더하고 빼는 계좌입니다.', busy: !!busy.pensionSections, content: pension },
        {
          id: 'purchase',
          label: '이번 달 구매',
          desc: '매달 사는 계좌만 구매일 팝업과 「이번 달 구매」 목록에 나옵니다. 끈 계좌는 묻지 않습니다.',
          busy: monthlyBusy != null || linkBusy != null,
          content: purchase,
        },
        { id: 'colors', label: '자산 분류 색', desc: '원형 차트와 분류별 표에 같은 색으로 보입니다. 미지정은 회색입니다.', busy: !!busy.classColors, content: colors },
        {
          id: 'price',
          label: '시트 가격',
          desc: '시트 「티커」 의 가격 · 환율을 어디서 받는지입니다. 토스로 바꾸면 장이 열린 동안 10초마다 바뀐 값만 시트에 씁니다.',
          busy: priceBusy,
          content: price,
        },
        {
          id: 'cash',
          label: '현금 자동 반영',
          desc: '시트 「현금」 탭 은행 계좌의 금액만 앱이 바꿉니다 — 매수 · 매도 때 예수금 · 매달 월급 · 고정 흐름. 어긋나면 시트에서 고치면 그 숫자에서 이어 갑니다.',
          busy: cashBusy,
          content: <AssetCashSettings onLocked={onLocked} onBusy={setCashBusy} />,
        },
        {
          id: 'lock',
          label: '잠금',
          desc: '마지막으로 자산 화면을 쓴 뒤 이 시간 동안 아무것도 하지 않으면 저절로 잠급니다. 가격이 저절로 바뀌는 것은 쓴 것으로 세지 않습니다.',
          busy: !!busy.lockMinutes,
          content: lock,
        },
      ]}
    />
  );
}

/** 분류 한 줄 — 이름 + 팔레트 색 동그라미(고른 것은 테두리 고리) */
function ColorRow({ label, value, disabled, onPick }: { label: string; value: AssetColorId; disabled: boolean; onPick: (id: AssetColorId) => void }) {
  return (
    <div className="flex items-center gap-3" role="radiogroup" aria-label={`${label} 색`}>
      <span className="w-20 shrink-0 text-xs text-text-primary">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        {ASSET_COLOR_IDS.map((id) => {
          const on = id === value;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={ASSET_COLOR_LABEL[id]}
              data-tip={ASSET_COLOR_LABEL[id]}
              disabled={disabled}
              data-color={id}
              onClick={() => !on && onPick(id)}
              className={`h-5 w-5 rounded-full ${swatchBg(id)} ${on ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-bg-secondary' : 'hover:opacity-80'} disabled:cursor-wait`}
            />
          );
        })}
      </span>
    </div>
  );
}
