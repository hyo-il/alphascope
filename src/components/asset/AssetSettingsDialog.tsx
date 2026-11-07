import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, ICON_SM, Select } from '../ui';
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

/**
 * 자산 관리 「설정」 창(v2.62.1) — 오른쪽 위 「설정」 버튼이 연다. 세 칸:
 * 1. 연금으로 볼 계좌 — 표(계좌 이름 「( 날짜 )」 그대로) + [계좌 추가](창 = 시트 계좌 중 아직 없는 것) + 줄마다 삭제(`AssetAccountTable`)
 * 2. 위성으로 선택한 종목 — 매매 설정 대상 종목과 같은 부품(`common/SymbolTable`): 표(종목 · 코드 · 있는 계좌) + [종목 추가] + 줄마다 삭제.
 *    [종목 추가] 창 = 시트의 분류 「주식」 종목 중 아직 위성이 아닌 것만(`source` — 관심 목록 · 검색 없음). 표의 종목 = 위성 · 나머지 주식 = 코어.
 *    분류가 주식이 아니게 된 위성 종목은 흐리게 + 「분류가 주식이 아니라 계산에서 빠짐」(삭제할 수 있음).
 * 3. 자산 분류 색 — 분류마다 팔레트 색 동그라미(원형 · 분류별 표가 같은 색)
 * 4. 목표 비율(v2.63.0) — 정수 % 여섯 칸 · 두 합이 100 일 때만 [저장] · **시트에 쓴다**(`AssetTargetRatioForm`). 「비율 조정」 [목표 비율 바꾸기] 는 이 칸으로 연다.
 * 5. 괜찮음 범위(v2.63.0) — ±1~20 %p 고르기 · 바로 저장(앱 DB — 다른 설정과 같이)
 * 1~3 · 5 는 추가 · 삭제 · 색 바꿈 · 고르기마다 바로 저장(그 칸만 로딩 · 저장 중에는 그 칸을 다시 바꾸지 않음) — 실패하면 원래 값으로 되돌리고 그 칸에 이유 한 줄.
 * 저장 뒤 화면을 다시 받아 원형 · 표에 반영.
 */

type Field = keyof AssetSettings;

const GROUP_LABEL: Record<ColoredGroupKey, string> = { cash: '현금', bond: '채권', gold: '금', stock: '주식', retirement: '퇴직 연금' };

function Block({ title, desc, busy, error, children }: { title: string; desc?: string; busy: boolean; error: string | null; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-text-primary">
        {title}
        <span className="inline-flex w-4 justify-center">{busy && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="저장하는 중" />}</span>
      </h3>
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
  focus,
  onClose,
}: {
  summary: AssetSummary;
  /** 고칠 칸만 저장 — 실패면 이유 문구 */
  onSave: (patch: Partial<AssetSettings>) => Promise<string | null>;
  /** 목표 비율 저장(시트에 씀) */
  onSaveTarget: (ratio: Record<keyof AssetTargetRatio, number>) => Promise<{ ok: true; ratio: AssetTargetRatio } | { ok: false; error: string }>;
  /** 「비율 조정」 [목표 비율 바꾸기] 로 열면 목표 비율 칸으로 */
  focus?: 'targetRatio';
  onClose: () => void;
}) {
  // 바꾼 값을 바로 보이고(저장 중에도), 실패하면 원래 값으로 되돌린다
  const [shown, setShown] = useState<AssetSettings>(summary.settings);
  const [busy, setBusy] = useState<Partial<Record<Field, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});

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

  return (
    <Dialog title="설정" titleAside="자산 관리" onClose={onClose} size="lg" bodyClassName="space-y-6 p-4">
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

      <Block title="자산 분류 색" desc="원형 차트와 분류별 표에 같은 색으로 보입니다. 미지정은 회색입니다." busy={!!busy.classColors} error={errors.classColors ?? null}>
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

      <Block title="목표 비율" desc="정수 %. 현금 · 채권 · 금 · 주식 합과 코어 + 위성 합이 각각 100일 때 저장할 수 있습니다. 저장하면 시트 「자산 투자 비율 관리」 에도 씁니다." busy={false} error={null}>
        <AssetTargetRatioForm initial={summary.targetRatio} writeEnabled={summary.writeEnabled} onSave={onSaveTarget} autoFocus={focus === 'targetRatio'} />
      </Block>

      <Block title="괜찮음 범위" desc="「비율 조정」 에서 목표와의 차이가 이 범위 안이면 「괜찮음」 입니다." busy={!!busy.rebalanceBand} error={errors.rebalanceBand ?? null}>
        <div className="flex items-center gap-2" data-setting="band">
          <Select size="sm" className="w-24" aria-label="괜찮음 범위" value={shown.rebalanceBand} disabled={!!busy.rebalanceBand} onChange={(e) => void save('rebalanceBand', Number(e.target.value))}>
            {Array.from({ length: REBALANCE_BAND_MAX - REBALANCE_BAND_MIN + 1 }, (_, i) => REBALANCE_BAND_MIN + i).map((n) => (
              <option key={n} value={n}>
                ±{n}%p
              </option>
            ))}
          </Select>
        </div>
      </Block>
    </Dialog>
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
