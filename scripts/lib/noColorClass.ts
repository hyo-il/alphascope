/**
 * 「1280 이상 모양 그대로」 비교(`desk.json` 정답 파일)에서 **색 클래스만 뺀다** — 155차(v2.81.0) 앱 전체 색 규칙(주 단추 · 빨강 · 매수 / 매도 색)은
 * 모든 크기에서 바뀌므로, 정답 파일과 지금 모양을 견줄 때 두 쪽 모두에서 색 이름을 지우고 태그 · 배치 클래스 · 자리 · 크기만 견준다(지시서 D-6 「색 속성은 비교에서 뺌」).
 * 한 줄 꼴: `태그|클래스 …|x,y,w,h` — 클래스 순서는 그대로 두고 색 이름만 거른다.
 */
const COLOR_NAMES =
  '(?:bullish|bearish|danger|warning|star|white|black|transparent|current|overlay|border|chart-grid|accent(?:-button)?(?:-hover)?|text-(?:primary|secondary|muted)|bg-(?:primary|secondary|tertiary|elevated|box)|rebalance-[a-z]+|swatch-[a-z]+|heat-[a-z0-9-]+)';
const COLOR_CLASS = new RegExp(`^(?:[a-z-]+:)*(?:text|bg|border|ring|fill|stroke|decoration|outline)-${COLOR_NAMES}(?:/\\d+)?$`);
const EXTRA = /^(?:[a-z-]+:)*brightness-\d+$/;

export function noColorClass(cls: string): string {
  return cls
    .split(/\s+/)
    .filter((c) => c && !COLOR_CLASS.test(c) && !EXTRA.test(c))
    .join(' ');
}

/** `태그|클래스|자리` 한 줄에서 클래스의 색 이름만 뺀다 */
export function noColorLine(line: string): string {
  const [tag, cls, ...rest] = line.split('|');
  return rest.length ? [tag, noColorClass(cls ?? ''), ...rest].join('|') : line;
}
