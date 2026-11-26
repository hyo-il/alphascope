/**
 * 「이 작업이 매매 · 시황 · 공유 코드를 건드리지 않았다」 시험(자산 시험들 — 그 차수의 기준 커밋과 지금 작업 트리를 `git diff`)이 함께 쓰는 비교 한 곳.
 *
 * 그 뒤 **다른 지시서가 바꾼 파일**은 둘로 나눠 견준다 — ① 기준 커밋 → 그 지시서 커밋 바로 앞(그 차수의 뜻 그대로) ② 그 지시서 커밋 → 지금(그 뒤 다시 바뀌면 걸린다).
 * 지시된 변경 때문에 옛 시험이 모두 깨지지 않게 하면서 확인하는 범위는 줄이지 않는다. 지시서가 이런 파일을 바꾸면 여기에 한 줄(파일 → 그 커밋)을 더한다.
 * 한 커밋이 파일을 많이 바꾸면(정리 등) 그 커밋을 `LATER_COMMITS` 에 한 줄 — 그 커밋이 바꾼 파일 전부를 같은 방법으로 나눈다.
 * 한 파일을 여러 지시서가 바꿨으면 차례대로 나눈다(기준 → 첫 커밋 앞 · 첫 커밋 → 둘째 커밋 앞 · … · 마지막 커밋 → 지금). 기준 커밋보다 앞선 커밋은 쓰지 않는다.
 */
import { spawnSync } from 'node:child_process';

export const LATER_CHANGES: Readonly<Record<string, string>> = {
  'server/autoTrading/guards.ts': 'b72df96', // 136차 v2.70.2 B — 실적 회피 사유에 「미국 날짜」(문장만)
  'src/utils/autoTradeExplain.ts': 'ca9606d', // 136차 v2.70.2 A — 「최근 판단」 줄 종류 noteKind · 거래 내역 「자동」 판별
  'scripts/designCheck.ts': 'ca9606d', // 136차 v2.70.2 A — 「최근 판단」 장면(보기 이름 · 못 산 이유)
};

