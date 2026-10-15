/**
 * 급등 탐지의 **판정 기준을 화면에 그대로 적기 위한 설명표** (v2.45.0 에 예전 매수 판단(스윙) 기준 설명은 지웠다 — 매수 판단은 「매매 규칙」 을 쓴다).
 *
 * ⚠️ 여기는 **설명**이고 판정은 서버가 한다 (`server/surgeDetector.ts`).
 * 두 곳이 갈라지지 않도록, 값을 바꿀 때는 **서버 코드와 이 표를 같은 커밋에서** 고친다.
 * 화면이 판정을 다시 계산하는 일은 없어야 한다 — 그러면 같은 종목이 화면마다 다르게 보인다.
 */

export interface CriteriaItem {
  label: string;
  /** 배점 또는 컷오프 */
  value: string;
  /** 무엇을 보는지 */
  detail: string;
}

export interface CriteriaSpec {
  title: string;
  /** 점수 배분 (합 100) */
  scoring: CriteriaItem[];
  /** 등급 컷오프 */
  grades: string;
  /** 점수와 무관하게 걸리는 조건 */
  gates: string[];
}

export const SURGE_CRITERIA: CriteriaSpec = {
  title: '급등 탐지 판정 기준',
  scoring: [
    { label: '주기성', value: '30점', detail: '급등 간격이 규칙적인가 (표본 수로 가중)' },
    { label: '예상일 근접', value: '20점', detail: '다음 예상 급등일 ±3일' },
    { label: 'RSI 과매도', value: '15점', detail: 'RSI(14) 과매도 구간' },
    { label: '거래량 증가', value: '10점', detail: '최근 거래량이 늘고 있는가' },
    { label: '볼린저 하단', value: '10점', detail: '밴드 하단 근접' },
    { label: 'MACD 양전환', value: '10점', detail: '히스토그램 음 → 양' },
    { label: '변동성 축소', value: '5점', detail: '밴드 폭이 좁아지는 구간' },
  ],
  grades: 'HIGH ≥ 80 · MEDIUM ≥ 60 · LOW ≥ 40 · NONE < 40',
  gates: [
    '급등일 = 하루 변동률(전일 종가 대비) ≥ 기준 이면서 거래량 ≥ 20일 평균의 200%',
    '변동률 기준은 시가총액에 맞춘다 — 대형주 2% · 중형주 3% · 소형주 5% (설정에서 수동 지정 가능)',
    '평균 간격 3일 미만은 주기로 보지 않는다 — 이틀 연속 급등을 주기라 부를 수 없다',
    '지지선 근접은 표시만 하고 점수는 주지 않는다 (볼린저 하단과 겹쳐 이중 가산이 된다)',
  ],
};
