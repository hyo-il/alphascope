/**
 * 「그 차수가 매매 · 시황 · 공유 코드를 건드리지 않았다」 시험이 함께 쓰는 비교 한 곳 — **그 차수 범위만** 본다.
 *
 * - 범위 = 그 차수의 기준 커밋(`base`) → 그 차수 마지막 커밋. 끝난 차수는 **커밋끼리** 견주므로 뒤 차수가 같은 파일을 바꿔도 걸리지 않는다
 *   (뒤 차수 몫은 그 차수의 새 시험이 본다 — 뒤 차수는 여기에 아무것도 더하지 않는다).
 * - 끝 찾기: `src/data/changelog.ts` 에 그 차수 버전(`version: 'vX'`)을 **처음 더한 커밋**(`CLAUDE.md` 2-6 — changelog 는 그 차수 마지막 커밋에 담음).
 *   그 커밋이 없으면(지금 하는 차수) 작업 트리까지 본다.
 * - 그 뒤에 고침 커밋이 더 있었던 차수는 시험이 `end` 에 `PROMPTS_INDEX.md` 그 줄의 마지막 해시를 직접 적는다.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** 한 차수 — 기준 커밋 · 그 차수 버전 · (예외만) 마지막 커밋 */
export interface Chasu {
  base: string;
  version: string;
  end?: string;
}

function git(root: string, args: string[]) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

const endCache = new Map<string, string | null>();

/** 그 차수 마지막 커밋(짧은 해시) — 없으면 `null`(지금 하는 차수 · 작업 트리까지) */
export function chasuEnd(root: string, c: Chasu): string | null {
  if (c.end) return c.end;
  const key = `${root}\0${c.base}\0${c.version}`;
  if (endCache.has(key)) return endCache.get(key)!;
  const r = git(root, ['log', '--reverse', '--ancestry-path', '--format=%h', `-Sversion: '${c.version}'`, `${c.base}..HEAD`, '--', 'src/data/changelog.ts']);
  if (r.status !== 0) throw new Error(`chasuRange: ${c.base} → ${c.version} 끝 찾기 실패 — ${r.stderr.trim()}`);
  const end = r.stdout.split('\n').filter(Boolean)[0] ?? null;
  endCache.set(key, end);
  return end;
}

/** 보고 · 시험 이름에 쓰는 범위 글 — `base..end` 또는 `base..작업 트리` */
export function chasuLabel(root: string, c: Chasu): string {
  return `${c.base}..${chasuEnd(root, c) ?? '작업 트리'}`;
}

/** `git diff <opts> <base> [<end>] -- <paths>` — 그 차수 범위(끝이 없으면 작업 트리까지) */
export function chasuDiff(root: string, c: Chasu, opts: string[], paths: string[]) {
  const end = chasuEnd(root, c);
  return git(root, ['diff', ...opts, c.base, ...(end ? [end] : []), '--', ...paths]);
}

/** 그 차수가 바꾼 파일 이름(`--name-only`) — 빈 줄 없이 */
export function chasuChanged(root: string, c: Chasu, paths: string[]): string[] {
  return chasuDiff(root, c, ['--name-only'], paths).stdout.split('\n').filter(Boolean);
}

/** 그 차수가 바꾼 줄(`-U0`) */
export function chasuPatch(root: string, c: Chasu, paths: string[]): string {
  return chasuDiff(root, c, ['-U0'], paths).stdout;
}

/** 그 차수가 지운 줄(`-` 로 시작 · 파일 머리 `---` 제외) */
export function chasuDeleted(root: string, c: Chasu, paths: string[]): string[] {
  return chasuPatch(root, c, paths).split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
}

/** 아직 커밋하지 않은 새 파일 — 지금 하는 차수(끝 없음)만 센다 · 끝난 차수는 커밋끼리 견주므로 0개 */
export function chasuUntracked(root: string, c: Chasu, paths: string[]): string[] {
  if (chasuEnd(root, c)) return [];
  // 링크(scratch worktree 의 `python/.venv` 같은 시험 환경 연결)는 코드가 아니다
  return git(root, ['ls-files', '--others', '--exclude-standard', '--', ...paths])
    .stdout.split('\n')
    .filter((f) => f && !fs.lstatSync(path.join(root, f)).isSymbolicLink());
}
