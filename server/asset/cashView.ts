/**
 * 설정 창 「현금 자동 반영」 응답(v2.71.0 · `GET /api/asset/cash`) — 설정 · 「현금」 줄 · 「월 고정지출」 줄 · 다음 반영 날 · 다시 확인 필요 · 반영 기록.
 * 시트는 읽기만(「현금」 B:C · 「월 고정지출」 A:Z 한 번씩 + 계좌 이름은 30초 캐시 시트). 계산은 `cashKeys.ts` · `cashSchedule.ts` 그대로.
 * ⚠️ 로그를 남기지 않는다(값이 든 응답).
 */
import { ASSET_CASH_FROM_SALARY, type AssetCashFlowViewV2, type AssetCashPreview, type AssetCashViewV3 } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled } from './config';
import { AssetSheetError } from './google';
import { readAssetSheet } from './sheet';
import { cashOptions, findCashLine, findFixedLine, fixedViews, sameFixedKey, type CashLine } from './cashKeys';
import { listCashMoves, readCashStored, readCashSheetNow, resolveCashSettings, type CashSheetNow } from './cashMoves';
import { cashCalendar, kstDay, nextDueDay } from './cashSchedule';
import { SHEET_LAYOUT } from './sheetLayout';
import { readCashBankFix } from './cashBanks';
import { cashPreview } from './cashPreview';

/** 계좌 key(합친 표 제외 · 시트 순서) */
export const CASH_SECTION_KEYS: string[] = SHEET_LAYOUT.sections.flatMap((s) => ('key' in s && s.key ? [s.key] : []));

/** 설정 저장 검사 · 화면에 쓰는 지금 시트 */
export async function cashSheetNow(): Promise<CashSheetNow & { salary: number | null; fixedError: string | null }> {
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  const r = await readCashSheetNow(config);
  return { sections: CASH_SECTION_KEYS, ...r };
}

/** 미리 보기만(`GET /api/asset/cash/preview`) — 시트 읽기만 */
export async function buildCashPreview(now = Date.now()): Promise<AssetCashPreview> {
  const sheet = await cashSheetNow();
  return cashPreview(sheet, readCashBankFix(), now, cashCalendar());
}

export async function buildCashView(now = Date.now()): Promise<AssetCashViewV3> {
  const [sheet, data] = await Promise.all([cashSheetNow(), readAssetSheet()]);
  const stored = readCashStored();
  const s = resolveCashSettings(stored);
  const follows = (k: AssetCashFlowViewV2['item']) => k != null && stored.flows.some((f) => f.from === ASSET_CASH_FROM_SALARY && sameFixedKey(f.item, k.key));
  const cal = cashCalendar();
  const lineOk = (k: { name: string; nth: number } | null) => k == null || findCashLine(sheet.lines as CashLine[], k) != null;

  const flows: AssetCashFlowViewV2[] = [];
  const items = sheet.fixed ? fixedViews(sheet.fixed) : [];
  for (const item of items) {
    // 저장 때와 같은 분류 · 사유 줄 수일 때만 이 줄의 설정(「#n」 이 밀렸으면 아래 「시트에서 찾지 못한 줄」 로)
    const setting = s.flows.find((f) => sameFixedKey(f.item, item.key) && sheet.fixed != null && findFixedLine(sheet.fixed, f.item) != null) ?? null;
    const rowsOk = !setting || (lineOk(setting.from) && (setting.to === 'out' || lineOk(setting.to)));
    const payable = item.reflect && item.amount != null && item.amount > 0;
    flows.push({
      item,
      setting,
      nextDay: setting && rowsOk && payable ? nextDueDay(s, 'fixed', setting, now, cal) : null,
      problem: setting && !rowsOk ? 'missing-row' : null,
      // 설정이 없는 줄도 빠지는 계좌 기본 = 월급 받는 계좌(따라감)
      fromSalary: !setting || follows(item),
    });
  }
  // 설정만 남고 시트에서 사라진 줄 — 「다시 확인 필요」(지울 수 있다) · 「월 고정지출」 을 못 읽었으면 설정 그대로 보인다(문제 표시 없음)
  for (const setting of s.flows) {
    if (sheet.fixed && findFixedLine(sheet.fixed, setting.item)) continue;
    if (!sheet.fixed && items.some((i) => sameFixedKey(i.key, setting.item))) continue;
    flows.push({ item: null, setting, nextDay: null, problem: sheet.fixed ? 'missing-item' : null, fromSalary: stored.flows.some((f) => f.from === ASSET_CASH_FROM_SALARY && sameFixedKey(f.item, setting.item)) });
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
    bankFix: readCashBankFix(),
    preview: cashPreview(sheet, readCashBankFix(), now, cal),
  };
}
