/**
 * 스윙 「기준 편집」 1층 — **질문 3개 → 판정값** (v2.17.0).
 *
 * 초보자는 "BUY 컷 65" 같은 숫자로 고르지 못한다. 대신 세 가지를 묻고 그 답을 숫자로 옮긴다.
 *   1. 추천을 얼마나 자주 받고 싶나 → 등급 컷 네 개를 함께 +5 / 0 / −5 (순서가 유지된다)
 *   2. 얼마나 떨어졌을 때 사고 싶나 → RSI 눌림 구간 40–50 / 35–45 / 30–40
 *   3. 한 번 거래에서 잃어도 되는 돈 → 리스크 %(저·중·고변동) 를 표준의 0.5 / 1 / 1.5 배 (상한 2%)
 *
 * ⚠️ ±5·구간·배수는 **앱의 출발값이다(근거 검증 전).** 화면에 "권장" 으로 적지 않는다.
 * ⚠️ 손익비 강등 기준(`rrDemoteBelow`)은 1층이 건드리지 않는다 — 1.0 아래 금지 안전장치라 성향 질문과 섞지 않는다.
 * ⚠️ 표준(`STANDARD_SWING`)은 여기서도 바뀌지 않는다. 1층이 만든 값도 서버 검증(`validateSwingParams`)을 통과해야 저장된다.
 */

import { PARAM_LIMITS, STANDARD_SWING, type SwingParams } from '../types/strategyProfile';

export type Frequency = 'strict' | 'normal' | 'loose';
export type Dip = 'small' | 'normal' | 'large';
export type RiskChoice = 0.5 | 1 | 1.5;

export interface EasyChoice {
  frequency: Frequency;
  dip: Dip;
  risk: RiskChoice;
}

export const FREQUENCY_OPTIONS: { id: Frequency; label: string; hint: string; shift: number }[] = [
  { id: 'strict', label: '드물게(엄격)', hint: '추천이 줄지만 조건을 더 많이 갖춘 종목만 남습니다', shift: 5 },
  { id: 'normal', label: '보통', hint: '표준과 같은 점수 기준입니다', shift: 0 },
  { id: 'loose', label: '자주(느슨)', hint: '추천이 늘지만 덜 확실한 종목도 섞입니다', shift: -5 },
];

export const DIP_OPTIONS: { id: Dip; label: string; hint: string; band: { low: number; high: number } }[] = [
  { id: 'small', label: '조금', hint: '살짝 쉬어 갈 때 삽니다 (RSI 40~50)', band: { low: 40, high: 50 } },
  { id: 'normal', label: '보통', hint: '표준과 같습니다 (RSI 35~45)', band: { low: 35, high: 45 } },
  { id: 'large', label: '많이', hint: '꽤 떨어졌을 때만 삽니다 (RSI 30~40)', band: { low: 30, high: 40 } },
];

export const RISK_OPTIONS: { id: RiskChoice; label: string; hint: string }[] = [
  { id: 0.5, label: '0.5%', hint: '손절에 걸려도 전체의 약 0.5% 만 잃도록 적게 삽니다' },
  { id: 1, label: '1%', hint: '표준과 같습니다' },
  { id: 1.5, label: '1.5%', hint: '더 많이 사지만 손절 때 잃는 돈도 커집니다 (상한 2%)' },
];

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 세 답 → 판정값. 손익비 강등 기준은 `base` 의 것을 그대로 둔다 */
export function applyEasy(choice: EasyChoice, base: SwingParams = STANDARD_SWING): SwingParams {
  const shift = FREQUENCY_OPTIONS.find((o) => o.id === choice.frequency)!.shift;
  const band = DIP_OPTIONS.find((o) => o.id === choice.dip)!.band;
  const s = STANDARD_SWING;
  const cap = (v: number) => Math.min(PARAM_LIMITS.risk.max, round2(v));
  return {
    grades: {
      strong: s.grades.strong + shift,
      buy: s.grades.buy + shift,
      watch: s.grades.watch + shift,
      hold: s.grades.hold + shift,
    },
    rrDemoteBelow: base.rrDemoteBelow,
    rsiBand: { ...band },
    risk: {
      lowVol: cap(s.risk.lowVol * choice.risk),
      midVol: cap(s.risk.midVol * choice.risk),
      highVol: cap(s.risk.highVol * choice.risk),
    },
  };
}

/** 지금 값이 세 답의 어떤 조합과 같은가 — 2층에서 직접 고쳤으면 null("직접 설정") */
export function detectEasy(params: SwingParams): EasyChoice | null {
  for (const f of FREQUENCY_OPTIONS) {
    for (const d of DIP_OPTIONS) {
      for (const r of RISK_OPTIONS) {
        const choice: EasyChoice = { frequency: f.id, dip: d.id, risk: r.id };
        if (JSON.stringify(applyEasy(choice, params)) === JSON.stringify(params)) return choice;
      }
    }
  }
  return null;
}
