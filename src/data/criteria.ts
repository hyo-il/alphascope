import { PROFILE_LABEL, STANDARD_SWING, type ProfileId, type SwingParams } from '../types/strategyProfile';

/**
 * 급등·스윙의 **판정 기준을 화면에 그대로 적기 위한 설명표**.
 *
 * ⚠️ 여기는 **설명**이고 판정은 서버가 한다 (`server/surgeDetector.ts`·`swingAnalyzer.ts`).
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

/**
 * 스윙 기준 설명 — **활성 프로파일 값으로 만든다** (v2.7.0).
 *
 * ⚠️ 상수가 아니라 함수인 이유: 값이 프로파일마다 다르므로 문구에 숫자를 박아 두면
 * 화면이 실제 판정과 다른 말을 한다 (엔진도 같은 이유로 라벨·사유를 params 로 만든다).
 */
export function swingCriteria(params: SwingParams, profileId: ProfileId): CriteriaSpec {
  const { grades, rrDemoteBelow, rsiBand, risk } = params;
  const suffix =
    profileId === 'standard'
      ? '(표준)'
      : `(${PROFILE_LABEL[profileId]} · 사용자 설정)`;

  return {
    title: `스윙 추천 판정 기준 ${suffix}`,
    scoring: [
      { label: '추세', value: '30점', detail: '현재가 > 60일선 · 정배열 · 60일선 기울기' },
      {
        label: '타이밍',
        value: '25점',
        detail: `RSI ${rsiBand.low}~${rsiBand.high} · 20일선 ±1.5% · 볼린저 중단~하단`,
      },
      { label: '모멘텀', value: '20점', detail: 'MACD 양전환 · 스토캐스틱 골든크로스 · RSI 반전' },
      { label: '거래량', value: '15점', detail: '최근 3일 ≥ 20일 평균 120% · 건강한 조정 · OBV 상승' },
      { label: '손익비', value: '10점', detail: '≥2.0 → 10 / ≥1.5 → 7 / ≥1.0 → 3 / <1.0 → 0' },
    ],
    grades:
      `STRONG ≥ ${grades.strong} · BUY ≥ ${grades.buy} · WATCH ≥ ${grades.watch} · ` +
      `HOLD ≥ ${grades.hold} · AVOID < ${grades.hold} (BUY 이상만 추천)`,
    gates: [
      `손익비 < ${rrDemoteBelow} 이면 점수와 무관하게 WATCH 로 내린다 — 잃을 금액이 더 큰 거래는 반복할수록 잃는다`,
      '손절가는 ATR×2 · 20일 지지선 −1% · 60일선 −0.5% 중 가장 가까운 값',
      `비중은 리스크 룰 (저변동 ${risk.lowVol}% · 중변동 ${risk.midVol}% · 고변동 ${risk.highVol}%, 상한 25%)`,
      '모든 계산의 기준은 현재가가 아니라 진입가(NOW · 눌림 · 돌파)다',
    ],
  };
}

/** 표준 기준 — 프로파일을 아직 못 받았을 때 그린다 */
export const STANDARD_SWING_CRITERIA = swingCriteria(STANDARD_SWING, 'standard');

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
