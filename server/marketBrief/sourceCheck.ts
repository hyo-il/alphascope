/**
 * 오늘 시황 — 소스 점검(`npm run -s marketbrief:sources`, v2.59.6). 오라클에서 어느 소스 · 후보가 열리는지 본다.
 *
 * - 모든 소스 · 후보(국내 · 해외 뉴스 · 해외 4번째 자리 후보 · 국내 폴백 · 미2년물 후보)를 **각 1번** 연다 — 후보가 성공해도 다음 후보까지.
 * - 앱 DB 를 열지 않는다 · Gemini 0 · 토스 0. 미2년물은 지표 엔진 파이썬(`market_brief.py --check-us2y`)이 같은 받기 함수로 연다.
 * - 열기는 바꿔 끼울 수 있다(시험은 네트워크 0).
 */

import { DOMESTIC_FALLBACK, DOMESTIC_RSS, FOREIGN_RSS, FOREIGN_SLOT_CANDIDATES, fetchRssRaw, parseFeed, type RssSource } from './news';

export interface SourceRow {
  group: string;
  source: string;
  /** HTTP 코드 — 연결 실패 · 시간 초과면 null */
  status: number | null;
  ms: number;
  /** 받은 건수 · 값 · 실패 이유 */
  got: string;
  ok: boolean;
}

export interface Us2yCheck {
  source: string;
  status: number | null;
  ms: number;
  value: { current: number; data_date: string | null } | null;
  error: string | null;
}

export interface SourceCheckDeps {
  rss: (url: string) => Promise<{ status: number; text: string }>;
  us2y: () => Promise<Us2yCheck[]>;
  now: () => number;
}

/** 미2년물 후보 — 지표 엔진 파이썬을 한 번 띄워 후보마다 1번 */
async function us2yFromPython(): Promise<Us2yCheck[]> {
  const { execFile } = await import('node:child_process');
  const out = await new Promise<string>((resolve, reject) =>
    execFile('.venv/bin/python', ['market_brief.py', '--check-us2y'], { cwd: 'python', timeout: 90_000 }, (e, stdout, stderr) =>
      e ? reject(new Error(`${e.message}${stderr ? ` — ${stderr.trim().split('\n').at(-1)}` : ''}`)) : resolve(stdout),
    ),
  );
  return JSON.parse(out.trim().split('\n').at(-1) ?? '[]') as Us2yCheck[];
}

export const defaultSourceCheckDeps: SourceCheckDeps = { rss: fetchRssRaw, us2y: us2yFromPython, now: () => Date.now() };

async function rssRow(group: string, src: RssSource, deps: SourceCheckDeps): Promise<SourceRow> {
  const started = deps.now();
  try {
    const { status, text } = await deps.rss(src.url);
    const ms = deps.now() - started;
    if (status < 200 || status >= 300) return { group, source: src.source, status, ms, got: `HTTP ${status}`, ok: false };
    const items = parseFeed(text, src.source, false);
    const newest = items.map((i) => i.publishedAt).filter(Boolean).sort().at(-1);
    return { group, source: src.source, status, ms, got: items.length ? `${items.length}건${newest ? ` · 최신 ${newest.slice(0, 10)}` : ''}` : '글 0개', ok: items.length > 0 };
  } catch (e) {
    return { group, source: src.source, status: null, ms: deps.now() - started, got: (e as Error).message || '받기 실패', ok: false };
  }
}

/** 전부 — 소스 그룹 순서대로(같은 그룹은 나란히) */
export async function checkSources(deps: SourceCheckDeps = defaultSourceCheckDeps): Promise<SourceRow[]> {
  const groups: [string, RssSource[]][] = [
    ['국내 뉴스', DOMESTIC_RSS],
    ['국내 뉴스(폴백)', [DOMESTIC_FALLBACK]],
    ['해외 뉴스', FOREIGN_RSS],
    ['해외 대체 소스 후보', FOREIGN_SLOT_CANDIDATES],
  ];
  const [news, rates] = await Promise.all([
    Promise.all(groups.map(([g, list]) => Promise.all(list.map((s) => rssRow(g, s, deps))))),
    deps.us2y().catch((e: Error): Us2yCheck[] => [{ source: '지표 엔진 파이썬', status: null, ms: 0, value: null, error: e.message }]),
  ]);
  const rateRows: SourceRow[] = rates.map((r) => ({
    group: '미2년물 금리 후보',
    source: r.source,
    status: r.status,
    ms: r.ms,
    got: r.value ? `${r.value.current}%(${r.value.data_date ?? '날짜 모름'})` : (r.error ?? '값 없음'),
    ok: Boolean(r.value),
  }));
  return [...news.flat(), ...rateRows];
}

/** 표 — 「묶음 | 후보 | HTTP | 걸린 시간 | 받은 것」(마크다운 표 — 개발 대화에 그대로 붙인다) */
export function sourceTable(rows: SourceRow[]): string {
  const head = ['| 묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값 |', '|---|---|---|---|---|'];
  const body = rows.map((r) => `| ${r.group} | ${r.source} | ${r.status ?? '—'} | ${(r.ms / 1000).toFixed(1)}초 | ${r.ok ? '' : '실패 · '}${r.got.replace(/\|/g, '/')} |`);
  const failed = rows.filter((r) => !r.ok).length;
  return [...head, ...body, '', `${rows.length}곳 중 ${rows.length - failed}곳 받음 · ${failed}곳 실패`].join('\n');
}
