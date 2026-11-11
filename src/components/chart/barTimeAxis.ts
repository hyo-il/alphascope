/** 봉 시간축 — 가져오는 것 없는 순수 함수(시험 `chartview:test` 가 바로 부른다). 쓰는 곳: `drawingSupport.ts` */

/**
 * 봉 시간축 — 봉 시간 목록(초)으로 시간 ↔ 논리 자리(봉 번호 · 소수 가능)를 바꾼다.
 *
 * Lightweight Charts 의 `timeToCoordinate` · `coordinateToTime` 은 **봉이 있는 시간만** 안다 — 마지막 봉 오른쪽 빈 곳은 null 이라,
 * 그곳에 찍은 점은 「가장 가까운 봉(마지막 봉)」 으로 당겨져 자 · 추세선의 폭이 0 이 됐다(133차 · 0 bars · 0 days).
 * 여기서는 봉 밖 시간을 **봉 간격(가장 짧은 간격)만큼 늘린 자리**로 센다 — 빈 곳 n칸째 = 마지막 봉 시간 + n × 간격(칸에 맞추지 않음).
 * 봉 사이 시간(주말 등)은 앞뒤 봉 사이를 비율로 나눈다. 시간으로 기억하므로 새 봉이 들어오거나 과거가 앞에 붙어도 자리가 그대로다.
 */
export interface BarTimeAxis {
  timeToLogical(time: number): number | null;
  logicalToTime(logical: number): number | null;
}

/** 봉 간격 — 마지막 봉 20개 사이의 가장 짧은 간격(일봉 1일 · 주봉 7일 · 분봉 n분). 봉이 하나면 하루 */
function stepOf(times: readonly number[]): number {
  let step = Infinity;
  for (let i = Math.max(1, times.length - 20); i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < step) step = gap;
  }
  return Number.isFinite(step) ? step : 86_400;
}

export function barTimeAxis(times: readonly number[]): BarTimeAxis {
  const last = times.length - 1;
  const step = stepOf(times);
  return {
    timeToLogical(time) {
      if (last < 0) return null;
      if (time >= times[last]) return last + (time - times[last]) / step;
      if (time <= times[0]) return (time - times[0]) / step;
      let lo = 0;
      let hi = last;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= time) lo = mid;
        else hi = mid;
      }
      return lo + (time - times[lo]) / (times[hi] - times[lo]);
    },
    logicalToTime(logical) {
      if (last < 0 || !Number.isFinite(logical)) return null;
      // 봉 위(봉 칸 반 칸 안)는 그 봉 시간(라이브러리와 같음), 봉 밖 빈 곳은 칸에 맞추지 않고 **찍은 자리 그대로**(초 단위)
      if (logical > last + 0.5) return Math.round(times[last] + (logical - last) * step);
      if (logical < -0.5) return Math.round(times[0] + logical * step);
      return times[Math.min(last, Math.max(0, Math.round(logical)))];
    },
  };
}
