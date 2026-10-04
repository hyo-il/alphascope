/**
 * 3년 백테스트 — 웹 실행(시작만 하고 진행률 폴링, 진단 리포트와 같은 방식) + 파일 보고서 (v2.37.0).
 *
 * - **한 번에 하나** — 실행 중 다시 시작하면 409.
 * - **같은 날·같은 조건(사전 등록 판·유니버스 기준일)은 다시 계산하지 않는다** — 저장된 결과를 돌려준다. 강제는 `force`.
 * - 지표 엔진이 꺼져 있으면 시작 전에 503(engineDown) — 꺼진 채 돌리면 결과처럼 보이는 빈 숫자가 나온다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { outputDir, requireEngine, EngineDownError } from '../diagnose/report';
import { IndicatorEngineError } from '../indicatorService';
import { readUniverse } from '../universe';
import { marketDate } from '../../src/utils/marketDate';
import { PREREG_VERSION, researchMarkdown, runRuleResearch } from './ruleResearch';
import { getBacktest, listBacktests, saveBacktest } from './researchStore';
import type { BacktestProgress, BacktestReport } from '../../src/types/backtest';

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

/** 오늘(KST)·같은 사전 등록 판·같은 유니버스 기준일로 이미 만든 결과 */
export function sameDayReportId(now = Date.now()): number | null {
  let asOf = '';
  try {
    asOf = readUniverse().asOf;
  } catch {
    return null;
  }
  for (const item of listBacktests()) {
    if (kstDay(item.createdAt) !== kstDay(now)) continue;
    const full = getBacktest(item.id);
    if (full && full.detail.version === PREREG_VERSION && full.detail.universeAsOf === asOf) return item.id;
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

export async function startBacktest(force = false): Promise<BacktestProgress> {
  if (progress.running) throw new BacktestBusyError();
  if (!force) {
    const id = sameDayReportId();
    if (id != null) return { ...progress, running: false, reportId: id, error: null, engineDown: false };
  }
  try {
    await requireEngine();
  } catch (e) {
    if (e instanceof EngineDownError) {
      progress = { ...progress, running: false, error: '지표 엔진이 꺼져 있어 계산할 수 없습니다.', engineDown: true };
    }
    throw e;
  }
  progress = { running: true, done: 0, total: 0, current: '대상 고르는 중', startedAt: new Date().toISOString(), finishedAt: null, error: null, engineDown: false, reportId: null };
  void runAndSave((done, total, current) => {
    progress = { ...progress, done, total, current: current || null };
  })
    .then(({ id }) => {
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
