/**
 * 미국 마감 직후 값 점검(`ussample:run` 기록 · `ussample:report` 결과 보기)이 함께 쓰는 것 — 시각 판단 · 기록 한 줄 모양 · 비교.
 *
 * 알고 싶은 것: 매수 판단 매일 기록(16:30 ET)이 받는 미국 일봉이 애프터마켓이 끝난 뒤(20:00 ET)의 최종값과 같은가 —
 * 특히 마감 단일가와 늦은 체결로 **거래량**이 나중에 바뀌는가. 그래서 15:55~20:40 ET 사이에 5분마다 그날 일봉을 받아 적고,
 * 마지막(20:40 ET 무렵) 값과 비교한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 기록하는 시간대(ET, 분) — 15:55 ~ 20:40. 애프터마켓은 20:00 ET 에 끝나므로 마지막 40분은 늦은 반영을 보려는 여유다 */
export const WINDOW_START_MIN = 15 * 60 + 55;
export const WINDOW_END_MIN = 20 * 60 + 40;
/**
 * 「16:30 ET 무렵」 — 매수 판단 매일 기록 시각(`server/buyJudge/judge.ts` RECORD_AT)과 그 앞 5분만.
 * 16:30 뒤 값을 쓰면 실제 기록보다 늦게 받은 값이라 결과가 좋게 나올 수 있다.
 */
export const AROUND_1630 = { from: 16 * 60 + 25, to: 16 * 60 + 30, at: 16 * 60 + 30 };
/** 기록 파일 — 앱 폴더 밖(배포가 지우거나 덮지 않게) */
export const SAMPLE_FILE = path.join(os.homedir(), 'alphascope-samples', 'us-close.jsonl');
/** 한 번에 받는 종목 수 상한 */
export const MAX_SYMBOLS = 20;

/** 뉴욕 시각(서머타임은 Intl 이 맞춘다) — 날짜 YYYY-MM-DD · 분 · HH:MM */
export function etParts(now: Date): { day: string; minutes: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: hour * 60 + minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

export const inWindow = (minutes: number) => minutes >= WINDOW_START_MIN && minutes <= WINDOW_END_MIN;

/** `scripts/usCloseSampler.symbols.json` */
export interface SamplerConfig {
  /** 이 날(ET)부터 기록한다 */
  startDate: string;
  /** 이 날(ET)이 지나면 아무것도 하지 않는다 — 예약을 지우지 않아도 해가 없다 */
  endDate: string;
  /** 늘 받는 종목 */
  fixed: string[];
  /** 장 마감 뒤 실적 발표 종목 — 날짜는 회사 공식 IR·보도자료로 확인한 것만 */
  earnings: { date: string; symbol: string; name: string; when: string; source: string }[];
}

export function loadConfig(file: string): SamplerConfig {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SamplerConfig;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(raw.startDate) || !day.test(raw.endDate)) throw new Error(`${file}: startDate · endDate 는 YYYY-MM-DD`);
  if (!Array.isArray(raw.fixed) || !Array.isArray(raw.earnings)) throw new Error(`${file}: fixed · earnings 는 배열`);
  return raw;
}

/** 기록 한 줄 — 성공이면 다섯 칸, 실패면 error */
export interface SampleLine {
  /** 기록한 날(ET) */
  day: string;
  /** 기록한 시각(ET, HH:MM) */
  et: string;
  /** 받은 시각(UTC ISO) */
  at: string;
  symbol: string;
  /** 받은 일봉의 날짜(ET) — 그날 봉이 아니면 error 와 함께 남긴다 */
  barDate?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  error?: string;
}

export function readLines(file: string): SampleLine[] {
  if (!fs.existsSync(file)) return [];
  const out: SampleLine[] = [];
  for (const text of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!text.trim()) continue;
    try {
      out.push(JSON.parse(text) as SampleLine);
    } catch {
      // 덧붙이다 끊긴 줄 하나로 전체를 버리지 않는다
    }
  }
  return out;
}

