/**
 * 투자자 동향 (국내 종목) — 서버 라우트·Gemini 입력·Claude 수동 프롬프트가 **같은 계산**을 쓴다 (v2.23.0).
 *
 * 원천: 토스 `GET /api/v1/stocks/{symbol}/investor-trading` (명세 1.2.19, 2026-10-01 실측 대조).
 * - 단위는 **주(거래량)** 다 — 금액이 아니다. 순매수 = 매수 − 매도(음수 = 순매도).
 * - `foreigner` 는 **등록외국인** 기준이다(미등록 제외).
 * - ⚠️ 당일 기록은 장중 **잠정치**라 개인·기타법인이 null 이다(확정치는 그날 저녁). 그래서 합계·일수는
 *   **확정된 날(개인 값이 있는 날)만** 센다 — 잠정 날을 섞으면 외국인·기관만 하루 더 세진다.
 * - 쓰지 않는 칸: 기관 세부(`breakdown`)·외국인 보유(`foreignerHolding`)·CFD 잔고(`cfd`) — 뜻은 명세에 있지만 이번 범위가 아니다.
 *
 * ⚠️ 사실(순매수량)만 적는다. "외국인이 사면 오른다" 같은 해석은 이 앱에서 검증한 적이 없다.
 * DOM 을 쓰지 않는다 — `src/utils` 는 서버(tsconfig.node)도 컴파일한다.
 */

export interface FlowSide {
  buy: number;
  sell: number;
  net: number;
}

export interface FlowRecord {
  date: string;
  updatedAt: string | null;
  /** 장중 잠정치 — 개인·기타법인이 아직 없다 */
  provisional: boolean;
  foreigner: FlowSide | null;
  institution: FlowSide | null;
  individual: FlowSide | null;
  otherCorporation: FlowSide | null;
}

export interface FlowSums {
  d5: number;
  d20: number;
  /** 최근 20 확정일 중 순매수(>0)였던 날 수 */
  buyDays: number;
  days: number;
}

export interface InvestorFlow {
  symbol: string;
  /** 최신순 — 당일 잠정 기록이 있으면 맨 앞 */
  records: FlowRecord[];
  sums: { foreigner: FlowSums; institution: FlowSums; individual: FlowSums };
  /** 합계에 쓴 확정일 기간 (가장 이른 날 ~ 가장 늦은 날). 확정일이 없으면 null */
  period: { from: string; to: string; days: number } | null;
  /** 가장 최근 기록의 갱신 시각 */
  updatedAt: string | null;
}

export const FLOW_DAYS = 20;

const SIDES = ['foreigner', 'institution', 'individual'] as const;
export type FlowSideKey = (typeof SIDES)[number];
export const FLOW_SIDE_LABEL: Record<FlowSideKey | 'otherCorporation', string> = {
  foreigner: '외국인',
  institution: '기관',
  individual: '개인',
  otherCorporation: '기타법인',
};

/** 확정된 날만 — 개인 값이 있어야 확정치다(명세: 개인은 확정치 반영 때 채워진다) */
export function confirmedRecords(records: FlowRecord[]): FlowRecord[] {
  return records.filter((r) => !r.provisional);
}

/** 합계에 쓰는 확정일 — 최신순 최대 20일 */
export function flowWindow(records: FlowRecord[]): FlowRecord[] {
  return confirmedRecords(records).slice(0, FLOW_DAYS);
}

export function flowPeriod(records: FlowRecord[]): InvestorFlow['period'] {
  const window = flowWindow(records);
  if (!window.length) return null;
  return { from: window.at(-1)!.date, to: window[0].date, days: window.length };
}

export function sumFlow(records: FlowRecord[]): InvestorFlow['sums'] {
  const confirmed = flowWindow(records);
  const sums = {} as InvestorFlow['sums'];
  for (const side of SIDES) {
    const nets = confirmed.map((r) => r[side]?.net ?? 0);
    sums[side] = {
      d5: nets.slice(0, 5).reduce((a, b) => a + b, 0),
      d20: nets.reduce((a, b) => a + b, 0),
      buyDays: nets.filter((n) => n > 0).length,
      days: confirmed.length,
    };
  }
  return sums;
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ko-KR')}`;

/**
 * AI 입력 블록 — **국내 종목에서 동향을 받았을 때만** 넣는다. 확정일이 없으면 null(블록을 빼고 분석을 계속한다).
 * ⚠️ 문구를 바꾸면 Gemini 프롬프트 버전(`v1-flow`)도 함께 올린다 — `server/gemini/agents.ts` 참고.
 */
export function investorFlowBlock(flow: InvestorFlow | null | undefined): string | null {
  if (!flow) return null;
  const days = flow.sums.foreigner.days;
  if (!days) return null;
  const line = (side: FlowSideKey) => {
    const s = flow.sums[side];
    return `- ${FLOW_SIDE_LABEL[side]} 순매수: 5일 합계 ${signed(s.d5)} / ${days}일 합계 ${signed(s.d20)} / 순매수 일수 ${s.buyDays}/${days}`;
  };
  const period = flow.period;
  return [
    `## 투자자 동향 (최근 ${days}거래일, 단위: 주, 출처: 토스증권)`,
    ...(period ? [`- 기간: 확정 ${period.days}거래일 ${period.from} ~ ${period.to}`] : []),
    line('foreigner'),
    line('institution'),
    line('individual'),
    '- 참고: 거래량(주) 기준이며 금액이 아닙니다. 외국인은 등록외국인 기준, 당일 잠정치는 제외했습니다.',
  ].join('\n');
}
