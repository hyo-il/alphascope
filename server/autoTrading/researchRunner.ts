/**
 * 백테스트 실행기.
 *
 * - 웹(「실험실 > 백테스트」, v2.38.0) = **사용자 시험**(`runCustomBacktest`) — 시작만 하고 진행률 폴링(진단 리포트와 같은 방식).
 *   - **한 번에 하나** — 실행 중 다시 시작하면 409. 화면을 떠났다 와도 `getBacktestProgress()` 로 이어 본다.
 *   - **같은 날·같은 입력(종목·조건·기간)은 다시 계산하지 않는다** — 저장된 결과를 돌려준다. 강제는 `force`.
 *   - 지표 엔진이 꺼져 있으면 시작 전에 503(engineDown) — 꺼진 채 돌리면 결과처럼 보이는 빈 숫자가 나온다.
 * - 명령어(`npm run research:rule`) = v2.37.0 **미리 정한 시험**(`runAndSave`) — 파일 보고서도 쓴다. 화면에서는 실행하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { outputDir, requireEngine, EngineDownError } from '../diagnose/report';
import { IndicatorEngineError } from '../indicatorService';
import { readUniverse } from '../universe';
import { marketDate } from '../../src/utils/marketDate';
import { PREREG_VERSION, customInputKey, researchMarkdown, runCustomBacktest, runRuleResearch } from './ruleResearch';
import { getBacktest, listBacktests, saveBacktest } from './researchStore';
import { isCustomSummary, type BacktestInput, type BacktestProgress, type BacktestReport } from '../../src/types/backtest';

let progress: BacktestProgress = {
  running: false, done: 0, total: 0, current: null, startedAt: null, finishedAt: null, error: null, engineDown: false, reportId: null,
};

export const getBacktestProgress = () => progress;

export class BacktestBusyError extends Error {
  constructor() {
    super('백테스트가 이미 실행 중입니다. 끝난 뒤 다시 실행하세요.');
  }
}

const kstDay = (iso: string | number) => marketDate(typeof iso === 'string' ? Date.parse(iso) : iso, '005930');

/** 오늘(KST)·같은 사전 등록 판·같은 유니버스 기준일로 이미 만든 **미리 정한 시험** 결과 */
export function sameDayReportId(now = Date.now()): number | null {
  let asOf = '';
  try {
    asOf = readUniverse().asOf;
  } catch {
    return null;
  }
  for (const item of listBacktests()) {
    if (isCustomSummary(item.summary) || kstDay(item.createdAt) !== kstDay(now)) continue;
    const full = getBacktest(item.id);
    if (full && full.detail.kind !== 'custom' && full.detail.version === PREREG_VERSION && full.detail.universeAsOf === asOf) return item.id;
  }
  return null;
}

/** 오늘(KST) 같은 입력으로 이미 만든 사용자 시험 결과 */
export function sameDayCustomId(input: BacktestInput, now = Date.now()): number | null {
  const key = customInputKey(input);
  for (const item of listBacktests()) {
    if (isCustomSummary(item.summary) && item.summary.inputKey === key && kstDay(item.createdAt) === kstDay(now)) return item.id;
  }
  return null;
}

/** md + json 파일 — 진단과 같은 폴더(맥 관리 루트 docs/analysis/ · 오라클 reports/) */
export function writeReportFiles(report: BacktestReport): { md: string; json: string } {
  const { dir } = outputDir();
  fs.mkdirSync(dir, { recursive: true });
  const day = kstDay(report.computedAt);
  const md = path.join(dir, `rule_backtest_${day}.md`);
  const json = path.join(dir, `rule_backtest_${day}.json`);
  fs.writeFileSync(md, researchMarkdown(report));
  fs.writeFileSync(json, JSON.stringify(report, null, 2));
  return { md, json };
}

/** 계산 + 저장 + 파일 — 웹과 명령어가 같은 함수 */
export async function runAndSave(onProgress?: (done: number, total: number, current: string) => void): Promise<{ id: number; report: BacktestReport; files: { md: string; json: string } }> {
  await requireEngine();
  const report = await runRuleResearch(onProgress);
  const id = saveBacktest(outputDir().server, report);
  const files = writeReportFiles(report);
  return { id, report, files };
}

/** 사용자 시험 시작 — 시작만 하고 돌려준다(같은 날 같은 입력이면 계산 없이 그 결과 id) */
export async function startCustomBacktest(input: BacktestInput, force = false): Promise<BacktestProgress> {
  if (progress.running) throw new BacktestBusyError();
  if (!force) {
    const id = sameDayCustomId(input);
    if (id != null) return { ...progress, running: false, reportId: id, error: null, engineDown: false, reused: true };
  }
  try {
    await requireEngine();
  } catch (e) {
    if (e instanceof EngineDownError) {
      progress = { ...progress, running: false, error: '지표 엔진이 꺼져 있어 계산할 수 없습니다.', engineDown: true };
    }
    throw e;
  }
  progress = {
    running: true, done: 0, total: input.symbols.length, current: null, startedAt: new Date().toISOString(),
    finishedAt: null, error: null, engineDown: false, reportId: null,
  };
  void runCustomBacktest(input, (done, total, current) => {
    progress = { ...progress, done, total, current: current || null };
  })
    .then((report) => {
      const id = saveBacktest(outputDir().server, report);
      progress = { ...progress, running: false, finishedAt: new Date().toISOString(), reportId: id, current: null };
    })
    .catch((e) => {
      progress = {
        ...progress,
        running: false,
        finishedAt: new Date().toISOString(),
        error: (e as Error).message,
        engineDown: e instanceof IndicatorEngineError || e instanceof EngineDownError,
      };
    });
  return progress;
}
