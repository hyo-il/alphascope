/**
 * 급등 탐지 알고리즘 자체 점검 (합성 데이터).
 * 실행: npx tsx scripts/surgeSelfTest.ts
 */
import { analyzePeriodicity, findSurgeEvents } from '../server/surgeDetector';
import type { Candle } from '../src/types/toss';

const DAY = 24 * 60 * 60 * 1000;

/** 주어진 간격 순서대로 급등하는 종목을 만든다 */
function synth(days: number, intervals: number[]): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  let step = 0;
  let next = 30;
  for (let i = 0; i < days; i++) {
    const surge = i === next;
    if (surge) next += intervals[step++ % intervals.length];
    const change = surge ? 0.05 : 0.001;
    const open = price;
    price = price * (1 + change);
    candles.push({
      timestamp: Date.UTC(2025, 0, 1) + i * DAY,
      open,
      high: Math.max(open, price),
      low: Math.min(open, price),
      close: price,
      volume: surge ? 3_000_000 : 1_000_000,
    });
  }
  return candles;
}

const regular = findSurgeEvents(synth(180, [14]), 3, 200);
const regularity = analyzePeriodicity(regular, 3, 50);
const irregular = findSurgeEvents(synth(180, [8, 40, 13, 35]), 3, 200);
const irregularity = analyzePeriodicity(irregular, 3, 50);

console.log('규칙형:', {
  count: regularity.surgeCount,
  intervals: regularity.intervals,
  avg: regularity.avgInterval,
  std: regularity.stdDeviation,
  regularity: regularity.regularity,
  isPeriodic: regularity.isPeriodic,
  next: regularity.nextEstimatedDate,
});
console.log('불규칙형:', {
  count: irregularity.surgeCount,
  intervals: irregularity.intervals,
  regularity: irregularity.regularity,
  isPeriodic: irregularity.isPeriodic,
});

if (!regularity.isPeriodic) throw new Error('규칙적인 종목을 주기적으로 분류하지 못했습니다');
if (irregularity.isPeriodic) throw new Error('불규칙한 종목을 주기적으로 잘못 분류했습니다');
console.log('✅ 통과');
