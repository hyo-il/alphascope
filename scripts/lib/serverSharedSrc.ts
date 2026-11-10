/**
 * 서버가 함께 쓰는 `src/` 파일(129차 · v2.69.1) — `server/` 의 `from '…/src/…'` 가 가리키는 파일(직접)과,
 * 그 파일들이 다시 가져다 쓰는 `src/` 파일을 끝까지 따라간 전체(닫힘). 매매 영향 판단 · 「바뀐 줄 0」 시험이 같이 쓴다.
 * 상대 경로 가져오기만 따라간다(패키지 이름은 `src/` 밖).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
  }
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec).replace(/\.js$/, '');
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')])
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

const importsOf = (file: string) => [...fs.readFileSync(file, 'utf8').matchAll(SPEC)].map((m) => resolve(file, m[1])).filter((f): f is string => !!f);

const rel = (f: string) => path.relative(ROOT, f);
const inSrc = (f: string) => rel(f).startsWith('src/');

/** `direct` = 서버가 바로 가져다 쓰는 `src/` 파일 · `closure` = 그 파일들이 다시 가져다 쓰는 `src/` 파일까지(직접 포함) — 저장소 기준 경로 */
export function serverSharedSrc(): { direct: string[]; closure: string[] } {
  const direct = new Set<string>();
  for (const f of walk(path.join(ROOT, 'server'))) for (const t of importsOf(f)) if (inSrc(t)) direct.add(t);
  const closure = new Set<string>(direct);
  const queue = [...direct];
  while (queue.length) {
    const f = queue.pop()!;
    for (const t of importsOf(f)) if (inSrc(t) && !closure.has(t)) {
      closure.add(t);
      queue.push(t);
    }
  }
  return { direct: [...direct].map(rel).sort(), closure: [...closure].map(rel).sort() };
}