/** 지시서 커밋 전체(오래된 것부터) — 그 커밋이 바꾼 파일은 모두 위처럼 나눠 견준다 */
export const LATER_COMMITS: readonly string[] = [
  '6ce2321', // 137차 v2.70.3 A — 서버 · 공유 파일 export 떼기(이름 · 본문 그대로) · 끝난 데이터 정리 · 배포 스크립트 지움
  '1ccbaf0', // 137차 v2.70.3 B — 「최근 판단」 매도 주문 실패는 「그대로」(화면 셈만)
  'deaf94c', // 138차 v2.70.4 B — 자산 「현금 합계」 계좌별 펼침(화면) · design:check 장면 2
  'ed19639', // 139차 v2.71.0 A — 현금 자동 반영 계산 · 기록(타입 더하기 · 「월 고정지출」 칸 정의 · google.ts 주석 · 쓰는 곳 목록 시험)
  '9d80375', // 139차 v2.71.0 B — 현금 자동 반영 예약(server/index.ts 예약 시작)
  '8932789', // 139차 v2.71.0 C — 매수 · 매도 때 예수금(routes · summary 환율 함수 · 매수 창)
  '55962dd', // 139차 v2.71.0 D — 설정 「현금 자동 반영」 화면 · design:check 장면(더하기만)
  'd7361a8', // 140차 v2.71.1 A — 은행 묶기 · 미리 보기 · 설정 모양 2(타입 더하기 · 현금 설정 서버)
  '90c92b5', // 140차 v2.71.1 B — 현금 자동 반영 설정 화면 다시 그리기 · 타입 더하기 · design:check 장면 3(더하기만)
  '9c42321', // 140차 v2.71.1 C — 매수 창 예수금 문장 · 「현금 합계」 은행별 · design:check 장면 1(더하기만)
  '9466811', // 140차 v2.71.1 H — 캡처 검토 반영(이 차수에 더한 미리 보기 까닭 글 하나 고침) · 시험 손질
  '461e95d', // 141차 v2.71.2 H — 빨간 표시 · 예수금 한 줄 시험 · design:check 장면 5(더하기만)
  'b695e82', // 142차 v2.71.3 A — 예수금 balance · 시트 응답 짝(routes pair · sheet 응답 칸 더하기 · 타입 더하기)
  '793d3a6', // 142차 v2.71.3 H — design:check 장면 4(더하기만) · 예수금 줄 둘째 줄
  '4ba3004', // 143차 v2.72.0 A — 직접 입출금 서버(타입 더하기 · cashMoves 켬 판단 · 새 cashManual · routes manual)
  '027626d', // 143차 v2.72.0 B — [입출금] 화면 · design:check 장면 7(더하기만) · 견본 더하기
  'e9ec1fd', // 145차 v2.72.2 A — 막는 로딩 부품(LoadingOverlay) · 창 busy · 매수 판단 표 덮개 · 읽기 덮개를 표시로
  '0b36dc1', // 145차 v2.72.2 B — 나갈 때 묻기(Dialog dirty · leaveGuard · appStore 화면 바꾸기)
  '0310c5e', // 145차 v2.72.2 C — 창 dirty · busy 맞추기(자산 · 모의 계좌 · 규칙 · 목표 창) · 편집 화면 묻기
  '511d287', // 145차 v2.72.2 H — 덮개 구조 · design:check 장면(더하기만 · 장면 뒤 정리 함수)
  '6284b37', // 146차 v2.73.0 F — design:check 폰 · 패드 크기 · 앱틀 장면 · 「화면 가로 넘침」 항목(더하기만)
  '882effb', // 147차 v2.74.0 A — 폰 창 아래 판(ui/tokens.ts 이름 더하기 · Dialog · index.css)
  '52ca4a2', // 147차 v2.74.0 B — design:check 「누르는 칸 44 미만」 · 「누르는 칸 겹침」(손가락 화면만 · 더하기만)
  '7664602', // 147차 v2.74.0 B — 손가락 크기(ui/tokens.ts 이름 · 공용 부품 · 표 줄 높이 이름)
  '3f0dc69', // 147차 v2.74.0 C — 툴팁 손가락(ui/tooltip/hover.ts 판단 더하기 · tokens.ts 시간 이름)
  '1ae5c3d', // 147차 v2.74.0 F — 폰 종목 지도(ui/tokens.ts 지도 높이 이름)
  'afa438d', // 147차 v2.74.0 H — design:check 장면 4(폰 · 패드 창 · 시황 띠 시계 · 손가락 [ⓘ] — 더하기만)
  '5ff8377', // 148차 v2.75.0 A — 옆으로 미는 표 부품(ui/tokens.ts 이름 칸 최소 폭 이름 더하기 · ScrollTable · index.css)
  '568c390', // 148차 v2.75.0 B — 표 32곳 감싸기(ui/tokens.ts 폰 · 패드 이름 칸 · 한 줄 칸 이름 더하기)
  '2d31822', // 148차 v2.75.0 C — 점검 7줄(ui/tokens.ts 한 줄 칸 이름 바꿈 · 설명 글)
  '2257186', // 149차 v2.76.0 B — 폰 계좌 보유 카드(ui/tokens.ts 카드 이름 더하기)
  '102e629', // 149차 v2.76.0 C — 계좌 · 자동매매 점검 줄(ui/tokens.ts 손가락 줄 사이 · 칩 크기 이름 더하기 · 공용 부품)
  '23e3771', // 149차 v2.76.0 D — 시험 mobileaccount:test · ui/tokens.ts 손가락 표 줄 이름 더하기
];

const covers = (spec: string, file: string) => file === spec || file.startsWith(`${spec.replace(/\/$/, '')}/`);

function run(root: string, args: string[]) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/** 파일 → 그 파일을 바꾼 뒤 지시서 커밋들(오래된 것부터 · 기준 커밋 뒤의 것만) */
function laterFiles(root: string, base: string): Map<string, string[]> {
  const after = (c: string) => run(root, ['merge-base', '--is-ancestor', base, c]).status === 0 && run(root, ['rev-parse', base]).stdout !== run(root, ['rev-parse', c]).stdout;
  const map = new Map<string, string[]>();
  const add = (f: string, c: string) => map.set(f, [...(map.get(f) ?? []), c]);
  for (const [f, c] of Object.entries(LATER_CHANGES)) if (after(c)) add(f, c);
  for (const c of LATER_COMMITS) {
    if (!after(c)) continue;
    for (const f of run(root, ['diff', '--name-only', `${c}^`, c]).stdout.split('\n').filter(Boolean)) add(f, c);
  }
  return map;
}

/** `git diff <opts> <base> -- <paths>` 와 같은 모양(status · stdout · stderr) — 뒤에 바뀐 파일은 위 ① ② 로 */
function laterAware(root: string, opts: string[], base: string, paths: string[]) {
  const later = [...laterFiles(root, base)].filter(([f]) => paths.some((p) => covers(p, f)));
  const all = [
    run(root, ['diff', ...opts, base, '--', ...paths, ...later.map(([f]) => `:!${f}`)]),
    ...later.flatMap(([f, cs]) => {
      const starts = [base, ...cs];
      const ends = [...cs.map((c) => `${c}^`), null];
      return starts.map((from, i) => run(root, ['diff', ...opts, from, ...(ends[i] ? [ends[i]!] : []), '--', f]));
    }),
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
