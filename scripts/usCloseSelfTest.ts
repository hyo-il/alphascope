/**
 * 미국 마감 직후 값 기록 · 결과 보기 점검 — `npm run ussample:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 고정 시각 · 가짜 토스로: 시간 밖 · 휴장일 · 서머타임 바뀌는 날(11-01 앞뒤) · startDate/endDate · 실패 줄 · 토큰 발급 실패 뒤 멈춤 ·
 * 종목 고르기(20개 상한) · 앱 DB 에 쓰지 않음 · 결과 보기 비교. 기록 파일은 임시 폴더에만 쓴다.
 * `--real` 이면 마지막에 실제 토스로 한 번(SPY · QQQ, 2026-10-16 봉).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dbFilePath } from '../server/db';
import { isMockMode } from '../server/mockData';
import { getAccessToken, setTokenStore, TossAuthError } from '../src/services/toss/auth';
import { isKrSymbol } from '../src/utils/market';
import type { Candle } from '../src/types/toss';
import { compareGroups, conclusion, etParts, readLines, renderReport, type SampleLine, type SamplerConfig } from './lib/usClose';
import { fileTokenStore, heldUsSymbols, pickSymbols, runSampler } from './usCloseSampler';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ussample-'));
const outFile = path.join(tmp, 'us-close.jsonl');
const dbPath = dbFilePath();
// 읽기 전용으로 열어도 SQLite 가 빈 -wal · -shm 을 만든다(WAL 모드) — 없음과 빈 파일은 같은 것으로 본다. -shm 은 공유 메모리 색인이라 보지 않는다
const hashOf = (p: string) => {
  const data = fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
  return crypto.createHash('sha256').update(data).digest('hex');
};
const dbHashBefore = [dbPath, `${dbPath}-wal`].map(hashOf).join(',');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const config: SamplerConfig = {
  startDate: '2026-10-19',
  endDate: '2026-11-30',
  fixed: ['SPY', 'QQQ'],
  earnings: [
    { date: '2026-10-19', symbol: 'WRB', name: 'W. R. Berkley', when: 'after close', source: 'test' },
    { date: '2026-10-20', symbol: 'NFLX', name: 'Netflix', when: 'after close', source: 'test' },
  ],
};

/** 미국 일봉 timestamp — 그날 ET 자정(토스와 같은 모양) */
const etMidnight = (day: string, offset: string) => Date.parse(`${day}T00:00:00${offset}`);
const bar = (day: string, offset: string, close: number, volume = 1000): Candle => ({
  timestamp: etMidnight(day, offset),
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume,
});

let calls: string[] = [];
const fakeFetch = (day: string, offset: string) => async (symbol: string) => {
  calls.push(symbol);
  return [bar('2026-10-16', '-04:00', 99), bar(day, offset, 100)];
};

async function run(nowIso: string, extra: Partial<Parameters<typeof runSampler>[0]> = {}) {
  calls = [];
  return runSampler({ now: new Date(nowIso), config, outFile, db, held: [], fetchDaily: fakeFetch('2026-10-19', '-04:00'), ...extra });
}

// ── 1. 시각 — ET 변환과 시간대 경계 ──
{
  const a = etParts(new Date('2026-10-19T19:54:59Z'));
  check('ET 변환(서머타임 EDT)', a.day === '2026-10-19' && a.hhmm === '15:54', JSON.stringify(a));
  for (const [iso, want] of [
    ['2026-10-19T19:54:00Z', 'outside'], // 15:54 ET
    ['2026-10-19T19:55:00Z', 'recorded'], // 15:55 ET
    ['2026-10-20T00:40:30Z', 'recorded'], // 20:40 ET (10-19)
    ['2026-10-20T00:41:00Z', 'outside'], // 20:41 ET
    ['2026-10-19T13:30:00Z', 'outside'], // 09:30 ET 장중
  ] as const) {
    const r = await run(iso);
    check(`시간대 ${iso} → ${want}`, r.status === want && (want === 'recorded' || calls.length === 0), `${r.status} ${r.et} 호출 ${calls.length}`);
  }
  fs.rmSync(outFile, { force: true });
}

