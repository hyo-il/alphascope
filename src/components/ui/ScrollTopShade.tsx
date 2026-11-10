/**
 * 탭 줄 아래 가림 띠 — 탭 줄 바로 밑이 스크롤 영역 위 끝인 화면(자산 관리 · 매수 판단 · 급등 탐지 · 검증 기록)에서
 * 스크롤된 내용의 잘린 끝(칸 · 버튼 아래 몇 px)이 탭 줄 밑에 비치지 않게 덮는다.
 *
 * - 스크롤 영역(`PANEL_PAD` — 위 여백 12px)의 **첫 자식**으로 둔다.
 * - 높이 0 의 sticky 틀(`top-0` — 크롬은 붙는 위치를 위 여백 안쪽으로 재므로 틀은 위 끝 12px 아래에 붙는다) 안에
 *   12px 띠를 틀 위로 그린다 → 띠 = 스크롤 영역 위 끝 12px(위 6px 바탕색 그대로 · 아래 6px 만 투명으로 — 전부 흐리면 잘린 숫자 끝이 비친다).
 * - 맨 위에서는 위 여백(빈 자리) 위에만 있어 보이지 않는다. 틀은 자리를 차지하지 않고(높이 0 · 위아래 바깥 여백 0 — 부모 `space-y-*` 간격도 받지 않음)
 *   내용은 원래 자리(위 여백 12px 아래)에 그대로 놓인다.
 * - 폭은 내용 폭(가로 여백 안쪽) — 넓히면 design:check 「탭·내용 왼쪽 끝」 이 어긋난다.
 */
export default function ScrollTopShade() {
  return (
    <div aria-hidden className="pointer-events-none sticky top-0 z-10 my-0 h-0">
      <div className="absolute inset-x-0 -top-3 h-3 bg-gradient-to-b from-bg-primary from-50% to-transparent" data-scroll-shade />
    </div>
  );
}
