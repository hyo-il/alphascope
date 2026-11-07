import type { AssetClassColors, AssetColorId, AssetGroupKey } from '../../types/asset';

/**
 * 자산 분류 색(v2.62.1) — 팔레트 색 이름 → 클래스. 색 값은 `src/index.css` `--color-swatch-*` 한 곳(여기는 이름만).
 * 원형 조각 · 분류별 표 점 · 설정 창 동그라미가 **이 표 하나**를 쓴다(같은 분류는 어디서나 같은 색).
 * Tailwind 가 클래스를 찾을 수 있게 글자 그대로 적는다(이어 붙여 만들지 않는다).
 */
const STROKE: Record<AssetColorId | 'gray', string> = {
  yellow: 'stroke-swatch-yellow',
  orange: 'stroke-swatch-orange',
  red: 'stroke-swatch-red',
  pink: 'stroke-swatch-pink',
  purple: 'stroke-swatch-purple',
  blue: 'stroke-swatch-blue',
  teal: 'stroke-swatch-teal',
  green: 'stroke-swatch-green',
  lime: 'stroke-swatch-lime',
  brown: 'stroke-swatch-brown',
  gray: 'stroke-swatch-gray',
};
const BG: Record<AssetColorId | 'gray', string> = {
  yellow: 'bg-swatch-yellow',
  orange: 'bg-swatch-orange',
  red: 'bg-swatch-red',
  pink: 'bg-swatch-pink',
  purple: 'bg-swatch-purple',
  blue: 'bg-swatch-blue',
  teal: 'bg-swatch-teal',
  green: 'bg-swatch-green',
  lime: 'bg-swatch-lime',
  brown: 'bg-swatch-brown',
  gray: 'bg-swatch-gray',
};

/** 그 분류의 색 이름 — 「분류 없음」 은 회색 고정 */
const colorOf = (key: AssetGroupKey, colors: AssetClassColors): AssetColorId | 'gray' => (key === 'none' ? 'gray' : colors[key]);

/** 원형 조각(SVG stroke) */
export const groupStroke = (key: AssetGroupKey, colors: AssetClassColors): string => STROKE[colorOf(key, colors)];
/** 표 · 범례 점 */
export const groupDot = (key: AssetGroupKey, colors: AssetClassColors): string => BG[colorOf(key, colors)];
/** 설정 창 색 동그라미 */
export const swatchBg = (id: AssetColorId): string => BG[id];
