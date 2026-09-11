import { Fragment, useState } from 'react';
import type { SymbolSummary } from '../../types/analysis';
import type { Fundamentals } from '../../types/company';
import { changeColor, formatCompactMoney, formatPrice } from '../../utils/formatters';

/**
 * 기업정보 비교 테이블 — 행이 항목, 열이 종목이다.
 *
 * 종목을 열에 두는 편이 비교에 맞다. 행에 두면 항목이 가로로 늘어서서
 * 같은 항목의 값을 눈으로 따라가야 한다.
 */

const NONE = '—';

interface Cell {
  symbol: string;
  fundamentals: Fundamentals | null;
  summary: SymbolSummary | undefined;
  currency: 'KRW' | 'USD';
}

interface Row {
  label: string;
  /** 화면에 적을 값 */
  text: (cell: Cell) => string;
  /**
   * 열끼리 비교할 수 있는 숫자. `better` 와 함께 있으면 가장 좋은 값과
   * 가장 나쁜 값에 색을 준다 — 표를 훑다가 바로 눈에 걸리게.
   */
  raw?: (cell: Cell) => number | null;
  better?: 'high' | 'low';
  /** 값 자체로 색이 정해지는 행 (RSI 과매수, 등락률 등) */
  tone?: (cell: Cell) => string | null;
}

const num = (value: number | null | undefined, digits = 2, suffix = ''): string =>
  value == null || !Number.isFinite(value) ? NONE : `${value.toFixed(digits)}${suffix}`;

/** yfinance 의 비율은 소수다 (0.2762 = 27.62%) */
const pct = (value: number | null | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value) ? NONE : `${(value * 100).toFixed(digits)}%`;

/** 현재가 대비 기준선의 괴리율 */
function gap(price: number | null | undefined, line: number | null | undefined): number | null {
  if (price == null || line == null || !Number.isFinite(price) || !line) return null;
  return ((price - line) / line) * 100;
}

