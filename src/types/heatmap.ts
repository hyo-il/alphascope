/** 종목 지도(히트맵, v2.18.0) — 서버 `server/heatmap.ts` 와 화면 `components/heatmap` 이 함께 쓴다 */

export type HeatmapMarket = 'us' | 'kr';

export interface HeatmapCell {
  symbol: string;
  name: string | null;
  /** 한국어 섹터 이름 (없으면 '기타') */
  sector: string;
  /** 네모 크기 — 시가총액(통화 단위 그대로) */
  marketCap: number;
  price: number | null;
  /** 전 거래일 종가 대비 등락률(%) — 모르면 null(회색) */
  changeRate: number | null;
  currency: 'KRW' | 'USD';
  /** 관심 종목인가 (대형주 100 밖이어도 지도에 넣는다) */
  watch: boolean;
}

export interface HeatmapResponse {
  market: HeatmapMarket;
  cells: HeatmapCell[];
  asOf: string;
  /** 섹터를 아직 모르는 종목 수 — 하루 1회 갱신 전이면 '기타' 로 묶인다 */
  missingSectors: number;
}
