import WarnIcon from '../ui/WarnIcon';

const DISCLAIMER = '본 정보는 투자 권유가 아니며 투자 판단의 책임은 본인에게 있습니다.';

/** ⑧ 면책 — 화면 글자로 늘 보인다(지우지 않는다) */
export default function Disclaimer() {
  return (
    <p className="break-keep text-caption text-text-muted" data-brief-disclaimer>
      <WarnIcon />
      {DISCLAIMER} 투자 조언이 아닙니다. AI(Gemini)가 뉴스 제목과 시장 데이터로 쓴 글이라 틀릴 수 있습니다.
    </p>
  );
}