export const FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;
export type Field = (typeof FIELDS)[number];
const LABEL: Record<Field, string> = { open: '시가', high: '고가', low: '저가', close: '종가', volume: '거래량' };

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function fmtDiff(field: Field, d: number): string {
  const sign = d > 0 ? '+' : '-';
  const abs = Math.abs(d);
  const text = field === 'volume' ? Math.round(abs).toLocaleString('en-US') : String(Number(abs.toFixed(4)));
  return `${sign}${text}`;
}

/** 한 칸 비교 — 「같음」 또는 「다름(차이 = 그때 값 − 최종값)」 */
export function cell(field: Field, value: number, final: number): string {
  return value === final ? '같음' : `다름(${fmtDiff(field, value - final)})`;
}

export interface GroupResult {
  day: string;
  symbol: string;
  samples: number;
  finalEt: string;
  /** 16:30 무렵 표본(없으면 null) */
  near: { et: string; cells: Record<Field, string>; same: Record<Field, boolean>; volumePct: number } | null;
  /** 이 시각부터 끝까지 가격 4칸이 최종값과 같다 */
  priceSettledEt: string;
  /** 이 시각부터 끝까지 다섯 칸이 최종값과 같다 */
  allSettledEt: string;
  rows: SampleLine[];
}

/**
 * 종목 · 날짜마다 각 시각 값을 그날 마지막(20:40 ET 무렵) 값과 비교한다.
 * 그날 봉(barDate = day)인 성공 줄만 쓴다 — 실패 줄은 따로 센다.
 */
