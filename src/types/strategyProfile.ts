/**
 * 스윙 판정 기준 **프로파일** (Step 10 보강, v2.7.0).
 *
 * 같은 종목·같은 지표라도 "몇 점부터 사겠는가" 는 성향의 문제다. 그래서 판정값 네 종류를
 * 프로파일로 빼고, 표준 / 공격 / 수비 중 하나를 골라 쓴다.
 *
 * ⚠️ **표준은 코드 상수다** (`STANDARD_SWING`). DB 에 저장하지 않는다 — 저장해 두면 언젠가
 * 저장된 값이 코드값을 덮어 "표준인데 예전과 다른 결과" 가 나온다. 표준을 고르면 v2.6.0
 * 이전과 **완전히 같은 판정**이어야 한다.
 *
 * ⚠️ **공격·수비의 초기값도 표준과 같다.** 2026-09-23 에 근거를 다시 확인한 결과,
 * "공격은 BUY 58점" 같은 수치를 최근 1년 이내 출처로 뒷받침할 수 없었다 —
 * 애초에 점수 컷오프는 이 앱이 만든 점수 체계라 외부 출처가 있을 수 없다.
 * 그래서 숫자를 미리 넣지 않고 사용자가 성적표를 보며 맞춰 간다.
 * 화면·주석 어디에도 "권장값"·"검증된 값" 으로 적지 말 것 — **사용자 설정(근거 검증 전)** 이다.
 */

export type ProfileId = 'standard' | 'aggressive' | 'defensive';
/** 사용자가 값을 정할 수 있는 프로파일 (표준은 고정이라 제외) */
export type CustomProfileId = Exclude<ProfileId, 'standard'>;

export interface SwingParams {
  /** 등급 컷오프 — strong > buy > watch > hold */
  grades: { strong: number; buy: number; watch: number; hold: number };
  /** 손익비가 이 값 미만이면 STRONG·BUY 를 WATCH 로 내린다 */
  rrDemoteBelow: number;
  /** 타이밍 조건의 'RSI 눌림 구간' */
  rsiBand: { low: number; high: number };
  /** 비중 계산의 1회 리스크(%) — 변동성(ATR/가격) 구간별 */
  risk: { lowVol: number; midVol: number; highVol: number };
}

/** 표준 = v2.6.0 까지의 코드값 그대로. 이 값을 바꾸면 '표준' 의 뜻이 바뀐다. */
export const STANDARD_SWING: SwingParams = {
  grades: { strong: 80, buy: 65, watch: 50, hold: 35 },
  rrDemoteBelow: 1,
  rsiBand: { low: 35, high: 45 },
  risk: { lowVol: 1.5, midVol: 1, highVol: 0.5 },
};

export const PROFILE_LABEL: Record<ProfileId, string> = {
  standard: '표준',
  aggressive: '공격',
  defensive: '수비',
};

export const CUSTOM_PROFILES: CustomProfileId[] = ['aggressive', 'defensive'];

export interface ProfileState {
  active: ProfileId;
  /** 화면이 "얼마나 바꿨는지" 를 옆에 두고 비교하기 위한 읽기 전용 복사본 */
  standard: SwingParams;
  custom: Record<CustomProfileId, SwingParams>;
}

/**
 * 입력 한계 — **앱의 안전장치이고 출처에서 온 값이 아니다.**
 * 손익비 하한 1.0 만은 성향과 무관한 원칙이다: 1 미만은 잃을 금액이 벌 금액보다 큰 거래라
 * 공격 성향이라도 추천 대상에 넣지 않는다 (Step 10).
 */
export const PARAM_LIMITS = {
  grade: { min: 0, max: 100 },
  rrDemoteBelow: { min: 1, max: 3 },
  rsi: { min: 10, max: 70 },
  risk: { min: 0.1, max: 2 },
} as const;

export const cloneSwingParams = (p: SwingParams): SwingParams => ({
  grades: { ...p.grades },
  rrDemoteBelow: p.rrDemoteBelow,
  rsiBand: { ...p.rsiBand },
  risk: { ...p.risk },
});

/** 두 기준이 같은지 — 화면이 "아직 표준과 같습니다" 를 알리는 데 쓴다 */
export const sameSwingParams = (a: SwingParams, b: SwingParams): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