// ── 2. 휴장일 · 주말 · startDate · endDate ──
{
  const thanksgiving = await run('2026-11-26T21:30:00Z'); // 16:30 EST, 추수감사절(NYSE 표)
  check('휴장일(11-26 추수감사절) → 아무것도 안 함', thanksgiving.status === 'holiday' && calls.length === 0, thanksgiving.status);
  const saturday = await run('2026-10-24T20:30:00Z');
  check('주말(10-24 토) → 아무것도 안 함', saturday.status === 'holiday' && calls.length === 0, saturday.status);
  const before = await run('2026-10-16T20:30:00Z');
  check('startDate 앞(10-16) → 아무것도 안 함', before.status === 'before-start' && calls.length === 0, before.status);
  const ended = await run('2026-10-26T20:30:00Z', { config: { ...config, endDate: '2026-10-23' } });
  check('endDate 지남(10-26 > 10-23) → 아무것도 안 함', ended.status === 'ended' && calls.length === 0, ended.status);
  const lastDay = await run('2026-10-23T20:30:00Z', { config: { ...config, endDate: '2026-10-23' }, fetchDaily: fakeFetch('2026-10-23', '-04:00') });
  check('endDate 당일(10-23) → 기록', lastDay.status === 'recorded', lastDay.status);
  check('기록 파일이 없던 시간 밖 실행에서는 생기지 않았다', readLines(outFile).every((l) => l.day === '2026-10-23'));
  fs.rmSync(outFile, { force: true });
}

// ── 3. 서머타임 바뀌는 날(2026-11-01 일요일) 앞뒤 ──
{
  const fri = await run('2026-10-30T19:56:00Z', { fetchDaily: fakeFetch('2026-10-30', '-04:00') }); // 15:56 EDT
  check('10-30(금, EDT) 19:56Z = 15:56 ET → 기록', fri.status === 'recorded' && fri.et === '15:56', `${fri.status} ${fri.et}`);
  const fri2 = await run('2026-10-31T00:40:00Z', { fetchDaily: fakeFetch('2026-10-30', '-04:00') }); // 20:40 EDT
  check('10-31 00:40Z = 10-30 20:40 ET → 기록(날짜는 10-30)', fri2.status === 'recorded' && fri2.day === '2026-10-30', `${fri2.status} ${fri2.day}`);
  const monEarly = await run('2026-11-02T19:56:00Z', { fetchDaily: fakeFetch('2026-11-02', '-05:00') }); // 14:56 EST
  check('11-02(월, EST) 19:56Z = 14:56 ET → 시간 밖', monEarly.status === 'outside' && monEarly.et === '14:56', `${monEarly.status} ${monEarly.et}`);
  const mon = await run('2026-11-02T20:56:00Z', { fetchDaily: fakeFetch('2026-11-02', '-05:00') }); // 15:56 EST
  check('11-02 20:56Z = 15:56 ET → 기록', mon.status === 'recorded' && mon.et === '15:56', `${mon.status} ${mon.et}`);
  const monLate = await run('2026-11-03T01:41:00Z', { fetchDaily: fakeFetch('2026-11-02', '-05:00') }); // 20:41 EST
  check('11-03 01:41Z = 11-02 20:41 ET → 시간 밖', monLate.status === 'outside', monLate.status);
  const lines = readLines(outFile);
  check('EST 날 일봉(ET 자정 −05:00)을 그날 봉으로 찾음', lines.filter((l) => l.day === '2026-11-02').every((l) => l.barDate === '2026-11-02' && l.close === 100));
  fs.rmSync(outFile, { force: true });
}

// ── 4. 실패 줄 · 그날 봉 없음 · 토큰 발급 실패 ──
{
  const r = await run('2026-10-19T20:30:00Z', {
    fetchDaily: async (s) => {
      calls.push(s);
      if (s === 'QQQ') throw new Error('토스 API 요청 실패 (500)');
      if (s === 'WRB') return [bar('2026-10-16', '-04:00', 50)];
      return [bar('2026-10-19', '-04:00', 100)];
    },
  });
  const lines = readLines(outFile);
  const by = (s: string) => lines.find((l) => l.symbol === s);
  check('실패한 종목은 error 를 적고 넘어감', r.status === 'recorded' && by('QQQ')?.error?.includes('500') === true && by('SPY')?.close === 100, JSON.stringify(by('QQQ')));
  check('그날 봉이 없으면 error + 받은 봉 날짜', by('WRB')?.error === '그날 봉 없음' && by('WRB')?.barDate === '2026-10-16', JSON.stringify(by('WRB')));
  check('뒤 종목(NFLX)도 받음', by('NFLX')?.close === 100);
  fs.rmSync(outFile, { force: true });

  const r2 = await run('2026-10-19T20:30:00Z', {
    fetchDaily: async (s) => {
      calls.push(s);
      throw new TossAuthError('토큰 발급 실패 (429): too many', 429, '');
    },
  });
  const lines2 = readLines(outFile);
  check('토큰 발급 실패 → 첫 종목 한 번만 부르고 멈춤', calls.length === 1 && r2.status === 'recorded' && r2.failed === lines2.length, `호출 ${calls.length}`);
  check('남은 종목도 실패 줄이 남음', lines2.length === 4 && lines2.every((l) => l.error?.startsWith('토큰 발급 실패')), String(lines2.length));
  fs.rmSync(outFile, { force: true });
}

