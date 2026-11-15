/**
 * 「이 작업이 매매 · 시황 · 공유 코드를 건드리지 않았다」 시험(자산 시험들 — 그 차수의 기준 커밋과 지금 작업 트리를 `git diff`)이 함께 쓰는 비교 한 곳.
 *
 * 그 뒤 **다른 지시서가 바꾼 파일**은 둘로 나눠 견준다 — ① 기준 커밋 → 그 지시서 커밋 바로 앞(그 차수의 뜻 그대로) ② 그 지시서 커밋 → 지금(그 뒤 다시 바뀌면 걸린다).
 * 지시된 변경 때문에 옛 시험이 모두 깨지지 않게 하면서 확인하는 범위는 줄이지 않는다. 지시서가 이런 파일을 바꾸면 여기에 한 줄(파일 → 그 커밋)을 더한다.
 */
import { spawnSync } from 'node:child_process';

export const LATER_CHANGES: Readonly<Record<string, string>> = {
  'server/autoTrading/guards.ts': 'b72df96', // 136차 v2.70.2 B — 실적 회피 사유에 「미국 날짜」(문장만)
  'src/utils/autoTradeExplain.ts': 'ca9606d', // 136차 v2.70.2 A — 「최근 판단」 줄 종류 noteKind · 거래 내역 「자동」 판별
  'scripts/designCheck.ts': 'ca9606d', // 136차 v2.70.2 A — 「최근 판단」 장면(보기 이름 · 못 산 이유)
};

const covers = (spec: string, file: string) => file === spec || file.startsWith(`${spec.replace(/\/$/, '')}/`);

function run(root: string, args: string[]) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** `git diff <opts> <base> -- <paths>` 와 같은 모양(status · stdout · stderr) — 뒤에 바뀐 파일은 위 ① ② 로 */
function laterAware(root: string, opts: string[], base: string, paths: string[]) {
  const later = Object.entries(LATER_CHANGES).filter(([f]) => paths.some((p) => covers(p, f)));
  const all = [
    run(root, ['diff', ...opts, base, '--', ...paths, ...later.map(([f]) => `:!${f}`)]),
    ...later.flatMap(([f, c]) => [run(root, ['diff', ...opts, base, `${c}^`, '--', f]), run(root, ['diff', ...opts, c, '--', f])]),
  ];
  return {
    status: all.find((r) => r.status !== 0)?.status ?? 0,
    stdout: all.map((r) => r.stdout).join(''),
    stderr: all.map((r) => r.stderr).join(''),
  };
}

/** `git diff --name-only <base> -- <paths>` — 바뀐 파일 이름(뒤 지시서가 바꾼 파일은 그 지시서 몫을 빼고) */
export function tradingDiff(root: string, base: string, paths: string[]) {
  const r = laterAware(root, ['--name-only'], base, paths);
  return { ...r, stdout: [...new Set(r.stdout.split('\n').filter(Boolean))].map((l) => `${l}\n`).join('') };
}

/** `git diff -U0 <base> -- <paths>` — 바뀐 줄(뒤 지시서가 바꾼 파일은 그 지시서 몫을 빼고) */
export function laterAwarePatch(root: string, base: string, paths: string[]) {
  return laterAware(root, ['-U0'], base, paths);
}
