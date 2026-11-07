import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { ICON_SM, Select, SideNavDialog } from '../ui';
import {
  ASSET_COLOR_IDS,
  ASSET_COLOR_LABEL,
  COLORED_GROUP_KEYS,
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

/**
 * 「자산 관리 설정」 창(v2.62.1 · v2.65.2 왼쪽 메뉴 — 공용 `SideNavDialog`) — 오른쪽 위 「설정」 버튼이 연다. 메뉴 다섯(이 순서):
 * 1. 목표 비율 — 정수 % 여섯 칸 · 두 합이 100 일 때만 [저장] · **시트에 쓴다**(`AssetTargetRatioForm`) + 비율 조정 범위(±1~20 %p 고르기 · 바로 저장 — 앱 DB).
 *    「비율 조정」 [목표 비율 바꾸기] 는 이 메뉴로 연다.
 * 2. 코어 · 위성 — 위성으로 선택한 종목: 매매 설정 대상 종목과 같은 부품(`common/SymbolTable`): 표(종목 · 코드 · 있는 계좌) + [종목 추가] + 줄마다 삭제.
 *    [종목 추가] 창 = 시트의 분류 「주식」 종목 중 아직 위성이 아닌 것만(`source` — 관심 목록 · 검색 없음). 표의 종목 = 위성 · 나머지 주식 = 코어.
 *    분류가 주식이 아니게 된 위성 종목은 흐리게 + 「분류가 주식이 아니라 계산에서 빠짐」(삭제할 수 있음).
 * 3. 연금 — 연금으로 볼 계좌: 표(계좌 이름 「( 날짜 )」 그대로) + [계좌 추가](창 = 시트 계좌 중 아직 없는 것) + 줄마다 삭제(`AssetAccountTable`)
 * 4. 자산 분류 색 — 분류마다 팔레트 색 동그라미(원형 · 분류별 표가 같은 색)
 * 5. 시트 가격(v2.65.0) — 「티커」 가격 · 환율을 토스로 바꾸기 · 되돌리기(확인 창 · **시트에 쓴다** — `AssetPriceSheetSection`)
 * 처음 열면 「목표 비율」 · 마지막에 본 메뉴는 이 기기에 기억(`alphascope.asset.settingsMenu` · 읽기 실패면 목표 비율).
 * 추가 · 삭제 · 색 바꿈 · 고르기마다 바로 저장(그 칸만 로딩 + 메뉴 이름 옆 로딩 · 저장 중에는 그 칸을 다시 바꾸지 않음) — 실패하면 원래 값으로 되돌리고 그 칸에 이유 한 줄.
 * 저장 뒤 화면을 다시 받아 원형 · 표에 반영.
 */

/** 메뉴 — 순서가 곧 화면 순서 */
const MENUS = ['target', 'core', 'pension', 'colors', 'price'] as const;
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
  focus,
  onClose,
}: {
  summary: AssetSummary;
  /** 고칠 칸만 저장 — 실패면 이유 문구 */
  onSave: (patch: Partial<AssetSettings>) => Promise<string | null>;
  /** 목표 비율 저장(시트에 씀) */
  onSaveTarget: (ratio: Record<keyof AssetTargetRatio, number>) => Promise<{ ok: true; ratio: AssetTargetRatio } | { ok: false; error: string }>;
  /** 시트 가격 바꾸기 · 되돌리기 — 실패면 이유 문구 */
  onPriceSheet: (kind: 'convert' | 'restore') => Promise<string | null>;
  /** 「비율 조정」 [목표 비율 바꾸기] 로 열면 목표 비율 칸으로 */
  focus?: 'targetRatio';
  onClose: () => void;
}) {
  // 바꾼 값을 바로 보이고(저장 중에도), 실패하면 원래 값으로 되돌린다
  const [shown, setShown] = useState<AssetSettings>(summary.settings);
  const [busy, setBusy] = useState<Partial<Record<Field, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [priceBusy, setPriceBusy] = useState(false);

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

  const [menu, setMenu] = useState<Menu>(() => (focus === 'targetRatio' ? 'target' : readMenu()));
  useEffect(() => saveMenu(menu), [menu]);

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
        <AssetTargetRatioForm initial={summary.targetRatio} writeEnabled={summary.writeEnabled} onSave={onSaveTarget} autoFocus={focus === 'targetRatio'} />
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
        { id: 'target', label: '목표 비율', desc: '자산 배분 · 주식 안 코어 · 위성의 목표와, 「비율 조정」 이 괜찮다고 보는 범위입니다.', busy: !!busy.rebalanceBand, content: target },
        { id: 'core', label: '코어 · 위성', desc: '분류 「주식」 종목을 코어와 위성으로 나눕니다.', busy: !!busy.satelliteSymbols, content: satellite },
        { id: 'pension', label: '연금', desc: '「연금 포함」 을 켜고 끌 때 함께 더하고 빼는 계좌입니다.', busy: !!busy.pensionSections, content: pension },
        { id: 'colors', label: '자산 분류 색', desc: '원형 차트와 분류별 표에 같은 색으로 보입니다. 미지정은 회색입니다.', busy: !!busy.classColors, content: colors },
        {
          id: 'price',
          label: '시트 가격',
          desc: '시트 「티커」 의 가격 · 환율을 어디서 받는지입니다. 토스로 바꾸면 장이 열린 동안 10초마다 바뀐 값만 시트에 씁니다.',
          busy: priceBusy,
          content: price,
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
              title={ASSET_COLOR_LABEL[id]}
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