// ── 5. 종목 고르기 · 앱 DB 읽기 ──
{
  // 사본 DB 의 다른 복사본(임시 폴더)에 미국·국내·0주 보유를 넣고 읽기 전용으로 읽는다
  const posDbPath = path.join(tmp, 'positions.db');
  fs.copyFileSync(dbPath, posDbPath);
  const w = new Database(posDbPath);
  w.pragma('foreign_keys = OFF');
  w.exec(`DELETE FROM paper_positions`);
  const put = w.prepare(`INSERT INTO paper_positions (account_id, symbol, quantity, avg_price, total_cost, currency, opened_at, updated_at) VALUES (?, ?, ?, 1, 1, 'USD', 'x', 'x')`);
  put.run(1, 'AAPL', 3);
  put.run(2, 'AAPL', 1);
  put.run(1, '005930', 10);
  put.run(1, 'MSFT', 0);
  put.run(1, 'NVDA', 2);
  w.close();
  const ro = new Database(posDbPath, { readonly: true, fileMustExist: true });
  const held = heldUsSymbols(ro);
  ro.close();
  check('보유 종목은 미국 · 0주 아님 · 겹침 없음', held.join(',') === 'AAPL,NVDA' && held.every((s) => !isKrSymbol(s)), held.join(','));
  const picked = pickSymbols(config, '2026-10-19', ['AAPL', 'spy']);
  check('순서: 고정 → 그날 실적 → 보유 → 다른 날 실적, 겹침·소문자 정리', picked.symbols.join(',') === 'SPY,QQQ,WRB,AAPL,NFLX', picked.symbols.join(','));
  const many = Array.from({ length: 25 }, (_, i) => `T${i}`);
  const capped = pickSymbols(config, '2026-10-19', many);
  check('20개 상한 · 넘친 것은 dropped', capped.symbols.length === 20 && capped.dropped.length === 25 + 4 - 20, `${capped.symbols.length}/${capped.dropped.length}`);
  calls = [];
  await runSampler({ now: new Date('2026-10-19T20:30:00Z'), config, outFile, db, fetchDaily: fakeFetch('2026-10-19', '-04:00') });
  const appHeld = heldUsSymbols(db);
  check('held 를 안 넘기면 앱 DB 의 보유 미국 종목을 받음', appHeld.every((s) => calls.includes(s)) && calls.length === 4 + appHeld.length, `보유 ${appHeld.length} · 호출 ${calls.length}`);
  fs.rmSync(outFile, { force: true });
}

