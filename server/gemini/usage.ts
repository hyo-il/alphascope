/**
 * 오늘(한국 시간 날짜) Gemini 사용량 — 기능별 (v2.47.0, 퀀트 5단계 A-9).
 *
 * 따로 카운터를 두지 않는다 — 각 기능이 이미 남기는 기록을 센다(재시작해도 같다). 그래서 **저장하지 않은 호출은 세지 못한다**:
 * - AI 분석(지정 종목 · 바로 분석): `gemini_analysis` 한 줄 = 에이전트 4 + 의장 1 = 5호출(예전 「오늘 Gemini 사용」 과 같은 환산 — 날짜만 한국 시간으로)
 * - AI 검증: `aiCheck/store.countCallsOn` 그대로(계좌 하루 한도와 같은 수)
 * - 뉴스 AI 판정: `news_sentiment` 한 줄 = 1호출
 * - 목표 수익 가능성: `target_analysis` 한 줄 = 5호출(에이전트 4 + 의장 1)
 * - 백테스트 AI 설명: 기록(`backtest_reports`)에 붙은 설명 = 1호출. 기록은 최근 100개만 남아 지워진 기록의 설명은 빠진다
 * 실패한 호출(한도 초과 · 오류로 저장되지 않은 것)은 AI 검증 말고는 세지 못한다 — 화면에 그렇게 적는다.
 */
import { getDb } from '../db';
import { countCallsOn } from '../aiCheck/store';
import { kstDate } from '../aiCheck/check';
import type { GeminiUsage, GeminiUsageItem } from '../../src/types/gemini';

/** 표가 아직 없으면(그 기능을 한 번도 안 썼으면) 0 */
function countRows(sql: string, day: string): number {
  try {
    return (getDb().prepare(sql).get(day) as { n: number }).n;
  } catch (e) {
    if (/no such table/i.test((e as Error).message)) return 0;
    throw e;
  }
}

export function geminiUsageToday(now = new Date()): GeminiUsage {
  const day = kstDate(now);
  const analyses = countRows(`SELECT COUNT(*) AS n FROM gemini_analysis WHERE date(created_at, '+9 hours') = ?`, day);
  const news = countRows(`SELECT COUNT(*) AS n FROM news_sentiment WHERE date(created_at, '+9 hours') = ?`, day);
  const target = countRows(`SELECT COUNT(*) AS n FROM target_analysis WHERE date(created_at, '+9 hours') = ?`, day);
  const explain = countRows(
    `SELECT COUNT(*) AS n FROM backtest_reports WHERE date(json_extract(detail_json, '$.explain.createdAt'), '+9 hours') = ?`,
    day,
  );
  const items: GeminiUsageItem[] = [
    { key: 'analysis', label: 'AI 분석', runs: analyses, calls: analyses * 5 },
    { key: 'aiCheck', label: 'AI 검증', runs: null, calls: countCallsOn(day) },
    { key: 'news', label: '뉴스 AI 판정', runs: news, calls: news },
    { key: 'target', label: '목표 수익 가능성', runs: target, calls: target * 5 },
    { key: 'backtestExplain', label: '백테스트 AI 설명', runs: explain, calls: explain },
  ];
  return { date: day, items, totalCalls: items.reduce((s, i) => s + i.calls, 0) };
}
