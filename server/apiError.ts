import type express from 'express';

/** 처리하지 못한 오류 — 로그 한 줄 + 500 { error } (`server/index.ts` 와 기능별 `routes.ts` 가 같이 쓴다) */
export function fail(res: express.Response, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.error('[api]', message);
  res.status(500).json({ error: message });
}