// ── 6. 결과 보기 비교 ──
{
  const mk = (et: string, at: string, o: Partial<SampleLine>): SampleLine => ({
    day: '2026-10-19', et, at: `2026-10-19T${at}Z`, symbol: 'SPY', barDate: '2026-10-19',
    open: 10, high: 12, low: 9, close: 11, volume: 1000, ...o,
  });
  const lines: SampleLine[] = [
    mk('16:00', '20:00:00', { close: 11.5, volume: 800 }),
    mk('16:30', '20:30:00', { volume: 950 }),
    mk('17:00', '21:00:00', { volume: 1000 }),
    mk('20:40', '00:40:00', { volume: 1000, at: '2026-10-20T00:40:00Z' }),
    { ...mk('16:30', '20:30:00', {}), symbol: 'QQQ', close: 5, volume: 7 },
    { ...mk('20:40', '00:40:00', {}), symbol: 'QQQ', close: 5, volume: 7, at: '2026-10-20T00:40:00Z' },
    { day: '2026-10-19', et: '16:30', at: '2026-10-19T20:30:01Z', symbol: 'NFLX', error: '토스 API 요청 실패 (500)' },
  ];
  const groups = compareGroups(lines);
  const spy = groups.find((g) => g.symbol === 'SPY')!;
  check('16:30 무렵 표본을 고름', spy.near?.et === '16:30', spy.near?.et);
  check('가격은 같음, 거래량은 다름(차이)', spy.near?.cells.close === '같음' && spy.near?.cells.volume === '다름(-50)', JSON.stringify(spy.near?.cells));
  check('가격 4칸 같아진 시각 16:30 · 5칸 17:00', spy.priceSettledEt === '16:30' && spy.allSettledEt === '17:00', `${spy.priceSettledEt} ${spy.allSettledEt}`);
  check('최종값 = 마지막 받은 시각(20:40)', spy.finalEt === '20:40');
  check('결론: 거래량 1건 다름 · 가격 4칸 같음 · 최대 %(950 vs 1000 = 5.00%) · 같아진 시각', conclusion(groups).includes('다르다 — 거래량 1건 (가격 4칸은 모두 같음). 거래량 차이는 최대 5.00%, 다섯 칸이 최종값과 같아진 가장 늦은 시각 17:00 ET.'), conclusion(groups));
  const late = compareGroups([mk('16:35', '20:35:00', { volume: 1 }), mk('20:40', '00:40:00', { at: '2026-10-20T00:40:00Z' })]);
  check('16:35 값은 「16:30 무렵」 으로 쓰지 않음(기록 시각보다 늦음) → 제외로 셈', late[0].near === null && conclusion(late).startsWith('결론: 판단할 표본이 없다'), conclusion(late));
  check('결론에 제외 수', conclusion([...groups, ...late.map((g) => ({ ...g, symbol: 'X' }))]).includes('제외 1개'), conclusion([...groups, ...late]));
  check('같은 종목만이면 「다섯 칸 모두 같다」', conclusion(groups.filter((g) => g.symbol === 'QQQ')).includes('다섯 칸 모두 같다'));
  const text = renderReport(lines);
  check('결과 표에 실패 줄 수', text.includes('실패 1줄') && text.includes('| 2026-10-19 | SPY | 16:30 | 같음 | 같음 | 같음 | 같음 | 다름(-50) | 16:30 | 17:00 | 20:40 | 4 |'), text.split('\n')[5]);
  const early = compareGroups([mk('16:30', '20:30:00', {}), mk('18:00', '22:00:00', {})]);
  check('마지막 기록이 20:30 보다 이르면 결론에서 뺌', conclusion(early).startsWith('결론: 판단할 표본이 없다'));
  fs.writeFileSync(outFile, '{"day":"2026-10-19"\n' + JSON.stringify(lines[0]) + '\n');
  check('끊긴 줄 하나는 건너뛰고 읽음', readLines(outFile).length === 1);
  fs.rmSync(outFile, { force: true });
}

// ── 7. 토큰 파일 ──
{
  const tokenFile = path.join(tmp, '.toss-token.json');
  const store = fileTokenStore(tokenFile);
  store.save({ accessToken: 'x', expiresAt: 1 });
  check('토큰 파일 권한 600', (fs.statSync(tokenFile).mode & 0o777) === 0o600, (fs.statSync(tokenFile).mode & 0o777).toString(8));
  check('토큰 파일 다시 읽기', store.load()?.accessToken === 'x');
  check('발급 시도는 한 실행에 1번(두 번째는 막음)', store.canIssue() && !store.canIssue() && !store.canIssue());
  store.clear();
  check('토큰 파일 지우기', !fs.existsSync(tokenFile) && store.load() === null);
  setTokenStore({ load: () => null, save: () => {}, clear: () => {}, canIssue: () => false });
  const refused = await getAccessToken().then(() => null, (e: unknown) => e);
  check('발급이 막히면 getAccessToken 이 토큰 요청 없이 TossAuthError(4xx 취급 — tossGet 이 다시 시도하지 않음)', refused instanceof TossAuthError && refused.status < 500, String(refused));
  setTokenStore(null);
}

// ── 8. 실제 토스 한 번(--real) — SPY · QQQ 의 10-16 봉 ──
if (process.argv.includes('--real')) {
  if (isMockMode()) {
    check('실제 토스(토스 키 없음 — 건너뜀)', false);
  } else {
    const tokenFile = path.join(tmp, '.toss-token.json');
    setTokenStore(fileTokenStore(tokenFile));
    const r = await runSampler({
      now: new Date('2026-10-16T21:00:00Z'),
      config: { startDate: '2026-10-16', endDate: '2026-10-16', fixed: ['SPY', 'QQQ'], earnings: [] },
      outFile,
      db,
      held: [],
    });
    const lines = readLines(outFile);
    check('실제 토스: 2종목 모두 그날 봉', r.status === 'recorded' && lines.length === 2 && lines.every((l) => !l.error && l.barDate === '2026-10-16'), JSON.stringify(lines));
    check('실제 토스: 토큰 파일(600)이 남음', fs.existsSync(tokenFile) && (fs.statSync(tokenFile).mode & 0o777) === 0o600);
    setTokenStore(null);
  }
}

db.close();
check('앱 DB(사본) 파일이 바뀌지 않음', [dbPath, `${dbPath}-wal`].map(hashOf).join(',') === dbHashBefore);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
