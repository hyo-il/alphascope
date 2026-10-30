/*
  오늘 시황(탐색 → 오늘 시황, v2.59.0) 주소 — 평일 아침 자동 오전판 + 「시황 분석」 버튼(지금 시각 판 · 하루 5번).
  ⚠️ 판단 · 주문과 무관하다. 버튼은 시작만 하고 바로 돌려준다 — 화면은 진행 상태를 읽는다(진행 중에만).
  `server/index.ts` 가 문지기(authGuard) 뒤에서 `app.use(marketBriefRouter)` 로 붙인다 — 주소는 전체 경로 그대로 적는다.
*/
import { Router } from 'express';
import { fail } from '../apiError';
import { BriefLimitError, briefStatus, startButtonRun } from './service';
import { getBrief, listBriefDays, listBriefsOf } from './store';
import { outlookView } from './outlookScore';

export const marketBriefRouter = Router();

marketBriefRouter.get('/api/market-brief/status', (_req, res) => {
  try {
    res.json(briefStatus());
  } catch (e) {
    fail(res, e);
  }
});

marketBriefRouter.get('/api/market-brief/days', (_req, res) => {
  try {
    res.json({ days: listBriefDays() });
  } catch (e) {
    fail(res, e);
  }
});

marketBriefRouter.get('/api/market-brief', async (req, res) => {
  try {
    const rawDate = req.query.date;
    const rawId = req.query.id;
    if (rawDate !== undefined && (typeof rawDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate))) {
      return res.status(400).json({ error: 'date 는 YYYY-MM-DD 입니다.' });
    }
    if (rawId !== undefined && (typeof rawId !== 'string' || !/^\d+$/.test(rawId))) {
      return res.status(400).json({ error: 'id 는 숫자입니다.' });
    }
    const date = typeof rawDate === 'string' ? rawDate : briefStatus().today;
    const items = listBriefsOf(date);
    // 고른 줄이 그날 것이 아니면 그날 가장 최근 것
    const wanted = typeof rawId === 'string' ? items.find((i) => i.id === Number(rawId)) : undefined;
    const pick = wanted ?? items[0];
    const selected = pick ? getBrief(pick.id) : null;
    // 「오늘 예상 방향」 채점 상태 · 최근 성적(v2.60.0) — 예상이 있는 브리핑만. 채점 읽기가 실패해도 브리핑은 보인다
    const outlook = selected?.brief?.today_outlook?.length
      ? await outlookView({ id: selected.id, createdAt: selected.createdAt, outlook: selected.brief.today_outlook }, Date.now()).catch((e: Error) => {
          console.warn('[market-brief] 예상 채점 상태 읽기 실패:', e.message);
          return undefined;
        })
      : undefined;
    res.json({ date, items, selected, ...(outlook ? { outlook } : {}) });
  } catch (e) {
    fail(res, e);
  }
});

marketBriefRouter.post('/api/market-brief/run', (_req, res) => {
  try {
    const { started } = startButtonRun();
    // 진행 중이면 새로 시작하지 않는다 — 진행 상태를 그대로 돌려준다
    res.status(started ? 202 : 200).json({ started, status: briefStatus() });
  } catch (e) {
    if (e instanceof BriefLimitError) return res.status(429).json({ error: e.message, status: briefStatus() });
    fail(res, e);
  }
});
