/**
 * 거래정지 화면 「미국 정규장에만 목록」 — `GET /api/us-halts` 의 `regularOpen` · `nextRegularOpen` · `nextRegularClose`.
 * 판단 = 종목 지도와 같은 `heatmapSession('US', now)` 의 세션이 정규장인가(토스 달력 — 조기 마감 · 휴장 반영, 못 받으면 고정표).
 * 새 판단을 만들지 않는다. 보조 판단(최근 체결 `/prices`)은 부르지 않는다(`probe: false` — 정규장은 시간표로만 정해진다).
 * ⚠️ 받기 작업(04:00~20:00 ET · 이어 받기)과 상관없다 — 서버는 정규장 밖에도 계속 쌓고, 화면만 숨긴다.
 */
import { heatmapSession, nextSessionSpan } from '../heatmapSession';

export interface UsRegularStatus {
  regularOpen: boolean;
  /** 다음 정규장 시작 · 끝(epoch ms — 지금 열려 있으면 그다음 것). 모르면 null */
  nextRegularOpen: number | null;
  nextRegularClose: number | null;
}

export async function usRegularStatus(now = Date.now()): Promise<UsRegularStatus> {
  const info = await heatmapSession('US', now, { probe: false });
  const next = await nextSessionSpan('US', 'regular', now);
  return { regularOpen: info.span?.session === 'regular', nextRegularOpen: next?.start ?? null, nextRegularClose: next?.end ?? null };
}
