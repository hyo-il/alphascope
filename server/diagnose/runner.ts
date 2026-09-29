/**
 * 웹에서 진단 실행 — 시작만 하고 바로 돌려준다 (급등 탐지와 같은 방식).
 *
 * 오라클에서 52초 걸렸다. 응답을 붙잡고 있으면 브라우저·nginx 가 먼저 끊으므로
 * 화면은 `GET /api/diagnose/progress` 를 폴링한다. ⚠️ **한 번에 하나만** 돈다 —
 * `report.ts` 의 실행 설정이 모듈 변수라 겹치면 서로를 덮는다.
 */

import type { DiagnoseProgress } from '../../src/types/diagnose';
import { TOTAL_STEPS, runDiagnose } from './report';

let progress: DiagnoseProgress = {
  running: false,
  step: 0,
  total: TOTAL_STEPS,
  label: null,
  startedAt: null,
  finishedAt: null,
  error: null,
  reportId: null,
};

export function getDiagnoseProgress(): DiagnoseProgress {
  return progress;
}

export class DiagnoseBusyError extends Error {
  constructor() {
    super('진단이 이미 실행 중입니다. 끝난 뒤 다시 실행하세요.');
    this.name = 'DiagnoseBusyError';
  }
}

export function startDiagnose(options: { quick?: boolean } = {}): DiagnoseProgress {
  if (progress.running) throw new DiagnoseBusyError();

  progress = {
    running: true,
    step: 0,
    total: TOTAL_STEPS,
    label: '준비 중 (지표 엔진 확인)',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    reportId: null,
  };

  void runDiagnose({
    quick: options.quick,
    onStep: (step, label) => {
      progress = { ...progress, step, label };
    },
  })
    .then((outcome) => {
      progress = {
        ...progress,
        running: false,
        step: TOTAL_STEPS,
        label: '완료',
        finishedAt: new Date().toISOString(),
        reportId: outcome.id,
      };
    })
    .catch((e) => {
      progress = {
        ...progress,
        running: false,
        finishedAt: new Date().toISOString(),
        error: e instanceof Error ? e.message : String(e),
      };
    });

  return progress;
}