export function compareGroups(lines: SampleLine[]): GroupResult[] {
  const groups = new Map<string, SampleLine[]>();
  for (const l of lines) {
    if (l.error || l.barDate !== l.day) continue;
    const key = `${l.day} ${l.symbol}`;
    const list = groups.get(key) ?? [];
    list.push(l);
    groups.set(key, list);
  }
  const out: GroupResult[] = [];
  for (const rows of groups.values()) {
    rows.sort((a, b) => a.at.localeCompare(b.at));
    const final = rows[rows.length - 1];
    const eq = (r: SampleLine, fields: readonly Field[]) => fields.every((f) => r[f] === final[f]);
    const settled = (fields: readonly Field[]) => {
      let i = rows.length - 1;
      while (i > 0 && eq(rows[i - 1], fields)) i -= 1;
      return rows[i].et;
    };
    const candidates = rows.filter((r) => toMin(r.et) >= AROUND_1630.from && toMin(r.et) <= AROUND_1630.to && r !== final);
    candidates.sort((a, b) => Math.abs(toMin(a.et) - AROUND_1630.at) - Math.abs(toMin(b.et) - AROUND_1630.at));
    const n = candidates[0];
    out.push({
      day: final.day,
      symbol: final.symbol,
      samples: rows.length,
      finalEt: final.et,
      near: n
        ? {
            et: n.et,
            cells: Object.fromEntries(FIELDS.map((f) => [f, cell(f, n[f]!, final[f]!)])) as Record<Field, string>,
            same: Object.fromEntries(FIELDS.map((f) => [f, n[f] === final[f]])) as Record<Field, boolean>,
            volumePct: final.volume ? ((n.volume! - final.volume) / final.volume) * 100 : 0,
          }
        : null,
      priceSettledEt: settled(['open', 'high', 'low', 'close']),
      allSettledEt: settled(FIELDS),
      rows,
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.symbol.localeCompare(b.symbol));
}

/** 마지막 값이 20:30 ET 보다 이르면 「최종값」 으로 믿기 어렵다(그 뒤 기록이 빠졌다) */
export const FINAL_MIN_OK = 20 * 60 + 30;

/** 결과 보기 글 — 사용자가 개발 대화에 붙여 넣는 짧은 표 */
export function renderReport(lines: SampleLine[], opts: { all?: boolean } = {}): string {
  const groups = compareGroups(lines);
  const errors = lines.filter((l) => l.error);
  const out: string[] = [];
  out.push(`미국 마감 직후 값 점검 — 기록 ${lines.length}줄 (실패 ${errors.length}줄) · 종목·날짜 ${groups.length}개`);
  out.push('비교 기준 = 그날 마지막 기록(20:40 ET 무렵). 칸 = 16:30 ET 무렵 값 − 최종값.');
  out.push('');
  out.push('| 날짜 | 종목 | 16:30 무렵 | 시가 | 고가 | 저가 | 종가 | 거래량 | 가격 4칸 같아진 시각 | 5칸 같아진 시각 | 마지막 | 표본 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const g of groups) {
    const c = g.near?.cells;
    const late = toMin(g.finalEt) < FINAL_MIN_OK ? ' ⚠️' : '';
    out.push(
      `| ${g.day} | ${g.symbol} | ${g.near?.et ?? '없음'} | ${c ? FIELDS.map((f) => c[f]).join(' | ') : '— | — | — | — | —'} | ${g.priceSettledEt} | ${g.allSettledEt} | ${g.finalEt}${late} | ${g.samples} |`,
    );
  }
  if (groups.some((g) => toMin(g.finalEt) < FINAL_MIN_OK)) out.push('⚠️ = 그날 마지막 기록이 20:30 ET 보다 이르다(그 뒤 기록이 빠짐) — 최종값으로 믿기 어렵다.');

  if (opts.all) {
    for (const g of groups) {
      out.push('', `### ${g.day} ${g.symbol}`, '| 시각 | 시가 | 고가 | 저가 | 종가 | 거래량 |', '|---|---|---|---|---|---|');
      const final = g.rows[g.rows.length - 1];
      for (const r of g.rows) out.push(`| ${r.et} | ${FIELDS.map((f) => cell(f, r[f]!, final[f]!)).join(' | ')} |`);
    }
  }

  if (errors.length) {
    const byMsg = new Map<string, number>();
    for (const e of errors) byMsg.set(e.error!, (byMsg.get(e.error!) ?? 0) + 1);
    out.push('', '실패:');
    for (const [msg, n] of [...byMsg].sort((a, b) => b[1] - a[1]).slice(0, 5)) out.push(`- ${n}줄 · ${msg}`);
  }

  out.push('', conclusion(groups));
  return out.join('\n');
}

/** 「16:30 ET 무렵 값이 최종값과 같은가」 한 줄 */
export function conclusion(groups: GroupResult[]): string {
  const judged = groups.filter((g) => g.near && toMin(g.finalEt) >= FINAL_MIN_OK);
  if (!judged.length) return '결론: 판단할 표본이 없다(16:30 무렵 기록과 20:30 ET 이후 마지막 기록이 함께 있는 종목·날짜가 없음).';
  const diff = FIELDS.map((f) => ({ f, n: judged.filter((g) => !g.near!.same[f]).length })).filter((x) => x.n > 0);
  const days = new Set(judged.map((g) => g.day)).size;
  const skipped = groups.length - judged.length;
  const base = `결론(${days}일 · ${judged.length}개 종목·날짜${skipped ? ` · 제외 ${skipped}개 — 16:25~16:30 기록 없음 또는 마지막 기록이 20:30 전` : ''}): 16:30 ET 무렵 값이 최종값과`;
  if (!diff.length) return `${base} 다섯 칸 모두 같다.`;
  const priceSame = diff.every((x) => x.f === 'volume');
  const volDiff = judged.filter((g) => !g.near!.same.volume);
  const maxPct = Math.max(0, ...volDiff.map((g) => Math.abs(g.near!.volumePct)));
  const lastSettled = judged.map((g) => g.allSettledEt).sort().at(-1);
  const volText = volDiff.length ? ` 거래량 차이는 최대 ${maxPct.toFixed(2)}%, 다섯 칸이 최종값과 같아진 가장 늦은 시각 ${lastSettled} ET.` : '';
  return `${base} 다르다 — ${diff.map((x) => `${LABEL[x.f]} ${x.n}건`).join(' · ')}${priceSame ? ' (가격 4칸은 모두 같음)' : ''}.${volText}`;
}
