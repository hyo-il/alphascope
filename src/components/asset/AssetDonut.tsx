import { formatCompactMoney, formatNumber, formatPrice } from '../../utils/formatters';
import type { AssetGroup, AssetGroupKey } from '../../types/asset';

/**
 * 자산 구성 원형 차트(v2.62.0) — 새 의존성 없이 SVG 고리. 분류마다 고정 색(`index.css` `--color-asset-*` 한 곳 — 이 표가 이름만 쓴다).
 * 조각 사이 2px 바탕 틈 · 가운데 총 자산. 조각에 마우스를 올리면 분류 · 금액 · 비율(옆 분류별 표가 범례 · 표 보기를 겸한다).
 */
export const GROUP_FILL: Record<AssetGroupKey, string> = {
  cash: 'stroke-asset-cash',
  bond: 'stroke-asset-bond',
  gold: 'stroke-asset-gold',
  stock: 'stroke-asset-stock',
  retirement: 'stroke-asset-retirement',
  none: 'stroke-asset-none',
};
/** 표 · 범례의 색 점 */
export const GROUP_DOT: Record<AssetGroupKey, string> = {
  cash: 'bg-asset-cash',
  bond: 'bg-asset-bond',
  gold: 'bg-asset-gold',
  stock: 'bg-asset-stock',
  retirement: 'bg-asset-retirement',
  none: 'bg-asset-none',
};

const SIZE = 180;
const STROKE = 26;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** 조각 사이 틈(둘레 길이) */
const GAP = 2;

export default function AssetDonut({ groups, total }: { groups: AssetGroup[]; total: number }) {
  // 음수(빚 등)는 원에 그릴 수 없다 — 0 으로(표에는 그대로 보인다)
  const parts = groups.filter((g) => g.amount > 0);
  const sum = parts.reduce((a, g) => a + g.amount, 0);
  let offset = 0;
  return (
    <figure className="relative mx-auto shrink-0" style={{ width: SIZE, height: SIZE }} aria-label="자산 구성 원형 차트">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} className="stroke-bg-tertiary" />
        {sum > 0 &&
          parts.map((g) => {
            const len = (g.amount / sum) * C;
            const drawn = parts.length > 1 ? Math.max(len - GAP, 0.5) : len;
            const el = (
              <circle
                key={g.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                strokeWidth={STROKE}
                strokeDasharray={`${drawn} ${C - drawn}`}
                strokeDashoffset={-offset}
                className={`${GROUP_FILL[g.key]} transition-opacity hover:opacity-80`}
                data-group={g.key}
              >
                <title>{`${g.label} ${formatPrice(g.amount, 'KRW')} · ${g.ratio == null ? '—' : formatNumber(g.ratio * 100, 1, '%')}`}</title>
              </circle>
            );
            offset += len;
            return el;
          })}
      </svg>
      <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-caption text-text-muted">총 자산</span>
        <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCompactMoney(total, 'KRW')}</span>
      </figcaption>
    </figure>
  );
}
