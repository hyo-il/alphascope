#!/bin/bash
# Claude Code PreToolUse(Bash) 훅 — 검사 · 시험 · 빌드 출력을 파이프로 자르는 명령을 막는다(v2.83.0 검사 줄이기 · CLAUDE.md 2-1).
#
# 막는 것: 한 파이프 줄(;  &&  ||  줄바꿈으로 나뉜 조각)의 앞쪽에 `npm run` · `npx tsc` · `npx tsx scripts/` · `vite build` 가 있고,
#          그 뒤 파이프(`|` · `|&`) 단계가 `tail` · `head` · `grep` · `sed` · `awk` 로 시작하는 명령.
# 막으면: 이유 한 줄을 stderr 로 내고 종료 코드 2(Claude Code 가 실행하지 않음). 그 밖은 종료 코드 0(그대로 실행).
# 설정: 관리 루트 `.claude/settings.json` 의 hooks.PreToolUse(matcher Bash) — 끄려면 그 줄을 지운다.
# 시험: `npm run hooks:test`(scripts/hooksSelfTest.ts).
set -u
input="$(cat)"
node -e '
let cmd = "";
try {
  cmd = String(JSON.parse(process.argv[1] || "{}")?.tool_input?.command ?? "");
} catch {
  process.exit(0); // 읽지 못한 입력은 막지 않는다(훅이 다른 명령을 막지 않게)
}
const CHECK = /(^|[\s;&|(])(npm\s+run\s|npx\s+tsc\b|npx\s+tsx\s+scripts\/|vite\s+build\b)/;
const TRIM = /^\s*(tail|head|grep|sed|awk)\b/;
// 따옴표 안의 글은 나누지 않는다(작은 · 큰따옴표) — 조각(; && || 줄바꿈) → 파이프 단계(| · |&)
function split(s) {
  const segs = [[""]];
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const seg = segs[segs.length - 1];
    if (q) {
      if (c === q) q = null;
      seg[seg.length - 1] += c;
      continue;
    }
    if (c === "\x27" || c === "\"") { q = c; seg[seg.length - 1] += c; continue; }
    if (c === "\\" && i + 1 < s.length) { seg[seg.length - 1] += c + s[++i]; continue; }
    const two = s.slice(i, i + 2);
    if (two === "&&" || two === "||") { segs.push([""]); i++; continue; }
    if (c === ";" || c === "\n") { segs.push([""]); continue; }
    if (c === "|") { if (s[i + 1] === "&") i++; seg.push(""); continue; }
    seg[seg.length - 1] += c;
  }
  return segs;
}
// heredoc 본문(커밋 메시지 · 파일 내용)은 명령이 아니다 — `<<[-]["]끝["]` 다음 줄부터 「끝」 한 줄까지 뺀다
function dropHeredocs(s) {
  const lines = s.split("\n");
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.replace(/^\t+/, "") === end) end = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (m) end = m[2];
  }
  return out.join("\n");
}
for (const stages of split(dropHeredocs(cmd))) {
  const first = stages.findIndex((st) => CHECK.test(st));
  if (first < 0) continue;
  if (stages.slice(first + 1).some((st) => TRIM.test(st))) {
    process.stderr.write("검사 출력은 자르지 않습니다 — `--summary` · `summary.md` 를 보세요(scripts/hooks/blockTrimmedChecks.sh · CLAUDE.md 2-1)\n");
    process.exit(2);
  }
}
process.exit(0);
' "$input"
