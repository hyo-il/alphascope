/**
 * 스윙 「기준 편집」 결과 미리보기 — `POST /api/swing/profile-preview` (v2.17.0).
 *
 * "이 설정이었다면 지난 120일 동안 관심 종목에서 추천(BUY 이상)이 N번, 그 뒤 10일 평균 수익 X%" 를
 * 표준 설정과 나란히 낸다. 계산은 진단의 **120일 재현 함수**(`replaySwing`)를 판정값만 바꿔 그대로 부른다 —
 * 미리보기용 판정을 따로 만들면 진단·스윙 화면과 다른 말을 하게 된다.
 *
 * - (판정값, 날짜, 관심 목록) 단위로 **하루 캐시**, 같은 요청이 겹치면 한 번만 돈다(지표 엔진을 종목×120번 부른다).
 * - ⚠️ 과거 결과일 뿐 앞으로를 보장하지 않는다 — 화면에 고정 문구로 적는다. 표본 10 미만이면 "표본 적음".
 */

import { replaySwing, type ReplayResult } from './diagnose/report';
import { watchlistSymbols } from './analysis/targetHit';
import { STANDARD_SWING, type SwingParams } from '../src/types/strategyProfile';

const REPLAY_DAYS = 120;

export interface PreviewStats {
  /** BUY 이상 판정이 나온 날 수 (종목×날) */
  count: number;
  /** 그 뒤 10거래일 평균 수익률(%) — 10일 뒤가 아직 없는 날은 뺀다 */
  avg10d: number | null;
  /** 평균에 들어간 표본 수 */
  sample: number;
}

export interface PreviewResult extends PreviewStats {
  baseline: PreviewStats;
  symbols: number;
  days: number;
}

function stats(replay: ReplayResult[]): PreviewStats {
  const d10 = replay.flatMap((r) => r.forward.d10);
  return {
    count: replay.reduce((n, r) => n + r.buyDates.length, 0),
    avg10d: d10.length ? Math.round((d10.reduce((a, b) => a + b, 0) / d10.length) * 100) / 100 : null,
    sample: d10.length,
  };
}

const cache = new Map<string, Promise<PreviewStats>>();

function statsFor(params: SwingParams, symbols: string[]): Promise<PreviewStats> {
  const day = new Date().toISOString().slice(0, 10);
  const key = `${JSON.stringify(params)}|${day}|${symbols.join(',')}`;
  let found = cache.get(key);
  if (!found) {
    found = replaySwing(symbols, { id: 'aggressive', params }, REPLAY_DAYS).then(stats);
    cache.set(key, found);
    // 실패는 캐시에 남기지 않는다 (지표 엔진이 잠깐 꺼졌던 경우 다시 시도할 수 있게)
    found.catch(() => cache.delete(key));
    // 날짜가 바뀐 옛 항목은 버린다
    for (const k of cache.keys()) if (!k.includes(`|${day}|`)) cache.delete(k);
  }
  return found;
}

export async function previewProfile(params: SwingParams): Promise<PreviewResult> {
  const symbols = watchlistSymbols();
  const [mine, baseline] = await Promise.all([statsFor(params, symbols), statsFor(STANDARD_SWING, symbols)]);
  return { ...mine, baseline, symbols: symbols.length, days: REPLAY_DAYS };
}