const SECTIONS: { id: string; label: string; rows: Row[] }[] = [
  {
    id: 'valuation',
    label: '밸류에이션',
    rows: [
      {
        label: '현재가',
        text: (c) => formatPrice(c.summary?.price ?? null, c.currency),
      },
      {
        label: '시가총액',
        text: (c) =>
          formatCompactMoney(c.fundamentals?.profile.marketCap ?? null, c.fundamentals?.profile.currency),
        raw: (c) => c.fundamentals?.profile.marketCap ?? null,
      },
      {
        label: 'PER (TTM)',
        text: (c) => num(c.fundamentals?.valuation.per),
        raw: (c) => positive(c.fundamentals?.valuation.per),
        better: 'low',
      },
      {
        label: 'Forward PER',
        text: (c) => num(c.fundamentals?.valuation.forwardPer),
        raw: (c) => positive(c.fundamentals?.valuation.forwardPer),
        better: 'low',
      },
      {
        label: 'PBR',
        text: (c) => num(c.fundamentals?.valuation.pbr),
        raw: (c) => positive(c.fundamentals?.valuation.pbr),
        better: 'low',
      },
      {
        label: 'PSR',
        text: (c) => num(c.fundamentals?.valuation.priceToSales),
        raw: (c) => positive(c.fundamentals?.valuation.priceToSales),
        better: 'low',
      },
      {
        label: 'EV/EBITDA',
        text: (c) => num(c.fundamentals?.valuation.evToEbitda),
        raw: (c) => positive(c.fundamentals?.valuation.evToEbitda),
        better: 'low',
      },
      {
        // ⚠️ 배당수익률만 이미 퍼센트 단위다 (0.35 = 0.35%).
        label: '배당수익률',
        text: (c) => num(c.fundamentals?.dividend.yield, 2, '%'),
        raw: (c) => c.fundamentals?.dividend.yield ?? null,
        better: 'high',
      },
    ],
  },
  {
    id: 'profitability',
    label: '수익성',
    rows: [
      {
        label: '매출 (TTM)',
        text: (c) =>
          formatCompactMoney(c.fundamentals?.profitability.revenue ?? null, c.fundamentals?.profile.currency),
        raw: (c) => c.fundamentals?.profitability.revenue ?? null,
      },
      {
        label: '영업이익률',
        text: (c) => pct(c.fundamentals?.profitability.operatingMargin),
        raw: (c) => c.fundamentals?.profitability.operatingMargin ?? null,
        better: 'high',
      },
      {
        label: '순이익률',
        text: (c) => pct(c.fundamentals?.profitability.profitMargin),
        raw: (c) => c.fundamentals?.profitability.profitMargin ?? null,
        better: 'high',
      },
      {
        label: 'ROE',
        text: (c) => pct(c.fundamentals?.profitability.roe),
        raw: (c) => c.fundamentals?.profitability.roe ?? null,
        better: 'high',
      },
      {
        label: 'ROA',
        text: (c) => pct(c.fundamentals?.profitability.roa),
        raw: (c) => c.fundamentals?.profitability.roa ?? null,
        better: 'high',
      },
      {
        label: 'EPS',
        text: (c) => num(c.fundamentals?.valuation.eps),
        raw: (c) => c.fundamentals?.valuation.eps ?? null,
        better: 'high',
      },
      {
        label: 'EPS 성장률 (YoY)',
        text: (c) => pct(c.fundamentals?.profitability.earningsGrowth),
        raw: (c) => c.fundamentals?.profitability.earningsGrowth ?? null,
        better: 'high',
      },
    ],
  },
  {
    id: 'stability',
    label: '안정성',
    rows: [
      {
        // yfinance 의 debtToEquity 는 이미 퍼센트다 (145.0 = 145%).
        label: '부채비율',
        text: (c) => num(c.fundamentals?.stability.debtToEquity, 1, '%'),
        raw: (c) => c.fundamentals?.stability.debtToEquity ?? null,
        better: 'low',
      },
      {
        label: '유동비율',
        text: (c) => num(c.fundamentals?.stability.currentRatio),
        raw: (c) => c.fundamentals?.stability.currentRatio ?? null,
        better: 'high',
      },
      {
        label: '이자보상배율',
        text: (c) => num(c.fundamentals?.stability.interestCoverage, 1, '배'),
        raw: (c) => c.fundamentals?.stability.interestCoverage ?? null,
        better: 'high',
      },
      {
        label: '베타',
        text: (c) => num(c.fundamentals?.stability.beta),
        raw: (c) => c.fundamentals?.stability.beta ?? null,
        // 베타는 좋고 나쁨이 아니라 성향이다 — 최고·최저를 칠하지 않는다.
      },
    ],
  },
  {
    id: 'technical',
    label: '기술적 지표',
    rows: [
      {
        label: 'RSI (14)',
        text: (c) => num(c.summary?.indicators.rsi14, 1),
        tone: (c) => {
          const rsi = c.summary?.indicators.rsi14;
          if (rsi == null) return null;
          if (rsi >= 70) return 'text-warning';
          if (rsi <= 30) return 'text-bullish';
          return null;
        },
      },
      {
        label: 'MACD 신호',
        text: (c) => {
          const i = c.summary?.indicators;
          if (i?.macd == null || i.macdSignal == null) return NONE;
          return i.macd >= i.macdSignal ? '양전환 (시그널 위)' : '음전환 (시그널 아래)';
        },
        tone: (c) => {
          const i = c.summary?.indicators;
          if (i?.macd == null || i.macdSignal == null) return null;
          return i.macd >= i.macdSignal ? 'text-bullish' : 'text-bearish';
        },
      },
      ...(
        [
          ['20일선 대비', 'sma20'],
          ['60일선 대비', 'sma60'],
          ['52주 최고 대비', 'high52w'],
          ['52주 최저 대비', 'low52w'],
        ] as const
      ).map(([label, key]) => ({
        label,
        text: (c: Cell) => {
          const value = gap(c.summary?.price, c.summary?.indicators[key]);
          return value == null ? NONE : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
        },
        tone: (c: Cell) => {
          const value = gap(c.summary?.price, c.summary?.indicators[key]);
          return value == null ? null : changeColor(value);
        },
      })),
    ],
  },
];

