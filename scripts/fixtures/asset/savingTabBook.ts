/**
 * 가짜 「적립식 투자」 탭(v2.79.0 · 152차 시험 · 디자인 점검) — **원본과 같은 모양 · 만든 값**(151차 점검 8번 칸 지도와 같은 줄 · 열).
 * - 묶음 1 = 3행 머리(연금) · 5 ~ 7행 3줄 · 8행 합계(D 수식) / 묶음 2 = 10행(ISA) · 12 ~ 17행 6줄(0% 1줄) · 18행 합계 · 총 금액 C11 은 수식 /
 *   묶음 3 = 20행(적립식) · 22 ~ 25행 4줄(0% 1줄) · 26행 합계 / 묶음 4 = 28행(개별 — 다른 모양: 머리 다음 줄 D 빈칸 · 비율 열 없음).
 * - G ~ J 열에 옆 표(읽지 않는 칸)를 둔다.
 * - 돌려주는 값: 'A1' 주소 → 값 / 수식(수식 칸은 values 에 계산된 값 · formulas 에 수식 글자).
 * ⚠️ 금액 · 이름은 만든 값이다(실제 시트 값이 아니다). 시험 출력에 이 값을 찍지 않는다.
 */
export type SavingCell = string | number;
export interface SavingBook {
  values: Record<string, SavingCell>;
  formulas: Record<string, SavingCell>;
}

/** 만든 값 — 시험이 「출력에 나오지 않는가」 를 보려고 내보낸다 */
export const SAVING_SECRET = {
  totals: [12_345_678, 23_456_789, 34_567_890, 9_876_543],
  months: [12, 10, 7, 5],
  names: [
    ['가짜지수에스', '가짜지수나스', '가짜채권하나'],
    ['가짜지수둘가', '가짜지수둘나', '가짜지수둘다', '가짜금둘라', '가짜영둘마', '가짜채권둘바'],
    ['가짜지수셋가', '가짜지수셋나', '가짜채권셋다', '가짜영셋라'],
    ['가짜넷가', '가짜넷나', '가짜넷다'],
  ],
  ratios: [
    [0.55, 0.25, 0.2],
    [0.5, 0.2, 0.1, 0.1, 0, 0.1],
    [0.6, 0.3, 0.1, 0],
  ],
  heads: ['연금 저축 적립', 'ISA 적립', '적립식 계좌 적립', '개별 투자 적립'],
} as const;

/** 가짜 탭 — `change` 로 칸을 바꿔 다른 경우를 만든다 */
export function savingTabBook(change?: (b: SavingBook) => void): SavingBook {
  const v: Record<string, SavingCell> = {};
  const f: Record<string, SavingCell> = {};
  const put = (cell: string, value: SavingCell, formula?: string) => {
    v[cell] = value;
    f[cell] = formula ?? value;
  };
  const S = SAVING_SECRET;
  put('B2', 2026); // 원본 2행 B 숫자 칸(묶음과 상관없음)
  const groups: { head: number; lines: number }[] = [
    { head: 3, lines: 3 },
    { head: 10, lines: 6 },
    { head: 20, lines: 4 },
  ];
  groups.forEach(({ head, lines }, gi) => {
    put(`B${head}`, S.heads[gi]);
    put(`C${head}`, '총 구매할 금액');
    put(`D${head}`, '분할 개월 수');
    put(`E${head}`, '한 달 금액');
    const n = head + 1;
    // 묶음 2 의 총 금액은 수식(값으로 읽는다)
    put(`C${n}`, S.totals[gi], gi === 1 ? `=SUM(H11:I11)` : undefined);
    put(`D${n}`, S.months[gi]);
    put(`E${n}`, Math.round(S.totals[gi] / S.months[gi]), `=C${n}/D${n}`);
    for (let k = 0; k < lines; k++) {
      const r = head + 2 + k;
      put(`B${r}`, S.names[gi][k]);
      put(`D${r}`, S.ratios[gi][k]);
      put(`E${r}`, 0, `=$E$${n}*D${r}`);
    }
    const sum = head + 2 + lines;
    put(`B${sum}`, '합계');
    put(`D${sum}`, 1, `=SUM(D${head + 2}:D${sum - 1})`);
    put(`E${sum}`, 0, `=SUM(E${head + 2}:E${sum - 1})`);
  });
  // 묶음 4 — 다른 모양(28행): 머리 다음 줄 D 빈칸 · 개월 수가 E · 비율 열 없음
  put('B28', S.heads[3]);
  put('C28', '총 구매할 금액');
  put('D28', '분할 개월 수');
  put('E28', '한 달 금액');
  put('C29', S.totals[3]);
  put('E29', S.months[3], '=5');
  S.names[3].forEach((name, k) => {
    put(`B${30 + k}`, name);
    put(`E${30 + k}`, 0, `=$C$29/$E$29/3`);
  });
  // 옆 표(G ~ J — 읽지 않는다)
  for (const r of [3, 4, 5, 7, 8, 10, 12, 13]) {
    put(`G${r}`, '옆표');
    put(`H${r}`, 0.5);
  }
  put('J3', '메모');
  const book = { values: v, formulas: f };
  change?.(book);
  return book;
}

/** 칸 하나를 값 · 수식 모두 바꾼다(빈칸이면 지움) — 시험의 `change` 에서 쓴다 */
export function setSavingCell(b: SavingBook, cell: string, value: SavingCell | null, formula?: string): void {
  if (value == null) {
    delete b.values[cell];
    delete b.formulas[cell];
    return;
  }
  b.values[cell] = value;
  b.formulas[cell] = formula ?? value;
}
