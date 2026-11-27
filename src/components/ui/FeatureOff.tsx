import InfoTip from './InfoTip';

/** 꺼진 기능 안내 글 — 화면 · 시험 · 용어집이 같은 글을 쓴다 */
export const FEATURE_OFF_TEXT = '이 기능은 꺼져 있습니다';
/** [ⓘ] 안 첫 줄 — 설정 이름 · 명령 · 경로 없이 쉬운 말로만(테마 9-1 R4 · 사용자 결정 3) */
export const FEATURE_OFF_HOW = '서버 설정에서 켭니다.';

/**
 * 꺼진 기능 안내 — 그 자리에 「이 기능은 꺼져 있습니다」 한 줄(13 · secondary) + [ⓘ](「서버 설정에서 켭니다」 + 그 기능 한 줄 설명).
 * **꺼진 기능 안내는 모두 이 부품을 쓴다** — 화면에 개발용 글(설정 이름 `*_ENABLED` · `.env` · `npm run …` · 파일 경로)을 내지 않는다.
 * 숨기지 않는다(사용자 결정 3). 자리 잡기는 `className` 으로만.
 */
export default function FeatureOff({
  what,
  className = '',
}: {
  /** 그 기능 한 줄 설명(예: 「Gemini 가 차트 · 뉴스를 읽고 의견을 냅니다」) — [ⓘ] 안 둘째 줄 */
  what: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 text-caption text-text-secondary ${className}`} data-feature-off>
      {FEATURE_OFF_TEXT}
      <InfoTip label="꺼진 기능 설명">
        <span className="block">{FEATURE_OFF_HOW}</span>
        <span className="block">{what}</span>
      </InfoTip>
    </span>
  );
}