/** PER 이 음수인 종목(적자)은 "가장 싸다" 로 읽히면 안 된다 — 비교에서 뺀다. */
function positive(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

interface Props {
  symbols: string[];
  names: (symbol: string) => string | null | undefined;
  fundamentals: Record<string, Fundamentals | null>;
  summaries: SymbolSummary[];
  loading: boolean;
}

export default function CompareTable({ symbols, names, fundamentals, summaries, loading }: Props) {
  const [section, setSection] = useState<string>('all');

  const cells: Cell[] = symbols.map((symbol) => {
    const f = fundamentals[symbol] ?? null;
    return {
      symbol,
      fundamentals: f,
      summary: summaries.find((s) => s.symbol === symbol),
      // 통화는 yfinance 가 준 값을 그대로 믿는다 (국내 종목이면 KRW).
      currency: f?.profile.currency === 'KRW' ? 'KRW' : 'USD',
    };
  });

  const shown = section === 'all' ? SECTIONS : SECTIONS.filter((s) => s.id === section);

  /** 한 행에서 가장 좋은 값·가장 나쁜 값을 찾는다 (열이 2개 이상일 때만 의미가 있다) */
  const extremes = (row: Row) => {
    if (!row.better || cells.length < 2) return null;
    const values = cells
      .map((cell) => row.raw?.(cell) ?? null)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length < 2) return null;
    const high = Math.max(...values);
    const low = Math.min(...values);
    if (high === low) return null;
    return row.better === 'high' ? { good: high, bad: low } : { good: low, bad: high };
  };

  return (
    <section className="rounded-md border border-border bg-bg-secondary">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <h3 className="mr-2 text-xs font-medium text-text-secondary">기업정보 비교</h3>
        {[{ id: 'all', label: '전체' }, ...SECTIONS].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
              section === s.id
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
        {loading && <span className="ml-auto text-[11px] text-text-muted">불러오는 중…</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              <th className="sticky left-0 z-10 bg-bg-secondary px-3 py-2 text-left font-medium">
                항목
              </th>
              {cells.map((cell) => (
                <th key={cell.symbol} className="px-3 py-2 text-right font-medium">
                  <span className="block text-text-primary">{names(cell.symbol) || cell.symbol}</span>
                  {names(cell.symbol) && (
                    <span className="block text-[10px] font-normal text-text-muted">
                      {cell.symbol}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {shown.map((group) => (
              <Fragment key={group.id}>
                <tr className="bg-bg-tertiary/40">
                  <td
                    colSpan={cells.length + 1}
                    className="px-3 py-1 text-[11px] font-medium text-text-secondary"
                  >
                    {group.label}
                  </td>
                </tr>
                {group.rows.map((row) => {
                  const edge = extremes(row);
                  return (
                    <tr key={`${group.id}-${row.label}`} className="border-b border-border/40">
                      <td className="sticky left-0 z-10 bg-bg-secondary px-3 py-1.5 text-text-secondary">
                        {row.label}
                      </td>
                      {cells.map((cell) => {
                        const raw = row.raw?.(cell) ?? null;
                        const color =
                          row.tone?.(cell) ??
                          (edge && raw != null
                            ? raw === edge.good
                              ? 'text-bullish'
                              : raw === edge.bad
                                ? 'text-bearish'
                                : null
                            : null);

                        return (
                          <td
                            key={cell.symbol}
                            className={`px-3 py-1.5 text-right tabular-nums ${color ?? 'text-text-primary'}`}
                          >
                            {row.text(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
