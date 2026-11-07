import { formatCompactMoney, formatNumber, formatPrice } from '../../utils/formatters';
import type { AssetClassColors, AssetGroup } from '../../types/asset';
import { groupStroke } from './assetColors';

/**
 * 자산 구성 원형 차트(v2.62.0) — 새 의존성 없이 SVG 고리. 분류 색은 설정(「자산 분류 색」 — 팔레트 이름)을 `assetColors.ts` 한 표로 칠한다.
 * 조각 사이 2px 바탕 틈 · 가운데 총 자산. 조각에 마우스를 올리면 분류 · 금액 · 비율(옆 분류별 표가 범례 · 표 보기를 겸한다).
 */
const SIZE = 180;
const STROKE = 26;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** 조각 사이 틈(둘레 길이) */
const GAP = 2;

export default function AssetDonut({ groups, total, colors }: { groups: AssetGroup[]; total: number; colors: AssetClassColors }) {
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
                className={`${groupStroke(g.key, colors)} transition-opacity hover:opacity-80`}
                data-group={g.key}
                data-color={g.key === 'none' ? 'gray' : colors[g.key]}
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
