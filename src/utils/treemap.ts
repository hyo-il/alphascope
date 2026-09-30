/**
 * Squarified treemap (Bruls·Huizing·van Wijk, 2000) — 종목 지도(v2.18.0)가 쓴다.
 *
 * 라이브러리를 들이지 않고 직접 구현했다(40줄 남짓이라 의존성을 늘릴 이유가 없다).
 * 값이 큰 것부터 짧은 변을 따라 한 줄씩 채우며, 줄에 하나를 더했을 때 가장 나쁜 가로세로비가
 * 나빠지면 그 줄을 확정하고 남은 영역에서 새 줄을 시작한다 → 칸이 정사각형에 가까워진다.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed<T> {
  rect: Rect;
  data: T;
}

/** 줄(row)의 가장 나쁜 가로세로비 — 면적 목록 areas 를 길이 side 인 변에 붙였을 때 */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  if (sum <= 0 || side <= 0) return Infinity;
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
}

export function squarify<T>(items: { value: number; data: T }[], rect: Rect): Placed<T>[] {
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = positive.reduce((a, b) => a + b.value, 0);
  if (!positive.length || total <= 0 || rect.w <= 0 || rect.h <= 0) return [];

  // 값을 면적으로 바꾼다
  const scale = (rect.w * rect.h) / total;
  const queue = positive.map((i) => ({ area: i.value * scale, data: i.data }));
  const out: Placed<T>[] = [];
  let free = { ...rect };
  let row: typeof queue = [];

  const layRow = () => {
    const sum = row.reduce((a, b) => a + b.area, 0);
    if (free.w >= free.h) {
      // 왼쪽에 세로 줄
      const width = sum / free.h;
      let y = free.y;
      for (const r of row) {
        const h = r.area / width;
        out.push({ rect: { x: free.x, y, w: width, h }, data: r.data });
        y += h;
      }
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      // 위쪽에 가로 줄
      const height = sum / free.w;
      let x = free.x;
      for (const r of row) {
        const w = r.area / height;
        out.push({ rect: { x, y: free.y, w, h: height }, data: r.data });
        x += w;
      }
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
    row = [];
  };

  for (const item of queue) {
    const side = Math.min(free.w, free.h);
    const current = row.map((r) => r.area);
    if (!row.length || worst([...current, item.area], side) <= worst(current, side)) {
      row.push(item);
    } else {
      layRow();
      row.push(item);
    }
  }
  if (row.length) layRow();
  return out;
}
