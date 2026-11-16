/**
 * 설정 창 「현금 자동 반영」 응답(v2.71.0 · `GET /api/asset/cash`) — 설정 · 「현금」 줄 · 「월 고정지출」 줄 · 다음 반영 날 · 다시 확인 필요 · 반영 기록.
 * 시트는 읽기만(「현금」 B:C · 「월 고정지출」 A:Z 한 번씩 + 계좌 이름은 30초 캐시 시트). 계산은 `cashKeys.ts` · `cashSchedule.ts` 그대로.
 * ⚠️ 로그를 남기지 않는다(값이 든 응답).
 */
import type { AssetCashFlowView, AssetCashView } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled } from './config';
import { AssetSheetError } from './google';
import { readAssetSheet } from './sheet';
import { cashOptions, findCashLine, fixedViews, sameFixedKey, type CashLine } from './cashKeys';
import { listCashMoves, readCashSettings, readCashSheetNow, type CashSheetNow } from './cashMoves';
import { cashCalendar, kstDay, nextDueDay } from './cashSchedule';
import { SHEET_LAYOUT } from './sheetLayout';

/** 계좌 key(합친 표 제외 · 시트 순서) */
export const CASH_SECTION_KEYS: string[] = SHEET_LAYOUT.sections.flatMap((s) => ('key' in s && s.key ? [s.key] : []));

/** 설정 저장 검사 · 화면에 쓰는 지금 시트 */
export async function cashSheetNow(): Promise<CashSheetNow & { salary: number | null; fixedError: string | null }> {
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  const r = await readCashSheetNow(config);
  return { sections: CASH_SECTION_KEYS, ...r };
}

export async function buildCashView(now = Date.now()): Promise<AssetCashView> {
  const [sheet, data] = await Promise.all([cashSheetNow(), readAssetSheet()]);
  const s = readCashSettings();
  const cal = cashCalendar();
  const lineOk = (k: { name: string; nth: number } | null) => k == null || findCashLine(sheet.lines as CashLine[], k) != null;

  const flows: AssetCashFlowView[] = [];
  const items = sheet.fixed ? fixedViews(sheet.fixed) : [];
  for (const item of items) {
    const setting = s.flows.find((f) => sameFixedKey(f.item, item.key)) ?? null;
    const rowsOk = !setting || (lineOk(setting.from) && (setting.to === 'out' || lineOk(setting.to)));
    const payable = item.reflect && item.amount != null && item.amount > 0;
    flows.push({
      item,
      setting,
      nextDay: setting && rowsOk && payable ? nextDueDay(s, 'fixed', setting, now, cal) : null,
      problem: setting && !rowsOk ? 'missing-row' : null,
    });
  }
  // 설정만 남고 시트에서 사라진 줄 — 「다시 확인 필요」(지울 수 있다) · 「월 고정지출」 을 못 읽었으면 설정 그대로 보인다(문제 표시 없음)
  for (const setting of s.flows) {
    if (items.some((i) => sameFixedKey(i.key, setting.item))) continue;
    flows.push({ item: null, setting, nextDay: null, problem: sheet.fixed ? 'missing-item' : null });
  }

  const salaryRowOk = lineOk(s.salary.to);
  return {
    settings: s,
    writeEnabled: isAssetSyncEnabled(),
    today: kstDay(now),
    sections: data.sections.filter((x) => !x.combined && x.key).map((x) => ({ key: x.key as string, name: x.name })),
    rows: cashOptions(sheet.lines),
    fixedError: sheet.fixedError,
    salary: {
      amount: sheet.salary,
      nextDay: salaryRowOk ? nextDueDay(s, 'salary', null, now, cal) : null,
      problem: !salaryRowOk ? 'missing-row' : null,
    },
    flows,
    moves: listCashMoves(),
  };
}
