import { Check } from 'lucide-react';
import { ICON_SM } from '../ui/icon';
import { RULE_CHOICES, matchChoice, type RuleChoice } from '../../types/ruleChoices';
import type { RuleConfig } from '../../types/autoTrading';

/**
 * 규칙형 쉬운 선택지 3장 (v2.38.0 에 떼어 냈다) — 계좌 자동매매 설정(`paper-trading/RuleChoices`)과 「실험실 > 백테스트」 ② 가 같은 카드.
 * 고른 카드 = 밝은 바탕 + 체크(디자인 규칙 2, 파란 테두리 없음). 저장값이 셋과 다르면 아무것도 고르지 않은 상태 → 쓰는 곳이 「직접 설정」 을 적는다.
 * 값은 앱의 출발값(근거 검증 전) — "추천"·"검증된" 으로 쓰지 않는다.
 */
export default function RuleChoiceCards({
  rule,
  onPick,
  showWhy = true,
}: {
  rule: RuleConfig;
  onPick: (choice: RuleChoice) => void;
  /** 「왜 쓰나」 줄 — 백테스트는 이름·살 때·팔 때·약점만 */
  showWhy?: boolean;
}) {
  const active = matchChoice(rule);
  return (
    <div className="grid grid-cols-3 gap-2">
      {RULE_CHOICES.map((c) => {
        const on = active === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            aria-pressed={on}
            className={`flex flex-col justify-start rounded-lg px-3 py-2 text-left transition-colors ${
              on ? 'bg-bg-elevated' : 'bg-bg-tertiary/60 hover:bg-bg-tertiary'
            }`}
          >
            <p className="flex items-center gap-1 text-xs font-semibold text-text-primary">
              {on && <Check {...ICON_SM} aria-hidden />}
              {c.title}
            </p>
            <p className="mt-1 text-caption leading-snug text-text-secondary">
              <b className="text-text-primary">매수</b>: {c.buy}
            </p>
            <p className="text-caption leading-snug text-text-secondary">
              <b className="text-text-primary">매도</b>: {c.sell}
            </p>
            {showWhy && (
              <p className="mt-1 text-caption leading-snug text-text-secondary">
                <b className="text-text-primary">왜 쓰나</b>: {c.why}
              </p>
            )}
            <p className="mt-1 text-caption leading-snug text-warning">
              <b>약점</b>: {c.weak}
            </p>
          </button>
        );
      })}
    </div>
  );
}
