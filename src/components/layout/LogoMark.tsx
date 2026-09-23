/**
 * 사이드 메뉴의 로고 도형 — **파비콘(`public/favicon.svg`)과 같은 모양**이다.
 *
 * ⚠️ 모양을 고칠 일이 있으면 **두 곳을 함께** 고친다. 탭 아이콘과 화면 로고가 갈라지면
 * 같은 앱으로 보이지 않는다. (SVG 를 import 해서 쓰지 않는 이유: 파비콘은 브라우저가
 * 파일로 받아야 해서 `public/` 에 있어야 하고, 이쪽은 색을 토큰으로 맞춰야 한다.)
 */
export default function LogoMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden
      className="shrink-0"
    >
      <circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <g className="text-bullish" fill="currentColor">
        <rect x="10" y="16.5" width="5" height="7" rx="1.4" />
        <rect x="17.5" y="9.5" width="5" height="14" rx="1.4" />
      </g>
    </svg>
  );
}
