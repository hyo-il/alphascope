import { useEffect, useRef, useState } from 'react';
import StockName from '../common/StockName';

/**
 * 🎯 목표 수익률 — "관심 종목을 아무 날이나 샀다면, N일 안에 +X% 와 −Y% 중 어디에 먼저 닿았나".
 *
 * ⚠️ **보기 전용 기준선이다.** 여기서 고른 값으로 스윙 등급·추천·자동매매를 바꾸지 않는다 —
 * 진단 결과 무조건 매수의 기대값이 ≈0 이라, 목표만 바꾼다고 신호가 생기지 않는다.
 * 계산은 서버(`server/analysis/targetHit.ts`)가 하고 진단 리포트와 같은 함수다.
 */

interface Row {
  symbol: string;
  name: string | null;
  atr: number | null;
  samples?: number;
  hitTarget?: number;
  hitStop?: number;
  neither?: number;
  expectancy?: number;
  error?: string;
}

interface Result {
  target: number;
  stop: number;
  days: number;
  rows: Row[];
  spy: Row | null;
  asOf: string;
  computedAt: string;
}

const TARGETS = [3, 5, 10, 15];
const RATIOS: { value: number; label: string }[] = [
  { value: 0.5, label: '목표의 절반 (2:1)' },
  { value: 1, label: '목표와 같게 (1:1)' },
];
const HORIZONS = [5, 10, 20];

function Choice<T extends number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] text-text-muted">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
            value === option.value
              ? 'border-accent bg-accent/10 font-semibold text-accent'
              : 'border-border text-text-secondary hover:border-accent/50'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const fmt = (v: number | undefined, suffix = '%') => (v == null ? '—' : `${v.toFixed(1)}${suffix}`);

function expectancyClass(v: number | undefined): string {
  if (v == null) return 'text-text-muted';
  if (v > 0) return 'text-bullish';
  if (v < 0) return 'text-bearish';
  return 'text-text-secondary';
}

export default function TargetHitTab() {
  const [target, setTarget] = useState(5);
  const [ratio, setRatio] = useState(1);
  const [days, setDays] = useState(10);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 버튼을 빠르게 바꿀 때 늦게 온 이전 응답이 새 표를 덮지 않게 */
  const sequence = useRef(0);

  useEffect(() => {
    const mine = ++sequence.current;
    setLoading(true);
    setError(null);
    fetch(`/api/swing/target-hit?target=${target}&stopRatio=${ratio}&days=${days}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? `요청 실패 (${response.status})`);
        return payload as Result;
      })
      .then((data) => {
        if (mine === sequence.current) setResult(data);
      })
      .catch((e: Error) => {
        if (mine === sequence.current) setError(e.message);
      })
      .finally(() => {
        if (mine === sequence.current) setLoading(false);
      });
  }, [target, ratio, days]);

  const spy = result?.spy ?? null;
  const rows = [...(result?.rows ?? [])].sort(
    (a, b) => (b.expectancy ?? -Infinity) - (a.expectancy ?? -Infinity),
  );

  const renderRow = (row: Row, isSpy = false) => {
    const beatsMarket =
      !isSpy && spy?.expectancy != null && row.expectancy != null && row.expectancy > spy.expectancy;
    const dayCount = row.atr ? (result!.target / row.atr).toFixed(1) : null;
    return (
      <tr
        key={isSpy ? 'SPY-base' : row.symbol}
        className={`border-t border-border ${isSpy ? 'bg-bg-tertiary/40' : ''}`}
      >
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            {isSpy ? (
              <span className="text-text-primary">
                {row.name} <span className="text-[10px] text-text-secondary">SPY</span>
              </span>
            ) : (
              <StockName symbol={row.symbol} name={row.name ?? undefined} />
            )}
            {beatsMarket && (
              <span className="rounded bg-bullish/10 px-1 text-[10px] text-bullish">시장보다 ↑</span>
            )}
          </div>
          {row.error ? (
            <p className="text-[10px] text-warning">{row.error}</p>
          ) : (
            dayCount && (
              <p className="text-[10px] text-text-muted">
                목표 {result!.target}% = 이 종목 하루 움직임의 약 {dayCount}일치
              </p>
            )
          )}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.atr ?? undefined)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.hitTarget)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.hitStop)}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-text-secondary">{fmt(row.neither)}</td>
        <td className={`px-2 py-1.5 text-right font-medium tabular-nums ${expectancyClass(row.expectancy)}`}>
          {row.expectancy == null ? '—' : `${row.expectancy > 0 ? '+' : ''}${row.expectancy.toFixed(2)}%p`}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-text-muted">{row.samples ?? '—'}</td>
      </tr>
    );
  };

  return (
    <div className="space-y-3">
      {/* 항상 보인다 — 이 표를 신호로 읽지 않게 하는 문장이다 */}
      <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
        아무 신호 없이 매일 샀을 때의 과거 빈도입니다. 예측이 아니며 미래를 보장하지 않습니다. 매매
        신호는 이 기준선보다 나아야 의미가 있습니다.
      </p>

      <div className="space-y-2 rounded-lg border border-border bg-bg-secondary px-3 py-2.5">
        <Choice
          label="목표 수익"
          options={TARGETS.map((v) => ({ value: v, label: `${v}%` }))}
          value={target}
          onChange={setTarget}
        />
        <Choice label="손절" options={RATIOS} value={ratio} onChange={setRatio} />
        <Choice
          label="기간"
          options={HORIZONS.map((v) => ({ value: v, label: `${v}일` }))}
          value={days}
          onChange={setDays}
        />
        <p className="text-[11px] text-text-muted">
          +{target}% 목표 · −{target * ratio}% 손절 · {days}거래일 안 · 대상: 관심 목록 전체 + SPY ·
          최근 250거래일
          {result && ` · 마지막 봉 ${new Date(result.asOf).toLocaleDateString('ko-KR')}`}
          {loading && ' · 계산 중…'}
        </p>
      </div>

      {error && (
        <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
          {error}
        </p>
      )}

      {result && !result.rows.length && (
        <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
          관심 목록이 비어 있습니다. 오른쪽 관심 목록에 종목을 담으면 여기에 나옵니다.
        </p>
      )}

      {result && (result.rows.length > 0 || spy) && (
        <div className={`overflow-x-auto rounded-lg border border-border ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-xs">
            <thead className="bg-bg-secondary text-[11px] text-text-secondary">
              <tr>
                <th className="px-2 py-1.5 text-left font-normal">종목</th>
                <th className="px-2 py-1.5 text-right font-normal">하루 평균 움직임</th>
                <th className="px-2 py-1.5 text-right font-normal">목표 먼저</th>
                <th className="px-2 py-1.5 text-right font-normal">손절 먼저</th>
                <th className="px-2 py-1.5 text-right font-normal">둘 다 안 닿음</th>
                <th className="px-2 py-1.5 text-right font-normal">기대값 (비용 반영) ▾</th>
                <th className="px-2 py-1.5 text-right font-normal">표본</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => renderRow(row))}
              {spy && renderRow(spy, true)}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-text-muted">
        같은 날 목표와 손절에 모두 닿으면 손절로 셉니다(보수적). 기대값 = 목표 먼저 × 목표 − 손절
        먼저 × 손절 − 왕복 비용 0.30%p. 하루 평균 움직임은 ATR(14) ÷ 종가입니다.
      </p>
    </div>
  );
}
