import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, ICON_SM } from '../ui';
import { ASSET_COLOR_IDS, ASSET_COLOR_LABEL, COLORED_GROUP_KEYS, type AssetClassColors, type AssetColorId, type AssetSettings, type AssetSummary, type ColoredGroupKey } from '../../types/asset';
import { swatchBg } from './assetColors';

/**
 * 자산 관리 「설정」 창(v2.62.1) — 오른쪽 위 「설정」 버튼이 연다. 세 칸:
 * 1. 연금으로 볼 계좌 — 시트의 계좌 이름 체크(「( 날짜 )」 그대로)
 * 2. 위성으로 선택한 종목 — 분류 「주식」 종목 체크(체크 = 위성 · 나머지 주식 = 코어). 분류가 주식이 아닌데 목록에 남은 종목은 흐리게.
 * 3. 자산 분류 색 — 분류마다 팔레트 색 동그라미(원형 · 분류별 표가 같은 색)
 * 바꾸면 바로 저장(그 칸만 로딩) — 실패하면 원래 값으로 되돌리고 그 칸에 이유 한 줄. 저장 뒤 화면을 다시 받아 원형 · 표에 반영.
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
  onClose,
}: {
  summary: AssetSummary;
  /** 고칠 칸만 저장 — 실패면 이유 문구 */
  onSave: (patch: Partial<AssetSettings>) => Promise<string | null>;
  onClose: () => void;
}) {
  // 바꾼 값을 바로 보이고(저장 중에도), 실패하면 원래 값으로 되돌린다
  const [shown, setShown] = useState<AssetSettings>(summary.settings);
  const [busy, setBusy] = useState<Partial<Record<Field, boolean>>>({});
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});

  const save = async <K extends Field>(field: K, value: AssetSettings[K]) => {
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

  const toggle = (list: string[], v: string, on: boolean) => (on ? [...list, v] : list.filter((x) => x !== v));
  const accountName = (key: string) => summary.accounts.find((a) => a.key === key)?.name ?? key;

  return (
    <Dialog title="설정" titleAside="자산 관리" onClose={onClose} size="lg" bodyClassName="space-y-6 p-4">
      <Block title="연금으로 볼 계좌" desc="「연금 포함」 을 끄면 체크한 계좌와 퇴직 연금이 총 자산에서 빠집니다." busy={!!busy.pensionSections} error={errors.pensionSections ?? null}>
        <div className="flex flex-wrap gap-x-6 gap-y-2" data-setting="pension">
          {summary.accounts.map((a) => (
            <label key={a.key} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-text-primary">
              <input
                type="checkbox"
                checked={shown.pensionSections.includes(a.key)}
                disabled={!!busy.pensionSections}
                onChange={(e) => void save('pensionSections', toggle(shown.pensionSections, a.key, e.target.checked))}
              />
              {a.name}
            </label>
          ))}
        </div>
      </Block>

      <Block title="위성으로 선택한 종목" desc="체크한 종목 = 위성, 나머지 주식 = 코어. 같은 종목은 어느 계좌에 있든 같은 쪽입니다." busy={!!busy.satelliteSymbols} error={errors.satelliteSymbols ?? null}>
        {summary.stockChoices.length === 0 ? (
          <p className="text-xs text-text-muted keep-all">자산 분류가 「주식」 인 종목이 없습니다 — 「상세 보기」 에서 자산 분류를 골라 주세요.</p>
        ) : (
          <ul className="space-y-1" data-setting="satellite">
            {summary.stockChoices.map((c) => (
              <li key={c.symbol} className={c.isStock ? '' : 'text-text-muted'}>
                <label className="flex min-w-0 items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={shown.satelliteSymbols.includes(c.symbol)}
                    disabled={!!busy.satelliteSymbols}
                    onChange={(e) => void save('satelliteSymbols', toggle(shown.satelliteSymbols, c.symbol, e.target.checked))}
                  />
                  <span className={`min-w-0 truncate ${c.isStock ? 'text-text-primary' : ''}`} title={c.name}>
                    {c.name}
                  </span>
                  <span className="shrink-0 text-text-secondary">{c.symbol}</span>
                  <span className="shrink-0 whitespace-nowrap text-caption text-text-muted">{c.sections.map(accountName).join(' · ')}</span>
                  {!c.isStock && <span className="shrink-0 whitespace-nowrap text-caption text-text-muted">분류가 주식이 아니라 계산에서 빠짐</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
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
