/**
 * 매매 시험을 여러 「실제 지금」 에서 돌려 견주기 — `npm run testclock:matrix -- [--at <ISO>,<ISO>…] [--only autotrade|buyjudge]`
 * ⚠️ `DB_PATH=<사본>` 으로만(맨 첫 import) · 지표 엔진(INDICATORS_PORT) 필요 · 토스 실제 데이터(`.env`) · 시험마다 사본을 새로 복사.
 *
 * 각 시각을 `TEST_REAL_NOW` 로 넣어 `autotrade:test` · `buyjudge:test` 를 돌리고, 확인 이름마다 통과/실패가 **첫 시각과 같은지** 표로 보인다.
 * 한 번에 시험 하나씩(토스 429) · 오래 걸려(시각 하나에 약 3분) 기계 검사(`check:all`)에는 넣지 않는다 — 기계 검사 몫은 `testclock:test`.
 *
 * 기본 시각(`--at` 없음): 지난 금요일(한국) 07:00 · 13:00 · 19:30 · 23:30 · 토요일 12:00.
 * 토스는 「진짜 지금」 의 일봉을 주므로, 흉내 낸 시각보다 뒤의 거래일 봉이 둘 이상이면 시각과 데이터가 맞지 않는다(그 판단은 「끝나지 않음」).
 * 그래서 이 도구는 **주말(토 06:30 ~ 월 06:30 한국)** 에 돌린다 — 그 밖이면 멈춘다. 서머타임 주처럼 데이터가 없는 시각은 「건너뜀」(→ `testclock:test` 가 고르기만 확인).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const H = 3_600_000;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const kstIso = (ms: number) => new Date(ms + 9 * H).toISOString().slice(0, 16).replace('T', ' ');

const now = Date.now();
const k = new Date(now + 9 * H);
const kDay = k.getUTCDay(); // 0 = 일
const kMid = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 9 * H;
const fridayMid = kMid - ((kDay + 2) % 7) * 24 * H; // 가장 가까운 지난(또는 오늘) 금요일 0시(한국)
const weekendFrom = fridayMid + 24 * H + 6.5 * H;
const weekendTo = fridayMid + 3 * 24 * H + 6.5 * H;
const custom = arg('--at');
if (!custom && (now < weekendFrom || now >= weekendTo)) {
  console.error(`주말(한국 토 06:30 ~ 월 06:30)에만 기본 시각으로 돈다 — 지금 ${kstIso(now)}. 다른 때는 --at 으로 시각을 직접 준다.`);
  process.exit(1);
}
const times = custom
  ? custom.split(',').map((s) => s.trim())
  : [[0, 7], [0, 13], [0, 19.5], [0, 23.5], [1, 12]].map(([d, h]) => new Date(fridayMid + d * 24 * H + h * H).toISOString());
const only = arg('--only');
const tests = [
  ['autotrade', 'scripts/autoTradingSelfTest.ts'],
  ['buyjudge', 'scripts/buyJudgeSelfTest.ts'],
].filter(([name]) => !only || name === only);

/** 시험 출력 → 확인 이름 → 통과 여부 (buyjudge 「PASS  이름 — …」 · autotrade 「  ✅ 이름 — …」) */
function parse(out: string): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const line of out.split('\n')) {
    const r = /^\s*(PASS|FAIL|✅|❌)\s+(.*)$/.exec(line);
    if (!r) continue;
    const name = r[2].split(' — ')[0].trim();
    m.set(m.has(name) ? `${name} #${m.size}` : name, r[1] === 'PASS' || r[1] === '✅');
  }
  return m;
}

const src = process.env.DB_PATH!;
const work = mkdtempSync(join(tmpdir(), 'clock-matrix-'));
let differ = 0;
try {
  for (const [name, file] of tests) {
    console.log(`\n## ${name}`);
    console.log('| 흉내 낸 실제 지금(한국) | 시험 시계 | 통과 | 실패 | 첫 시각과 다른 확인 |');
    console.log('|---|---|---|---|---|');
    let first: Map<string, boolean> | null = null;
    for (const t of times) {
      const db = join(work, `${name}-${Date.parse(t)}.db`);
      copyFileSync(src, db);
      const r = spawnSync('npx', ['tsx', file], { env: { ...process.env, DB_PATH: db, TEST_REAL_NOW: t, TEST_NOW: '' }, encoding: 'utf8', timeout: 9 * 60_000 });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const clock = /시험 시계: (\S+)/.exec(out)?.[1];
      const res = parse(out);
      const passN = [...res.values()].filter(Boolean).length;
      const failN = res.size - passN;
      let diff = '';
      if (!first) first = res;
      else {
        const names = new Set([...first.keys(), ...res.keys()]);
        const d = [...names].filter((n) => first!.get(n) !== res.get(n));
        if (d.length) differ++;
        diff = d.length ? `${d.length}개: ${d.slice(0, 3).join(' · ')}` : '없음';
      }
      if (!first.size || r.status == null) differ++;
      console.log(`| ${kstIso(Date.parse(t))} | ${clock ? kstIso(Date.parse(clock)) : '(없음)'} | ${passN} | ${failN} | ${first === res ? '(기준)' : diff}${r.status == null ? ' · 시간 초과' : ''} |`);
      for (const ext of ['', '-wal', '-shm']) rmSync(`${db}${ext}`, { force: true });
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n결과: ${differ ? `다른 시각 ${differ}곳` : '모든 시각이 같은 결과'}`);
process.exit(differ ? 1 : 0);
